/**
 * Salon POS app release manifest.
 *
 * The manifest lives NEXT TO the binaries in api/updates/salon-pos/ (a plain
 * static dir, see index.js) so publishing a new build is "drop apk + edit json"
 * on the server — no redeploy, no migration. The file is read per request but
 * cached on mtime, so a hand-edit takes effect immediately without paying an
 * fs.readFile on every poll from every till.
 *
 * Everything here is per-platform: an Android till and the browser build are on
 * different release trains and must not be told about each other's versions.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MANIFEST_PATH = path.join(__dirname, '../../../../updates/salon-pos/manifest.json');
const PUBLIC_PATH = '/updates/salon-pos';

let cache = { mtimeMs: 0, data: null };

/** Normalises the many spellings a client may send into a manifest key. */
export function normalisePlatform(raw) {
  const p = String(raw ?? 'web').toLowerCase();
  if (p === 'android' || p === 'mobile' || p === 'apk') return 'android';
  if (p === 'windows' || p === 'desktop' || p === 'electron') return 'windows';
  return 'web';
}

/**
 * Compare two dotted versions. Returns -1 / 0 / 1 (a vs b).
 * Non-numeric segments (e.g. "1.0.13-beta") compare on their numeric prefix.
 */
export function compareVersions(a, b) {
  const seg = (v) => String(v ?? '0').split('.').map((s) => parseInt(s, 10) || 0);
  const A = seg(a);
  const B = seg(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? 0;
    const y = B[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function readManifest() {
  let stat;
  try {
    stat = fs.statSync(MANIFEST_PATH);
  } catch {
    // No manifest published yet — treat as "nothing to offer", never as an error.
    cache = { mtimeMs: 0, data: null };
    return null;
  }

  if (cache.data && cache.mtimeMs === stat.mtimeMs) return cache.data;

  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    cache = { mtimeMs: stat.mtimeMs, data: parsed };
    return parsed;
  } catch (err) {
    console.error('[appRelease] manifest parse failed, ignoring:', err.message);
    cache = { mtimeMs: stat.mtimeMs, data: null };
    return null;
  }
}

/** Absolute base URL for download links, honouring the proxy in front of us. */
function publicBase(req) {
  const configured = process.env.PUBLIC_BASE_URL || process.env.API_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

/**
 * Resolve what the caller running `currentVersion` should be told.
 *
 * `currentVersion` comes from the client (the installed build). When a client
 * is too old to send it, we fall back to the manifest's `assumeVersion` so an
 * unknown client still gets offered the update instead of being told it is
 * up to date.
 */
export function resolveRelease(req, { platform: rawPlatform, currentVersion }) {
  const platform = normalisePlatform(rawPlatform);
  const manifest = readManifest();
  const rel = manifest?.[platform] ?? null;

  const current = String(currentVersion ?? manifest?.assumeVersion ?? '0.0.0').trim() || '0.0.0';

  if (!rel?.latestVersion) {
    return {
      currentVersion: current,
      latestVersion: current,
      updateAvailable: false,
      description: '',
      releaseNotes: '',
      downloadUrl: '',
      isRequired: false,
      releasedAt: null,
      platform,
    };
  }

  const updateAvailable = compareVersions(rel.latestVersion, current) > 0;

  // A build older than minSupportedVersion cannot be allowed to keep selling —
  // schema/endpoint drift makes its writes unsafe, so force the install.
  const belowFloor =
    rel.minSupportedVersion != null && compareVersions(current, rel.minSupportedVersion) < 0;

  let downloadUrl = rel.downloadUrl ?? '';
  if (!downloadUrl && rel.file) {
    // Never advertise a build whose binary is not actually on disk — that is
    // how a till ends up with a banner pointing at a 404. A manifest edited
    // ahead of the upload therefore stays silent until the file lands.
    if (!fs.existsSync(path.join(path.dirname(MANIFEST_PATH), rel.file))) {
      console.warn(`[appRelease] manifest names a missing file: ${rel.file}`);
      return {
        currentVersion: current,
        latestVersion: current,
        updateAvailable: false,
        description: '',
        releaseNotes: '',
        downloadUrl: '',
        isRequired: false,
        releasedAt: null,
        platform,
      };
    }
    downloadUrl = `${publicBase(req)}${PUBLIC_PATH}/${rel.file}`;
  }

  return {
    currentVersion: current,
    latestVersion: rel.latestVersion,
    updateAvailable,
    description: rel.description ?? '',
    releaseNotes: rel.releaseNotes ?? '',
    downloadUrl,
    isRequired: Boolean(rel.isRequired) || belowFloor,
    releasedAt: rel.releasedAt ?? null,
    platform,
    versionCode: rel.versionCode ?? null,
    fileSize: rel.fileSize ?? null,
  };
}
