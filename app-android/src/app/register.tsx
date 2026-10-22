import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text } from 'react-native';
import { CONSENT_TITLE, ConsentText } from '../components/shared';
import { Button, Card, Checkbox, Field, Gap, Muted, Screen, Section, colors, errorText } from '../components/ui';
import { post } from '../lib/api';
import { useSession } from '../session';
import type { Profile } from '../types';

/**
 * Registro de clientes con el codigo de la academia (RQ7). Si la persona ya tiene cuenta en otra organizacion,
 * crea aqui un usuario y contrasena nuevos que quedan ligados a su mismo documento (RQ26).
 */
export default function Register() {
  const { signIn } = useSession();
  const [f, setF] = useState({ joinCode: '', fullName: '', document: '', email: '', phone: '', username: '', password: '', password2: '' });
  const [consent, setConsent] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    setError(null);
    if (f.password !== f.password2) return setError('Las contraseñas no coinciden');
    setBusy(true);
    try {
      const r = await post<{ token: string; user: Profile }>('/auth/register-client', {
        joinCode: f.joinCode, fullName: f.fullName, document: f.document, email: f.email || null, phone: f.phone || null,
        username: f.username.trim().toLowerCase(), password: f.password, consent,
      });
      await signIn(r.token, r.user);
      router.replace('/home');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Crear cuenta">
      <Card>
        <Field label="Código de la academia" value={f.joinCode} onChangeText={set('joinCode')} autoCapitalize="characters" placeholder="Ej. K7P2QX" hint="Pídelo en la recepción de tu academia." />
        <Field label="Nombre completo" value={f.fullName} onChangeText={set('fullName')} />
        <Field label="Documento de identidad" value={f.document} onChangeText={set('document')} autoCapitalize="characters" hint="Si ya estás registrado en otra organización usa el mismo documento." />
        <Field label="Correo" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Celular" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label="Usuario" value={f.username} onChangeText={set('username')} autoCapitalize="none" hint="Será tu usuario para ingresar en esta organización." />
        <Field label="Contraseña" value={f.password} onChangeText={set('password')} secureTextEntry autoCapitalize="none" hint="Mínimo 8 caracteres." />
        <Field label="Repite la contraseña" value={f.password2} onChangeText={set('password2')} secureTextEntry autoCapitalize="none" />
      </Card>
      <Section title={CONSENT_TITLE}>
        <Card>
          {showConsent ? <ConsentText /> : <Muted>Tus datos serán tratados únicamente por las academias en las que te registres y sus funcionarios.</Muted>}
          <Text onPress={() => setShowConsent(!showConsent)} style={{ color: colors.primary, fontWeight: '700', marginTop: 6 }}>
            {showConsent ? 'Ver menos' : 'Leer la autorización completa'}
          </Text>
          <Checkbox checked={consent} onChange={setConsent} testID="register-consent">
            Acepto el tratamiento de mis datos personales.
          </Checkbox>
        </Card>
      </Section>
      {error ? <Text style={{ color: colors.danger, marginVertical: 8 }}>{error}</Text> : null}
      <Gap h={4} />
      <Button label="Crear cuenta" onPress={submit} loading={busy} disabled={!consent} testID="register-submit" />
    </Screen>
  );
}
