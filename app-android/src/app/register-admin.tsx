import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Checkbox, Field, Gap, Muted, Screen, Section, colors, errorText, notify } from '../components/ui';
import { post } from '../lib/api';
import { useSession } from '../session';
import type { Profile } from '../types';

/** Alta de un administrador con su organizacion, su primera academia y su primera sede */
export default function RegisterAdmin() {
  const { signIn } = useSession();
  const [f, setF] = useState({ organization: '', academyName: '', siteName: 'Sede principal', fullName: '', document: '', email: '', phone: '', username: '', password: '', signupCode: '' });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await post<{ token?: string; user?: Profile; pending?: boolean; message?: string }>('/auth/register-admin', {
        ...f, email: f.email || null, phone: f.phone || null, username: f.username.trim().toLowerCase(), signupCode: f.signupCode || undefined, consent,
      });
      if (r.pending || !r.token) {
        // RQ58: el administrador general debe activar la organizacion antes del primer ingreso
        notify('Registro recibido', r.message ?? 'Podrás ingresar cuando el administrador general active tu organización.');
        router.replace('/login');
        return;
      }
      await signIn(r.token, r.user!);
      router.replace('/home');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Registrar mi academia">
      <Muted>Crea tu organización. Luego podrás agregar más academias, sedes, espacios, planes y usuarios.</Muted>
      <Section title="Organización">
        <Card>
          <Field label="Nombre de la organización" value={f.organization} onChangeText={set('organization')} />
          <Field label="Primera academia" value={f.academyName} onChangeText={set('academyName')} />
          <Field label="Primera sede" value={f.siteName} onChangeText={set('siteName')} />
        </Card>
      </Section>
      <Section title="Administrador">
        <Card>
          <Field label="Nombre completo" value={f.fullName} onChangeText={set('fullName')} />
          <Field label="Documento" value={f.document} onChangeText={set('document')} autoCapitalize="characters" />
          <Field label="Correo" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Celular" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
          <Field label="Usuario" value={f.username} onChangeText={set('username')} autoCapitalize="none" />
          <Field label="Contraseña" value={f.password} onChangeText={set('password')} secureTextEntry autoCapitalize="none" hint="Mínimo 8 caracteres." />
          <Field label="Código de alta (si el servidor lo exige)" value={f.signupCode} onChangeText={set('signupCode')} autoCapitalize="none" />
          <Checkbox checked={consent} onChange={setConsent}>
            Acepto el tratamiento de mis datos y me comprometo a usar los datos de mis clientes solo para la gestión de mis academias.
          </Checkbox>
        </Card>
      </Section>
      {error ? <Text style={{ color: colors.danger, marginVertical: 8 }}>{error}</Text> : null}
      <Gap h={4} />
      <Button label="Crear organización" onPress={submit} loading={busy} disabled={!consent} />
    </Screen>
  );
}
