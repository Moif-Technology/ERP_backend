/**
 * Password reset OTP tokens (hashed) for core.staff_master.
 */

export async function deleteTokensForStaff(client, staffPk) {
  await client.query(`DELETE FROM core.password_reset_token WHERE staff_pk = $1`, [staffPk]);
}

export async function insertToken(client, staffPk, otpHash, expiresAt) {
  await client.query(
    `INSERT INTO core.password_reset_token (staff_pk, otp_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [staffPk, otpHash, expiresAt]
  );
}

export async function findLatestTokenForStaff(pool, staffPk) {
  const { rows } = await pool.query(
    `SELECT id, otp_hash, expires_at
     FROM core.password_reset_token
     WHERE staff_pk = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [staffPk]
  );
  return rows[0] ?? null;
}

export async function deleteTokenById(client, tokenId) {
  await client.query(`DELETE FROM core.password_reset_token WHERE id = $1`, [tokenId]);
}
