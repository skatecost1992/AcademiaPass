import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { RangePicker, useRange } from '../components/ReportParts';
import { Badge, Card, Chips, Empty, Kpi, KpiRow, Loader, Muted, Screen, Section, colors, useLoad } from '../components/ui';
import { qs } from '../lib/api';
import { fmtRange } from '../lib/format';
import { useSession } from '../session';
import type { Teacher } from '../types';

interface TeacherReport {
  teacher: { id: number; full_name: string; kind: string };
  from: string; to: string;
  summary: { taught: number; absent: number; cancelled: number; upcoming: number; attendees: number; avgAttendees: number; occupancy: number };
  sessions: {
    id: number; title: string; kind: 'class' | 'rental'; starts_at: string; ends_at: string; academy_name: string; site_name: string; space_name: string;
    capacity: number; max_capacity: number; reserved: number; attendees: number; occupancy: number; state: 'taught' | 'absent' | 'cancelled' | 'upcoming';
  }[];
}

const STATE: Record<TeacherReport['sessions'][number]['state'], { text: string; tone: 'success' | 'danger' | 'muted' | 'accent' }> = {
  taught: { text: 'Dictada', tone: 'success' },
  absent: { text: 'No asistió', tone: 'danger' },
  cancelled: { text: 'Cancelada', tone: 'muted' },
  upcoming: { text: 'Próxima', tone: 'accent' },
};

/**
 * RQ69: reporte del profesor: clases dictadas con su aforo (asistentes sobre el cupo), clases a las que no pudo
 * asistir y canceladas. El profesor ve el suyo; el personal con permiso de reportes elige el profesor.
 */
export default function TeacherReportScreen() {
  const { user } = useSession();
  const own = user?.teacher ?? null;
  const teachers = useLoad<Teacher[]>(own ? null : '/teachers');
  const [teacherId, setTeacherId] = useState<number | null>(own?.id ?? null);
  const range = useRange();
  const { from, to } = range;
  const rep = useLoad<TeacherReport>(teacherId ? `/reports/teacher${qs({ teacherId, from, to })}` : null);

  return (
    <Screen title={own ? 'Mis clases dictadas' : 'Reporte de profesores'} onRefresh={() => void rep.reload()} refreshing={rep.loading}>
      {!own ? (
        <Chips label="Profesor" options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.full_name }))} value={teacherId ?? undefined} onChange={setTeacherId} />
      ) : null}
      <RangePicker range={range} showGroup={false} />
      {!teacherId ? <Muted>Elige el profesor.</Muted> : (
        <Loader state={rep}>
          {(r) => (
            <>
              <KpiRow>
                <Kpi label="Dictadas" value={r.summary.taught} icon="checkmark-done" tone="success" />
                <Kpi label="No asistió" value={r.summary.absent} icon="close-circle" tone="danger" />
                <Kpi label="Aforo promedio" value={`${r.summary.occupancy}%`} icon="people" />
              </KpiRow>
              <Muted style={{ fontSize: 12, marginBottom: 8 }}>
                {r.summary.attendees} asistentes en total · {r.summary.avgAttendees} por clase · {r.summary.cancelled} cancelada(s) por otro motivo · {r.summary.upcoming} próxima(s)
              </Muted>
              <Section title="Clases">
                {r.sessions.length === 0 ? <Empty text="Sin clases en este período." icon="school-outline" /> : r.sessions.map((x) => (
                  <Card key={x.id}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontWeight: '700', color: colors.text, flexShrink: 1 }}>{x.title}</Text>
                      <Badge text={STATE[x.state].text} tone={STATE[x.state].tone} />
                    </View>
                    <Muted>{fmtRange(x.starts_at, x.ends_at)}</Muted>
                    <Muted style={{ fontSize: 12 }}>{x.academy_name} · {x.site_name} · {x.space_name}</Muted>
                    {x.state === 'taught' || x.state === 'upcoming' ? (
                      <Muted style={{ fontSize: 12, marginTop: 2 }}>
                        Asistieron {x.attendees} de {x.capacity} ({x.occupancy}% del cupo) · {x.reserved} reserva(s) · aforo del espacio {x.max_capacity}
                      </Muted>
                    ) : null}
                  </Card>
                ))}
              </Section>
            </>
          )}
        </Loader>
      )}
    </Screen>
  );
}
