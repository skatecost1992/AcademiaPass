import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { DayAgenda } from '../../components/BookingForm';
import { Button, Card, Checkbox, Chips, Field, InfoRow, Muted, Screen, Section, errorText, notify } from '../../components/ui';
import { post } from '../../lib/api';
import { fmtRange, fmtTime, isDate, isTime, toIso, ymd } from '../../lib/format';
import type { Clash, ScheduleRequest, SessionConflict } from '../../types';

const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

interface Row { conflict: SessionConflict; clash: Clash; include: boolean; date: string; start: string; end: string; minutes: number }

/**
 * RQ66: pedirle a otro profesor que mueva sus sesiones que se cruzan con la clase. Por cada fecha se elige la hora
 * nueva que se le propone (con los horarios libres del espacio). Se envia una solicitud por profesor; el profesor
 * responde desde el correo o el personal responde por el en "Cambios de horario".
 */
export default function NewScheduleRequest() {
  const params = useLocalSearchParams<{ classId: string; className?: string; teacherId?: string; conflicts: string }>();
  const conflicts = useMemo<SessionConflict[]>(() => { try { return JSON.parse(params.conflicts ?? '[]'); } catch { return []; } }, [params.conflicts]);
  const ownTeacher = Number(params.teacherId ?? 0);
  // Solo se negocia con otros profesores: reservas con profesor distinto al de la clase
  const negotiable = conflicts.flatMap((c) => (c.clashes ?? []).filter((x) => x.teacherId && x.teacherId !== ownTeacher).map((clash) => ({ conflict: c, clash })));
  const teachers = [...new Map(negotiable.map((n) => [n.clash.teacherId!, n.clash])).values()];
  const [teacherId, setTeacherId] = useState<number | null>(teachers[0]?.teacherId ?? null);
  const [rows, setRows] = useState<Row[]>(() => negotiable.map(({ conflict, clash }) => {
    const minutes = Math.round((new Date(clash.endsAt).getTime() - new Date(clash.startsAt).getTime()) / 60000);
    return { conflict, clash, include: true, date: ymd(new Date(clash.startsAt)), start: '', end: '', minutes };
  }));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const mine = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.clash.teacherId === teacherId);
  const chosen = mine.filter(({ r }) => r.include);
  const valid = chosen.length > 0 && chosen.every(({ r }) => isDate(r.date) && isTime(r.start) && isTime(r.end) && r.end > r.start);
  const update = (i: number, patch: Partial<Row>) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const teacher = teachers.find((t) => t.teacherId === teacherId);

  const send = async () => {
    setBusy(true);
    try {
      const created = await post<ScheduleRequest & { emailed: boolean }>('/schedule-requests', {
        classId: Number(params.classId),
        message: message || null,
        items: chosen.map(({ r }) => ({
          bookingId: r.clash.bookingId, wantedStartsAt: r.conflict.startsAt, wantedEndsAt: r.conflict.endsAt,
          proposedStartsAt: toIso(r.date, r.start), proposedEndsAt: toIso(r.date, r.end),
        })),
      });
      notify('Solicitud enviada', created.emailed
        ? `Le enviamos un correo a ${created.target_teacher_name} para que acepte o rechace el cambio.`
        : `${created.target_teacher_name} no tiene correo registrado: respóndela por él en "Cambios de horario" cuando te confirme.`);
      router.replace('/schedule-requests');
    } catch (e) {
      notify('No se pudo enviar', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!negotiable.length) {
    return (
      <Screen title="Pedir cambio de horario">
        <Card><Muted>No hay cruces con clases de otros profesores para negociar.</Muted></Card>
        <Button label="Volver" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }
  return (
    <Screen title="Pedir cambio de horario">
      <Card>
        <Muted>
          La clase {params.className ?? ''} se cruza con sesiones de otros profesores. Propón a qué hora pasarían las suyas;
          si aceptan, se mueven y se programa tu clase.
        </Muted>
      </Card>
      {teachers.length > 1 ? (
        <Chips label="Profesor (una solicitud por profesor)" options={teachers.map((t) => ({ value: t.teacherId!, label: t.teacherName ?? 'Profesor' }))}
          value={teacherId ?? undefined} onChange={setTeacherId} />
      ) : null}
      {teacher && !teacher.teacherHasEmail ? (
        <Muted style={{ marginBottom: 8 }}>{teacher.teacherName} no tiene correo: la solicitud queda en la app y la respondes por él.</Muted>
      ) : null}

      {mine.map(({ r, i }) => (
        <Section key={i} title={fmtRange(r.conflict.startsAt, r.conflict.endsAt)}>
          <Card>
            <Checkbox checked={r.include} onChange={(v) => update(i, { include: v })}>Incluir esta fecha</Checkbox>
            <InfoRow label="Tu clase" value={`${fmtTime(r.conflict.startsAt)}–${fmtTime(r.conflict.endsAt)}`} />
            <InfoRow label={`Sesión de ${r.clash.teacherName}`} value={`${r.clash.title} · ${fmtTime(r.clash.startsAt)}–${fmtTime(r.clash.endsAt)}`} />
            {r.include ? (
              <>
                <Field label="Nueva fecha para su sesión (AAAA-MM-DD)" value={r.date} onChangeText={(v) => update(i, { date: v })} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><Field label="Desde" value={r.start} placeholder="HH:MM" onChangeText={(v) => update(i, { start: v })} /></View>
                  <View style={{ flex: 1 }}><Field label="Hasta" value={r.end} placeholder="HH:MM" onChangeText={(v) => update(i, { end: v })} /></View>
                </View>
              </>
            ) : null}
          </Card>
          {r.include && isDate(r.date) ? (
            <DayAgenda spaceId={r.clash.spaceId} date={r.date} anonymous={false}
              onPick={(from) => update(i, { start: from, end: hm(toMin(from) + r.minutes) })} />
          ) : null}
        </Section>
      ))}

      <Field label="Mensaje para el profesor (opcional)" value={message} onChangeText={setMessage} multiline />
      <Button label={`Enviar solicitud (${chosen.length} fecha(s))`} icon="send-outline" onPress={send} loading={busy} disabled={!valid} />
      <Muted style={{ fontSize: 12, marginTop: 6 }}>La hora propuesta no puede cruzarse con la de tu clase y debe estar libre para el otro profesor.</Muted>
    </Screen>
  );
}
