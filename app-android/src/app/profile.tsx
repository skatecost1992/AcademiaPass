import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Gap, InfoRow, Muted, Screen, Section, Toggle, colors, errorText, notify, useLoad } from '../components/ui';
import { getApiUrl, post, put } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useSession } from '../session';
import type { MyNotifications, Profile } from '../types';

/**
 * Correos que recibe el usuario (RQ63, RQ64). Solo se envian los que la organizacion tiene activos y si el
 * usuario registro su correo en "Mis datos".
 */
function MyNotificationsCard({ email }: { email: string | null }) {
  const state = useLoad<MyNotifications>('/me/notifications');
  const [f, setF] = useState({ dayBefore: true, hoursBefore: true, plan: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (state.data) setF({ dayBefore: state.data.dayBefore, hoursBefore: state.data.hoursBefore, plan: state.data.plan });
  }, [state.data]);
  const org = state.data?.organization;
  const off = (on: boolean | undefined) => (org && !on ? 'Tu organización no envía este correo.' : undefined);

  const save = async () => {
    setBusy(true);
    try {
      await put('/me/notifications', f);
      notify('Preferencias guardadas');
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Notificaciones por correo">
      <Card>
        {!email ? <Muted style={{ color: colors.danger, marginBottom: 8 }}>Registra tu correo en "Mis datos" para recibir estos avisos.</Muted> : <Muted style={{ marginBottom: 8 }}>Se envían a {email}</Muted>}
        <Toggle label={`Recordatorio ${org?.dayBeforeHours ?? 24} horas antes`} value={f.dayBefore} onChange={(v) => setF({ ...f, dayBefore: v })}
          hint={off(org?.dayBefore) ?? 'Un día antes de cada reserva o clase reservada.'} />
        <Toggle label={`Recordatorio ${org?.hoursBeforeHours ?? 3} horas antes`} value={f.hoursBefore} onChange={(v) => setF({ ...f, hoursBefore: v })}
          hint={off(org?.hoursBefore)} />
        <Toggle label="Vencimiento de mi plan" value={f.plan} onChange={(v) => setF({ ...f, plan: v })}
          hint={off(org?.plan) ?? `Aviso ${org?.planNoticeDays ?? 3} día(s) antes y cuando vence, con las clases tomadas y pendientes.`} />
        <Button label="Guardar preferencias" variant="secondary" onPress={save} loading={busy} disabled={!state.data} />
      </Card>
    </Section>
  );
}

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
      <MyNotificationsCard email={user.email} />
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
