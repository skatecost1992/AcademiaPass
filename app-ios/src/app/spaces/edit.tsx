import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { PhotoGallery } from '../../components/PhotoGallery';
import { Button, Card, Field, Gap, Loading, Muted, Screen, Section, Toggle, confirm, errorText, notify, useLoad } from '../../components/ui';
import { del, post, put, qs } from '../../lib/api';
import { useSession } from '../../session';
import type { Space } from '../../types';

/** Espacio con su aforo y grupos simultaneos (RQ19) y sus fotos (RQ29) */
export default function SpaceEdit() {
  const params = useLocalSearchParams<{ id?: string; siteId: string }>();
  const { can } = useSession();
  const siteId = Number(params.siteId);
  const [id, setId] = useState<number | null>(params.id ? Number(params.id) : null);
  const spaces = useLoad<Space[]>(params.id ? `/spaces${qs({ siteId })}` : null);
  const [f, setF] = useState({ name: '', description: '', maxCapacity: '20', allowMultiGroup: false, maxGroups: '2', capacityPerGroup: '', active: true });
  const [loaded, setLoaded] = useState(!params.id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = spaces.data?.find((x) => x.id === id);
    if (s && !loaded) {
      setF({
        name: s.name, description: s.description ?? '', maxCapacity: String(s.max_capacity), allowMultiGroup: s.allow_multi_group,
        maxGroups: String(s.max_groups), capacityPerGroup: s.capacity_per_group ? String(s.capacity_per_group) : '', active: s.active,
      });
      setLoaded(true);
    }
  }, [spaces.data, id, loaded]);

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        siteId, name: f.name, description: f.description || null, maxCapacity: Number(f.maxCapacity), allowMultiGroup: f.allowMultiGroup,
        maxGroups: Number(f.maxGroups) || 1, capacityPerGroup: f.capacityPerGroup ? Number(f.capacityPerGroup) : null, active: f.active,
      };
      if (id) {
        await put(`/spaces/${id}`, body);
        notify('Espacio guardado');
      } else {
        const s = await post<Space>('/spaces', body);
        setId(s.id);
        router.setParams({ id: String(s.id) });
        notify('Espacio creado', 'Ahora puedes agregar fotos.');
      }
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id || !(await confirm('Eliminar espacio', 'Se eliminarán el espacio, sus reservas y sus fotos. ¿Continuar?', 'Eliminar'))) return;
    try {
      await del(`/spaces/${id}`);
      router.back();
    } catch (e) {
      notify('No se pudo eliminar', errorText(e));
    }
  };

  if (!loaded) return <Screen title="Espacio"><Loading /></Screen>;
  return (
    <Screen title={id ? f.name || 'Espacio' : 'Nuevo espacio'}>
      <Card>
        <Field label="Nombre" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="Ej. Salón 1, Cancha sintética" />
        <Field label="Descripción" value={f.description} onChangeText={(v) => setF({ ...f, description: v })} multiline />
        <Field label="Aforo máximo de asistentes" value={f.maxCapacity} onChangeText={(v) => setF({ ...f, maxCapacity: v })} keyboardType="number-pad" />
        <Toggle label="Habilitar para varios grupos a la vez" value={f.allowMultiGroup} onChange={(v) => setF({ ...f, allowMultiGroup: v })}
          hint="Ej. una cancha dividida para dos clases simultáneas." />
        {f.allowMultiGroup ? (
          <>
            <Field label="Máximo de grupos simultáneos" value={f.maxGroups} onChangeText={(v) => setF({ ...f, maxGroups: v })} keyboardType="number-pad" />
            <Field label="Asistentes por grupo" value={f.capacityPerGroup} onChangeText={(v) => setF({ ...f, capacityPerGroup: v })} keyboardType="number-pad" hint="Vacío = sin límite por grupo (solo el aforo total)." />
          </>
        ) : <Muted style={{ marginBottom: 10 }}>Si ya está reservado en un horario, no se podrá reservar de nuevo en ese horario.</Muted>}
        <Toggle label="Espacio activo" value={f.active} onChange={(v) => setF({ ...f, active: v })} />
        <Button label={id ? 'Guardar cambios' : 'Crear espacio'} onPress={save} loading={busy} disabled={!f.name.trim() || !(Number(f.maxCapacity) > 0)} />
      </Card>
      <Section title="Fotos del espacio">
        <Card>
          <PhotoGallery ownerType="space" ownerId={id} editable={can('schedules')} />
        </Card>
      </Section>
      <Gap h={20} />
      {id ? <Button label="Eliminar espacio" variant="danger" icon="trash-outline" onPress={remove} /> : null}
    </Screen>
  );
}
