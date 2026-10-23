/**
 * Modulo de reportes del personal: resumen agrupado (RQ22), asistencia de todos los clientes (RQ9), aforo por
 * espacio segun QR escaneados (RQ21) y pagos, filtrables por academia y sede (RQ10).
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Bars, ClassesReportView, RangePicker, useRange } from '../components/ReportParts';
import { PlacePicker } from '../components/shared';
import { Badge, Button, Card, Chips, Empty, InfoRow, Kpi, KpiRow, ListItem, Loader, Muted, Screen, Section, errorText, notify, useLoad } from '../components/ui';
import { qs } from '../lib/api';
import { cap, fmtDate, fmtDateTime, fmtPeriod, money } from '../lib/format';
import { sharePdf } from '../lib/pdf';
import { summaryReportHtml } from '../lib/report';
import { useSession } from '../session';

type Tab = 'summary' | 'attendance' | 'classes' | 'capacity' | 'payments';
type G = 'week' | 'month';

function AttendanceView({ a, g }: { a: any; g: G }) {
  return (
    <>
      <KpiRow>
        <Kpi label="Asistencias" value={a.totals.visits} icon="checkmark-done" />
        <Kpi label="Clientes distintos" value={a.totals.clients} icon="people" tone="success" />
      </KpiRow>
      <Section title={g === 'week' ? 'Por semana' : 'Por mes'}>
        <Bars rows={a.periods.map((p: any) => ({ label: fmtPeriod(p.period, g), value: p.visits, right: `${p.visits} · ${p.clients} clientes${p.over_capacity ? ` · ${p.over_capacity} fuera de aforo` : ''}` }))} />
      </Section>
      <Section title="Por sede">
        <Bars rows={a.bySite.map((x: any) => ({ label: `${x.name} (${x.academy_name})`, value: x.visits, right: `${x.visits} · ${x.clients} clientes` }))} />
      </Section>
      <Section title="Por clase">
        <Bars rows={a.byClass.map((x: any) => ({ label: x.name, value: x.visits }))} />
      </Section>
      <Section title="Por cliente">
        {a.byClient.length === 0 ? <Empty text="Sin asistencias." /> : a.byClient.slice(0, 100).map((c: any) => (
          <ListItem key={c.id} title={c.full_name} subtitle={`${c.visits} asistencias · ${c.days} días · último ${fmtDate(c.last)}`}
            onPress={() => router.push({ pathname: '/clients/report', params: { clientId: String(c.id) } })} />
        ))}
      </Section>
    </>
  );
}

function CapacityView({ c, g }: { c: any; g: G }) {
  return (
    <>
      <Muted>Cupos ofrecidos en clases y reservas frente a asistentes que escanearon su QR.</Muted>
      <Section title="Por espacio">
        {c.bySpace.length === 0 ? <Empty text="Sin clases ni reservas en el periodo." /> : c.bySpace.map((x: any) => (
          <Card key={x.id}>
            <InfoRow label={`${x.name} · ${x.site_name}`} value={<Badge text={`${x.occupancy}% ocupación`} tone={x.occupancy >= 90 ? 'danger' : x.occupancy >= 60 ? 'accent' : 'success'} />} />
            <InfoRow label="Aforo del espacio" value={`${x.max_capacity}${x.allow_multi_group ? ` · ${x.max_groups} grupos` : ''}`} />
            <InfoRow label="Clases/reservas" value={x.bookings} />
            <InfoRow label="Cupos ofrecidos" value={x.spots} />
            <InfoRow label="Asistentes (QR)" value={x.attendees} />
            {x.over_capacity ? <InfoRow label="Ingresos fuera de aforo" value={x.over_capacity} /> : null}
          </Card>
        ))}
      </Section>
      <Section title={g === 'week' ? 'Por semana' : 'Por mes'}>
        <Bars rows={c.periods.map((p: any) => ({ label: `${fmtPeriod(p.period, g)} · ${p.space_name}`, value: p.attendees, right: `${p.attendees}/${p.spots} (${p.occupancy}%)` }))} />
      </Section>
      <Section title="Sesiones">
        {c.sessions.slice(0, 50).map((s: any) => (
          <ListItem key={s.id} title={`${s.title} · ${s.space_name}`} subtitle={fmtDateTime(s.starts_at)}
            right={<Badge text={`${s.attendees}/${s.group_size}`} tone={s.full ? 'danger' : 'success'} />}
            onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: String(s.id) } })} />
        ))}
      </Section>
    </>
  );
}

function PaymentsView({ p, g }: { p: any; g: G }) {
  return (
    <>
      <KpiRow><Kpi label="Total" value={money(p.total)} icon="cash" tone="success" /></KpiRow>
      <Section title={g === 'week' ? 'Por semana' : 'Por mes'}>
        <Bars rows={p.periods.map((x: any) => ({ label: fmtPeriod(x.period, g), value: x.total, right: `${money(x.total)} · ${x.payments}` }))} />
      </Section>
      <Section title="Por medio de pago">
        <Bars rows={p.byMethod.map((x: any) => ({ label: cap(x.method), value: x.total, right: money(x.total) }))} />
      </Section>
      <Section title="Por concepto">
        <Bars rows={p.byConcept.map((x: any) => ({ label: x.concept, value: x.total, right: money(x.total) }))} />
      </Section>
    </>
  );
}

export default function Reports() {
  const { can, user } = useSession();
  const tabs = [
    can('reports') && { value: 'summary' as Tab, label: 'Resumen' },
    can('reports') && { value: 'attendance' as Tab, label: 'Asistencia' },
    can('reports') && { value: 'classes' as Tab, label: 'Clases' },
    can('capacity_reports') && { value: 'capacity' as Tab, label: 'Aforo' },
    can('reports') && { value: 'payments' as Tab, label: 'Pagos' },
  ].filter(Boolean) as { value: Tab; label: string }[];
  const [tab, setTab] = useState<Tab>(tabs[0]?.value ?? 'capacity');
  const range = useRange(90);
  const [academyId, setAcademyId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const path = { summary: '/reports/summary', attendance: '/reports/attendance', classes: '/reports/classes', capacity: '/reports/capacity', payments: '/reports/payments' }[tab];
  const data = useLoad<any>(`${path}${qs({ from: range.from, to: range.to, groupBy: range.groupBy, academyId, siteId })}`);
  const g = (data.data?.groupBy ?? range.groupBy) as G;

  const pdf = async () => {
    if (!data.data || tab !== 'summary') return;
    setBusy(true);
    try {
      const label = [academyId ? user?.academies.find((a) => a.id === academyId)?.name : 'Todas las academias', siteId ? 'sede filtrada' : 'todas las sedes'].join(' · ');
      await sharePdf(summaryReportHtml(user?.tenant.name ?? '', data.data, label), 'Reporte general');
    } catch (e) {
      notify('No se pudo generar el PDF', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Reportes" onRefresh={data.reload} refreshing={data.loading}>
      <Chips options={tabs} value={tab} onChange={setTab} />
      <RangePicker range={range} />
      <PlacePicker academyId={academyId} siteId={siteId} allowAll onChange={(a, s) => { setAcademyId(a); setSiteId(s); }} />
      <Loader state={data}>
        {(d) => {
          if (tab === 'attendance') return <AttendanceView a={d} g={g} />;
          if (tab === 'classes') return <ClassesReportView report={d} showClient />;
          if (tab === 'capacity') return <CapacityView c={d} g={g} />;
          if (tab === 'payments') return <PaymentsView p={d} g={g} />;
          if (!d.kpi) return null;
          return (
            <>
              <KpiRow>
                <Kpi label="Clientes activos" value={d.kpi.clients} icon="people" />
                <Kpi label="Planes vigentes" value={d.kpi.active_memberships} icon="pricetags" tone="success" />
                <Kpi label="Asistencias" value={d.attendance.totals.visits} icon="checkmark-done" tone="accent" />
                <Kpi label="Recaudado" value={money(d.payments.total)} icon="cash" tone="success" />
              </KpiRow>
              <Button label="Descargar reporte general en PDF" icon="document-text-outline" variant="secondary" onPress={pdf} loading={busy} style={{ marginTop: 12 }} />
              <Section title="Planes que vencen en 7 días">
                {d.expiring.length === 0 ? <Muted>Ninguno.</Muted> : d.expiring.map((m: any) => (
                  <ListItem key={m.id} title={m.full_name} subtitle={`${m.plan_name} · vence ${fmtDate(m.ends_on)}`} onPress={() => router.push({ pathname: '/clients/[id]', params: { id: String(m.client_id) } })} />
                ))}
              </Section>
              <Section title="Asistencia">
                <Bars rows={d.attendance.periods.map((p: any) => ({ label: fmtPeriod(p.period, g), value: p.visits, right: `${p.visits} · ${p.clients} clientes` }))} />
                <Bars rows={d.attendance.bySite.map((x: any) => ({ label: `${x.name} (${x.academy_name})`, value: x.visits }))} />
              </Section>
              {d.capacity ? (
                <Section title="Aforo por espacio">
                  <Bars rows={d.capacity.bySpace.map((x: any) => ({ label: `${x.name} · ${x.site_name}`, value: x.occupancy, right: `${x.attendees}/${x.spots} (${x.occupancy}%)` }))} />
                </Section>
              ) : null}
              <Section title="Pagos">
                <Bars rows={d.payments.periods.map((x: any) => ({ label: fmtPeriod(x.period, g), value: x.total, right: money(x.total) }))} />
              </Section>
            </>
          );
        }}
      </Loader>
    </Screen>
  );
}
