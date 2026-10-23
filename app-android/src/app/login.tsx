import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Field, colors, errorText } from '../components/ui';
import { getApiUrl, getServerMode, post } from '../lib/api';
import { useSession } from '../session';
import type { Profile } from '../types';

export default function Login() {
  const { signIn } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [server, setServerLabel] = useState('');
  // Se muestra la base de datos de cada opcion; la direccion de la API queda en la pantalla Servidor
  const MODE = { cloud: 'Nube · PostgreSQL en Neon', local: 'Local · SQL Server', custom: 'Servidor' } as const;
  useFocusEffect(useCallback(() => setServerLabel(getApiUrl() ? (getServerMode() === 'custom' ? `Servidor · ${getApiUrl()}` : MODE[getServerMode()]) : 'Configurar servidor'), [])); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await post<{ token: string; user: Profile }>('/auth/login', { username: username.trim().toLowerCase(), password });
      await signIn(r.token, r.user);
      router.replace(r.user.consentRequired ? '/consent' : '/home');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.primary }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <View style={s.brand}>
          <View style={s.logo}>
            <Ionicons name="qr-code" size={34} color={colors.primary} />
          </View>
          <Text style={s.title}>AcademiaPass</Text>
          <Text style={s.subtitle}>Clases, reservas, planes y asistencia con QR</Text>
        </View>
        <View style={s.card}>
          <Field label="Usuario" value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="tu.usuario" testID="login-user" />
          <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="••••••••" testID="login-pass" onSubmitEditing={submit} />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Button label="Ingresar" onPress={submit} loading={busy} disabled={!username || !password} testID="login-submit" />
          <View style={s.links}>
            <Pressable onPress={() => router.push('/register')}><Text style={s.link}>Crear cuenta de cliente</Text></Pressable>
            <Pressable onPress={() => router.push('/register-admin')}><Text style={s.link}>Registrar mi academia</Text></Pressable>
          </View>
        </View>
        <Pressable onPress={() => router.push('/server')} style={s.server}>
          <Ionicons name="cloud-outline" size={15} color="#CCFBF1" />
          <Text style={{ color: '#CCFBF1', fontSize: 12 }}>{server}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 20, width: '100%', maxWidth: 460, alignSelf: 'center' },
  brand: { alignItems: 'center', marginBottom: 24 },
  logo: { width: 68, height: 68, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#CCFBF1', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 18 },
  error: { color: colors.danger, marginBottom: 10 },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, flexWrap: 'wrap', gap: 8 },
  link: { color: colors.primary, fontWeight: '700' },
  server: { flexDirection: 'row', gap: 6, alignItems: 'center', alignSelf: 'center', marginTop: 20, padding: 8 },
});
