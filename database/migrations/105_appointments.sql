-- 105_appointments.sql
-- Salon POS: Appointment booking tables and indices

-- 1. Appointment master — one record per booked slot
CREATE TABLE IF NOT EXISTS ops.appointment_master (
  appointment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            BIGINT NOT NULL,
  customer_id           BIGINT NOT NULL,
  stylist_id            BIGINT NOT NULL,
  appointment_date      DATE NOT NULL,
  appointment_time      TIME NOT NULL,
  duration_minutes      INTEGER NOT NULL DEFAULT 60,
  appointment_status    VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED',
  notes                 TEXT,
  job_id                UUID NULL,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (company_id) REFERENCES core.company_master(company_id),
  FOREIGN KEY (customer_id) REFERENCES core.customer_master(customer_id),
  FOREIGN KEY (stylist_id) REFERENCES core.staff_master(staff_id),
  FOREIGN KEY (job_id) REFERENCES ops.kot_master(kot_id),
  UNIQUE (company_id, stylist_id, appointment_date, appointment_time)
);

-- 2. Appointment service lines — services booked in this appointment
CREATE TABLE IF NOT EXISTS ops.appointment_service (
  appointment_service_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id          UUID NOT NULL,
  service_id              BIGINT NOT NULL,
  expected_duration_min   INTEGER,
  created_at              TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (appointment_id) REFERENCES ops.appointment_master(appointment_id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES core.product_master(product_id)
);

-- 3. Indices for fast queries
CREATE INDEX IF NOT EXISTS idx_appointment_date_time
  ON ops.appointment_master(company_id, appointment_date, appointment_time);

CREATE INDEX IF NOT EXISTS idx_appointment_stylist
  ON ops.appointment_master(company_id, stylist_id, appointment_date);

CREATE INDEX IF NOT EXISTS idx_appointment_customer
  ON ops.appointment_master(company_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_appointment_status
  ON ops.appointment_master(company_id, appointment_status);

CREATE INDEX IF NOT EXISTS idx_appointment_service_id
  ON ops.appointment_service(appointment_id);

-- 4. Add default_duration_minutes to product_master (if not exists)
ALTER TABLE core.product_master
  ADD COLUMN IF NOT EXISTS default_duration_minutes INTEGER DEFAULT 60;
