export type Role = 'admin' | 'staff' | 'client';
export type Permission =
  | 'attendance' | 'schedules' | 'classes' | 'bookings' | 'clients' | 'plans' | 'payments'
  | 'reports' | 'capacity_reports' | 'override_capacity' | 'booking_rules';

export interface Profile {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  document: string;
  role: Role;
  permissions: Permission[];
  consentAt: string | null;
  consentRequired: boolean;
  tenant: { id: number; name: string };
  academies: { id: number; name: string; join_code?: string }[];
}

export interface Academy { id: number; name: string; description: string | null; join_code: string | null; active: boolean; sites: number }
export interface OpeningSlot { day: number; open: string; close: string }
export interface Site { id: number; academy_id: number; academy_name: string; name: string; address: string | null; phone: string | null; opening_hours: OpeningSlot[]; active: boolean; photos: number }
export interface Space {
  id: number; site_id: number; site_name: string; academy_id: number; name: string; description: string | null;
  max_capacity: number; allow_multi_group: boolean; max_groups: number; capacity_per_group: number | null; active: boolean; photos: number;
  opening_hours: OpeningSlot[] | null; // RQ40: null = el de la sede
}
export interface Teacher { id: number; full_name: string; kind: 'internal' | 'external'; phone: string | null; email: string | null; specialty: string | null; active: boolean }
export interface ClassDef { id: number; academy_id: number; academy_name: string; teacher_id: number | null; teacher_name: string | null; teacher_kind: string | null; name: string; description: string | null; default_capacity: number; active: boolean }
export interface Booking {
  id: number; kind: 'class' | 'rental'; title: string; starts_at: string; ends_at: string; group_size: number; status: string; notes: string | null;
  site_id: number; space_id: number; class_id: number | null; teacher_id: number | null; client_id: number | null;
  space_name: string; site_name: string; academy_id: number; academy_name: string; teacher_name: string | null; teacher_kind: string | null;
  client_name: string | null; attendees: number; paid: number;
  reserved: number; my_reservation_id?: number | null;
}
export type PlanKind = 'classes' | 'reservations' | 'access' | 'mixed';
export interface Plan {
  id: number; name: string; description: string | null; kind: PlanKind; units: number | null; validity_days: number; price: number;
  all_sites: boolean; active: boolean; academies: { id: number; name: string }[]; sites: { id: number; name: string }[];
}
export interface Membership {
  id: number; plan_id: number; plan_name: string; kind: PlanKind; starts_on: string; ends_on: string; units_total: number | null; units_used: number;
  remaining: number | null; status: 'active' | 'cancelled'; all_sites: boolean; academies: { id: number; name: string }[]; sites: { id: number; name: string }[];
  paid: number; price: number; is_current: boolean;
}
export interface ClientRow {
  id: number; username: string; full_name: string; email: string | null; phone: string | null; active: boolean; consent_at: string | null;
  home_site_id: number | null; home_site_name: string | null; document: string; academies: { id: number; name: string }[]; last_attendance: string | null;
}
export interface PeriodRow { period: string; visits: number; days: number }
export interface UnifiedReport {
  generatedAt: string; from: string; to: string;
  client: { id: number; fullName: string; document: string; email: string | null; organization: string };
  memberships: Membership[];
  totals: { visits: number; days: number; unitsUsed: number; unitsRemaining: number | null };
  byAcademy: { id: number; name: string; visits: number; days: number }[];
  weekly: { totals: PeriodRow[]; byAcademy: (PeriodRow & { academy_name: string })[] };
  monthly: { totals: PeriodRow[]; byAcademy: (PeriodRow & { academy_name: string })[] };
  days: string[];
  attendances: { id: number; scanned_at: string; day: string; academy_name: string; site_name: string; booking_title: string | null; plan_name: string | null }[];
}
