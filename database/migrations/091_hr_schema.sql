-- 091_hr_schema.sql  HR module tables

CREATE SCHEMA IF NOT EXISTS hr;

-- ── Shift Master ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.shift_master (
  company_id            INTEGER      NOT NULL,
  branch_id             INTEGER      NOT NULL,
  shift_id              INTEGER      NOT NULL,
  shift_name            VARCHAR(100) NOT NULL,
  shift_type            VARCHAR(10)  NOT NULL,  -- Regular / Flexible / 24hr etc.
  start_time            TIME,
  end_time              TIME,
  min_work_hours        NUMERIC(5,2) NOT NULL DEFAULT 8,
  late_grace_minutes    INTEGER      NOT NULL DEFAULT 0,
  early_grace_minutes   INTEGER      NOT NULL DEFAULT 0,
  auto_break_minutes    INTEGER      NOT NULL DEFAULT 0,
  ot_start_after_minutes INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, branch_id, shift_id)
);

-- ── Employee Master ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.employee_master (
  company_id          INTEGER       NOT NULL,
  branch_id           INTEGER       NOT NULL,
  employee_id         INTEGER       NOT NULL,
  employee_code       VARCHAR(20),
  employee_name       VARCHAR(100)  NOT NULL,
  shift_type          VARCHAR(10)   NOT NULL DEFAULT 'Regular',
  shift_id            INTEGER,
  designation         VARCHAR(80),
  department          VARCHAR(80),
  date_of_joining     DATE,
  date_of_birth       DATE,
  gender              VARCHAR(10),
  nationality         VARCHAR(50),
  mobile_no           VARCHAR(20),
  email               VARCHAR(100),
  address_line_1      VARCHAR(200),
  address_line_2      VARCHAR(200),
  emirates_id_no      VARCHAR(50),
  passport_no         VARCHAR(50),
  employment_type     VARCHAR(30),
  work_location       VARCHAR(80),
  reporting_manager   VARCHAR(100),
  payroll_group       VARCHAR(50),
  leave_policy        VARCHAR(80),
  basic_salary        NUMERIC(14,3),
  bank_name           VARCHAR(80),
  bank_account_no     VARCHAR(50),
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by          VARCHAR(50),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, branch_id, employee_id)
);

-- ── Leave Type Master ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.leave_type_master (
  company_id        INTEGER      NOT NULL,
  branch_id         INTEGER      NOT NULL,
  leave_type_id     INTEGER      NOT NULL,
  leave_name        VARCHAR(50)  NOT NULL,
  max_days_per_year INTEGER      NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, branch_id, leave_type_id)
);

-- ── Leave Request ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.leave_request (
  company_id        INTEGER      NOT NULL,
  branch_id         INTEGER      NOT NULL,
  leave_request_id  INTEGER      NOT NULL,
  employee_id       INTEGER      NOT NULL,
  leave_type_id     INTEGER      NOT NULL,
  from_date         DATE         NOT NULL,
  to_date           DATE         NOT NULL,
  total_days        NUMERIC(5,1) NOT NULL DEFAULT 1,
  request_status    VARCHAR(20)  NOT NULL DEFAULT 'Pending Approval',
  approved_by       VARCHAR(100),
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, branch_id, leave_request_id)
);

-- ── Attendance Daily ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.attendance_daily (
  company_id          INTEGER      NOT NULL,
  branch_id           INTEGER      NOT NULL,
  daily_id            INTEGER      NOT NULL,
  employee_id         INTEGER      NOT NULL,
  work_date           DATE         NOT NULL,
  shift_id            INTEGER,
  first_in            TIME,
  last_out            TIME,
  ot_hours            NUMERIC(5,2) NOT NULL DEFAULT 0,
  attendance_status   VARCHAR(20)  NOT NULL DEFAULT 'Present',
  PRIMARY KEY (company_id, branch_id, daily_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_daily_emp_date
  ON hr.attendance_daily (company_id, branch_id, employee_id, work_date);

-- ── Document Type Master ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.document_type_master (
  company_id          INTEGER      NOT NULL,
  branch_id           INTEGER      NOT NULL,
  document_type_id    INTEGER      NOT NULL,
  document_type_name  VARCHAR(80)  NOT NULL,
  allowed_extensions  VARCHAR(100) NOT NULL DEFAULT 'pdf,jpg,png',
  is_required         BOOLEAN      NOT NULL DEFAULT FALSE,
  reminder_days       INTEGER      NOT NULL DEFAULT 30,
  PRIMARY KEY (company_id, branch_id, document_type_id)
);

-- ── Attachment Master ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.attachment_master (
  company_id        INTEGER       NOT NULL,
  branch_id         INTEGER       NOT NULL,
  attachment_id     INTEGER       NOT NULL,
  employee_id       INTEGER       NOT NULL,
  document_type_id  INTEGER,
  title             VARCHAR(150)  NOT NULL,
  file_name         VARCHAR(255),
  file_path         VARCHAR(500),
  file_size         BIGINT,
  expiry_date       DATE,
  remind_days       INTEGER       NOT NULL DEFAULT 30,
  status            VARCHAR(20)   NOT NULL DEFAULT 'Valid',
  remarks           VARCHAR(500),
  created_by        VARCHAR(50),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, branch_id, attachment_id)
);

-- ── Leave Balance ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.leave_balance (
  company_id        INTEGER      NOT NULL,
  branch_id         INTEGER      NOT NULL,
  employee_id       INTEGER      NOT NULL,
  leave_type_id     INTEGER      NOT NULL,
  year              INTEGER      NOT NULL,
  entitled_days     NUMERIC(5,1) NOT NULL DEFAULT 0,
  used_days         NUMERIC(5,1) NOT NULL DEFAULT 0,
  carried_forward   NUMERIC(5,1) NOT NULL DEFAULT 0,
  remaining_days    NUMERIC(5,1) NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, branch_id, employee_id, leave_type_id, year)
);

-- ── Fix pre-existing employee_master column types and add missing columns ─────
ALTER TABLE hr.employee_master
  ALTER COLUMN created_by  TYPE VARCHAR(100) USING created_by::TEXT,
  ALTER COLUMN modified_by TYPE VARCHAR(100) USING modified_by::TEXT,
  ALTER COLUMN deleted_by  TYPE VARCHAR(100) USING deleted_by::TEXT,
  ADD COLUMN IF NOT EXISTS employment_type   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS work_location     VARCHAR(80),
  ADD COLUMN IF NOT EXISTS reporting_manager VARCHAR(100),
  ADD COLUMN IF NOT EXISTS payroll_group     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS leave_policy      VARCHAR(80),
  ADD COLUMN IF NOT EXISTS basic_salary      NUMERIC(14,3),
  ADD COLUMN IF NOT EXISTS bank_name         VARCHAR(80),
  ADD COLUMN IF NOT EXISTS bank_account_no   VARCHAR(50);

-- ── Loan Master ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hr.loan_master (
  company_id        INTEGER       NOT NULL,
  branch_id         INTEGER       NOT NULL,
  employee_id       INTEGER       NOT NULL,
  loan_id           INTEGER       NOT NULL,
  loan_type         VARCHAR(50),
  amount            NUMERIC(14,3) NOT NULL DEFAULT 0,
  balance           NUMERIC(14,3) NOT NULL DEFAULT 0,
  deduction         NUMERIC(14,3) NOT NULL DEFAULT 0,
  deduction_label   VARCHAR(50),
  loan_status       VARCHAR(20)   NOT NULL DEFAULT 'Active',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, branch_id, loan_id)
);
