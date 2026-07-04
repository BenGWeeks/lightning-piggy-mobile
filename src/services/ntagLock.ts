// Low-level NTAG21x byte-frame locking cluster for the Hide-a-Piglet flow.
// Private helpers used only by nfcService: the locked NDEF write, the
// post-failure lock-state diagnostic, and the labelled transceive wrapper.
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import {
  buildEnableAuthFrame,
  buildGetVersionFrame,
  buildNdefTlvBytes,
  buildPackWriteFrame,
  buildPwdAuthFrame,
  buildPwdWriteFrame,
  buildReadFrame,
  buildSetAccessFrame,
  diagnoseTagLockState,
  familyFromGetVersion,
  generateLockSecrets,
  hexToBytes,
  pagesForFamily,
  packToHex,
  pwdToPin,
  splitIntoPages,
  type NtagFamily,
  type NtagPages,
} from '../utils/nfc/ntag21xLock';
import { READER_MODE_OPTS, inferTagFamily, type WriteLnurlResult } from './nfcReaderMode';

interface LockedWriteOptions {
  onTagDetected?: () => void;
  existingLock?: { pwdHex: string; packHex: string };
}

export async function writeNdefBytesAndLockAndroid(
  opts: LockedWriteOptions,
  ndefBytes: number[],
): Promise<WriteLnurlResult> {
  // Requesting MifareUltralight specifically would let
  // Mifare-Classic / NTAG424 / IsoDep chips sit silently in reader
  // mode until they time out — the user just sees the spinner
  // forever. Catch the failure and translate to the same friendly
  // guidance the techFamily branch below produces. Copilot #572 r4
  // catch.
  try {
    await NfcManager.requestTechnology(NfcTech.MifareUltralight, READER_MODE_OPTS);
  } catch (e) {
    throw new Error(
      "This chip doesn't expose Mifare Ultralight pages — Lightning Piggy needs an NTAG215 / 216. " +
        `(${(e as Error)?.message ?? e})`,
    );
  }
  const tag = await NfcManager.getTag();
  if (!tag) throw new Error('No tag detected');
  const techFamily = inferTagFamily(tag as { techTypes?: string[]; type?: string });
  if (techFamily === 'mifare-classic') {
    throw new Error(
      "Mifare Classic tags can't be locked — use an NTAG215 / 216 chip so others can't overwrite this Piglet.",
    );
  }
  if (techFamily === 'ntag-424') {
    throw new Error(
      "NTAG424 doesn't support PWD/PACK locking — use an NTAG215 / 216 sticker (GH #558).",
    );
  }
  // GET_VERSION tells us 213 vs 215 vs 216 — the configuration pages
  // live at different addresses per chip (213: 0x29-0x2C, 215: 0x83-
  // 0x86, 216: 0xE3-0xE6) so we have to know before issuing any
  // PWD/PACK/AUTH0 write. Pre-Copilot-#572-review this hard-coded
  // 215's addresses and would have silently written into user memory
  // on a 216, leaving the chip in an undefined state.
  let chip: NtagFamily;
  try {
    const versionBytes = await NfcManager.nfcAHandler.transceive(buildGetVersionFrame());
    const detected = familyFromGetVersion(versionBytes);
    if (!detected) {
      throw new Error(
        "Couldn't identify the chip from its GET_VERSION reply — use an NTAG215 / 216 sticker.",
      );
    }
    chip = detected;
  } catch (e) {
    throw new Error(`Tag identification (GET_VERSION) failed: ${(e as Error)?.message ?? e}`);
  }
  if (chip === 'ntag-213') {
    throw new Error(
      'NTAG213 only has 144 bytes of user memory — not enough for a Hide-a-Piglet payload. Use an NTAG215 / 216 instead.',
    );
  }
  const pages = pagesForFamily(chip);
  const tagUid = (() => {
    const id = (tag as { id?: string }).id;
    return typeof id === 'string' && id.length > 0 ? id : '';
  })();
  // If the wizard passed in stored secrets for an existing lock,
  // authenticate before the write so user pages accept it. PWD_AUTH
  // failure means the tag isn't actually locked with this PIN — could
  // be a fresh tag, a different tag, or one rewritten by another tool.
  // Surface that clearly so the hider can recover (use a fresh tag,
  // unlock first, etc.).
  let reusedExistingLock: { pwdHex: string; packHex: string } | null = null;
  if (opts.existingLock) {
    const storedPwd = hexToBytes(opts.existingLock.pwdHex, 4);
    const expectedPack = hexToBytes(opts.existingLock.packHex, 2);
    try {
      const pack = await NfcManager.nfcAHandler.transceive(buildPwdAuthFrame(storedPwd));
      const packMatches =
        pack.length >= 2 && pack[0] === expectedPack[0] && pack[1] === expectedPack[1];
      if (!packMatches) {
        throw new Error("Tag PACK didn't match the stored value — this isn't the tag we locked.");
      }
      reusedExistingLock = { ...opts.existingLock };
      console.log('[NFC] rewrite path — PWD_AUTH OK, reusing existing lock');
    } catch (e) {
      throw new Error(
        `Tag is locked with a different PIN than the one we have stored for this Piglet. ${(e as Error)?.message ?? ''}`.trim(),
      );
    }
  }
  // Build the full byte stream we'll write into user pages: TLV envelope
  // around the NDEF message, then page-aligned.
  const tlvBytes = buildNdefTlvBytes(ndefBytes);
  const tlvPages = splitIntoPages(tlvBytes);
  // Capacity guard — abort BEFORE issuing any writePage if the TLV
  // doesn't fit in the chip's user-memory window. Without this guard
  // an oversize NDEF on a 215 would happily overwrite the dynamic
  // lock / config / PWD pages at 0x82+, leaving the tag bricked. The
  // datasheet's writePage behaviour past the user-memory boundary is
  // chip-specific (some return NAK, others silently write — neither is
  // safe). Copilot #572 review flagged this as a blocking issue.
  const userMemoryPageCount = pages.userPageLast - pages.userPageFirst + 1;
  if (tlvPages.length > userMemoryPageCount) {
    throw new Error(
      `Payload needs ${tlvPages.length * 4} bytes but ${chip.toUpperCase()} only offers ${userMemoryPageCount * 4} bytes of user memory. Use a larger chip (NTAG216 = 888 bytes).`,
    );
  }
  opts.onTagDetected?.();
  console.log(
    `[NFC] locked write — chip=${chip} uid=${tagUid} ndef=${ndefBytes.length}B ` +
      `tlv=${tlvBytes.length}B pages=${tlvPages.length}/${userMemoryPageCount} ` +
      `mode=${reusedExistingLock ? 'rewrite-keep-pin' : 'fresh-lock'}`,
  );
  // Phase 1 — write NDEF data starting at the chip's first user page
  // (0x04 on every NTAG21x). Page-by-page so a mid-stream failure
  // surfaces the offending page index in the error. On failure we
  // also run the lock-status diagnostic so the hider gets a clear
  // "OTP-locked, get a fresh chip" vs "PWD-protected, unlock first"
  // message instead of just "Transceive failed" (Pixel test session).
  for (let i = 0; i < tlvPages.length; i++) {
    const offset = pages.userPageFirst + i;
    try {
      await NfcManager.mifareUltralightHandlerAndroid.mifareUltralightWritePage(
        offset,
        tlvPages[i],
      );
    } catch (e) {
      const raw = `Tag write failed at page 0x${offset.toString(16)} (byte ${i * 4}/${tlvBytes.length}) — ${(e as Error)?.message ?? e}.`;
      const diagnosis = await diagnoseAndExplainLockState(pages).catch(() => null);
      throw new Error(diagnosis ? `${diagnosis}\n\n(${raw})` : raw);
    }
  }
  console.log('[NFC] NDEF user-data write OK');
  // Phase 2a — rewrite path. We already PWD_AUTH'd above, so the chip
  // accepted the user-page writes. PWD/PACK don't need re-writing
  // (they're still on the chip), but we DO re-apply ACCESS + AUTH0
  // idempotently. Pre-#572-review-r2 this branch assumed "the chip is
  // still locked because PWD_AUTH succeeded" — that's not strictly
  // true: AUTH0 can be 0xFF (unlocked) while PWD/PACK remain stored,
  // in which case PWD_AUTH still returns the matching PACK but the
  // tag is wide open. Re-writing CFG_0/CFG_1 here makes the rewrite
  // path idempotently locked regardless of the chip's prior AUTH0
  // state. The same PIN keeps working because we never touched
  // PWD/PACK.
  if (reusedExistingLock) {
    await sendTransceive(buildSetAccessFrame(pages), 'WRITE ACCESS (rewrite)');
    await sendTransceive(buildEnableAuthFrame(pages), 'WRITE AUTH0 (rewrite)');
    return {
      family: techFamily,
      locked: true,
      lock: {
        pwdHex: reusedExistingLock.pwdHex,
        packHex: reusedExistingLock.packHex,
        pin: reusedExistingLock.pwdHex.toUpperCase(),
        tagUid,
      },
    };
  }
  // Phase 2b — fresh-lock path. Set PWD/PACK + flip protection on.
  // Order matters: PWD and PACK first (so the chip stores them), then
  // ACCESS (configures read-still-allowed / write-blocked), then AUTH0
  // LAST — once AUTH0 = 0x04 takes effect, subsequent writes to pages
  // ≥ 4 require PWD_AUTH, including writes to PWD/PACK/CFG pages
  // themselves. Writing AUTH0 before PWD/PACK would lock us out before
  // we can store the password.
  const secrets = generateLockSecrets();
  await sendTransceive(buildPwdWriteFrame(pages, secrets.pwd), 'WRITE PWD');
  await sendTransceive(buildPackWriteFrame(pages, secrets.pack), 'WRITE PACK');
  await sendTransceive(buildSetAccessFrame(pages), 'WRITE ACCESS');
  await sendTransceive(buildEnableAuthFrame(pages), 'WRITE AUTH0');
  const pwdHex = secrets.pwd.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  const packHex = packToHex(secrets.pack);
  const pin = pwdToPin(secrets.pwd);
  console.log(`[NFC] locked write done — chip=${chip} pin=${pin.slice(0, 2)}******`);
  return {
    family: techFamily,
    locked: true,
    lock: { pwdHex, packHex, pin, tagUid },
  };
}

// Read the chip's lock-status bytes after a writePage failure and
// translate the state into a hider-readable explanation. Three
// states the user might see:
//
//   • OTP-locked: the static/dynamic lock bits at page 0x02 / family-
//     specific dynamic-lock page are set. These are one-way; once
//     flipped the chip is permanently read-only and no software can
//     recover it. Usually a relic of the pre-#567 path that called
//     Ndef.makeReadOnly() after every write — NFC Tools reports this
//     as "Writeable: No". The hider needs a fresh NTAG215.
//   • PWD-protected: AUTH0 ≤ last user page, so the chip is gating
//     writes behind PWD_AUTH. The hider can recover by entering the
//     Edit flow for the Piglet that originally locked this tag and
//     tapping Unlock tag.
//   • Open: no lock detected, the IOException came from elsewhere
//     (tag connection drop, broken antenna pad, mis-detected
//     family, …). Surface the raw transceive error.
//
// Each branch returns the prose; the caller composes it into the
// thrown error so the BrandedAlert / write-sheet error state shows
// it verbatim.
async function diagnoseAndExplainLockState(pages: NtagPages): Promise<string | null> {
  try {
    // READ at page 0x02 returns 16 bytes (pages 0x02-0x05). The
    // static lock bits live in bytes 2-3 of page 0x02.
    const staticRead = await NfcManager.nfcAHandler.transceive(buildReadFrame(0x02));
    if (staticRead.length < 4) return null;
    // READ at the dynamic-lock page (215: 0x82, 216: 0xE2, 213:
    // 0x28). Byte 0 holds the dynamic lock bits.
    const dynamicRead = await NfcManager.nfcAHandler.transceive(
      buildReadFrame(pages.dynamicLockPage),
    );
    if (dynamicRead.length < 1) return null;
    // READ CFG_0 → byte 3 is AUTH0 (first page that requires
    // PWD_AUTH for writes). Pre-set 0xFF (disabled) on a factory
    // chip; PR #567's lock flow sets it to 0x04.
    const cfg0Read = await NfcManager.nfcAHandler.transceive(buildReadFrame(pages.cfg0));
    if (cfg0Read.length < 4) return null;
    const state = diagnoseTagLockState(staticRead.slice(0, 4), dynamicRead[0], cfg0Read[3], pages);
    switch (state.kind) {
      case 'otp-locked':
        return (
          'This tag is permanently locked — its chip-level lock bits have been flipped ' +
          '(usually by an earlier app calling makeReadOnly). No software can rewrite it ' +
          'or undo the lock. Grab a fresh NTAG215 sticker / charm to continue.'
        );
      case 'pwd-protected':
        return (
          "This tag is password-locked by a Lightning Piggy PIN we don't have stored on " +
          `this device (chip AUTH0 = 0x${state.auth0.toString(16).padStart(2, '0').toUpperCase()}). ` +
          'Open the original Piglet from My Piglets, tap Edit, then Unlock tag on the PIN ' +
          'card. After that the chip accepts a fresh write.'
        );
      case 'open':
        return null;
      default:
        return null;
    }
  } catch {
    // READ itself can fail if the tag left the antenna mid-write. In
    // that case the diagnostic adds nothing — fall back to the raw
    // transceive error.
    return null;
  }
}

// Thin wrapper around `nfcAHandler.transceive` that surfaces the failing
// command name in the error message. The native handler returns
// `transceive fail: ${ex}` on TagLost / IOException; chaining the label
// makes "WRITE AUTH0 failed: TAG_LOST" instantly diagnostic.
export async function sendTransceive(frame: number[], label: string): Promise<number[]> {
  try {
    return await NfcManager.nfcAHandler.transceive(frame);
  } catch (e) {
    throw new Error(`${label} failed: ${(e as Error)?.message ?? e}`);
  }
}
