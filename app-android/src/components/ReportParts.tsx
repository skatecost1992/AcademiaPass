/**
 * Piezas de los reportes: selector de periodo, barras horizontales y la vista del reporte unificado (RQ8, RQ15).
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fmtDate, fmtDateTime, fmtPeriod, planKindLabel, today, unitsText, ymd } from '../lib/format';
import { sharePdf } from '../lib/pdf';
import { unifiedReportHtml } from '../lib/report';
import type { UnifiedReport } from '../types';
import { Badge, Button, Card, Chips, Empty, InfoRow, Kpi, KpiRow, Muted, Section, colors, errorText, notify } from './ui';

export type GroupBy = 'week' | 'month';
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Periodo de los reportes (RQ50): un mes o un ano calendario, nunca mas de un ano. `offset` mueve el periodo
 * hacia atras (-1 = mes o ano anterior).
 */
export function useRange(initialMode: 'month' | 'year' = 'month') {
  const [mode, setMode] = useState<'month' | 'year'>(initialMode);
  const [offset, setOffset] = useState(0);
  const [groupBy, setGroupBy] = useState<GroupBy>(initialMode === 'year' ? 'month' : 'week');
  const now = new Date();
  let from: string;
  let to: string;
  let label: string;
  if (mode === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    from = ymd(first);
    to = ymd(new Date(first.getFullYear(), first.getMonth() + 1, 0));
    label = `${MONTH_NAMES[first.getMonth()]} ${first.getFullYear()}`;
  } else {
    const y = now.getFullYear() + offset;
    from = `${y}-01-01`;
    to = `${y}-12-31`;
    label = String(y);
  }
  // Los periodos futuros no tienen registros: se recortan a hoy
  if (to > today() && offset === 0) to = today();
  const changeMode = (m: 'month' | 'year') => { setMode(m); setOffset(0); setGroupBy(m === 'year' ? 'month' : 'week'); };
  return { mode, setMode: changeMode, offset, setOffset, groupBy, setGroupBy, from, to, label };
}

export function RangePicker({ range, showGroup = true }: { range: ReturnType<typeof useRange>; showGroup?: boolean }) {
  return (
    <View>
      <Chips label="Consultar por" options={[{ value: 'month' as const, label: 'Mes' }, { value: 'year' as const, label: 'Año' }]} value={range.mode} onChange={range.setMode} />
      <View style={s.period}>
        <Button small variant="secondary" icon="chevron-back" label="" onPress={() => range.setOffset(range.offset - 1)} />
        <Text style={s.periodLabel}>{range.label}</Text>
        <Button small variant="secondary" icon="chevron-forward" label="" onPress={() => range.setOffset(Math.min(0, range.offset + 1))} disabled={range.offset >= 0} />
      </View>
      {showGroup ? (
        <Chips<GroupBy> label="Agrupar por" options={[{ value: 'week', label: 'Semana' }, { value: 'month', label: 'Mes' }]} value={range.groupBy} onChange={range.setGroupBy} />
      ) : null}
    </View>
  );
}

/** Lista de barras proporcionales: [etiqueta, valor, texto a la derecha] */
export function Bars({ rows, empty = 'Sin registros en el periodo.' }: { rows: { label: string; value: number; right?: string }[]; empty?: string }) {
  if (!rows.length) return <Empty text={empty} icon="bar-chart-outline" />;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      {rows.map((r, i) => (
        <View key={`${r.label}-${i}`} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={s.barLabel} numberOfLines={1}>{r.label}</Text>
            <Text style={s.barValue}>{r.right ?? r.value}</Text>
          </View>
          <View style={s.track}>
            <View style={[s.bar, { width: `${Math.max(2, (r.value / max) * 100)}%` }]} />
          </View>
        </View>
      ))}
    </Card>
  );
}

export interface ClassesReport {
  totals: { reserved: number; taken: number; takenWithReservation: number; missed: number; upcoming: number };
  byClass: { title: string; reserved: number; taken: number; missed: number }[];
  rows: {
    reservation_id: number | null; client_id: number; client_name: string; booking_id: number; title: string; starts_at: string;
    site_name: string; academy_name: string; teacher_name: string | null; attended_at: string | null; reserved: boolean; state: 'taken' | 'missed' | 'reserved' | 'cancelled';
  }[];
}

const CLASS_STATE = {
  taken: ['Tomada', 'success'], missed: ['No asistió', 'danger'], reserved: ['Reservada', 'primary'], cancelled: ['Clase cancelada', 'muted'],
} as const;

/** Clases reservadas y tomadas (RQ41). Con `showClient` muestra el cliente de cada fila (vista del personal) */
export function ClassesReportView({ report, showClient }: { report: ClassesReport; showClient?: boolean }) {
  const t = report.totals;
  return (
    <View>
      <KpiRow>
        <Kpi label="Reservadas" value={t.reserved} icon="bookmark" />
        <Kpi label="Tomadas" value={t.taken} icon="checkmark-done" tone="success" />
        <Kpi label="No asistió" value={t.missed} icon="close-circle" tone="danger" />
        <Kpi label="Por venir" value={t.upcoming} icon="time" tone="accent" />
      </KpiRow>
      <Section title="Por clase">
        <Bars rows={report.byClass.map((c) => ({ label: c.title, value: c.reserved + c.taken, right: `${c.reserved} reservadas · ${c.taken} tomadas${c.missed ? ` · ${c.missed} sin asistir` : ''}` }))} />
      </Section>
      <Section title="Detalle">
        {report.rows.length === 0 ? <Empty text="Sin clases reservadas ni tomadas en el periodo." icon="school-outline" /> : (
          <Card>
            {report.rows.slice(0, 100).map((r, i) => (
              <View key={`${r.booking_id}-${r.client_id}-${i}`} style={s.att}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={[s.attDate, { flex: 1 }]}>{r.title} · {fmtDateTime(r.starts_at)}</Text>
                  <Badge text={CLASS_STATE[r.state][0]} tone={CLASS_STATE[r.state][1]} />
                </View>
                <Muted style={{ fontSize: 12 }}>
                  {showClient ? `${r.client_name} · ` : ''}{r.teacher_name ? `Prof. ${r.teacher_name} · ` : ''}{r.academy_name} · {r.site_name}{r.reserved ? ' · con reserva' : ' · sin reserva previa'}
                </Muted>
              </View>
            ))}
          </Card>
        )}
      </Section>
    </View>
  );
}

export function UnifiedReportView({ report, groupBy }: { report: UnifiedReport; groupBy: GroupBy }) {
  const [busy, setBusy] = useState(false);
  const periods = groupBy === 'week' ? report.weekly : report.monthly;

  const pdf = async () => {
    setBusy(true);
    try {
      await sharePdf(unifiedReportHtml(report), `Reporte ${report.client.fullName}`);
    } catch (e) {
      notify('No se pudo generar el PDF', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <KpiRow>
        <Kpi label="Asistencias" value={report.totals.visits} icon="checkmark-done" />
        <Kpi label="Días asistidos" value={report.totals.days} icon="calendar" tone="success" />
        <Kpi label="Clases restantes" value={report.totals.unitsRemaining ?? '∞'} icon="hourglass" tone="accent" />
      </KpiRow>
      <Button label="Descargar PDF" icon="document-text-outline" variant="secondary" onPress={pdf} loading={busy} style={{ marginTop: 12 }} testID="report-pdf" />

      <Section title="Planes">
        {report.memberships.length === 0 ? <Empty text="Sin planes adquiridos." /> : null}
        {report.memberships.map((m) => (
          <Card key={m.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={s.title}>{m.plan_name}</Text>
              <Badge text={m.status === 'cancelled' ? 'Cancelado' : m.is_current ? 'Vigente' : 'Terminado'} tone={m.is_current ? 'success' : 'muted'} />
            </View>
            <InfoRow label="Tipo" value={planKindLabel(m.kind)} />
            <InfoRow label="Tomadas" value={m.units_used} />
            <InfoRow label="Restantes" value={unitsText(m.remaining, m.units_total)} />
            <InfoRow label="Vigencia" value={`${fmtDate(m.starts_on)} – ${fmtDate(m.ends_on)}`} />
            <Muted style={{ fontSize: 12 }}>{m.academies.map((a) => a.name).join(', ')} · {m.all_sites ? 'todas las sedes' : m.sites.map((x) => x.name).join(', ')}</Muted>
          </Card>
        ))}
      </Section>

      <Section title="Por academia">
        <Bars rows={report.byAcademy.map((a) => ({ label: a.name, value: a.visits, right: `${a.visits} · ${a.days} días` }))} />
      </Section>

      <Section title={groupBy === 'week' ? 'Asistencia semanal' : 'Asistencia mensual'}>
        <Bars rows={periods.totals.map((p) => ({ label: fmtPeriod(p.period, groupBy), value: p.visits, right: `${p.visits} · ${p.days} días` }))} />
        {periods.byAcademy.length > periods.totals.length ? (
          <Card>
            {periods.byAcademy.map((p, i) => (
              <InfoRow key={i} label={`${fmtPeriod(p.period, groupBy)} · ${p.academy_name}`} value={`${p.visits}`} />
            ))}
          </Card>
        ) : null}
      </Section>

      <Section title="Días asistidos">
        {report.attendances.length === 0 ? <Empty text="Sin asistencias en el periodo." /> : (
          <Card>
            {report.attendances.slice(0, 60).map((a) => (
              <View key={a.id} style={s.att}>
                <Text style={s.attDate}>{fmtDateTime(a.scanned_at)}</Text>
                <Muted style={{ fontSize: 12 }}>{a.academy_name} · {a.site_name} · {a.booking_title ?? 'Ingreso general'}</Muted>
              </View>
            ))}
          </Card>
        )}
      </Section>
    </View>
  );
}

const s = StyleSheet.create({
  period: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  periodLabel: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: colors.text, textTransform: 'capitalize' },
  barLabel: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  barValue: { color: colors.muted, fontSize: 13 },
  track: { height: 8, backgroundColor: '#E5ECEA', borderRadius: 4, marginTop: 4, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, flex: 1 },
  att: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  attDate: { fontWeight: '700', color: colors.text },
});
