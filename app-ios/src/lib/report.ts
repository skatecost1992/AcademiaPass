/**
 * HTML de los reportes en PDF: reporte unificado del cliente (RQ15) y reporte agrupado del administrador (RQ22).
 * Solo HTML y CSS en linea para que expo-print lo convierta igual en Android, iOS y web.
 */
import type { UnifiedReport } from '../types';
import { fmtDate, fmtDateTime, fmtPeriod, money, planKindLabel, unitsText } from './format';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #10231F; margin: 28px; font-size: 12px; }
  header { border-bottom: 3px solid #0F766E; padding-bottom: 10px; margin-bottom: 16px; }
  h1 { font-size: 20px; margin: 0; color: #0F766E; }
  h2 { font-size: 14px; margin: 20px 0 8px; color: #0F766E; text-transform: uppercase; letter-spacing: .5px; }
  .muted { color: #5E726E; }
  .kpis { display: flex; gap: 10px; margin: 10px 0; }
  .kpi { flex: 1; border: 1px solid #DCE5E3; border-radius: 8px; padding: 10px; }
  .kpi b { display: block; font-size: 20px; color: #0F766E; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th { background: #DDF3EF; text-align: left; padding: 6px; font-size: 11px; }
  td { border-bottom: 1px solid #E5ECEA; padding: 6px; }
  td.n, th.n { text-align: right; }
  .bar { height: 8px; background: #0F766E; border-radius: 4px; }
  footer { margin-top: 24px; font-size: 10px; color: #5E726E; border-top: 1px solid #DCE5E3; padding-top: 8px; }
`;

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}
  <footer>Generado por AcademiaPass el ${esc(fmtDateTime(new Date().toISOString()))}. Información confidencial, tratada únicamente por la academia y sus funcionarios.</footer></body></html>`;

function table(headers: string[], rows: (string | number)[][], numeric: number[] = []) {
  if (!rows.length) return '<p class="muted">Sin registros en el periodo.</p>';
  const th = headers.map((h, i) => `<th class="${numeric.includes(i) ? 'n' : ''}">${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numeric.includes(i) ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/** Reporte unificado: asistencia semanal y mensual en todas las academias y saldo de cada plan (RQ15) */
export function unifiedReportHtml(r: UnifiedReport) {
  const kpis = `<div class="kpis">
    <div class="kpi"><b>${r.totals.visits}</b>asistencias</div>
    <div class="kpi"><b>${r.totals.days}</b>días asistidos</div>
    <div class="kpi"><b>${r.totals.unitsUsed}</b>clases tomadas (planes vigentes)</div>
    <div class="kpi"><b>${r.totals.unitsRemaining ?? 'Ilimitado'}</b>clases restantes</div></div>`;
  const plans = table(
    ['Plan', 'Tipo', 'Academias / sedes', 'Vigencia', 'Tomadas', 'Restantes', 'Estado'],
    r.memberships.map((m) => [
      m.plan_name, planKindLabel(m.kind), `${m.academies.map((a) => a.name).join(', ')} · ${m.all_sites ? 'todas las sedes' : m.sites.map((s) => s.name).join(', ')}`,
      `${fmtDate(m.starts_on)} – ${fmtDate(m.ends_on)}`, m.units_used, unitsText(m.remaining, m.units_total),
      m.status === 'cancelled' ? 'Cancelado' : m.is_current ? 'Vigente' : 'Terminado',
    ]),
    [4],
  );
  const byAcademy = table(['Academia', 'Asistencias', 'Días'], r.byAcademy.map((a) => [a.name, a.visits, a.days]), [1, 2]);
  const weekly = table(['Semana', 'Academia', 'Asistencias', 'Días'], r.weekly.byAcademy.map((w) => [fmtPeriod(w.period, 'week'), w.academy_name, w.visits, w.days]), [2, 3]);
  const monthly = table(['Mes', 'Academia', 'Asistencias', 'Días'], r.monthly.byAcademy.map((w) => [fmtPeriod(w.period, 'month'), w.academy_name, w.visits, w.days]), [2, 3]);
  const detail = table(['Fecha', 'Academia', 'Sede', 'Clase / reserva', 'Plan'], r.attendances.map((a) => [fmtDateTime(a.scanned_at), a.academy_name, a.site_name, a.booking_title ?? 'Ingreso general', a.plan_name ?? '—']));
  return page(`Reporte ${r.client.fullName}`, `
    <header><h1>Reporte unificado de asistencia</h1>
      <div><b>${esc(r.client.fullName)}</b> · Documento ${esc(r.client.document)} · ${esc(r.client.organization)}</div>
      <div class="muted">Periodo: ${esc(fmtDate(r.from))} a ${esc(fmtDate(r.to))}</div></header>
    ${kpis}
    <h2>Planes</h2>${plans}
    <h2>Asistencia por academia</h2>${byAcademy}
    <h2>Asistencia semanal</h2>${weekly}
    <h2>Asistencia mensual</h2>${monthly}
    <h2>Detalle de asistencias</h2>${detail}`);
}

/** Reporte agrupado del administrador (RQ22): indicadores, asistencia, aforo y pagos */
export function summaryReportHtml(org: string, s: any, filterLabel: string) {
  const g = s.groupBy as 'week' | 'month';
  const kpis = `<div class="kpis">
    <div class="kpi"><b>${s.kpi.clients}</b>clientes activos</div>
    <div class="kpi"><b>${s.kpi.active_memberships}</b>planes vigentes</div>
    <div class="kpi"><b>${s.attendance.totals.visits}</b>asistencias</div>
    <div class="kpi"><b>${esc(money(s.payments.total))}</b>recaudado</div></div>`;
  const att = table([g === 'week' ? 'Semana' : 'Mes', 'Asistencias', 'Clientes', 'Fuera de aforo'], s.attendance.periods.map((p: any) => [fmtPeriod(p.period, g), p.visits, p.clients, p.over_capacity]), [1, 2, 3]);
  const sites = table(['Academia', 'Sede', 'Asistencias', 'Clientes'], s.attendance.bySite.map((x: any) => [x.academy_name, x.name, x.visits, x.clients]), [2, 3]);
  const clients = table(['Cliente', 'Asistencias', 'Días'], s.attendance.byClient.slice(0, 50).map((c: any) => [c.full_name, c.visits, c.days]), [1, 2]);
  const cap = s.capacity
    ? table(['Sede', 'Espacio', 'Aforo', 'Reservas', 'Cupos', 'Asistentes', 'Ocupación', 'Fuera de aforo'], s.capacity.bySpace.map((x: any) => [x.site_name, x.name, x.max_capacity, x.bookings, x.spots, x.attendees, `${x.occupancy}%`, x.over_capacity]), [2, 3, 4, 5, 6, 7])
    : '<p class="muted">Sin permiso para reportes de aforo.</p>';
  const pay = table([g === 'week' ? 'Semana' : 'Mes', 'Pagos', 'Total'], s.payments.periods.map((p: any) => [fmtPeriod(p.period, g), p.payments, money(p.total)]), [1, 2]);
  const methods = table(['Medio', 'Pagos', 'Total'], s.payments.byMethod.map((p: any) => [p.method, p.payments, money(p.total)]), [1, 2]);
  const expiring = table(['Cliente', 'Plan', 'Vence', 'Tomadas'], s.expiring.map((m: any) => [m.full_name, m.plan_name, fmtDate(m.ends_on), m.units_total == null ? m.units_used : `${m.units_used}/${m.units_total}`]), [3]);
  return page(`Reporte general ${org}`, `
    <header><h1>Reporte general · ${esc(org)}</h1>
      <div class="muted">Periodo: ${esc(fmtDate(s.from))} a ${esc(fmtDate(s.to))} · ${esc(filterLabel)}</div></header>
    ${kpis}
    <h2>Asistencia</h2>${att}
    <h2>Asistencia por sede</h2>${sites}
    <h2>Clientes con más asistencias</h2>${clients}
    <h2>Aforo por espacio</h2>${cap}
    <h2>Pagos</h2>${pay}${methods}
    <h2>Planes que vencen en 7 días</h2>${expiring}`);
}
