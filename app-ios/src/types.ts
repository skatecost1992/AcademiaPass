export type Role = 'admin' | 'staff' | 'client';
export type Permission =
  | 'attendance' | 'schedules' | 'classes' | 'bookings' | 'clients' | 'plans' | 'payments'
  | 'reports' | 'capacity_reports' | 'override_capacity' | 'booking_rules' | 'notifications';

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
  isSuperadmin?: boolean; // RQ58
  teacher?: { id: number; name: string } | null; // RQ69: usuario de un profesor
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
export interface Teacher {
  id: number; full_name: string; kind: 'internal' | 'external'; phone: string | null; email: string | null; specialty: string | null; active: boolean;
  sites: { id: number; name: string; academy_id: number; academy_name: string }[]; // RQ62
  account: { userId: number; username: string; permissions: Permission[]; active: boolean } | null; // RQ69
}
export interface ClassDef { id: number; academy_id: number; academy_name: string; teacher_id: number | null; teacher_name: string | null; teacher_kind: string | null; name: string; description: string | null; default_capacity: number; active: boolean;
  space_id: number | null; space_name: string | null; site_id: number | null; site_name: string | null; // RQ61
}
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
  validity_months: number | null; sale_until: string | null; // RQ55, RQ56
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

/** Correos automaticos (RQ63, RQ64): parametros de la organizacion */
export interface OrgNotificationSettings {
  dayBefore: boolean;
  hoursBefore: boolean;
  plan: boolean;
  planNoticeDays: number;
  dayBeforeHours: number;
  hoursBeforeHours: number;
  mailConfigured: boolean;
  mailProvider: 'gmail-api' | 'gmail' | 'resend' | 'brevo' | 'smtp' | 'test' | null; // RQ67
  mailFrom: string | null;
}

/** Preferencias de correo del usuario */
export interface MyNotifications {
  email: string | null;
  dayBefore: boolean;
  hoursBefore: boolean;
  plan: boolean;
  organization: OrgNotificationSettings;
}

/** RQ66: reserva con la que se cruza una sesion, y sesion que no se pudo programar */
export interface Clash { bookingId: number; kind: 'class' | 'rental'; title: string; startsAt: string; endsAt: string; spaceId: number; classId: number | null; teacherId: number | null; teacherName: string | null; teacherHasEmail: boolean }
export interface SessionConflict { startsAt: string; endsAt: string; code?: string; message: string; available?: string[]; clashes?: Clash[] }

/** RQ66: solicitud de cambio de horario a otro profesor */
export interface ScheduleRequest {
  id: number; status: 'pending' | 'accepted' | 'rejected' | 'cancelled'; message: string | null; response_note: string | null;
  resolved_via: 'app' | 'email' | null; resolved_at: string | null; created_at: string; class_id: number; class_name: string;
  requester_teacher_name: string | null; target_teacher_id: number; target_teacher_name: string; target_teacher_has_email: boolean;
  requested_by_name: string | null; resolved_by_name: string | null;
  items: { id: number; booking_id: number; title: string; starts_at: string; ends_at: string; wanted_starts_at: string; wanted_ends_at: string;
    proposed_starts_at: string; proposed_ends_at: string; new_booking_id: number | null; space_name: string; site_name: string }[];
}
