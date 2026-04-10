# 02 — Verification Flow (Deep Dive)

This is the critical path. Everything else in the system exists to support
these 13 steps. Read this doc carefully before changing anything in the
proof → attestation pipeline.

## The 13 steps (happy path, first-time user)

### Step 1 — B2B backend mints a session

```http
POST /v1/sessions HTTP/1.1
Authorization: Bearer sk_live_...
Content-Type: application/json

{
  "userRef": "user_42",
  "requiredClaims": { "isOver18": true, "gender": "any" },
  "returnUrl": "https://client.app/verified",
  "webhookUrl": "https://client.app/hooks/shunya"
}
```

Response:

```json
{
  "sessionId": "ses_01HXYZ...",
  "sessionToken": "eyJhbGciOi...",   // short-lived JWT, 15 min
  "popupUrl": "https://verify.shunya.app/?s=eyJ..."
}
```

- `sessionId` is our internal DB row id.
- `sessionToken` is a JWT signed with a per-env HMAC secret. Claims:
  `{sid, oid, exp, reqClaims}`. This is the *only* thing the popup carries.
- `userRef` is whatever the B2B app wants to use to correlate back to
  their user (we just echo it in the webhook).

### Step 2 — B2B frontend opens the popup

```js
shunya.open({ sessionToken, onSuccess, onError, onClose });
```

The SDK creates an iframe pointing at
`https://verify.shunya.app/?s={sessionToken}` and wires up a `postMessage`
bridge. The iframe now owns the user interaction.

### Step 3 — User authenticates (phone OTP)

- The popup calls `POST /internal/sessions/:id/otp/request` with the
  phone number.
- API stores `H(phone):otp` in Redis with a 5-minute TTL, sends the OTP
  via the provider (MSG91 in India, Twilio fallback).
- User enters OTP → `POST /internal/sessions/:id/otp/verify` → API checks
  Redis → marks session as "phone-verified".
- Phone is only used for rate-limiting + abuse prevention. It is **not**
  stored unhashed. It is **not** the primary key. The nullifier is.

### Step 4 — User uploads DigiLocker Aadhaar QR

- Popup shows "Upload your Aadhaar QR screenshot from DigiLocker".
- Accepts PNG/JPG (screenshot) or PDF (full DigiLocker download).
- For images: `jsQR` decodes the QR → raw bytes.
- For PDFs: `pdf.js` rasterizes page 1 → `jsQR` decodes.
- Raw bytes are the UIDAI-signed compressed XML structure.
- **Nothing is sent to the server yet.**

### Step 5 — Nullifier check (returning-user fast path)

Before starting the expensive proving step, the popup computes:

```
nullifier = poseidon(UID, SHUNYA_NULLIFIER_SALT)
```

Wait — the salt is server-side only. So actually:

```
Option A: do the full proof (first-time flow)
Option B: compute a *commitment* client-side (poseidon(UID)), POST it, server hashes
          with salt and checks DB
```

We use **Option B**:

```http
POST /internal/sessions/:id/nullifier/check
{ "uidCommitment": "0x<poseidon(UID)>" }
```

Server:
1. Compute `nullifier = poseidon(uidCommitment, SALT)`.
2. `SELECT * FROM verified_users WHERE nullifier = $1`.
3. If hit → mark session as `fast-path`, enqueue a `copyAttestationJob` that
   issues a fresh attestation for this org pointing at the same smart
   account, and returns status `verified` within seconds.
4. If miss → return `{ status: "needs_proof" }` and the popup proceeds.

**Why hash the commitment with the salt server-side?** If we hashed with
the salt in the browser, the salt would leak into JS bundles — anyone
could grind nullifiers offline and learn whether an arbitrary Aadhaar UID
has ever registered with Shunya. Keeping the salt server-side makes
nullifiers unpredictable to anyone except us.

**Why poseidon(UID) client-side instead of just sending UID?** Defense in
depth. Even though TLS protects transit, sending the raw UID to our server
violates our "no PII touches the server" principle *even momentarily*.
Poseidon is one-way.

### Step 6 — Client-side proof generation (first-time path)

Runs in a Web Worker to avoid freezing the UI.

```
Input:  raw Aadhaar QR bytes (UIDAI-signed)
Circuit: forked @anon-aadhaar/circuits
Asserts:
  1. RSA-SHA256 signature on payload == UIDAI public key
  2. DOB implies age >= 18 at `currentDate` (passed as public input)
  3. UID == preimage of uidCommitment
Reveals (public outputs):
  - isOver18: bool (will always be true if proof succeeds; kept as field
    for future flexibility)
  - genderBit: 0 or 1
  - nameHash: poseidon(name)
  - uidCommitment: poseidon(UID)
Output: { proof, publicSignals }
```

Target: <10 seconds on a mid-range Android. We use Groth16 with a
cached zkey (~30 MB, IndexedDB).

### Step 7 — Submit proof to API

```http
POST /internal/sessions/:id/proof
Authorization: Bearer <sessionToken>

{
  "proof": { "pi_a": [...], "pi_b": [...], "pi_c": [...] },
  "publicSignals": ["0x01", "0x00", "0x...", "0x..."],
  "uidCommitment": "0x..."
}
```

API:
1. Validates `sessionToken`.
2. Validates `publicSignals` shape (length, range).
3. Writes to `verification_jobs` table with `status = queued`.
4. Pushes to BullMQ queue `verify-proof`.
5. Returns `202 Accepted` with `{ status: "queued", sessionId }`.

### Step 8 — Worker: verify on zkVerify

Worker picks up the job, calls zkVerify testnet RPC:

```ts
const receipt = await zkVerify.submitProof({
  proofType: "groth16",
  vk: SHUNYA_VK,
  proof,
  publicSignals
});
// receipt = { merkleRoot, leafIndex, siblings, blockHash }
```

- Poll until included (timeout: 2 min, then BullMQ retry).
- Persist `receipt` as JSON in `attestations.zkverify_receipt` (or a
  pre-attestation staging table; final choice in §04-data-model).

### Step 9 — Worker: ensure smart account exists

```ts
const existing = await db.verified_users.findByNullifier(nullifier);
let smartAccount: Address;
if (existing) {
  smartAccount = existing.smart_account_address;
} else {
  // First time this human has ever registered with Shunya
  smartAccount = await cdp.createSmartAccount({
    owner: ourMasterSigner,         // we're the key custodian
    salt: nullifier                 // deterministic address per human
  });
  await db.verified_users.insert({
    nullifier, smart_account_address: smartAccount, ...publicClaims
  });
}
```

- The CDP smart account is 4337-compatible.
- We hold the owner key (users don't manage keys). This is Privy-style
  custodial UX.
- `salt: nullifier` means the address is deterministic — even if we lose
  the DB row, we can recreate the same address from the nullifier.

### Step 10 — Worker: write EAS attestation on Base Sepolia

```solidity
ShunyaResolver.attest(
  zkVerifyReceipt,        // Merkle proof to be verified on-chain
  publicSignals,          // {isOver18, genderBit, nameHash, uidCommitment}
  smartAccount            // subject of the attestation
);
```

Inside the contract:
1. Call `zkVerifyVerifier.verifyReceipt(receipt)` — reverts if invalid.
2. Call `EAS.attest({schema: SHUNYA_SCHEMA_UID, recipient: smartAccount,
   data: abi.encode(nullifier, isOver18, gender, nameHash)})`.
3. Emits `AttestationCreated(uid)`.

The tx itself is sent as a **UserOperation from the smart account**,
sponsored by the CDP paymaster. The paymaster policy only sponsors
calls to `ShunyaResolver.attest()` to prevent abuse.

### Step 11 — Worker: persist result

```sql
INSERT INTO attestations (
  verified_user_id, org_id, session_id,
  attestation_uid, tx_hash, zkverify_receipt, chain
) VALUES (...);

UPDATE sessions
SET status = 'verified', attestation_id = $1, completed_at = now()
WHERE id = $2;
```

### Step 12 — Worker: enqueue webhook delivery

Worker pushes a job to `deliver-webhook` queue. A separate worker handles
retry/backoff so a slow client webhook doesn't block the verification path.

### Step 13 — Webhook delivery to B2B client

```http
POST https://client.app/hooks/shunya HTTP/1.1
Content-Type: application/json
X-Shunya-Signature: sha256=<hmac>
X-Shunya-Event: session.verified
X-Shunya-Timestamp: 1712750400

{
  "sessionId": "ses_01HXYZ...",
  "userRef": "user_42",
  "status": "verified",
  "attestationUid": "0xabc...",
  "walletAddress": "0xdef...",
  "claims": { "isOver18": true, "gender": "F" },
  "chain": "base-sepolia",
  "verifiedAt": "2026-04-10T11:00:00Z"
}
```

HMAC = `sha256(webhookSecret + timestamp + "." + body)`. B2B client
verifies it before trusting the payload. Retry policy: 1m, 5m, 25m, 2h,
12h, give up at 24h total.

Concurrently the popup receives a `postMessage` event from a long-poll of
`GET /v1/sessions/:id`, redirects to `returnUrl?session=...&status=verified`,
and the SDK fires `onSuccess` on the parent page.

## Returning-user flow (the moat)

Steps 1–4 identical. At step 5, the nullifier check hits. Then:

```
[5b] API: verified_users row exists → smart account + claims known
[6b] Enqueue `copyAttestationJob` (not `verifyProofJob`)
[7b] Worker: call ShunyaResolver.attest() with a special "reuse" branch
     that takes an existing attestation UID as input and creates a new
     one for this org. (Or: our schema allows multiple attestations per
     subject and we just write a new one.)
[8b] Persist attestations row, fire webhook. Total time: <3s.
```

No proof generation, no zkVerify roundtrip. The user sees "Verifying…
verified" and is done.

**Per-org attestations** — we write a fresh attestation row per
(verified_user × org) combo so each B2B client has its own on-chain
receipt they can audit independently. The shared bits (wallet, claims)
are reused.

## Failure modes

| Step | Failure | Handling |
|---|---|---|
| 3 | OTP rate limit | Return 429, surfaced as "too many attempts, try in N min" |
| 4 | QR unreadable | Show "Can't read QR, try a clearer screenshot" |
| 5 | Nullifier miss | Fall through to full proof — this is not an error |
| 6 | Proof fails | Almost always = invalid QR or <18. Show "Verification failed" |
| 7 | Auth failure | Session expired → tell user to restart |
| 8 | zkVerify timeout | BullMQ retry ×5, then `status = failed` → webhook fires with failed status |
| 10 | Chain tx revert | BullMQ retry ×3. If persistent, alert on-call |
| 13 | Webhook 4xx/5xx | Exponential retry up to 24h, then dead-letter queue |

## Idempotency & crash recovery

- Every BullMQ job carries the `sessionId`.
- Each worker stage writes a `stage` column on `sessions` (`queued →
  verified_on_zkverify → chain_submitted → complete`).
- If a worker dies between stages, the next retry checks `stage` and
  skips completed sub-steps. No double-spend of paymaster gas.
- `attestations.attestation_uid` is unique, so a double-submit fails
  cleanly at the DB layer.

## Timing targets

| Stage | Target (first-time) | Target (returning) |
|---|---|---|
| OTP → phone verified | <5s human-bound | <5s |
| QR parse | <500ms | <500ms |
| Nullifier check | <300ms | <300ms |
| Proof generation | <10s (mid-Android) | *skipped* |
| zkVerify verify | <5s | *skipped* |
| Chain attest | <3s | <3s |
| Webhook fire | <500ms | <500ms |
| **Total (user-perceived)** | **<25s** | **<5s** |
