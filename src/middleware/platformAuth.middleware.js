import { verifyPlatformAccessToken } from '../admin/services/platformAuth.service.js';
import * as platformUserRepo from '../admin/repositories/platformUser.repository.js';

export async function requirePlatformAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing platform token' });
    let decoded;
    try {
      decoded = verifyPlatformAccessToken(token);
    } catch {
      return res.status(401).json({ message: 'Invalid platform token' });
    }
    if (decoded.typ !== 'platform-access') {
      return res.status(401).json({ message: 'Invalid platform token' });
    }
    const platformUserId = Number(decoded.sub);
    const user = await platformUserRepo.findById(platformUserId);
    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'Platform user inactive' });
    }
    req.platformUser = {
      platformUserId,
      email: user.email,
      fullName: user.full_name,
    };
    if (!req.platformCapabilities) {
      req.platformCapabilities = await platformUserRepo.listCapabilities(platformUserId);
    }
    return next();
  } catch (err) {
    return res.status(500).json({ message: 'Platform auth check failed', error: err.message });
  }
}

export function requireCapability(capabilityCode) {
  return (req, res, next) => {
    const caps = req.platformCapabilities || [];
    if (!caps.includes(capabilityCode)) {
      return res.status(403).json({ message: 'Missing platform capability', capabilityCode });
    }
    return next();
  };
}
