#!/usr/bin/env node
/**
 * Publish a Salon POS build to the update feed.
 *
 * Copies the APK into api/updates/salon-pos/ and rewrites manifest.json, which
 * is all /api/salon-pos/app/version reads. No restart, no migration — the
 * manifest is re-read on mtime change.
 *
 * Usage (run on the server, or locally then scp the whole dir):
 *
 *   node scripts/publish-salon-release.mjs \
 *     --apk ../saloon-pos/android/app/build/outputs/apk/release/app-release.apk \
 *     --version 1.0.13 \
 *     --code 14 \
 *     --notes "Fixed split payment;Faster stylist search" \
 *     [--description "Salon POS update"] \
 *     [--required] \
 *     [--min-supported 1.0.5]
 *
 * Notes are separated by ';' and written as a bullet list.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.join(__dirname, '../updates/salon-pos');
const MANIFEST = path.join(RELEASE_DIR, 'manifest.json');

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const val = process.argv[i + 1];
  return val && !val.startsWith('--') ? val : true;
}

const apkPath = arg('apk');
const version = arg('version');
const versionCode = arg('code');
const notes = arg('notes', '');
const description = arg('description', 'Salon POS update');
const required = Boolean(arg('required', false));
const minSupported = arg('min-supported');

if (!apkPath || !version) {
  console.error('Missing --apk and/or --version. See header of this file for usage.');
  process.exit(1);
}
if (!fs.existsSync(apkPath)) {
  console.error(`APK not found: ${apkPath}`);
  process.exit(1);
}

fs.mkdirSync(RELEASE_DIR, { recursive: true });

const fileName = `salon-pos-${version}.apk`;
const dest = path.join(RELEASE_DIR, fileName);
fs.copyFileSync(apkPath, dest);
const { size } = fs.statSync(dest);

const manifest = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  : { assumeVersion: '0.0.0' };

const prev = manifest.android ?? {};

manifest.android = {
  ...prev,
  latestVersion: String(version),
  versionCode: versionCode ? Number(versionCode) : (prev.versionCode ?? null),
  minSupportedVersion: minSupported ?? prev.minSupportedVersion ?? null,
  isRequired: required,
  description,
  releaseNotes: String(notes)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join('\n'),
  file: fileName,
  fileSize: size,
  releasedAt: new Date().toISOString(),
};

fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Published Salon POS ${version}`);
console.log(`  file      : ${dest} (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  download  : /updates/salon-pos/${fileName}`);
console.log(`  required  : ${required}`);
console.log('Tills pick this up on their next hourly check.');
