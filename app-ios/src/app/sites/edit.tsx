import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { OpeningHoursEditor } from '../../components/OpeningHoursEditor';
import { PhotoGallery, PhotoIcon } from '../../components/PhotoGallery';
import { Button, Card, Chips, Field, Gap, ListItem, Loading, Muted, Screen, Section, Toggle, confirm, errorText, notify, useLoad } from '../../components/ui';
import { del, post, put, qs } from '../../lib/api';
import { isTime } from '../../lib/format';
import { useSession } from '../../session';
import type { Academy, OpeningSlot, Site, Space } from '../../types';

/** Crear o editar una sede: datos, horario de atencion, fotos (RQ29) y sus espacios */
export default function SiteEdit() {
  const params = useLocalSearchParams<{ id?: string; academyId?: string }>();
  const { can } = useSession();
  const [id, setId] = useState<number | null>(params.id ? Number(params.id) : null);
  const academies = useLoad<Academy[]>('/academies');
  const sites = useLoad<Site[]>(id ? '/sites' : null);
  const spaces = useLoad<Space[]>(id ? `/spaces${qs({ siteId: id })}` : null);
  const [f, setF] = useState({ academyId: params.academyId ? Number(params.academyId) : 0, name: '', address: '', phone: '', active: true });
  const [hours, setHours] = useState<OpeningSlot[]>([]);
  const [loaded, setLoaded] = useState(!params.id);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = sites.data?.find((x) => x.id === id);
    if (s && !loaded) {
      setF({ academyId: s.academy_id, name: s.name, address: s.address ?? '', phone: s.phone ?? '', active: s.active });
      setHours(s.opening_hours);
      setLoaded(true);
    }
  }, [sites.data, id, loaded]);

  const save = async () => {
    if (hours.some((h) => !isTime(h.open) || !isTime(h.close) || h.open >= h.close)) return notify('Revisa el horario', 'Usa HH:MM y una apertura menor que el cierre.');
    setBusy(true);
    try {
      const body = { academyId: f.academyId, name: f.name, address: f.address || null, phone: f.phone || null, openingHours: hours, active: f.active };
      if (id) {
        await put(`/sites/${id}`, body);
        notify('Sede guardada');
      } else {
        const s = await post<Site>('/sites', body);
        setId(s.id);
        router.setParams({ id: String(s.id) });
        notify('Sede creada', 'Ahora puedes agregar fotos y espacios.');
      }
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id || !(await confirm('Eliminar sede', 'Se eliminarán la sede, sus espacios y sus fotos. ¿Continuar?', 'Eliminar'))) return;
    try {
      await del(`/sites/${id}`);
      router.back();
    } catch (e) {
      notify('No se pudo eliminar', errorText(e));
    }
  };

  if (!loaded) return <Screen title="Sede"><Loading /></Screen>;
  return (
    <Screen title={id ? f.name || 'Sede' : 'Nueva sede'}>
      <Card>
        <Chips label="Academia" options={(academies.data ?? []).map((a) => ({ value: a.id, label: a.name }))} value={f.academyId} onChange={(v) => setF({ ...f, academyId: v })} />
        <Field label="Nombre" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
        <Field label="Dirección" value={f.address} onChangeText={(v) => setF({ ...f, address: v })} />
        <Field label="Teléfono" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" />
        <Toggle label="Sede activa" value={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </Card>
      <Section title="Horario de atención">
        <Card>
          <OpeningHoursEditor value={hours} onChange={setHours} />
          <Muted style={{ fontSize: 12 }}>Las clases y reservas solo se pueden programar dentro de este horario.</Muted>
        </Card>
      </Section>
      <Button label={id ? 'Guardar cambios' : 'Crear sede'} onPress={save} loading={busy} disabled={!f.academyId || !f.name.trim()} />
      <Section title="Fotos de la sede">
        <Card>
          <PhotoGallery ownerType="site" ownerId={id} editable={can('schedules')} />
        </Card>
      </Section>
      {id ? (
        <Section title="Espacios" action={<Button small label="Nuevo espacio" icon="add" onPress={() => router.push({ pathname: '/spaces/edit', params: { siteId: String(id) } })} />}>
          {(spaces.data ?? []).length === 0 ? <Muted>Sin espacios. Agrega salones, canchas o salas con su aforo.</Muted> : null}
          {(spaces.data ?? []).map((sp) => (
            <ListItem
              key={sp.id}
              icon="cube-outline"
              title={sp.name}
              muted={!sp.active}
              subtitle={`Aforo ${sp.max_capacity}${sp.allow_multi_group ? ` · hasta ${sp.max_groups} grupos${sp.capacity_per_group ? ` de ${sp.capacity_per_group}` : ''}` : ' · un grupo'}`}
              right={<PhotoIcon count={sp.photos} />}
              onPress={() => router.push({ pathname: '/spaces/edit', params: { id: String(sp.id), siteId: String(id) } })}
            />
          ))}
        </Section>
      ) : null}
      <Gap h={20} />
      {id ? <Button label="Eliminar sede" variant="danger" icon="trash-outline" onPress={remove} /> : null}
    </Screen>
  );
}
