/**
 * Issues a device token for the on-premise biometric push agent
 * (attendance-api/adms-lite.js).
 *
 * The token is what identifies the tenant: whichever company/branch it was
 * issued for is where every punch it pushes will land. The request body never
 * gets a say. That is why this is a script and not an HTTP endpoint - minting
 * one is a deliberate act, not something a compromised session can do.
 *
 * Only the SHA-256 of the secret is stored. The plaintext is printed once here
 * and cannot be recovered afterwards; if it is lost, revoke and issue a new one.
 *
 * Usage:
 *   node scripts/issue-biometric-token.mjs --company 6 --branch 1 --label "Transwave office PC"
 *   node scripts/issue-biometric-token.mjs --list --company 6 --branch 1
 *   node scripts/issue-biometric-token.mjs --revoke 3
 *
 * Check the target first - api/.env points at PRODUCTION whenever the SSH
 * tunnel to the Azure VM is open. This script prints host:port/database and
 * inet_server_addr() before it writes anything.
 */
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function parseArgs(argv) {
  const args = { company: null, branch: null, label: null, list: false, revoke: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--company') args.company = Number(argv[++i]);
    else if (a === '--branch') args.branch = Number(argv[++i]);
    else if (a === '--label') args.label = argv[++i];
    else if (a === '--list') args.list = true;
    else if (a === '--revoke') args.revoke = Number(argv[++i]);
  }
  return args;
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL missing in api/.env');
    process.exit(1);
  }

  let target = 'unknown';
  try {
    const u = new URL(url);
    target = `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch { /* keep 'unknown' */ }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const { rows: who } = await client.query(
      'SELECT inet_server_addr()::text AS addr, current_database() AS db',
    );
    console.log(`Target DB : ${target}`);
    console.log(`Server    : ${who[0].addr || 'local socket'} / ${who[0].db}`);
    console.log('');

    if (args.revoke != null) {
      const { rowCount } = await client.query(
        'UPDATE hr.biometric_device_token SET is_active = FALSE WHERE token_id = $1',
        [args.revoke],
      );
      console.log(rowCount ? `Token ${args.revoke} revoked.` : `Token ${args.revoke} not found.`);
      return;
    }

    if (args.list) {
      const params = [];
      let where = '';
      if (Number.isFinite(args.company)) { params.push(args.company); where += ` AND company_id = $${params.length}`; }
      if (Number.isFinite(args.branch)) { params.push(args.branch); where += ` AND branch_id = $${params.length}`; }
      const { rows } = await client.query(
        `SELECT token_id, company_id, branch_id, label, is_active, last_seen_at, last_sync_at, last_sync_rows
           FROM hr.biometric_device_token
          WHERE TRUE${where}
          ORDER BY token_id`,
        params,
      );
      if (!rows.length) console.log('No tokens.');
      else console.table(rows);
      return;
    }

    if (!Number.isFinite(args.company) || !Number.isFinite(args.branch)) {
      console.error('Usage: node scripts/issue-biometric-token.mjs --company <id> --branch <id> [--label "..."]');
      process.exit(1);
    }

    const { rows: co } = await client.query(
      'SELECT company_name FROM core.company_master WHERE company_id = $1',
      [args.company],
    );
    if (!co[0]) {
      console.error(`Company ${args.company} does not exist. Refusing to issue a token for it.`);
      process.exit(1);
    }

    const plain = crypto.randomBytes(48).toString('base64url');
    const { rows } = await client.query(
      `INSERT INTO hr.biometric_device_token (company_id, branch_id, token_hash, label)
       VALUES ($1,$2,$3,$4) RETURNING token_id`,
      [args.company, args.branch, sha256(plain), args.label ?? null],
    );

    console.log('Token issued.');
    console.log(`  token_id : ${rows[0].token_id}`);
    console.log(`  company  : ${args.company} (${co[0].company_name})`);
    console.log(`  branch   : ${args.branch}`);
    console.log(`  label    : ${args.label ?? '(none)'}`);
    console.log('');
    console.log('  SECRET (shown once - copy it into attendance-api/start-adms.bat):');
    console.log('');
    console.log(`  ${plain}`);
    console.log('');
    console.log('  set ERP_SYNC_TOKEN=' + plain);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
