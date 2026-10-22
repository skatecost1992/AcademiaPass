import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Button, Card, Chips, Field, Loading, Screen, Toggle, errorText, notify, useLoad } from '../../components/ui';
import { post, put } from '../../lib/api';
import type { Academy, ClassDef, Teacher } from '../../types';

export default function ClassEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const academies = useLoad<Academy[]>('/academies');
  const teachers = useLoad<Teacher[]>('/teachers');
  const classes = useLoad<ClassDef[]>(id ? '/classes' : null);
  const [f, setF] = useState({ academyId: 0, teacherId: null as number | null, name: '', description: '', defaultCapacity: '15', active: true });
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = classes.data?.find((x) => x.id === Number(id));
    if (c && !loaded) {
      setF({ academyId: c.academy_id, teacherId: c.teacher_id, name: c.name, description: c.description ?? '', defaultCapacity: String(c.default_capacity), active: c.active });
      setLoaded(true);
    }
  }, [classes.data, id, loaded]);
  useEffect(() => {
    if (!f.academyId && academies.data?.length === 1) setF((x) => ({ ...x, academyId: academies.data![0].id }));
  }, [academies.data, f.academyId]);

  const save = async () => {
    setBusy(true);
    try {
      const body = { academyId: f.academyId, teacherId: f.teacherId, name: f.name, description: f.description || null, defaultCapacity: Number(f.defaultCapacity), active: f.active };
      if (id) await put(`/classes/${id}`, body);
      else await post('/classes', body);
      router.back();
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Screen title="Clase"><Loading /></Screen>;
  return (
    <Screen title={id ? 'Editar clase' : 'Nueva clase'}>
      <Card>
        <Chips label="Academia" options={(academies.data ?? []).map((a) => ({ value: a.id, label: a.name }))} value={f.academyId} onChange={(v) => setF({ ...f, academyId: v })} />
        <Field label="Nombre de la clase" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="Ej. Salsa principiantes" />
        <Field label="Descripción" value={f.description} onChangeText={(v) => setF({ ...f, description: v })} multiline />
        <Chips<number | null>
          label="Profesor que la dicta"
          options={[{ value: null, label: 'Sin asignar' }, ...(teachers.data ?? []).filter((t) => t.active).map((t) => ({ value: t.id as number | null, label: `${t.full_name}${t.kind === 'external' ? ' (externo)' : ''}` }))]}
          value={f.teacherId}
          onChange={(v) => setF({ ...f, teacherId: v })}
        />
        <Field label="Cupo por sesión" value={f.defaultCapacity} onChangeText={(v) => setF({ ...f, defaultCapacity: v })} keyboardType="number-pad" />
        <Toggle label="Clase activa" value={f.active} onChange={(v) => setF({ ...f, active: v })} />
        <Button label="Guardar" onPress={save} loading={busy} disabled={!f.academyId || !f.name.trim() || !(Number(f.defaultCapacity) > 0)} />
      </Card>
    </Screen>
  );
}
