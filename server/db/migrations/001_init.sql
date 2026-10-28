-- =====================================================================
-- Integrated Government Services System (Lesotho)
-- Migration 001: core schema
-- PostgreSQL 14+
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------
CREATE TABLE departments (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,          -- HOME_AFFAIRS, PASSPORT, TRAFFIC, FINANCE, PENSION, POLICE
  name          TEXT NOT NULL,
  short_name    TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  is_data_owner BOOLEAN NOT NULL DEFAULT false, -- Home Affairs owns the citizen identity record
  sort_order    INT NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- Population register (Home Affairs system of record)
-- In production this is loaded from the Home Affairs register (CSV import
-- in the admin area). Demo rows are flagged is_demo = true.
-- ---------------------------------------------------------------------
CREATE TABLE population_register (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  national_id    TEXT NOT NULL UNIQUE,
  first_name     TEXT NOT NULL,
  middle_name    TEXT,
  surname        TEXT NOT NULL,
  date_of_birth  DATE NOT NULL,
  sex            CHAR(1) NOT NULL CHECK (sex IN ('F','M')),
  district       TEXT,
  life_status    TEXT NOT NULL DEFAULT 'alive' CHECK (life_status IN ('alive','deceased')),
  is_demo        BOOLEAN NOT NULL DEFAULT false,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX population_register_surname_idx ON population_register (lower(surname));

-- ---------------------------------------------------------------------
-- Offices (one table for every department's service points)
-- ---------------------------------------------------------------------
CREATE TABLE offices (
  id              SERIAL PRIMARY KEY,
  department_id   INT NOT NULL REFERENCES departments(id),
  name            TEXT NOT NULL,
  district        TEXT NOT NULL,
  location        TEXT NOT NULL DEFAULT 'Address to be confirmed',
  phone           TEXT,                 -- NULL = not available (never invent numbers)
  hours           TEXT NOT NULL DEFAULT 'Monday to Friday, 08:00 to 16:30',
  open_time       TIME NOT NULL DEFAULT '08:00',
  close_time      TIME NOT NULL DEFAULT '16:00',
  slot_minutes    INT  NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 10 AND 120),
  slot_capacity   INT  NOT NULL DEFAULT 4  CHECK (slot_capacity BETWEEN 1 AND 100),
  details_verified BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (department_id, name)
);

-- ---------------------------------------------------------------------
-- Citizens (portal accounts linked to the register)
-- National ID is optional so people without an ID can still register
-- and apply for a National ID. Login works with ID, phone or email.
-- ---------------------------------------------------------------------
CREATE TABLE citizens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id         UUID REFERENCES population_register(id),
  national_id         TEXT UNIQUE,
  first_name          TEXT NOT NULL,
  surname             TEXT NOT NULL,
  date_of_birth       DATE NOT NULL,
  sex                 CHAR(1) CHECK (sex IN ('F','M')),
  phone               TEXT NOT NULL UNIQUE,
  email               TEXT UNIQUE,
  district            TEXT,
  address             TEXT,
  password_hash       TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
                      CHECK (verification_status IN ('unverified','pending_office','verified','rejected')),
  verification_note   TEXT,
  verified_at         TIMESTAMPTZ,
  verified_by         TEXT,               -- 'SYSTEM' or staff id
  session_version     INT NOT NULL DEFAULT 1,
  failed_logins       INT NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX citizens_email_lower_idx ON citizens (lower(email)) WHERE email IS NOT NULL;
CREATE TRIGGER citizens_updated BEFORE UPDATE ON citizens FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Staff (government employees and the system administrator)
-- ---------------------------------------------------------------------
CREATE TABLE staff (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_number         TEXT NOT NULL UNIQUE,
  full_name            TEXT NOT NULL,
  email                TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  department_id        INT REFERENCES departments(id),  -- NULL only for admin
  office_id            INT REFERENCES offices(id),
  role                 TEXT NOT NULL CHECK (role IN ('officer','supervisor','admin')),
  is_active            BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  session_version      INT NOT NULL DEFAULT 1,
  failed_logins        INT NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role = 'admin') OR (department_id IS NOT NULL))
);
CREATE UNIQUE INDEX staff_email_lower_idx ON staff (lower(email));

CREATE TABLE password_resets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type TEXT NOT NULL CHECK (account_type IN ('citizen','staff')),
  account_id   UUID NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Service catalogue (data-driven: requirements and fees are managed by
-- the administrator, never hard-coded in the interface)
-- ---------------------------------------------------------------------
CREATE TABLE services (
  id                    SERIAL PRIMARY KEY,
  department_id         INT NOT NULL REFERENCES departments(id),
  code                  TEXT NOT NULL UNIQUE,
  ref_prefix            TEXT NOT NULL,
  name                  TEXT NOT NULL,
  summary               TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  applies_to            TEXT NOT NULL DEFAULT 'self' CHECK (applies_to IN ('self','minor','both')),
  requires_national_id  BOOLEAN NOT NULL DEFAULT true,  -- citizen must hold a verified ID to apply
  requires_appointment  BOOLEAN NOT NULL DEFAULT true,
  in_person_note        TEXT NOT NULL DEFAULT 'You must attend the office in person so an officer can check your original documents.',
  min_age               INT,     -- age rules (e.g. pension) read from here, not from code
  requirements_verified BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  sort_order            INT NOT NULL DEFAULT 0
);

CREATE TABLE service_requirements (
  id                 SERIAL PRIMARY KEY,
  service_id         INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  applicant_category TEXT NOT NULL CHECK (applicant_category IN ('adult','minor','any')),
  label              TEXT NOT NULL,
  detail             TEXT NOT NULL DEFAULT '',
  is_fee             BOOLEAN NOT NULL DEFAULT false,
  is_verified        BOOLEAN NOT NULL DEFAULT false,  -- confirmed from an official source
  sort_order         INT NOT NULL DEFAULT 0
);
CREATE INDEX service_requirements_service_idx ON service_requirements (service_id, applicant_category);

CREATE TABLE service_fees (
  id          SERIAL PRIMARY KEY,
  service_id  INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  label       TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  note        TEXT NOT NULL DEFAULT '',
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (service_id, code)
);

-- ---------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------
CREATE TABLE holidays (
  holiday_date DATE PRIMARY KEY,
  name         TEXT NOT NULL
);

CREATE TABLE appointment_slots (
  id         BIGSERIAL PRIMARY KEY,
  office_id  INT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  starts_at  TIMESTAMPTZ NOT NULL,
  capacity   INT NOT NULL CHECK (capacity > 0),
  booked     INT NOT NULL DEFAULT 0,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (office_id, starts_at),
  CHECK (booked >= 0 AND booked <= capacity)
);
CREATE INDEX appointment_slots_office_time_idx ON appointment_slots (office_id, starts_at);

-- ---------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------
CREATE SEQUENCE application_ref_seq START 1000;
CREATE SEQUENCE access_request_ref_seq START 100;

CREATE TABLE applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          TEXT NOT NULL UNIQUE,
  citizen_id         UUID NOT NULL REFERENCES citizens(id),
  service_id         INT NOT NULL REFERENCES services(id),
  department_id      INT NOT NULL REFERENCES departments(id),
  applicant_category TEXT NOT NULL CHECK (applicant_category IN ('adult','minor')),
  applicant_key      TEXT NOT NULL DEFAULT 'SELF',  -- SELF or minor birth-certificate no. (duplicate guard)
  applicant          JSONB NOT NULL DEFAULT '{}',   -- minor details, relationship
  form_data          JSONB NOT NULL DEFAULT '{}',   -- service-specific answers, draft state
  checklist          JSONB NOT NULL DEFAULT '{}',   -- { requirementId: true }
  fee_id             INT REFERENCES service_fees(id),
  fee_amount         NUMERIC(10,2),
  office_id          INT REFERENCES offices(id),
  slot_id            BIGINT REFERENCES appointment_slots(id),
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                       'draft','preparing_documents','ready_for_visit','submitted',
                       'under_review','additional_info_required','completed','rejected','cancelled')),
  status_reason      TEXT,
  last_status_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at       TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX applications_citizen_idx ON applications (citizen_id, created_at DESC);
CREATE INDEX applications_department_idx ON applications (department_id, status, last_status_at DESC);
-- One open application per service per applicant (automatic duplicate prevention)
CREATE UNIQUE INDEX applications_one_open_idx ON applications (citizen_id, service_id, applicant_key)
  WHERE status NOT IN ('completed','rejected','cancelled');
CREATE TRIGGER applications_updated BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE application_events (
  id             BIGSERIAL PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  note           TEXT,
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('citizen','staff','system')),
  actor_id       TEXT,
  actor_label    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX application_events_app_idx ON application_events (application_id, created_at);

CREATE TABLE document_checks (
  id             BIGSERIAL PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  requirement_id INT NOT NULL REFERENCES service_requirements(id),
  result         TEXT NOT NULL CHECK (result IN ('verified','missing','invalid')),
  note           TEXT,
  staff_id       UUID NOT NULL REFERENCES staff(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE info_requests (
  id             BIGSERIAL PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('information','documents','identity')),
  message        TEXT NOT NULL,
  requested_by   TEXT NOT NULL,       -- staff id or 'SYSTEM'
  response       TEXT,
  responded_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE previous_passports (
  id            BIGSERIAL PRIMARY KEY,
  citizen_id    UUID NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  issue_year    INT NOT NULL CHECK (issue_year BETWEEN 1966 AND 2100),
  passport_type TEXT NOT NULL,
  reference     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  citizen_id  UUID NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,   -- status_changed, visit_reminder, checklist_incomplete, info_required, completed, consent_request, system
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  link        TEXT,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  dedupe_key  TEXT UNIQUE,     -- automation never sends the same reminder twice
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_citizen_idx ON notifications (citizen_id, is_read, created_at DESC);

-- ---------------------------------------------------------------------
-- Information sharing (least privilege)
-- ---------------------------------------------------------------------
-- Fields a department may see by default for citizens it is serving
CREATE TABLE department_field_permissions (
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  field         TEXT NOT NULL,
  PRIMARY KEY (department_id, field)
);

-- Extra fields a department may REQUEST, and how such a request is decided
CREATE TABLE data_sharing_policies (
  id                       SERIAL PRIMARY KEY,
  requesting_department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  field                    TEXT NOT NULL,
  purpose                  TEXT NOT NULL,
  requires_consent         BOOLEAN NOT NULL DEFAULT true,
  auto_approve             BOOLEAN NOT NULL DEFAULT false,  -- system approves once consent is given
  max_days                 INT NOT NULL DEFAULT 14 CHECK (max_days BETWEEN 1 AND 365),
  UNIQUE (requesting_department_id, field)
);

CREATE TABLE access_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference                TEXT NOT NULL UNIQUE,
  requested_by             UUID NOT NULL REFERENCES staff(id),
  requesting_department_id INT NOT NULL REFERENCES departments(id),
  owning_department_id     INT NOT NULL REFERENCES departments(id),
  citizen_id               UUID NOT NULL REFERENCES citizens(id),
  application_id           UUID REFERENCES applications(id),
  fields                   TEXT[] NOT NULL,
  purpose                  TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN
                             ('pending_consent','pending_approval','approved','denied','expired','revoked')),
  consent_status           TEXT NOT NULL CHECK (consent_status IN ('not_required','pending','given','refused')),
  consent_at               TIMESTAMPTZ,
  decided_by               UUID REFERENCES staff(id),
  decided_by_system        BOOLEAN NOT NULL DEFAULT false,
  decision_note            TEXT,
  decided_at               TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX access_requests_citizen_idx ON access_requests (citizen_id, status);
CREATE INDEX access_requests_dept_idx ON access_requests (requesting_department_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Audit log (append-only, enforced by trigger)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('citizen','staff','system','anonymous')),
  actor_id      TEXT,
  actor_label   TEXT,
  department_id INT REFERENCES departments(id),
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  citizen_id    UUID,
  outcome       TEXT NOT NULL DEFAULT 'success' CHECK (outcome IN ('success','denied','failed')),
  details       JSONB NOT NULL DEFAULT '{}',
  ip            TEXT
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_dept_idx ON audit_log (department_id, at DESC);
CREATE INDEX audit_log_citizen_idx ON audit_log (citizen_id, at DESC);

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- ---------------------------------------------------------------------
-- Settings and automation
-- ---------------------------------------------------------------------
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE job_runs (
  id          BIGSERIAL PRIMARY KEY,
  trigger     TEXT NOT NULL,     -- schedule, manual, startup
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  result      JSONB NOT NULL DEFAULT '{}',
  error       TEXT
);
