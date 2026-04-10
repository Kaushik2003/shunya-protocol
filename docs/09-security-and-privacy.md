# 09 — Security & Privacy

Shunya exists because PII storage is a legal bomb. If we get privacy
wrong, the product has no reason to exist. This doc is the single
source of truth for how we handle data, auth, and secrets.

## The privacy contract we make to users

> "We never see your Aadhaar, and we never learn your name, date of
> birth, address, or Aadhaar number. We only learn that some anonymous
> human passed a zero-knowledge proof that they are over 18, along
> with a one-way hash that lets the same person skip re-verifying next
> time."

Every design decision must be checkable against this sentence.

## PII classification

| Class | Examples | Our handling |
|---|---|---|
| **Hard PII** | Aadhaar number, name, DOB, address, photo | Never crosses network. Exists only in browser memory during proving, cleared after. |
| **Derived PII** | Poseidon(name), Poseidon(UID) | Stored. One-way by construction. `poseidon(UID)` combined with server salt gives the nullifier. |
| **Soft identifiers** | Phone number | Hashed with bcrypt/argon2, TTL 5 min in Redis for OTP only. Never written to Postgres. |
| **Crypto-public** | Smart account address, attestation UID, tx hash | Public on-chain. Stored freely. |
| **Claims** | `isOver18`, gender bit | Stored. Binary, minimal. |

## The nullifier, in detail

```
Step 1 (browser, in-circuit):
  uidCommitment = poseidon(UID)         // one-way

Step 2 (server, private):
  nullifier     = poseidon(uidCommitment, SHUNYA_NULLIFIER_SALT)

Where SHUNYA_NULLIFIER_SALT:
  - is 32 random bytes, generated once
  - is stored in the secrets vault (Bitwarden / SOPS / Infisical)
  - NEVER changes — rotation would brick every returning user
  - is known ONLY to our backend (never in browsers, never in circuits)
```

### Why this construction is safe

- **Not reversible.** Poseidon is a hash; recovering `UID` from `nullifier`
  requires brute-forcing ~10^12 Aadhaar numbers. Without the salt, that's
  still feasible for a targeted attack (any single UID can be checked).
  **With the salt server-side, it's impossible for an external attacker.**
- **Not linkable across services.** An outside observer seeing our
  attestations cannot tell if two attestations are the same human —
  each org gets its own attestation UID. Only our backend, with the
  salt and the DB, can correlate.
- **Linkable by us (intentional).** This is the moat — we can
  recognise returning users. That's the product.

### What if the salt leaks?

- **Immediate impact:** anyone with the leaked salt + a stolen nullifier
  can attempt brute-force across the Aadhaar UID space (10^12), which
  is actually feasible for a nation-state actor.
- **Mitigation:** rotate only if compromised. Rotation bricks returning
  users, which is a product harm but not a legal one.
- **Storage:** vault access is restricted to 2 people + CI, audited.

## Data flow enforcement checklist

When reviewing code, verify:

1. ☐ No API route receives a field called `aadhaar`, `uid`, `name`, `dob`, `address`.
2. ☐ The popup's `POST /internal/sessions/:id/proof` body contains ONLY `{proof, publicSignals, uidCommitment}`.
3. ☐ The server never decodes `publicSignals` into named PII fields it then logs.
4. ☐ Logs use structured `redact` rules to strip fields matching the PII classification above.
5. ☐ Phone numbers appear only in Redis (TTL'd) — grep for `phone` in the DB schema should return nothing in `verified_users` / `sessions`.

## Auth & session management

### Dashboard (B2B humans)
- **Lucia Auth** with email + password + TOTP.
- Passwords: Argon2id, 64MB memory cost.
- Sessions: cookie, HttpOnly, SameSite=Lax, 7-day sliding expiry.
- Rate-limit login attempts (5/min/IP).

### API (B2B backends)
- Bearer token: `sk_live_...`.
- Stored as Argon2 hash + prefix.
- Rate-limit per key (Redis token bucket, configurable per org plan).
- TLS 1.3 only.

### Popup session tokens
- JWT signed with env-scoped HMAC secret.
- 15-minute expiry.
- `aud: "shunya-popup"`, `sid`, `oid` claims.
- Single-use semantically — once a session reaches `verified`, the
  token can't be reused to submit a second proof.

### End users (phone OTP)
- 6-digit OTP, TTL 5 min.
- Rate-limit: 3 OTP requests per phone per 15 min, 10/hour per IP.
- OTP stored as `sha256(otp)` in Redis, never plaintext.

## Webhook HMAC

```
sig = hex(hmac_sha256(webhook_secret, timestamp + "." + rawBody))
```

Headers:
```
X-Shunya-Timestamp: 1712750400
X-Shunya-Signature: sha256=abcdef...
X-Shunya-Event: session.verified
```

Clients verify:
1. `abs(now - timestamp) < 5min` (replay protection)
2. `constant_time_compare(sig, expected)`

We publish a reference verifier in `@shunya/node`.

## Secrets inventory

| Secret | Lives where | Access |
|---|---|---|
| `SHUNYA_NULLIFIER_SALT` | Vault | Backend workers only |
| `JWT_SECRET` (session tokens) | Vault | API nodes |
| `WEBHOOK_SIGNING_KEY` (per org) | DB column, written once | Worker |
| `DEPLOYER_EOA_KEY` (Base) | Vault | CI + one operator |
| `CDP_API_KEY` | Vault | Workers |
| `ZKVERIFY_SUBMITTER_SEED` | Vault | Workers |
| `DB_URL` (Neon prod) | Vault | API + workers |
| `SMTP_PASSWORD` | Vault | Dashboard app |

No secret is in `.env.example`. No secret is committed to git. CI injects
secrets at deploy time via OIDC.

## Threat model (abbreviated)

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DB stolen | Low | **Zero PII leaked** by design | Data model §03 |
| Salt leaked | Very low | Returning users brute-forceable | Vault + small access list |
| Malicious B2B client forging onSuccess callback | Medium | Client's own problem (we sign webhooks) | Document "always verify webhook" in SDK docs |
| MITM between popup and API | Low | TLS | TLS 1.3, HSTS, cert pinning for native later |
| Circuit bug (accepts invalid proof) | Medium | Bogus attestations | Audit before mainnet; revocable attestations |
| Replay of old proofs | Medium | Bogus attestations with stale data | `currentDate` public input + resolver check |
| Stolen `sk_live_` key | Medium | Attacker drains org quota | Prefixes + revoke endpoint, usage alerts |
| Phone OTP bypass | Medium | Bot farms | Rate limits + abuse detection per phone/IP |
| Stolen session JWT | Low | 15-min window to complete a proof | Short expiry + single-use |

## Legal posture (India)

- **UIDAI Aadhaar Regulations:** forbid storage of Aadhaar number by
  private entities. We store `poseidon(poseidon(UID), SALT)` — a
  cryptographically one-way derivative. Legal review required before
  mainnet launch to confirm this is not interpreted as "storage" under
  the regulation. Documented as an open legal question.
- **DPDP Act 2023:** requires consent, purpose limitation, data
  minimisation. Our model is minimisation-native. Consent UX is part
  of the popup (explicit "I consent to sharing age/gender with
  [client]" checkbox before proving).
- **No cross-border transfer of PII** because no PII leaves the device.
  This is a huge feature for B2B clients doing DPDP assessments.

## Audit trail

- Every API request logs `{ts, org_id, actor, route, status}` — no body.
- Every on-chain tx is permanently auditable via BaseScan.
- Dashboard shows the org's full attestation history.
- We keep 90-day request logs in Loki, then drop.
