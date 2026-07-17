#!/usr/bin/env node
// Fetches the rust-nostr Swift bindings for modules/nostr-native (Stage 2 M3 of #1036).
// Same consume-prebuilt-artifacts model as bdk-rn's installer: a checksum-pinned
// xcframework + the UniFFI-generated Swift source, downloaded at npm-install time
// (CocoaPods prepare_command never runs for development pods, so postinstall is
// the only reliable hook that precedes pod install on EAS Mac workers).
// The artifacts are gitignored; the podspec raises with a pointer here if missing.
// Upgrade path: bump VERSION + both hashes below, keeping the Android Maven
// version in modules/nostr-native/android/build.gradle in lockstep.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Swift bindings lag the Kotlin artifact by one packaging patch (0.44.2 vs
// 0.44.3) — both wrap the same rust-nostr 0.44 core; wire formats are spec-frozen.
const VERSION = '0.44.2';
const XCFRAMEWORK_URL = `https://github.com/rust-nostr/nostr-sdk-swift/releases/download/${VERSION}/nostr_sdkFFI.xcframework.zip`;
// Pinned from nostr-sdk-swift's Package.swift binaryTarget checksum at tag 0.44.2.
const XCFRAMEWORK_SHA256 = '3a3d527eea38a1f78b82ea4e3637445d07ce9fc861e99f660f6bb00a75d48f05';
const SWIFT_URL = `https://raw.githubusercontent.com/rust-nostr/nostr-sdk-swift/${VERSION}/Sources/NostrSDK/NostrSDK.swift`;
const SWIFT_SHA256 = '487bcd3fa99dc453c144a7d8782d7004bf5794c1f10402c3957e89230ccc54f2';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const iosDir = join(repoRoot, 'modules', 'nostr-native', 'ios');
const frameworkDir = join(iosDir, 'nostr_sdkFFI.xcframework');
const markerPath = join(frameworkDir, '.lightning-piggy-version');
const generatedDir = join(iosDir, 'Generated');
const swiftPath = join(generatedDir, 'NostrSDK.swift');

// Only Mac builds (local prebuild + EAS iOS workers) need the artifacts; Linux
// CI / Android EAS workers skip the 39 MB download. Override for testing.
if (process.platform !== 'darwin' && process.env.FETCH_NOSTR_SDK_SWIFT !== '1') {
  console.log('[nostr-sdk-swift] non-darwin platform — skipping iOS bindings fetch');
  process.exit(0);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const marker = `${VERSION} ${XCFRAMEWORK_SHA256}`;

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureSwiftSource() {
  if (existsSync(swiftPath) && sha256(readFileSync(swiftPath)) === SWIFT_SHA256) return false;
  console.log(`[nostr-sdk-swift] downloading NostrSDK.swift ${VERSION}…`);
  const buf = await download(SWIFT_URL);
  const got = sha256(buf);
  if (got !== SWIFT_SHA256) throw new Error(`NostrSDK.swift sha256 mismatch: ${got}`);
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(swiftPath, buf);
  return true;
}

async function ensureXcframework() {
  if (existsSync(markerPath) && readFileSync(markerPath, 'utf8').trim() === marker) return false;
  console.log(`[nostr-sdk-swift] downloading nostr_sdkFFI.xcframework ${VERSION} (~39 MB)…`);
  const buf = await download(XCFRAMEWORK_URL);
  const got = sha256(buf);
  if (got !== XCFRAMEWORK_SHA256) throw new Error(`xcframework zip sha256 mismatch: ${got}`);
  // Same-filesystem temp dir: renameSync below can't cross devices, and /tmp
  // is an unreliable tmpfs on some dev boxes.
  const tmp = mkdtempSync(join(iosDir, '.nostr-sdk-swift-'));
  try {
    const zipPath = join(tmp, 'nostr_sdkFFI.xcframework.zip');
    writeFileSync(zipPath, buf);
    execFileSync('unzip', ['-q', zipPath, '-d', tmp]);
    const unpacked = join(tmp, 'nostr_sdkFFI.xcframework');
    if (!existsSync(join(unpacked, 'Info.plist'))) {
      throw new Error('unexpected zip layout: nostr_sdkFFI.xcframework/Info.plist not found');
    }
    rmSync(frameworkDir, { recursive: true, force: true });
    renameSync(unpacked, frameworkDir);
    writeFileSync(markerPath, `${marker}\n`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return true;
}

try {
  const fetchedSwift = await ensureSwiftSource();
  const fetchedFramework = await ensureXcframework();
  if (!fetchedSwift && !fetchedFramework) {
    console.log(`[nostr-sdk-swift] ${VERSION} already present — nothing to do`);
  } else {
    console.log(`[nostr-sdk-swift] ${VERSION} ready`);
  }
} catch (err) {
  console.error(`[nostr-sdk-swift] fetch failed: ${err.message}`);
  console.error(
    '[nostr-sdk-swift] iOS builds of modules/nostr-native will fail until this succeeds — re-run: node scripts/fetch-nostr-sdk-swift.mjs',
  );
  process.exit(1);
}
