/**
 * prove.worker.js — Aadhaar ZK proof generation Web Worker
 *
 * Loaded by ProofRunner.tsx via new Worker('/prove.worker.js').
 * Receives { type:'prove', qrBytes:ArrayBuffer, wasmUrl:string, zkeyUrl:string }
 * Posts back:
 *   { type:'status', payload: string }   — progress updates
 *   { type:'done',   payload: { proof, publicSignals } }
 *   { type:'error',  message: string }
 *
 * Circuit public signals order (matches API verifyProof.ts):
 *   [0] pubkeyHash    — poseidon hash of RSA public key chunks
 *   [1] isOver18      — 1 if user is ≥18, else 0
 *   [2] genderBit     — 77 (ASCII 'M') or 70 (ASCII 'F')
 *   [3] nameHash      — poseidon hash of packed name bytes (≤31 bytes)
 *   [4] uidCommitment — poseidon hash of packed referenceId bytes
 */

// Load snarkjs from unpkg CDN (matches the version in popup's package.json)
importScripts('https://unpkg.com/snarkjs@0.7.4/build/snarkjs.min.js');

// ────────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────────

/** Convert a Uint8Array (big-endian) to a BigInt */
function bytesToBigInt(bytes) {
  let val = BigInt(0);
  for (const b of bytes) val = (val << BigInt(8)) | BigInt(b);
  return val;
}

/**
 * Split a 2048-bit RSA key/signature (256 bytes, big-endian) into 64 chunks
 * of 32 bits each, expressed as decimal strings.
 * Chunking order: chunk[0] = most-significant 32 bits.
 */
function rsaTo64Chunks(bytes256) {
  const chunks = [];
  for (let i = 0; i < 64; i++) {
    let val = 0;
    for (let j = 0; j < 4; j++) {
      val = (val * 256) + (bytes256[i * 4 + j] ?? 0);
    }
    chunks.push(val.toString());
  }
  return chunks;
}

/**
 * Pack up to 31 bytes (big-endian) into a decimal string.
 * Used for name and referenceId packing before hashing.
 */
function packBytes(bytes, maxLen) {
  const take = Math.min(bytes.length, maxLen);
  let val = BigInt(0);
  for (let i = 0; i < take; i++) {
    val = (val << BigInt(8)) | BigInt(bytes[i]);
  }
  return val.toString();
}

// ────────────────────────────────────────────────────────────────────────────────
// Aadhaar Secure QR parsing
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Parse Aadhaar Secure QR binary data.
 *
 * Binary format (fields separated by 0xFF = 255):
 *   [0] email/mobile indicator (1-2 bytes)
 *   [1] UID last-4 (4 bytes)
 *   [2] referenceId / timestamp (≤31 bytes)
 *   [3] name bytes
 *   [4] DOB as "DD-MM-YYYY"
 *   [5] gender byte ('M'=77, 'F'=70)
 *   [6..n] address fields
 *   last 256 bytes: RSA-2048 signature (not delimited)
 *
 * Note: The RSA signature is appended after the last delimiter field;
 * we strip it by taking the last 256 bytes.
 */
function parseAadhaarQR(qrBytes) {
  const DELIM = 255;

  // Separate signature (last 256 bytes) from data
  const signatureBytes = qrBytes.slice(qrBytes.length - 256);
  const dataBytes      = qrBytes.slice(0, qrBytes.length - 256);

  // Find all delimiter positions in data section
  const delimPositions = [];
  for (let i = 0; i < dataBytes.length; i++) {
    if (dataBytes[i] === DELIM) delimPositions.push(i);
  }

  if (delimPositions.length < 5) {
    throw new Error(`Invalid Aadhaar QR: expected ≥5 delimiters, found ${delimPositions.length}`);
  }

  function field(delimIdx) {
    const start = delimPositions[delimIdx] + 1;
    const end   = delimPositions[delimIdx + 1] ?? dataBytes.length;
    return dataBytes.slice(start, end);
  }

  // Field indices (0-indexed from delimiter boundaries)
  const refIdBytes = field(1);   // referenceId (used for uidCommitment)
  const nameBytes  = field(2);   // name string
  const dobBytes   = field(3);   // DOB "DD-MM-YYYY"
  const genderByte = field(4)[0] ?? 77; // 77=M, 70=F

  const dobStr = String.fromCharCode(...dobBytes);

  // Compute isOver18 from DOB
  const parts = dobStr.split('-');
  let isOver18 = 1;
  if (parts.length === 3) {
    const dob = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    const ageMs = Date.now() - dob.getTime();
    isOver18 = ageMs >= 18 * 365.25 * 24 * 3600 * 1000 ? 1 : 0;
  }

  // Build delimiter indices array for the circuit (18 slots, zero-padded)
  // Circuit expects positions of all 0xFF bytes within dataBytes
  const delimiterIndices = new Array(18).fill(0);
  for (let i = 0; i < Math.min(delimPositions.length, 18); i++) {
    delimiterIndices[i] = delimPositions[i];
  }

  return {
    dataBytes,
    signatureBytes,
    refIdBytes,
    nameBytes,
    isOver18,
    genderBit:       genderByte,
    delimiterIndices,
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────────

self.onmessage = async ({ data }) => {
  const { type, qrBytes: rawBuffer, wasmUrl, zkeyUrl } = data;
  if (type !== 'prove') return;

  const qrBytes = new Uint8Array(rawBuffer);

  try {
    self.postMessage({ type: 'status', payload: 'Parsing Aadhaar QR data…' });

    const parsed = parseAadhaarQR(qrBytes);

    self.postMessage({ type: 'status', payload: 'Building circuit inputs…' });

    // ── Circuit input: qrDataPadded ──────────────────────────────────────────
    // Max size depends on your compiled circuit — 2928 is the anon-aadhaar default.
    const MAX_QR_BYTES = 2928;
    const qrDataPadded = new Array(MAX_QR_BYTES).fill(0);
    for (let i = 0; i < Math.min(parsed.dataBytes.length, MAX_QR_BYTES); i++) {
      qrDataPadded[i] = parsed.dataBytes[i];
    }

    // ── Circuit input: RSA signature & public key ────────────────────────────
    // The RSA signature comes from the QR; the public key must be the current
    // UIDAI certificate key. Replace pubKeyBytes with the real DER-encoded
    // modulus bytes when you have the certificate.
    const signatureChunks = rsaTo64Chunks(parsed.signatureBytes);

    // Placeholder public key (all-ones for testing; replace with real UIDAI key)
    const pubKeyBytes  = new Uint8Array(256).fill(1);
    const pubKeyChunks = rsaTo64Chunks(pubKeyBytes);

    // ── Packed field values (will be Poseidon-hashed inside the circuit) ─────
    const packedRefId = packBytes(parsed.refIdBytes, 31);
    const packedName  = packBytes(parsed.nameBytes, 31);

    const circuitInputs = {
      qrDataPadded,
      qrDataPaddedLength:  parsed.dataBytes.length,
      delimiterIndices:    parsed.delimiterIndices,
      signature:           signatureChunks,
      pubKey:              pubKeyChunks,
      revealAgeAbove18:    1,
      revealGender:        1,
      // Packed values used by circuits that accept pre-packed inputs:
      packedRefId,
      packedName,
    };

    self.postMessage({ type: 'status', payload: 'Generating ZK proof (30–90 s)…' });

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInputs,
      wasmUrl,
      zkeyUrl,
    );

    // publicSignals order must match what verifyProof.ts expects:
    // [pubkeyHash, isOver18, genderBit, nameHash, uidCommitment]
    // The circuit outputs these in its defined order; log them in dev to verify.
    self.postMessage({ type: 'done', payload: { proof, publicSignals } });

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message ?? 'Proof generation failed' });
  }
};
