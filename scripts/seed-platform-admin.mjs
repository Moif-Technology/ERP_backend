/**
 * Create or update the first SUPER_ADMIN platform user.
 * Usage: node scripts/seed-platform-admin.mjs <email> <password> "<full name>"
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const [email, password, fullName] = process.argv.slice(2);
  if (!email || !password || !fullName) {
    console.error('Usage: node scripts/seed-platform-admin.mjs <email> <password> "<full name>"');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO core.platform_user (email, password_hash, full_name, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (email)
       DO UPDATE SET password_hash = EXCLUDED.password_hash,
                     full_name = EXCLUDED.full_name,
                     is_active = TRUE,
                     updated_at = NOW()
       RETURNING platform_user_id`,
      [email, hash, fullName]
    );
    const platformUserId = userRows[0].platform_user_id;

    const { rows: roleRows } = await client.query(
      `SELECT platform_role_id FROM core.platform_role WHERE role_code = 'SUPER_ADMIN'`
    );
    if (roleRows.length === 0) {
      throw new Error('SUPER_ADMIN role missing — run platform migration first');
    }
    await client.query(
      `INSERT INTO core.platform_user_role (platform_user_id, platform_role_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [platformUserId, roleRows[0].platform_role_id]
    );
    console.log(`Seeded platform user ${email} as SUPER_ADMIN (id=${platformUserId})`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
