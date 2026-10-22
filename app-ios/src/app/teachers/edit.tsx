import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Button, Card, Chips, Field, Loading, Screen, Toggle, errorText, notify, useLoad } from '../../components/ui';
import { post, put } from '../../lib/api';
import type { Teacher } from '../../types';

/** Profesor interno (de la academia) o externo (alquila espacios para sus clases) (RQ5) */
export default function TeacherEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const teachers = useLoad<Teacher[]>(id ? '/teachers' : null);
  const [f, setF] = useState({ fullName: '', kind: 'internal' as 'internal' | 'external', phone: '', email: '', specialty: '', active: true });
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = teachers.data?.find((x) => x.id === Number(id));
    if (t && !loaded) {
      setF({ fullName: t.full_name, kind: t.kind, phone: t.phone ?? '', email: t.email ?? '', specialty: t.specialty ?? '', active: t.active });
      setLoaded(true);
    }
  }, [teachers.data, id, loaded]);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, phone: f.phone || null, email: f.email || null, specialty: f.specialty || null };
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
        <Toggle label="Activo" value={f.active} onChange={(v) => setF({ ...f, active: v })} />
        <Button label="Guardar" onPress={save} loading={busy} disabled={!f.fullName.trim()} />
      </Card>
    </Screen>
  );
}
