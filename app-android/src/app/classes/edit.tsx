import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Button, Card, Chips, Field, Loading, Muted, Screen, Section, Toggle, errorText, notify, useLoad } from '../../components/ui';
import { post, put, qs } from '../../lib/api';
import type { Academy, ClassDef, Site, Space, Teacher } from '../../types';

/**
 * Clase (RQ61): se da en un espacio de una sede de su academia y tiene un profesor asignado a esa sede (RQ62).
 * Sus sesiones (fecha y hora) se programan despues en la Agenda.
 */
export default function ClassEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const academies = useLoad<Academy[]>('/academies');
  const teachers = useLoad<Teacher[]>('/teachers');
  const classes = useLoad<ClassDef[]>(id ? '/classes' : null);
  const [f, setF] = useState({ academyId: 0, siteId: 0, spaceId: 0, teacherId: 0, name: '', description: '', defaultCapacity: '15', active: true });
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);
  const sites = useLoad<Site[]>(f.academyId ? `/sites${qs({ academyId: f.academyId })}` : null);
  const spaces = useLoad<Space[]>(f.siteId ? `/spaces${qs({ siteId: f.siteId })}` : null);

  useEffect(() => {
    const c = classes.data?.find((x) => x.id === Number(id));
    if (c && !loaded) {
      setF({
        academyId: c.academy_id, siteId: c.site_id ?? 0, spaceId: c.space_id ?? 0, teacherId: c.teacher_id ?? 0,
        name: c.name, description: c.description ?? '', defaultCapacity: String(c.default_capacity), active: c.active,
      });
      setLoaded(true);
    }
  }, [classes.data, id, loaded]);
  useEffect(() => {
    if (!f.academyId && academies.data?.length === 1) setF((x) => ({ ...x, academyId: academies.data![0].id }));
  }, [academies.data, f.academyId]);

  const space = spaces.data?.find((s) => s.id === f.spaceId);
  const limit = space ? (space.allow_multi_group && space.capacity_per_group ? space.capacity_per_group : space.max_capacity) : null;
  // RQ62: solo profesores asignados a la sede elegida
  const siteTeachers = (teachers.data ?? []).filter((t) => t.active && t.sites.some((s) => s.id === f.siteId));
  const tooBig = limit != null && Number(f.defaultCapacity) > limit;

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        academyId: f.academyId, spaceId: f.spaceId, teacherId: f.teacherId, name: f.name, description: f.description || null,
        defaultCapacity: Number(f.defaultCapacity), active: f.active,
      };
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
        <Field label="Nombre de la clase" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="Ej. Salsa principiantes" />
        <Field label="Descripción" value={f.description} onChangeText={(v) => setF({ ...f, description: v })} multiline />
        <Field label="Cupo por sesión" value={f.defaultCapacity} onChangeText={(v) => setF({ ...f, defaultCapacity: v })} keyboardType="number-pad"
          error={tooBig ? `Supera el aforo permitido en ${space?.name} (${limit})` : null} hint={limit != null ? `Máximo ${limit} en ${space?.name}` : undefined} />
        <Toggle label="Clase activa" value={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </Card>

      <Section title="Dónde se da la clase">
        <Card>
          <Chips label="Academia" options={(academies.data ?? []).map((a) => ({ value: a.id, label: a.name }))} value={f.academyId}
            onChange={(v) => setF({ ...f, academyId: v, siteId: 0, spaceId: 0, teacherId: 0 })} />
          {f.academyId ? (
            <Chips label="Sede" options={(sites.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} value={f.siteId}
              onChange={(v) => setF({ ...f, siteId: v, spaceId: 0, teacherId: 0 })} />
          ) : null}
          {f.siteId ? (
            <Chips label="Espacio" options={(spaces.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: `${s.name} (aforo ${s.max_capacity})` }))} value={f.spaceId}
              onChange={(v) => setF({ ...f, spaceId: v })} />
          ) : null}
        </Card>
      </Section>

      <Section title="Profesor que la dicta">
        <Card>
          {!f.siteId ? <Muted>Elige primero la sede.</Muted> : siteTeachers.length === 0 ? (
            <Muted>Ningún profesor está asignado a esta sede. Asígnalo en Profesores (Sedes donde da clase).</Muted>
          ) : (
            <Chips options={siteTeachers.map((t) => ({ value: t.id, label: `${t.full_name}${t.kind === 'external' ? ' (externo)' : ''}` }))} value={f.teacherId}
              onChange={(v) => setF({ ...f, teacherId: v })} />
          )}
        </Card>
      </Section>

      <Button label="Guardar" onPress={save} loading={busy}
        disabled={!f.academyId || !f.spaceId || !f.teacherId || !f.name.trim() || !(Number(f.defaultCapacity) > 0) || tooBig} />
    </Screen>
  );
}
