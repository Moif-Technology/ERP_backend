import { buildSessionPayload } from './session.js';
import { signAccessToken, signRefreshToken } from './token.service.js';
import {
  resolveEntitlementsForStaff,
  getEntitlementVersionForStaff,
} from './entitlement.service.js';

/**
 * Build access + refresh tokens and the session DTO for a staff row.
 * Single source of truth — shared by ERP auth and Counter-POS auth so the
 * token shape and entitlement resolution never drift between them.
 */
export async function buildTokensForStaffRow(staffRow) {
  const [access, accessVersion] = await Promise.all([
    resolveEntitlementsForStaff(staffRow),
    getEntitlementVersionForStaff(staffRow),
  ]);
  return {
    accessToken: signAccessToken({
      typ: 'access',
      sub: String(staffRow.id),
      cid: staffRow.company_id,
    }),
    refreshToken: signRefreshToken({ typ: 'refresh', sub: String(staffRow.id) }),
    session: {
      ...buildSessionPayload(staffRow, access),
      accessVersion,
    },
  };
}
