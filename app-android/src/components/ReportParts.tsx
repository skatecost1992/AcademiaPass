/**
 * Piezas de los reportes: selector de periodo, barras horizontales y la vista del reporte unificado (RQ8, RQ15).
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { addDays, fmtDate, fmtDateTime, fmtPeriod, planKindLabel, today, unitsText } from '../lib/format';
import { sharePdf } from '../lib/pdf';
import { unifiedReportHtml } from '../lib/report';
import type { UnifiedReport } from '../types';
import { Badge, Button, Card, Chips, Empty, InfoRow, Kpi, KpiRow, Muted, Section, colors, errorText, notify } from './ui';

export type GroupBy = 'week' | 'month';
const PRESETS = [
  { value: 30, label: '30 días' },
  { value: 90, label: '3 meses' },
  { value: 180, label: '6 meses' },
  { value: 365, label: '1 año' },
];

export function useRange(initial = 90) {
  const [days, setDays] = useState(initial);
  const [groupBy, setGroupBy] = useState<GroupBy>('week');
  const to = today();
  return { days, setDays, groupBy, setGroupBy, from: addDays(to, -days + 1), to };
}

export function RangePicker({ range, showGroup = true }: { range: ReturnType<typeof useRange>; showGroup?: boolean }) {
  return (
    <View>
      <Chips label="Periodo" options={PRESETS} value={range.days} onChange={range.setDays} />
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
  barLabel: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  barValue: { color: colors.muted, fontSize: 13 },
  track: { height: 8, backgroundColor: '#E5ECEA', borderRadius: 4, marginTop: 4, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, flex: 1 },
  att: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#EEF2F1' },
  attDate: { fontWeight: '700', color: colors.text },
});
