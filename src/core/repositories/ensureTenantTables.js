import { pool } from '../../config/db.js';

export async function ensureTenantTables() {
  // feature_master, plan_master, plan_feature are created by the original migration — do not re-create here.


  await pool.query(`
    CREATE TABLE IF NOT EXISTS core.tenant_feature_override (
      company_id   INTEGER      NOT NULL,
      feature_code VARCHAR(120) NOT NULL,
      is_enabled   BOOLEAN      NOT NULL DEFAULT TRUE,
      reason       TEXT,
      expires_at   TIMESTAMPTZ,
      created_by   INTEGER,
      created_at   TIMESTAMPTZ  DEFAULT NOW(),
      PRIMARY KEY (company_id, feature_code)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS core.tenant_limit_override (
      company_id   INTEGER      NOT NULL,
      limit_code   VARCHAR(120) NOT NULL,
      limit_value  BIGINT       NOT NULL,
      reason       TEXT,
      expires_at   TIMESTAMPTZ,
      created_by   INTEGER,
      created_at   TIMESTAMPTZ  DEFAULT NOW(),
      PRIMARY KEY (company_id, limit_code)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS core.subscription_audit_log (
      audit_id            BIGSERIAL    PRIMARY KEY,
      company_id          INTEGER      NOT NULL,
      actor_user_id       INTEGER,
      action              VARCHAR(80)  NOT NULL,
      entity_type         VARCHAR(80),
      entity_id           TEXT,
      before_json         JSONB,
      after_json          JSONB,
      created_at          TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS core.tenant_subscription (
      subscription_id            BIGSERIAL    PRIMARY KEY,
      company_id                 INTEGER      NOT NULL UNIQUE,
      plan_code                  VARCHAR(40),
      status                     VARCHAR(30)  NOT NULL DEFAULT 'trial',
      trial_started_at           TIMESTAMPTZ,
      trial_ends_at              TIMESTAMPTZ,
      subscription_started_at    TIMESTAMPTZ,
      current_period_starts_at   TIMESTAMPTZ,
      current_period_ends_at     TIMESTAMPTZ,
      grace_ends_at              TIMESTAMPTZ,
      cancelled_at               TIMESTAMPTZ,
      suspended_at               TIMESTAMPTZ,
      suspension_reason          TEXT,
      updated_at                 TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
}
