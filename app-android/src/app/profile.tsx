import { router } from 'expo-router';
import React, { useState } from 'react';
import { Badge, Button, Card, Field, Gap, InfoRow, Screen, Section, errorText, notify } from '../components/ui';
import { getApiUrl, post, put } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useSession } from '../session';
import type { Profile } from '../types';

export default function ProfileScreen() {
  const { user, setUser, signOut, isClient } = useSession();
  const [f, setF] = useState({ fullName: user?.fullName ?? '', email: user?.email ?? '', phone: user?.phone ?? '' });
  const [pw, setPw] = useState({ current: '', password: '' });
  const [busy, setBusy] = useState<'p' | 'w' | null>(null);
  if (!user) return null;

  const save = async () => {
    setBusy('p');
    try {
      setUser(await put<Profile>('/me', { fullName: f.fullName, email: f.email || null, phone: f.phone || null }));
      notify('Datos actualizados');
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const changePassword = async () => {
    setBusy('w');
    try {
      await post('/me/password', pw);
      setPw({ current: '', password: '' });
      notify('Contraseña actualizada');
    } catch (e) {
      notify('No se pudo cambiar', errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title="Mi perfil">
      <Card>
        <InfoRow label="Usuario" value={user.username} />
        <InfoRow label="Documento" value={user.document} />
        <InfoRow label="Organización" value={user.tenant.name} />
        <InfoRow label="Rol" value={<Badge text={user.role === 'admin' ? 'Administrador' : user.role === 'staff' ? 'Personal' : 'Cliente'} />} />
        {user.consentAt ? <InfoRow label="Tratamiento de datos" value={`Aceptado ${fmtDate(user.consentAt)}`} /> : null}
      </Card>
      {!isClient && user.academies.length ? (
        <Section title="Códigos de inscripción de clientes">
          <Card>
            {user.academies.map((a) => <InfoRow key={a.id} label={a.name} value={a.join_code ?? ''} />)}
          </Card>
        </Section>
      ) : null}
      <Section title="Mis datos">
        <Card>
          <Field label="Nombre completo" value={f.fullName} onChangeText={(v) => setF({ ...f, fullName: v })} />
          <Field label="Correo" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Celular" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" />
          <Button label="Guardar" onPress={save} loading={busy === 'p'} />
        </Card>
      </Section>
      <Section title="Contraseña">
        <Card>
          <Field label="Contraseña actual" value={pw.current} onChangeText={(v) => setPw({ ...pw, current: v })} secureTextEntry autoCapitalize="none" />
          <Field label="Nueva contraseña" value={pw.password} onChangeText={(v) => setPw({ ...pw, password: v })} secureTextEntry autoCapitalize="none" hint="Mínimo 8 caracteres." />
          <Button label="Cambiar contraseña" variant="secondary" onPress={changePassword} loading={busy === 'w'} disabled={!pw.current || pw.password.length < 8} />
        </Card>
      </Section>
      <Section title="Aplicación">
        <Card>
          <InfoRow label="Servidor" value={getApiUrl()} />
          <Gap h={6} />
          <Button label="Cambiar servidor" variant="ghost" icon="cloud-outline" onPress={() => router.push('/server')} />
        </Card>
      </Section>
      <Button label="Cerrar sesión" variant="danger" icon="log-out-outline" onPress={signOut} testID="logout" />
    </Screen>
  );
}
