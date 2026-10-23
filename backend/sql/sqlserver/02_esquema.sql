/*
  AcademiaPass - Tablas en SQL Server (equivalente T-SQL de backend/src/schema.ts, que es PostgreSQL).
  Idempotente: solo crea lo que falta. Ejecutar sobre la base creada por 01_crear_base.sql.

  Diferencias con PostgreSQL:
  - opening_hours y permissions se guardan como JSON en NVARCHAR(MAX) (CHECK ISJSON).
  - SQL Server no permite varias rutas de borrado en cascada; por eso solo las tablas de relacion
    (plan_academies, plan_sites, client_academies) borran en cascada y el resto usa NO ACTION:
    los borrados se hacen en orden desde la aplicacion.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.tenants', N'U') IS NULL
CREATE TABLE dbo.tenants (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(120) NOT NULL,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID(N'dbo.persons', N'U') IS NULL
CREATE TABLE dbo.persons (
  id INT IDENTITY(1,1) PRIMARY KEY,
  document NVARCHAR(20) NOT NULL UNIQUE,
  full_name NVARCHAR(120) NOT NULL,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID(N'dbo.academies', N'U') IS NULL
CREATE TABLE dbo.academies (
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  name NVARCHAR(120) NOT NULL,
  description NVARCHAR(500) NULL,
  join_code NVARCHAR(12) NOT NULL UNIQUE,
  active BIT NOT NULL DEFAULT 1,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID(N'dbo.sites', N'U') IS NULL
CREATE TABLE dbo.sites (
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  academy_id INT NOT NULL REFERENCES dbo.academies(id),
  name NVARCHAR(120) NOT NULL,
  address NVARCHAR(500) NULL,
  phone NVARCHAR(30) NULL,
  opening_hours NVARCHAR(MAX) NOT NULL DEFAULT N'[]' CHECK (ISJSON(opening_hours) = 1), -- RQ2
  active BIT NOT NULL DEFAULT 1,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
CREATE TABLE dbo.users (
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  person_id INT NOT NULL REFERENCES dbo.persons(id),
  username NVARCHAR(40) NOT NULL UNIQUE,
  password_hash NVARCHAR(100) NOT NULL,
  full_name NVARCHAR(120) NOT NULL,
  email NVARCHAR(120) NULL,
  phone NVARCHAR(30) NULL,
  role NVARCHAR(10) NOT NULL CHECK (role IN (N'admin', N'staff', N'client')),
  permissions NVARCHAR(MAX) NOT NULL DEFAULT N'[]' CHECK (ISJSON(permissions) = 1),
  active BIT NOT NULL DEFAULT 1,
  consent_at DATETIMEOFFSET NULL,
  consent_version NVARCHAR(20) NULL,
  home_site_id INT NULL REFERENCES dbo.sites(id),
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT uq_users_tenant_person UNIQUE (tenant_id, person_id)
);

IF OBJECT_ID(N'dbo.spaces', N'U') IS NULL
CREATE TABLE dbo.spaces (
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  site_id INT NOT NULL REFERENCES dbo.sites(id),
  name NVARCHAR(120) NOT NULL,
  description NVARCHAR(500) NULL,
  max_capacity INT NOT NULL CHECK (max_capacity > 0),          -- aforo (RQ19)
  allow_multi_group BIT NOT NULL DEFAULT 0,
  max_groups INT NOT NULL DEFAULT 1 CHECK (max_groups > 0),
  capacity_per_group INT NULL CHECK (capacity_per_group > 0),
  active BIT NOT NULL DEFAULT 1,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID(N'dbo.photos', N'U') IS NULL
CREATE TABLE dbo.photos (                                       -- RQ29, imagen en Base64
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  owner_type NVARCHAR(10) NOT NULL CHECK (owner_type IN (N'site', N'space')),
  owner_id INT NOT NULL,
  mime NVARCHAR(30) NOT NULL,
  data VARCHAR(MAX) NOT NULL,
  width INT NULL,
  height INT NULL,
  size_bytes INT NOT NULL,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'photos_owner_idx')
  CREATE INDEX photos_owner_idx ON dbo.photos (tenant_id, owner_type, owner_id);

IF OBJECT_ID(N'dbo.teachers', N'U') IS NULL
CREATE TABLE dbo.teachers (
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  full_name NVARCHAR(120) NOT NULL,
  kind NVARCHAR(10) NOT NULL CHECK (kind IN (N'internal', N'external')), -- RQ5
  phone NVARCHAR(30) NULL,
  email NVARCHAR(120) NULL,
  specialty NVARCHAR(120) NULL,
  active BIT NOT NULL DEFAULT 1,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID(N'dbo.classes', N'U') IS NULL
CREATE TABLE dbo.classes (
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  academy_id INT NOT NULL REFERENCES dbo.academies(id),
  teacher_id INT NULL REFERENCES dbo.teachers(id),
  name NVARCHAR(120) NOT NULL,
  description NVARCHAR(500) NULL,
  default_capacity INT NOT NULL CHECK (default_capacity > 0),
  active BIT NOT NULL DEFAULT 1,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID(N'dbo.bookings', N'U') IS NULL
CREATE TABLE dbo.bookings (                                     -- sesiones de clase y reservas (RQ2, RQ3, RQ18)
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  site_id INT NOT NULL REFERENCES dbo.sites(id),
  space_id INT NOT NULL REFERENCES dbo.spaces(id),
  kind NVARCHAR(10) NOT NULL CHECK (kind IN (N'class', N'rental')),
  class_id INT NULL REFERENCES dbo.classes(id),
  teacher_id INT NULL REFERENCES dbo.teachers(id),
  client_id INT NULL REFERENCES dbo.users(id),
  title NVARCHAR(120) NOT NULL,
  starts_at DATETIMEOFFSET NOT NULL,
  ends_at DATETIMEOFFSET NOT NULL,
  group_size INT NOT NULL CHECK (group_size > 0),
  status NVARCHAR(10) NOT NULL DEFAULT N'confirmed' CHECK (status IN (N'confirmed', N'cancelled')),
  notes NVARCHAR(500) NULL,
  created_by INT NULL REFERENCES dbo.users(id),
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT ck_bookings_range CHECK (ends_at > starts_at)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'bookings_space_time_idx')
  CREATE INDEX bookings_space_time_idx ON dbo.bookings (space_id, starts_at, ends_at);

IF OBJECT_ID(N'dbo.plans', N'U') IS NULL
CREATE TABLE dbo.plans (                                        -- RQ7, RQ11, RQ12 (units NULL = ilimitado)
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  name NVARCHAR(120) NOT NULL,
  description NVARCHAR(500) NULL,
  kind NVARCHAR(15) NOT NULL CHECK (kind IN (N'classes', N'reservations', N'access', N'mixed')),
  units INT NULL CHECK (units > 0),
  validity_days INT NOT NULL CHECK (validity_days > 0),
  price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  all_sites BIT NOT NULL DEFAULT 0,
  active BIT NOT NULL DEFAULT 1,
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID(N'dbo.plan_academies', N'U') IS NULL
CREATE TABLE dbo.plan_academies (
  plan_id INT NOT NULL REFERENCES dbo.plans(id) ON DELETE CASCADE,
  academy_id INT NOT NULL REFERENCES dbo.academies(id),
  PRIMARY KEY (plan_id, academy_id)
);

IF OBJECT_ID(N'dbo.plan_sites', N'U') IS NULL
CREATE TABLE dbo.plan_sites (
  plan_id INT NOT NULL REFERENCES dbo.plans(id) ON DELETE CASCADE,
  site_id INT NOT NULL REFERENCES dbo.sites(id),
  PRIMARY KEY (plan_id, site_id)
);

IF OBJECT_ID(N'dbo.client_academies', N'U') IS NULL
CREATE TABLE dbo.client_academies (                             -- RQ13
  client_id INT NOT NULL REFERENCES dbo.users(id) ON DELETE CASCADE,
  academy_id INT NOT NULL REFERENCES dbo.academies(id),
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  PRIMARY KEY (client_id, academy_id)
);

IF OBJECT_ID(N'dbo.memberships', N'U') IS NULL
CREATE TABLE dbo.memberships (                                  -- plan adquirido
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  client_id INT NOT NULL REFERENCES dbo.users(id),
  plan_id INT NOT NULL REFERENCES dbo.plans(id),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  units_total INT NULL,
  units_used INT NOT NULL DEFAULT 0,
  status NVARCHAR(10) NOT NULL DEFAULT N'active' CHECK (status IN (N'active', N'cancelled')),
  created_by INT NULL REFERENCES dbo.users(id),
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID(N'dbo.payments', N'U') IS NULL
CREATE TABLE dbo.payments (                                     -- RQ4, RQ6: plan o reserva, nunca ambos
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  client_id INT NULL REFERENCES dbo.users(id),
  payer_name NVARCHAR(120) NULL,
  membership_id INT NULL REFERENCES dbo.memberships(id),
  booking_id INT NULL REFERENCES dbo.bookings(id),
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  method NVARCHAR(20) NOT NULL,
  reference NVARCHAR(120) NULL,
  notes NVARCHAR(500) NULL,
  paid_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  created_by INT NULL REFERENCES dbo.users(id)
);

IF OBJECT_ID(N'dbo.attendances', N'U') IS NULL
CREATE TABLE dbo.attendances (                                  -- ingresos con QR (RQ7, RQ20, RQ21)
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  client_id INT NOT NULL REFERENCES dbo.users(id),
  membership_id INT NULL REFERENCES dbo.memberships(id),
  academy_id INT NOT NULL REFERENCES dbo.academies(id),
  site_id INT NOT NULL REFERENCES dbo.sites(id),
  booking_id INT NULL REFERENCES dbo.bookings(id),
  space_id INT NULL REFERENCES dbo.spaces(id),
  method NVARCHAR(10) NOT NULL DEFAULT N'qr' CHECK (method IN (N'qr', N'manual')),
  over_capacity BIT NOT NULL DEFAULT 0,
  scanned_by INT NULL REFERENCES dbo.users(id),
  scanned_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'attendances_once_per_booking')
  CREATE UNIQUE INDEX attendances_once_per_booking ON dbo.attendances (client_id, booking_id) WHERE booking_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'attendances_tenant_time_idx')
  CREATE INDEX attendances_tenant_time_idx ON dbo.attendances (tenant_id, scanned_at);

-- Horas antes del inicio hasta las que un cliente puede cancelar sus reservas (RQ32)
IF COL_LENGTH(N'dbo.tenants', N'cancel_hours') IS NULL
  ALTER TABLE dbo.tenants ADD cancel_hours INT NOT NULL CONSTRAINT df_tenants_cancel_hours DEFAULT 24;

-- Cupos reservados por clientes en sesiones de clase (RQ30, RQ31)
IF OBJECT_ID(N'dbo.class_reservations', N'U') IS NULL
CREATE TABLE dbo.class_reservations (
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  booking_id INT NOT NULL REFERENCES dbo.bookings(id),
  client_id INT NOT NULL REFERENCES dbo.users(id),
  status NVARCHAR(10) NOT NULL DEFAULT N'confirmed' CHECK (status IN (N'confirmed', N'cancelled')),
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  cancelled_at DATETIMEOFFSET NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'class_reservations_once')
  CREATE UNIQUE INDEX class_reservations_once ON dbo.class_reservations (booking_id, client_id) WHERE status = N'confirmed';

-- RQ34: todo pago va a un cliente y a un plan adquirido (la reserva es opcional); la API lo exige
IF OBJECT_ID(N'dbo.ck_payments_target', N'C') IS NOT NULL
  ALTER TABLE dbo.payments DROP CONSTRAINT ck_payments_target;

-- RQ35: limite de cancelacion por academia y por sede (NULL = hereda)
IF COL_LENGTH(N'dbo.academies', N'cancel_hours') IS NULL
  ALTER TABLE dbo.academies ADD cancel_hours INT NULL;
IF COL_LENGTH(N'dbo.sites', N'cancel_hours') IS NULL
  ALTER TABLE dbo.sites ADD cancel_hours INT NULL;

-- RQ37: solicitudes de autorizacion para ingresar con el aforo completo
IF OBJECT_ID(N'dbo.capacity_requests', N'U') IS NULL
CREATE TABLE dbo.capacity_requests (
  id INT IDENTITY(1,1) PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES dbo.tenants(id),
  client_id INT NOT NULL REFERENCES dbo.users(id),
  booking_id INT NULL REFERENCES dbo.bookings(id),
  academy_id INT NOT NULL REFERENCES dbo.academies(id),
  site_id INT NOT NULL REFERENCES dbo.sites(id),
  status NVARCHAR(10) NOT NULL DEFAULT N'pending' CHECK (status IN (N'pending', N'approved', N'rejected')),
  requested_by INT NULL REFERENCES dbo.users(id),
  resolved_by INT NULL REFERENCES dbo.users(id),
  resolved_at DATETIMEOFFSET NULL,
  attendance_id INT NULL REFERENCES dbo.attendances(id),
  created_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'capacity_requests_pending_idx')
  CREATE INDEX capacity_requests_pending_idx ON dbo.capacity_requests (tenant_id, status);

-- RQ40: horario de disponibilidad propio del espacio (NULL = el de la sede)
IF COL_LENGTH(N'dbo.spaces', N'opening_hours') IS NULL
  ALTER TABLE dbo.spaces ADD opening_hours NVARCHAR(MAX) NULL;

-- RQ47: hasta cuantos meses adelante se puede reservar
IF COL_LENGTH(N'dbo.tenants', N'booking_horizon_months') IS NULL
  ALTER TABLE dbo.tenants ADD booking_horizon_months INT NOT NULL CONSTRAINT df_tenants_horizon DEFAULT 3;

-- RQ52: cupo reservado y no tomado: al terminar la clase se descuenta del plan (una sola vez)
IF COL_LENGTH(N'dbo.bookings', N'cancelled_by') IS NULL
  ALTER TABLE dbo.bookings ADD cancelled_by INT NULL REFERENCES dbo.users(id);
IF COL_LENGTH(N'dbo.bookings', N'cancelled_at') IS NULL
  ALTER TABLE dbo.bookings ADD cancelled_at DATETIMEOFFSET NULL;
-- RQ55: vigencia del plan en meses (si no, en dias); RQ56: fecha limite para venderlo
IF COL_LENGTH(N'dbo.plans', N'validity_months') IS NULL
  ALTER TABLE dbo.plans ADD validity_months INT NULL;
IF COL_LENGTH(N'dbo.plans', N'sale_until') IS NULL
  ALTER TABLE dbo.plans ADD sale_until DATE NULL;

-- RQ58: una organizacion nueva queda pendiente hasta que el administrador general la active
IF COL_LENGTH(N'dbo.tenants', N'status') IS NULL
  ALTER TABLE dbo.tenants ADD status NVARCHAR(10) NOT NULL CONSTRAINT df_tenants_status DEFAULT N'active';
IF COL_LENGTH(N'dbo.tenants', N'reviewed_at') IS NULL
  ALTER TABLE dbo.tenants ADD reviewed_at DATETIMEOFFSET NULL;
IF COL_LENGTH(N'dbo.users', N'is_superadmin') IS NULL
  ALTER TABLE dbo.users ADD is_superadmin BIT NOT NULL CONSTRAINT df_users_superadmin DEFAULT 0;

IF COL_LENGTH(N'dbo.class_reservations', N'settled_at') IS NULL
  ALTER TABLE dbo.class_reservations ADD settled_at DATETIMEOFFSET NULL;
IF COL_LENGTH(N'dbo.class_reservations', N'penalty_membership_id') IS NULL
  ALTER TABLE dbo.class_reservations ADD penalty_membership_id INT NULL REFERENCES dbo.memberships(id);

DECLARE @tablas INT = (SELECT COUNT(*) FROM sys.tables WHERE name IN
  (N'tenants', N'persons', N'academies', N'sites', N'users', N'spaces', N'photos', N'teachers', N'classes', N'bookings',
   N'plans', N'plan_academies', N'plan_sites', N'client_academies', N'memberships', N'payments', N'attendances',
   N'class_reservations', N'capacity_requests'));
PRINT N'Esquema de AcademiaPass listo (' + CAST(@tablas AS NVARCHAR(5)) + N' de 19 tablas).';
