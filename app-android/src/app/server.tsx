import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Field, Gap, Muted, Screen, Section, colors, errorText, notify } from '../components/ui';
import { type ServerMode, checkServer, getApiUrl, getServerMode, isWebSameOrigin, loginAt, normalizeUrl, presetUrl, setServer } from '../lib/api';
import { useSession } from '../session';

const OPTIONS: { mode: Exclude<ServerMode, 'custom'>; title: string; icon: React.ComponentProps<typeof Ionicons>['name']; desc: string; dbKey: string }[] = [
  { mode: 'cloud', title: 'Nube · PostgreSQL en Neon', icon: 'cloud-outline', dbKey: 'cloudDatabase', desc: 'Los mismos datos en todos los teléfonos y en la web.' },
  { mode: 'local', title: 'Local · SQL Server', icon: 'desktop-outline', dbKey: 'localDatabase', desc: 'Base en tu PC. El teléfono debe estar en la misma red Wi-Fi.' },
];

type DbInfo = { engine: string; provider: string; host: string; database: string };

/** Base de datos que reporta cada servidor en /api/health; si no responde, la descripcion de app.json */
function useDatabaseInfo() {
  const [info, setInfo] = useState<Record<string, { text: string; online: boolean }>>({});
  useEffect(() => {
    const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
    for (const o of OPTIONS) {
      const fallback = extra[o.dbKey] ?? '';
      setInfo((x) => ({ ...x, [o.mode]: { text: fallback, online: false } }));
      const url = presetUrl(o.mode);
      if (!url) continue;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      fetch(`${url}/api/health`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((h: { database?: DbInfo }) => {
          const d = h.database;
          const text = d ? `${d.engine}${d.provider !== d.engine ? ` en ${d.provider}` : ''} · ${d.host}${d.database && d.engine === 'SQL Server' ? ` / ${d.database}` : ''}` : fallback;
          setInfo((x) => ({ ...x, [o.mode]: { text, online: true } }));
        })
        .catch(() => {})
        .finally(() => clearTimeout(t));
    }
  }, []);
  return info;
}

/**
 * Seleccion del servidor (nube, local u otra direccion). Solo un administrador puede cambiarlo: el usuario y la
 * clave se validan contra la tabla de usuarios de la base del servidor elegido (no se guarda ninguna clave en el
 * telefono). Al confirmar solo cambia el servidor (RQ59): la sesion se cierra y cada persona ingresa con su usuario.
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
  const { user, signOut } = useSession();
  const [mode, setMode] = useState<ServerMode>(getServerMode());
  const dbs = useDatabaseInfo();
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
      // RQ59: solo se cambia el servidor (y su base de datos); no se abre sesion con el admin que autorizo.
      // setServer borra el token; signOut deja la app en la pantalla de ingreso del servidor nuevo
      setPassword('');
      notify('Servidor cambiado', `La app ahora usa ${dbs[mode]?.text || url}. Inicia sesión con tu usuario de ese servidor.`);
      await signOut();
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
                <Ionicons name="server-outline" size={13} color={colors.primary} />
                <Text style={[s.url, { flex: 1, marginVertical: 0 }]}>Base de datos: {dbs[o.mode]?.text || '—'}</Text>
              </View>
              <Muted style={{ fontSize: 12 }}>
                API: {url || 'no configurada'} · {dbs[o.mode]?.online ? 'en línea' : 'sin respuesta todavía'}
              </Muted>
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
          <Button label="Autorizar y cambiar de servidor" icon="checkmark" onPress={save} loading={busy} disabled={!username.trim() || !password} testID="server-save" />
        </Card>
      </Section>

      <Section title="Importante">
        <Card>
          <Muted>• Cada servidor tiene su propia base de datos y sus propios usuarios. El administrador solo autoriza el cambio: después cada persona inicia sesión con su usuario de ese servidor.</Muted>
          <Muted>• El usuario inicial es admin; su clave inicial la define quien instala el servidor. Cámbiala en Mi perfil → Contraseña: queda guardada en la base de ese servidor.</Muted>
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
