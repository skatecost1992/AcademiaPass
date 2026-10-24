import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Button, Card, Chips, Field, Loading, Muted, Screen, Section, Toggle, errorText, notify, useLoad } from '../../components/ui';
import { post, put } from '../../lib/api';
import { useSession } from '../../session';
import type { Permission, Site, Teacher } from '../../types';

/** RQ69: permisos que puede tener el usuario de un profesor */
const TEACHER_PERMS: { value: Permission; label: string }[] = [
  { value: 'classes', label: 'Crear sus clases' },
  { value: 'bookings', label: 'Separar espacios' },
  { value: 'attendance', label: 'Registrar asistencia' },
  { value: 'booking_rules', label: 'Parametrizar reglas' },
];

/**
 * Profesor interno (de la academia) o externo (alquila espacios para sus clases) (RQ5). RQ69: el administrador le
 * puede crear un usuario para entrar a la app, con permisos de profesor (solo gestiona sus propias clases).
 */
export default function TeacherEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { isAdmin } = useSession();
  const [acc, setAcc] = useState({ enabled: false, exists: false, username: '', password: '', document: '', permissions: ['classes', 'bookings', 'attendance'] as Permission[], active: true });
  const teachers = useLoad<Teacher[]>(id ? '/teachers' : null);
  const [f, setF] = useState({ fullName: '', kind: 'internal' as 'internal' | 'external', phone: '', email: '', specialty: '', active: true });
  const [siteIds, setSiteIds] = useState<number[]>([]);
  const sites = useLoad<Site[]>('/sites');
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = teachers.data?.find((x) => x.id === Number(id));
    if (t && !loaded) {
      setF({ fullName: t.full_name, kind: t.kind, phone: t.phone ?? '', email: t.email ?? '', specialty: t.specialty ?? '', active: t.active });
      setSiteIds(t.sites.map((x) => x.id));
      if (t.account) setAcc((a) => ({ ...a, enabled: true, exists: true, username: t.account!.username, permissions: t.account!.permissions, active: t.account!.active }));
      setLoaded(true);
    }
  }, [teachers.data, id, loaded]);

  const save = async () => {
    setBusy(true);
    try {
      const account = isAdmin && acc.enabled
        ? (acc.exists
          ? { permissions: acc.permissions, active: acc.active, password: acc.password || undefined }
          : { username: acc.username.trim(), password: acc.password, document: acc.document.trim(), permissions: acc.permissions, active: acc.active })
        : undefined;
      const body = { ...f, phone: f.phone || null, email: f.email || null, specialty: f.specialty || null, siteIds, account };
      if (id) await put(`/teachers/${id}`, body);
      else await post('/teachers', body);
      router.back();
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Screen title="Profesor"><Loading /></Screen>;
  return (
    <Screen title={id ? 'Editar profesor' : 'Nuevo profesor'}>
      <Card>
        <Field label="Nombre completo" value={f.fullName} onChangeText={(v) => setF({ ...f, fullName: v })} />
        <Chips label="Tipo" options={[{ value: 'internal' as const, label: 'Interno' }, { value: 'external' as const, label: 'Externo' }]} value={f.kind} onChange={(v) => setF({ ...f, kind: v })}
          hint="Externo: dicta sus clases alquilando espacios de la academia." />
        <Field label="Especialidad" value={f.specialty} onChangeText={(v) => setF({ ...f, specialty: v })} />
        <Field label="Celular" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" />
        <Field label="Correo" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" />
        {/* RQ62: solo puede dar clases en las sedes asignadas, y en una sola a la vez */}
        <Chips multi label="Sedes donde da clase" options={(sites.data ?? []).filter((x) => x.active).map((x) => ({ value: x.id, label: `${x.name} (${x.academy_name})` }))}
          values={siteIds} onChangeMulti={setSiteIds} hint="Un profesor no puede tener dos clases a la misma hora, aunque sean en sedes distintas." />
        <Toggle label="Activo" value={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </Card>
      {isAdmin ? (
        <Section title="Usuario para entrar a la app">
          <Card>
            <Toggle label={acc.exists ? `Usuario: ${acc.username}` : 'Crear usuario para el profesor'} value={acc.enabled}
              onChange={(v) => setAcc({ ...acc, enabled: v || acc.exists })}
              hint="Entra con su usuario y solo gestiona sus clases: las crea, separa espacios, registra asistencia y las cancela con la anticipación de Reglas de reserva." />
            {acc.enabled ? (
              <>
                {!acc.exists ? (
                  <>
                    <Field label="Usuario" value={acc.username} onChangeText={(v) => setAcc({ ...acc, username: v })} autoCapitalize="none" />
                    <Field label="Documento" value={acc.document} onChangeText={(v) => setAcc({ ...acc, document: v })} keyboardType="number-pad" />
                  </>
                ) : null}
                <Field label={acc.exists ? 'Nueva contraseña (opcional)' : 'Contraseña'} value={acc.password} onChangeText={(v) => setAcc({ ...acc, password: v })}
                  secureTextEntry autoCapitalize="none" hint="Mínimo 8 caracteres." />
                <Chips multi label="Permisos" options={TEACHER_PERMS} values={acc.permissions} onChangeMulti={(v) => setAcc({ ...acc, permissions: v })} />
                {acc.exists ? <Toggle label="Usuario activo" value={acc.active} onChange={(v) => setAcc({ ...acc, active: v })} /> : null}
              </>
            ) : null}
          </Card>
        </Section>
      ) : <Muted>Solo el administrador crea el usuario del profesor.</Muted>}
      <Button label="Guardar" onPress={save} loading={busy}
        disabled={!f.fullName.trim() || siteIds.length === 0 || (isAdmin && acc.enabled && !acc.exists && (acc.username.trim().length < 3 || acc.password.length < 8 || acc.document.trim().length < 4))
          || (isAdmin && acc.enabled && acc.exists && acc.password.length > 0 && acc.password.length < 8)} />
    </Screen>
  );
}
