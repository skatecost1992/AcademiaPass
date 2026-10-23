import type { PlanKind } from '../types';

export const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' de una fecha en la hora local del telefono */
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = v.length === 10 ? new Date(`${v}T12:00:00`) : new Date(v);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export const fmtTime = (v: string) => {
  const d = new Date(v);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtDateTime = (v: string | null | undefined) => (v ? `${fmtDate(v)} ${fmtTime(v)}` : '—');
export const fmtRange = (a: string, b: string) => `${DAYS[new Date(a).getDay()]} ${fmtDate(a)} · ${fmtTime(a)}–${fmtTime(b)}`;

/** Etiqueta de un periodo de reporte (inicio de semana o de mes) */
export function fmtPeriod(p: string, groupBy: 'week' | 'month') {
  const d = new Date(`${p}T12:00:00`);
  return groupBy === 'month' ? `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : `Semana del ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export const money = (n: number | null | undefined) =>
  '$ ' + Math.round(n ?? 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Combina 'YYYY-MM-DD' y 'HH:MM' (hora del telefono) en ISO */
export function toIso(date: string, time: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).toISOString();
}

/** 'YYYY-MM-DD' + N meses calendario */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(y, m - 1 + months + 1, 0).getDate();
  return ymd(new Date(y, m - 1 + months, Math.min(d, last)));
}

/** Fin de vigencia de un plan que empieza en `start` (RQ55) */
export const planEnd = (start: string, plan: { validity_days: number; validity_months: number | null }) =>
  plan.validity_months ? addDays(addMonths(start, plan.validity_months), -1) : addDays(start, plan.validity_days - 1);

export const validityText = (plan: { validity_days: number; validity_months: number | null }) =>
  plan.validity_months ? `${plan.validity_months} ${plan.validity_months === 1 ? 'mes' : 'meses'}` : `${plan.validity_days} días`;

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export const PLAN_KINDS: { value: PlanKind; label: string }[] = [
  { value: 'classes', label: 'Clases' },
  { value: 'reservations', label: 'Reservas' },
  { value: 'access', label: 'Acceso / asesorías' },
  { value: 'mixed', label: 'Mixto' },
];
export const planKindLabel = (k: string) => PLAN_KINDS.find((p) => p.value === k)?.label ?? k;

export const PAY_METHODS = ['efectivo', 'transferencia', 'tarjeta', 'nequi', 'daviplata', 'otro'];
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const unitsText = (remaining: number | null, total: number | null) =>
  total == null ? 'Ilimitado' : `${remaining} de ${total}`;
