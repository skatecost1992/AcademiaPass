import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { DayAgenda } from '../../components/BookingForm';
import { Calendar } from '../../components/Calendar';
import { Button, Card, Chips, Field, Loading, Muted, Screen, Section, Toggle, confirm, errorText, notify, useLoad } from '../../components/ui';
import { ApiError, post, put, qs } from '../../lib/api';
import { DAYS, addDays, isDate, isTime, toIso, today, ymd } from '../../lib/format';
import type { Academy, ClassDef, Clash, SessionConflict, Site, Space, Teacher } from '../../types';

const weekdayOf = (date: string) => new Date(`${date}T12:00:00`).getDay();
const plusHour = (hm: string, max: string) => {
  const m = Math.min(Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + 60, Number(max.slice(0, 2)) * 60 + Number(max.slice(3, 5)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Clase (RQ61): se da en un espacio de una sede de su academia y tiene un profesor asignado a esa sede (RQ62).
 * RQ65: al crearla se programa su horario (fecha, hora desde y hasta, con los horarios libres del espacio) y,
 * opcionalmente, se repite cada semana en uno o varios dias. Luego se pueden agregar sesiones en la Agenda.
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
  const settings = useLoad<{ bookingHorizonMonths: number }>(id ? null : '/settings');
  const [sch, setSch] = useState({ enabled: true, date: addDays(today(), 1), start: '08:00', end: '09:00', periodic: false, weeks: '4', weekdays: [] as number[] });
  const maxDate = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() + (settings.data?.bookingHorizonMonths ?? 3));
    return ymd(d);
  })();

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

  const schedule = !id && sch.enabled;
  const scheduleOk = !schedule || (isDate(sch.date) && isTime(sch.start) && isTime(sch.end) && sch.end > sch.start
    && (!sch.periodic || (Number(sch.weeks) >= 1 && Number(sch.weeks) <= 26)));

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        academyId: f.academyId, spaceId: f.spaceId, teacherId: f.teacherId, name: f.name, description: f.description || null,
        defaultCapacity: Number(f.defaultCapacity), active: f.active,
        ...(schedule ? {
          schedule: {
            startsAt: toIso(sch.date, sch.start), endsAt: toIso(sch.date, sch.end),
            repeatWeeks: sch.periodic ? Number(sch.weeks) : 1,
            weekdays: sch.periodic ? (sch.weekdays.length ? sch.weekdays : [weekdayOf(sch.date)]) : undefined,
          },
        } : {}),
      };
      if (id) await put(`/classes/${id}`, body);
      else {
        const created = await post<{ sessions: unknown[] }>('/classes', body);
        if (created.sessions.length) notify('Clase creada', `Se programaron ${created.sessions.length} sesión(es) en la agenda.`);
      }
      router.back();
    } catch (e) {
      // RQ66: si se cruza con la clase de otro profesor, se puede crear con lo que cabe y pedirle el cambio
      const clashes: Clash[] = e instanceof ApiError ? e.data?.clashes ?? [] : [];
      const other = clashes.find((x) => x.teacherId && x.teacherId !== f.teacherId);
      if (!id && schedule && other && await confirm('Se cruza con otro profesor',
        `${errorText(e)}\n\n¿Crear la clase con las sesiones que sí caben y pedirle a ${other.teacherName} que cambie su horario en las fechas que chocan?`,
        'Crear y pedir el cambio')) {
        return await negotiate();
      }
      notify('No se pudo guardar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** RQ66: crea la clase con las sesiones que caben y abre la solicitud de cambio para las que chocan */
  const negotiate = async () => {
    try {
      const created = await post<{ id: number; sessions: unknown[]; conflicts: SessionConflict[] }>('/classes', {
        academyId: f.academyId, spaceId: f.spaceId, teacherId: f.teacherId, name: f.name, description: f.description || null,
        defaultCapacity: Number(f.defaultCapacity), active: f.active,
        schedule: {
          startsAt: toIso(sch.date, sch.start), endsAt: toIso(sch.date, sch.end), repeatWeeks: sch.periodic ? Number(sch.weeks) : 1,
          weekdays: sch.periodic ? (sch.weekdays.length ? sch.weekdays : [weekdayOf(sch.date)]) : undefined, skipConflicts: true,
        },
      });
      notify('Clase creada', `${created.sessions.length} sesión(es) programada(s); ${created.conflicts.length} chocan.`);
      router.replace({ pathname: '/schedule-requests/new', params: { classId: String(created.id), className: f.name, teacherId: String(f.teacherId), conflicts: JSON.stringify(created.conflicts) } });
    } catch (e) {
      notify('No se pudo crear la clase', errorText(e));
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

      {!id ? (
        <Section title="Horario de la clase">
          <Card>
            <Toggle label="Programar el horario ahora" value={sch.enabled} onChange={(v) => setSch({ ...sch, enabled: v })}
              hint="Si lo apagas, la clase se crea sin sesiones y las programas luego en la Agenda." />
            {sch.enabled ? (
              <>
                <Calendar value={sch.date} onChange={(v) => setSch({ ...sch, date: v, weekdays: [] })} min={today()} max={maxDate} />
                <Muted style={{ fontSize: 12, marginBottom: 8 }}>Fecha: {sch.date} ({DAYS[weekdayOf(sch.date)]}) · se puede programar hasta el {maxDate}.</Muted>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><Field label="Desde (HH:MM)" value={sch.start} onChangeText={(v) => setSch({ ...sch, start: v })} /></View>
                  <View style={{ flex: 1 }}><Field label="Hasta (HH:MM)" value={sch.end} onChangeText={(v) => setSch({ ...sch, end: v })}
                    error={isTime(sch.start) && isTime(sch.end) && sch.end <= sch.start ? 'Debe ser después de la hora inicial' : null} /></View>
                </View>
                <Muted style={{ fontSize: 12 }}>
                  Cupo de cada sesión: {f.defaultCapacity || '—'}{limit != null ? ` (aforo permitido en ${space?.name}: ${limit})` : ''}.
                </Muted>
                <Toggle label="Clase periódica" value={sch.periodic} onChange={(v) => setSch({ ...sch, periodic: v })}
                  hint="Se repite cada semana a la misma hora en los días que elijas." />
                {sch.periodic ? (
                  <>
                    <Chips multi label="Días de la semana" options={DAYS.map((d, i) => ({ value: i, label: d }))}
                      values={sch.weekdays.length ? sch.weekdays : [weekdayOf(sch.date)]} onChangeMulti={(v) => setSch({ ...sch, weekdays: v })} />
                    <Field label="Número de semanas (1 a 26)" value={sch.weeks} onChangeText={(v) => setSch({ ...sch, weeks: v.replace(/\D/g, '') })} keyboardType="number-pad"
                      hint="Si alguna sesión choca con otra reserva no se guarda ninguna y se indican los horarios libres." />
                  </>
                ) : null}
              </>
            ) : null}
          </Card>
          {sch.enabled && f.spaceId && isDate(sch.date) ? (
            <DayAgenda spaceId={f.spaceId} date={sch.date} anonymous={false}
              onPick={(from, to) => setSch({ ...sch, start: from, end: plusHour(from, to) })} />
          ) : sch.enabled ? <Muted>Elige el espacio para ver sus horarios disponibles.</Muted> : null}
        </Section>
      ) : null}

      <Button label={schedule ? 'Crear clase y programar horario' : 'Guardar'} onPress={save} loading={busy}
        disabled={!f.academyId || !f.spaceId || !f.teacherId || !f.name.trim() || !(Number(f.defaultCapacity) > 0) || tooBig || !scheduleOk} />
    </Screen>
  );
}
