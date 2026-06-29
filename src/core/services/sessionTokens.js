import { buildSessionPayload } from './session.js';
import { signAccessToken, signPosAccessToken, signRefreshToken } from './token.service.js';
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

/**
 * Variant for POS device logins.
 * Encodes stationId in the JWT (`sid` claim) so authMiddleware can inject it
 * into req.authStaff — overriding the staff-row's default station mapping.
 * Used when a staff PIN-logs into a specific enrolled device.
 */
export async function buildTokensForPOSDevice(staffRow, stationId) {
  const [access, accessVersion] = await Promise.all([
    resolveEntitlementsForStaff(staffRow),
    getEntitlementVersionForStaff(staffRow),
  ]);
  const mergedRow = { ...staffRow, station_id: stationId };
  return {
    accessToken: signPosAccessToken({
      typ: 'access',
      sub: String(staffRow.id),
      cid: staffRow.company_id,
      sid: Number(stationId),
    }),
    refreshToken: signRefreshToken({ typ: 'refresh', sub: String(staffRow.id) }),
    session: {
      ...buildSessionPayload(mergedRow, access),
      accessVersion,
    },
  };
}
