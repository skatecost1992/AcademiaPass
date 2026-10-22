import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Field, Gap, Muted, Screen, Section, colors, errorText } from '../components/ui';
import { type ServerMode, checkServer, getApiUrl, getServerMode, isWebSameOrigin, loginAt, normalizeUrl, presetUrl, setServer } from '../lib/api';
import { useSession } from '../session';
import type { Profile } from '../types';

const OPTIONS: { mode: Exclude<ServerMode, 'custom'>; title: string; icon: React.ComponentProps<typeof Ionicons>['name']; desc: string }[] = [
  { mode: 'cloud', title: 'Nube (web)', icon: 'cloud-outline', desc: 'Servidor en internet. Los mismos datos en todos los teléfonos y en la web.' },
  { mode: 'local', title: 'Local (red Wi-Fi)', icon: 'desktop-outline', desc: 'Backend en tu PC con la base de SQL Server. El teléfono debe estar en la misma red Wi-Fi.' },
];

/**
 * Seleccion del servidor (nube, local u otra direccion). Solo un administrador puede cambiarlo: el usuario y la
 * clave se validan contra la tabla de usuarios de la base del servidor elegido (no se guarda ninguna clave en el
 * telefono). Al confirmar, la app queda conectada a ese servidor con la sesion de ese administrador.
 */
export default function Server() {
  if (isWebSameOrigin()) {
    return (
      <Screen title="Servidor">
        <Card>
          <Muted>La versión web usa siempre el servidor desde el que se abrió:</Muted>
          <Text style={s.url}>{getApiUrl()}</Text>
        </Card>
      </Screen>
    );
  }
  return <ServerOptions />;
}

function ServerOptions() {
  const { user, signIn } = useSession();
  const [mode, setMode] = useState<ServerMode>(getServerMode());
  const [custom, setCustom] = useState(getServerMode() === 'custom' ? getApiUrl() : '');
  const [username, setUsername] = useState(user?.role === 'admin' ? user.username : 'admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const urlFor = (m: ServerMode) => (m === 'custom' ? normalizeUrl(custom) : presetUrl(m));

  const save = async () => {
    const url = urlFor(mode);
    setError(null);
    if (!url) return setError('Escribe la dirección del servidor.');
    setBusy(true);
    try {
      await checkServer(url);
      const r = await loginAt(url, username, password);
      if (r.user.role !== 'admin') throw new Error('Solo un usuario administrador puede cambiar la conexión.');
      await setServer(mode, url);
      await signIn(r.token, r.user as Profile);
      setPassword('');
      if (router.canDismiss()) router.dismissAll();
      router.replace(r.user.consentRequired ? '/consent' : '/home');
    } catch (e) {
      setError(`${url}\n${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Servidor">
      <Muted>Servidor actual: {getApiUrl() || 'sin configurar'}</Muted>
      <Gap />
      {OPTIONS.map((o) => {
        const on = mode === o.mode;
        const url = presetUrl(o.mode);
        return (
          <Pressable key={o.mode} onPress={() => setMode(o.mode)} style={[s.option, on && s.optionOn]} testID={`server-${o.mode}`}>
            <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.primary : colors.muted} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name={o.icon} size={16} color={colors.text} />
                <Text style={s.title}>{o.title}</Text>
              </View>
              <Text style={s.url}>{url || 'No configurada en app.json'}</Text>
              <Muted style={{ fontSize: 12 }}>{o.desc}</Muted>
            </View>
          </Pressable>
        );
      })}
      <Pressable onPress={() => setMode('custom')} style={[s.option, mode === 'custom' && s.optionOn]}>
        <Ionicons name={mode === 'custom' ? 'radio-button-on' : 'radio-button-off'} size={22} color={mode === 'custom' ? colors.primary : colors.muted} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Otra dirección</Text>
          <Muted style={{ fontSize: 12 }}>Por ejemplo otra IP de tu PC o un servidor de pruebas.</Muted>
        </View>
      </Pressable>
      {mode === 'custom' ? (
        <Field label="Dirección" value={custom} onChangeText={setCustom} autoCapitalize="none" keyboardType="url" placeholder="http://192.168.1.50:8080" />
      ) : null}

      <Section title="Administrador de ese servidor">
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.primary} />
            <Muted style={{ flex: 1 }}>Solo un administrador puede cambiar la conexión. Se valida en la base de datos del servidor elegido.</Muted>
          </View>
          <Field label="Usuario" value={username} onChangeText={setUsername} autoCapitalize="none" testID="config-user" />
          <Field label="Clave" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" testID="config-pass" onSubmitEditing={save} />
          {error ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{error}</Text> : null}
          <Button label="Validar y usar este servidor" icon="checkmark" onPress={save} loading={busy} disabled={!username.trim() || !password} testID="server-save" />
        </Card>
      </Section>

      <Section title="Importante">
        <Card>
          <Muted>• Cada servidor tiene su propia base de datos y sus propios usuarios. Al cambiar, la app queda con la sesión del administrador validado.</Muted>
          <Muted>• El usuario inicial es admin (clave inicial Bogota.2027). Cámbiala en Mi perfil → Contraseña: queda guardada en la base de ese servidor.</Muted>
          <Muted>• Local: en el PC ejecuta iniciar-local-sqlserver.ps1 dentro de backend.</Muted>
          <Muted>• Nube gratuita: si estuvo inactiva, la primera conexión tarda hasta 1 minuto.</Muted>
        </Card>
      </Section>
      <Button label="Volver" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const s = StyleSheet.create({
  option: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 14, marginBottom: 10 },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  title: { fontSize: 15, fontWeight: '800', color: colors.text },
  url: { fontSize: 13, color: colors.primary, fontWeight: '700', marginVertical: 3 },
});
