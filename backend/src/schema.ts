/**
 * Esquema de la base de datos. Es idempotente (IF NOT EXISTS): se ejecuta en cada arranque.
 *
 * Aislamiento (RQ25): toda tabla de negocio tiene `tenant_id`. Un tenant es la organizacion de un
 * administrador; sus academias, sedes, clientes y reportes nunca se mezclan con los de otro tenant.
 * Identidad (RQ13, RQ26): `persons` es la persona real (por documento). Una persona puede tener una cuenta
 * (`users`) en varios tenants, cada una con su usuario/contrasena y sus propios datos.
 */
export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS tenants (
  id serial PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS persons (
  id serial PRIMARY KEY,
  document text NOT NULL UNIQUE,
  full_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_id int NOT NULL REFERENCES persons(id),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  role text NOT NULL CHECK (role IN ('admin', 'staff', 'client')),
  permissions text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  consent_at timestamptz,
  consent_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, person_id)
);

CREATE TABLE IF NOT EXISTS academies (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  join_code text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  academy_id int NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  phone text,
  -- [{ "day": 0-6 (0 = domingo), "open": "06:00", "close": "21:00" }] (RQ2 horarios de atencion)
  opening_hours jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spaces (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  max_capacity int NOT NULL CHECK (max_capacity > 0),          -- aforo maximo (RQ19)
  allow_multi_group boolean NOT NULL DEFAULT false,           -- varios grupos a la vez
  max_groups int NOT NULL DEFAULT 1 CHECK (max_groups > 0),
  capacity_per_group int CHECK (capacity_per_group > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fotos de sedes y espacios en Base64 (RQ29). Las listas solo leen los metadatos; data se pide por id.
CREATE TABLE IF NOT EXISTS photos (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('site', 'space')),
  owner_id int NOT NULL,
  mime text NOT NULL,
  data text NOT NULL,
  width int,
  height int,
  size_bytes int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Sede de inscripcion del cliente (RQ10: clientes por sede)
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_site_id int REFERENCES sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS photos_owner_idx ON photos (tenant_id, owner_type, owner_id);

CREATE TABLE IF NOT EXISTS teachers (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('internal', 'external')),  -- RQ5
  phone text,
  email text,
  specialty text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classes (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  academy_id int NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  teacher_id int REFERENCES teachers(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  default_capacity int NOT NULL CHECK (default_capacity > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ocupacion de espacios: sesiones de clase (kind=class) y reservas de espacio (kind=rental). RQ2, RQ3, RQ5, RQ18
CREATE TABLE IF NOT EXISTS bookings (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  space_id int NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('class', 'rental')),
  class_id int REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id int REFERENCES teachers(id) ON DELETE SET NULL,
  client_id int REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  group_size int NOT NULL CHECK (group_size > 0),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  notes text,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS bookings_space_time_idx ON bookings (space_id, starts_at, ends_at);

-- Planes (RQ7, RQ11, RQ12). units NULL = ilimitado
CREATE TABLE IF NOT EXISTS plans (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  kind text NOT NULL CHECK (kind IN ('classes', 'reservations', 'access', 'mixed')),
  units int CHECK (units > 0),
  validity_days int NOT NULL CHECK (validity_days > 0),
  price numeric(12, 2) NOT NULL DEFAULT 0,
  all_sites boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plan_academies (
  plan_id int NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  academy_id int NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, academy_id)
);
CREATE TABLE IF NOT EXISTS plan_sites (
  plan_id int NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  site_id int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, site_id)
);

CREATE TABLE IF NOT EXISTS client_academies (
  client_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academy_id int NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, academy_id)
);

-- Plan adquirido por un cliente: copia unidades y vigencia para que cambiar el plan no altere lo vendido
CREATE TABLE IF NOT EXISTS memberships (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id int NOT NULL REFERENCES plans(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  units_total int,
  units_used int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Pagos: siempre asociados a un plan adquirido o a una reserva (RQ4, RQ6)
CREATE TABLE IF NOT EXISTS payments (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id int REFERENCES users(id) ON DELETE CASCADE,   -- NULL: paga un tercero (p. ej. profesor externo)
  payer_name text,
  membership_id int REFERENCES memberships(id) ON DELETE CASCADE,
  booking_id int REFERENCES bookings(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  method text NOT NULL,
  reference text,
  notes text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_by int REFERENCES users(id) ON DELETE SET NULL
);

-- Ingresos registrados al escanear el QR (RQ7, RQ20, RQ21)
CREATE TABLE IF NOT EXISTS attendances (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id int REFERENCES memberships(id) ON DELETE SET NULL,
  academy_id int NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  site_id int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  booking_id int REFERENCES bookings(id) ON DELETE SET NULL,
  space_id int REFERENCES spaces(id) ON DELETE SET NULL,
  method text NOT NULL DEFAULT 'qr' CHECK (method IN ('qr', 'manual')),
  over_capacity boolean NOT NULL DEFAULT false,
  scanned_by int REFERENCES users(id) ON DELETE SET NULL,
  scanned_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendances_once_per_booking ON attendances (client_id, booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendances_tenant_time_idx ON attendances (tenant_id, scanned_at);

-- Horas antes del inicio hasta las que un cliente puede cancelar sus reservas (RQ32)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS cancel_hours int NOT NULL DEFAULT 24;

-- Cupos reservados por clientes en sesiones de clase (RQ30, RQ31)
CREATE TABLE IF NOT EXISTS class_reservations (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id int NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS class_reservations_once ON class_reservations (booking_id, client_id) WHERE status = 'confirmed';

-- RQ34: todo pago va a un cliente y a un plan adquirido (la reserva es opcional). Se quita la regla anterior
-- "plan o reserva"; la API exige cliente y plan
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_check;

-- RQ35: limite de cancelacion por academia y por sede (NULL = hereda de la academia / de la organizacion)
ALTER TABLE academies ADD COLUMN IF NOT EXISTS cancel_hours int;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS cancel_hours int;

-- RQ37: solicitudes de autorizacion para ingresar con el aforo completo
CREATE TABLE IF NOT EXISTS capacity_requests (
  id serial PRIMARY KEY,
  tenant_id int NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id int REFERENCES bookings(id) ON DELETE SET NULL,
  academy_id int NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  site_id int NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by int REFERENCES users(id) ON DELETE SET NULL,
  resolved_by int REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  attendance_id int REFERENCES attendances(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capacity_requests_pending_idx ON capacity_requests (tenant_id, status);

-- RQ40: horario de disponibilidad propio del espacio (NULL = el de la sede)
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS opening_hours jsonb;
`;
