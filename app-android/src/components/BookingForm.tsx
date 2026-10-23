/**
 * Formulario para programar una clase o reservar un espacio (RQ2, RQ3, RQ5, RQ18, RQ19).
 * - mode client: el cliente reserva un espacio para el.
 * - mode staff : el personal programa sesiones de clase (con repeticion semanal) o reserva espacios para un
 *   profesor externo/interno o para un cliente.
 * Muestra la agenda del espacio ese dia para ver que esta libre; el servidor valida aforo y horario.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { post, qs } from '../lib/api';
import { DAYS, addDays, fmtTime, isDate, isTime, toIso, today, ymd } from '../lib/format';
import type { Booking, ClassDef, ClientRow, Site, Space, Teacher } from '../types';
import { Calendar } from './Calendar';
import { PhotoGallery } from './PhotoGallery';
import { PlacePicker } from './shared';
import { Badge, Button, Card, Chips, Field, Gap, InfoRow, Muted, RowWrap, Section, colors, errorText, notify, useLoad } from './ui';

function SpaceInfo({ space, site }: { space: Space; site?: Site }) {
  const day = site?.opening_hours ?? [];
  return (
    <Card>
      {space.description ? <Muted style={{ marginBottom: 6 }}>{space.description}</Muted> : null}
      <PhotoGallery ownerType="space" ownerId={space.id} editable={false} />
      <InfoRow label="Aforo máximo" value={`${space.max_capacity} personas`} />
      {space.opening_hours?.length ? (
        <Muted style={{ fontSize: 12 }}>Disponible: {space.opening_hours.map((h) => `${DAYS[h.day]} ${h.open}-${h.close}`).join(' · ')}</Muted>
      ) : null}
      <InfoRow label="Grupos simultáneos" value={space.allow_multi_group ? `hasta ${space.max_groups}${space.capacity_per_group ? ` de ${space.capacity_per_group} personas` : ''}` : 'Uno a la vez'} />
      {day.length ? (
        <Muted style={{ fontSize: 12, marginTop: 4 }}>
          Atención: {day.map((h) => `${DAYS[h.day]} ${h.open}-${h.close}`).join(' · ')}
        </Muted>
      ) : (
        <Badge text="La sede no tiene horario de atención: no se puede agendar hasta configurarlo" tone="danger" />
      )}
    </Card>
  );
}

interface DayAvailability { available: string[]; capacity: number; busy: { from: string; to: string; label: string; spotsLeft: number }[] }

/**
 * Ocupacion del espacio en el dia elegido. RQ60: el cliente solo ve cada franja como "Reservado" y los cupos
 * libres, sin datos de quien reservo; el personal ve ademas el titulo de cada reserva.
 */
export function DayAgenda({ spaceId, date, anonymous, onPick }: { spaceId: number; date: string; anonymous: boolean; onPick?: (from: string, to: string) => void }) {
  const list = useLoad<Booking[]>(!anonymous && isDate(date) ? `/bookings${qs({ spaceId, from: date, to: date })}` : null);
  const day = useLoad<DayAvailability>(isDate(date) ? `/spaces/${spaceId}/availability${qs({ date })}` : null);
  const busy = day.data?.busy ?? [];
  return (
    <Card>
      <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 4 }}>Ocupación del espacio ese día</Text>
      {onPick && day.data?.available.length ? (
        // RQ65: tocar una franja libre la usa como horario
        <Chips label="Horarios disponibles (toca uno para usarlo)" options={day.data.available.map((a) => ({ value: a, label: a.replace('-', '–') }))}
          value={undefined} onChange={(a) => { const [from, to] = a.split('-'); onPick(from, to); }} />
      ) : (
        <Muted style={{ fontSize: 12, marginBottom: 4, color: colors.success }}>
          Horarios disponibles: {day.data ? (day.data.available.length ? day.data.available.join(' · ') : 'ninguno ese día') : '…'}
        </Muted>
      )}
      {anonymous ? (
        busy.length === 0 ? <Muted>Sin reservas ese día.</Muted> : busy.map((b, i) => (
          <InfoRow key={i} label={`${b.from}–${b.to} · ${b.label}`} value={b.spotsLeft > 0 ? `${b.spotsLeft} cupo(s) libre(s)` : 'Sin cupos'} />
        ))
      ) : (list.data ?? []).length === 0 ? <Muted>Sin clases ni reservas ese día.</Muted> : (list.data ?? []).map((b) => (
        <InfoRow key={b.id} label={`${fmtTime(b.starts_at)}–${fmtTime(b.ends_at)}`} value={`${b.title} · ${b.group_size} pers.`} />
      ))}
    </Card>
  );
}

export function BookingForm({ mode, initialKind = 'class' }: { mode: 'client' | 'staff'; initialKind?: 'class' | 'rental' }) {
  const [academyId, setAcademyId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [spaceId, setSpaceId] = useState<number | null>(null);
  const [kind, setKind] = useState<'class' | 'rental'>(mode === 'client' ? 'rental' : initialKind);
  const [classId, setClassId] = useState<number | null>(null);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [forWho, setForWho] = useState<'teacher' | 'client' | 'other'>('teacher');
  const [clientQuery, setClientQuery] = useState('');
  const [client, setClient] = useState<ClientRow | null>(null);
  const [f, setF] = useState({ date: addDays(today(), 1), start: '08:00', end: '09:00', groupSize: '', title: '', notes: '', repeatWeeks: '1' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const settings = useLoad<{ bookingHorizonMonths: number }>('/settings');
  const maxDate = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + (settings.data?.bookingHorizonMonths ?? 3));
    return ymd(d);
  })();

  const sites = useLoad<Site[]>(academyId ? `/sites${qs({ academyId })}` : null);
  const spaces = useLoad<Space[]>(siteId ? `/spaces${qs({ siteId })}` : null);
  const classes = useLoad<ClassDef[]>(mode === 'staff' ? '/classes' : null);
  const teachers = useLoad<Teacher[]>(mode === 'staff' ? '/teachers' : null);
  const clients = useLoad<ClientRow[]>(mode === 'staff' && kind === 'rental' && forWho === 'client' && clientQuery.trim().length >= 2 ? `/clients${qs({ q: clientQuery.trim() })}` : null);

  const space = spaces.data?.find((s) => s.id === spaceId);
  const site = sites.data?.find((s) => s.id === siteId);
  const academyClasses = (classes.data ?? []).filter((c) => c.academy_id === academyId && c.active);

  const submit = async () => {
    if (!spaceId) return notify('Falta el espacio', 'Selecciona la sede y el espacio.');
    if (!isDate(f.date) || !isTime(f.start) || !isTime(f.end)) return notify('Revisa la fecha y las horas', 'Usa AAAA-MM-DD y HH:MM (24 horas).');
    const body: Record<string, unknown> = {
      spaceId, startsAt: toIso(f.date, f.start), endsAt: toIso(f.date, f.end), notes: f.notes || null,
      ...(f.groupSize ? { groupSize: Number(f.groupSize) } : {}),
    };
    setBusy(true);
    try {
      if (mode === 'client') {
        await post('/me/bookings', body);
        notify('Reserva creada', 'Recuerda realizar el pago en la recepción.');
      } else {
        if (kind === 'class' && !classId) throw new Error('Selecciona la clase');
        const created = await post<Booking[]>('/bookings', {
          ...body, kind,
          classId: kind === 'class' ? classId : null,
          teacherId: kind === 'class' || forWho === 'teacher' ? teacherId : null,
          clientId: kind === 'rental' && forWho === 'client' ? client?.id ?? null : null,
          title: f.title || null,
          repeatWeeks: Number(f.repeatWeeks) || 1,
        });
        notify('Guardado', created.length > 1 ? `Se programaron ${created.length} sesiones semanales.` : 'Se guardó en la agenda.');
      }
      router.back();
    } catch (e) {
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      {mode === 'staff' ? (
        <Chips label="Tipo" options={[{ value: 'class' as const, label: 'Sesión de clase' }, { value: 'rental' as const, label: 'Reserva de espacio' }]} value={kind} onChange={setKind} />
      ) : null}
      <PlacePicker academyId={academyId} siteId={siteId} requireSite onChange={(a, s) => { setAcademyId(a); setSiteId(s); setSpaceId(null); setClassId(null); }} />
      {siteId ? (
        <Chips label="Espacio" options={(spaces.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} value={spaceId ?? undefined} onChange={setSpaceId} />
      ) : null}
      {space ? <SpaceInfo space={space} site={site} /> : null}

      {mode === 'staff' && kind === 'class' && academyId ? (
        <>
          <Chips label="Clase" options={academyClasses.map((c) => ({ value: c.id, label: c.name }))} value={classId ?? undefined}
            onChange={(id) => {
              // RQ61: la clase ya trae su sede, su espacio y su profesor
              const c = academyClasses.find((x) => x.id === id);
              setClassId(id);
              setTeacherId(c?.teacher_id ?? null);
              if (c?.site_id && c.space_id) { setSiteId(c.site_id); setSpaceId(c.space_id); }
            }}
            hint={academyClasses.length ? undefined : 'Crea primero las clases de esta academia en "Clases y profesores".'} />
          {/* RQ54: se ve el profesor que dara la clase (por defecto el de la clase; se puede cambiar para esta sesion) */}
          {classId ? (
            <Card style={{ backgroundColor: colors.primarySoft }}>
              {(() => {
                const t = (teachers.data ?? []).find((x) => x.id === teacherId);
                return t
                  ? <InfoRow label="Profesor que dará la clase" value={`${t.full_name} · ${t.kind === 'external' ? 'externo' : 'interno'}${t.specialty ? ` · ${t.specialty}` : ''}`} />
                  : <Muted>Esta clase no tiene profesor asignado: elige uno abajo.</Muted>;
              })()}
            </Card>
          ) : null}
          <Chips<number | null> label="Cambiar profesor para esta sesión" options={(teachers.data ?? []).filter((t) => t.active && (!siteId || t.sites.some((x) => x.id === siteId))).map((t) => ({ value: t.id as number | null, label: `${t.full_name}${t.kind === 'external' ? ' (externo)' : ''}` }))} value={teacherId} onChange={setTeacherId} />
        </>
      ) : null}

      {mode === 'staff' && kind === 'rental' ? (
        <>
          <Chips label="Reservado para" options={[{ value: 'teacher' as const, label: 'Profesor' }, { value: 'client' as const, label: 'Cliente' }, { value: 'other' as const, label: 'Otro' }]} value={forWho} onChange={setForWho} />
          {forWho === 'teacher' ? (
            <Chips<number | null> label="Profesor (interno o externo)" options={(teachers.data ?? []).filter((t) => t.active && (!siteId || t.sites.some((x) => x.id === siteId))).map((t) => ({ value: t.id as number | null, label: `${t.full_name} · ${t.kind === 'external' ? 'externo' : 'interno'}` }))} value={teacherId} onChange={setTeacherId} />
          ) : null}
          {forWho === 'client' ? (
            <>
              <Field label="Buscar cliente" value={clientQuery} onChangeText={(v) => { setClientQuery(v); setClient(null); }} placeholder="Nombre o documento" />
              <Chips label="" options={(clients.data ?? []).slice(0, 8).map((c) => ({ value: c.id, label: `${c.full_name} · ${c.document}` }))} value={client?.id} onChange={(id) => setClient(clients.data!.find((c) => c.id === id)!)} />
            </>
          ) : null}
          <Field label="Título" value={f.title} onChangeText={set('title')} placeholder="Ej. Clase de pilates de Laura" />
        </>
      ) : null}

      <Section title="Fecha y hora">
        {/* RQ47: calendario hasta el limite de meses que define la academia */}
        <Calendar value={f.date} onChange={set('date')} min={today()} max={maxDate} />
        <Muted style={{ fontSize: 12, marginBottom: 8 }}>Fecha elegida: {f.date} · se puede reservar hasta el {maxDate}.</Muted>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="Desde (HH:MM)" value={f.start} onChangeText={set('start')} /></View>
          <View style={{ flex: 1 }}><Field label="Hasta (HH:MM)" value={f.end} onChangeText={set('end')} /></View>
        </View>
        <Field label={kind === 'class' ? 'Cupo de la sesión' : 'Número de personas'} value={f.groupSize} onChangeText={set('groupSize')} keyboardType="number-pad"
          placeholder={kind === 'class' ? 'Por defecto el cupo de la clase' : '1'} />
        {mode === 'staff' ? (
          <Field label="Repetir semanalmente (número de semanas)" value={f.repeatWeeks} onChangeText={set('repeatWeeks')} keyboardType="number-pad" hint="1 = solo esta fecha. Hasta 26 semanas; si alguna semana choca no se guarda ninguna." />
        ) : null}
        <Field label="Notas" value={f.notes} onChangeText={set('notes')} multiline />
      </Section>
      {spaceId ? <DayAgenda spaceId={spaceId} date={f.date} anonymous={mode === 'client'} /> : null}
      {space && f.groupSize && Number(f.groupSize) > space.max_capacity ? <Badge text="Supera el aforo del espacio" tone="danger" /> : null}
      <Gap />
      <Button label={mode === 'client' ? 'Reservar' : 'Guardar en la agenda'} onPress={submit} loading={busy} disabled={!spaceId} />
    </View>
  );
}
