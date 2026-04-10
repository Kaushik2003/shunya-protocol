# Shunya Protocol — Product Requirements Document (PRD)

> Zero-Knowledge Aadhaar verification, delivered as a B2B "Razorpay-for-identity" SDK.
> **Version:** 0.1 (implementation PRD) — **Date:** 2026-04-10
> **Scope:** MVP → production-shaped backend, SDK, and cross-client attestation reuse.

---

## 1. Executive Summary

Shunya lets Indian consumer apps (gaming, dating, social) verify that a user is
**real, above 18, and of a claimed gender** without ever touching raw Aadhaar PII.

A user uploads their DigiLocker Aadhaar QR screenshot in a Shunya-hosted popup.
Their device locally generates a zero-knowledge proof over the UIDAI-signed
QR data, the proof is verified on **zkVerify**, and an **EAS attestation** is
written on **Base Sepolia** tied to a **Coinbase Smart Account** auto-created
for the user. The B2B client app receives a signed verification result
(attestation UID + minimal claims) via webhook + redirect.

A returning user who has already verified on Shunya (across any client)
**skips proving entirely** — we look up their nullifier and return the
existing attestation. This is the moat.

**Primary constraint:** every piece of infra must be self-hostable. No
managed Supabase, no managed Neon, no Vercel lock-in. Postgres, Redis,
MinIO, and the Node/Bun services all run in our own containers.

---

## 2. Goals & Non-Goals

### 2.1 Goals
- **G1** — Client-side-only proving of Aadhaar claims (age ≥ 18, gender, name hash).
- **G2** — Zero PII at rest. We store nullifiers, attestation UIDs, and wallet addresses — nothing else derivable from Aadhaar.
- **G3** — Cross-client re-use: a verified user gets instant approval on any other Shunya client.
- **G4** — Invisible wallets via Coinbase Smart Accounts + CDP Paymaster gas sponsorship.
- **G5** — Drop-in embeddable SDK: `<script src="…/shunya.js">` + `Shunya.open({apiKey})`, Razorpay-style popup.
- **G6** — Self-hosted, horizontally scalable backend (stateless API nodes + Postgres + Redis + MinIO).
- **G7** — B2B onboarding dashboard for API key management.

### 2.2 Non-Goals (MVP)
- Native iOS/Android SDKs (web + React/React Native wrappers only).
- Liveness, face match, deepfake detection.
- State-level claims (restrict to age + gender + name hash).
- Fiat billing / metering / invoices (flat quota per org in MVP).
- Consumer-facing Shunya wallet app.

---

## 3. System Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              B2B CLIENT APP                               │
│  (Dating app / Gaming site) — embeds <script src="cdn/shunya.js">         │
└──────────────┬─────────────────────────────────▲──────────────────────────┘
               │ Shunya.open({apiKey, userRef})  │ webhook + redirect
               ▼                                 │
┌───────────────────────────────────────────────────────────────────────────┐
│                     SHUNYA POPUP (shunya.app/verify)                      │
│   Next.js app — phone OTP → QR upload → WASM proving → status             │
│   - @anon-aadhaar/core (forked) runs in Web Worker                        │
│   - No PII leaves the browser; only proof + publicSignals are POSTed      │
└──────────────┬────────────────────────────────────────────────────────────┘
               │ POST /v1/sessions/{id}/proof   (proof, publicSignals)
               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                   SHUNYA API (Bun + Hono, stateless)                      │
│   - /v1/sessions         (issue verification session)                     │
│   - /v1/sessions/:id/proof  (accept proof, enqueue)                       │
│   - /v1/attestations/:uid   (lookup)                                      │
│   - /v1/clients (dashboard CRUD, API keys)                                │
└──────────┬──────────────┬──────────────────┬─────────────────┬────────────┘
           │              │                  │                 │
           ▼              ▼                  ▼                 ▼
     ┌──────────┐   ┌──────────┐      ┌──────────────┐   ┌────────────┐
     │ Postgres │   │  Redis   │      │  BullMQ      │   │   MinIO    │
     │ (Drizzle)│   │ (cache + │      │  workers     │   │ (session   │
     │          │   │  OTP)    │      │ (zkVerify +  │   │  artefacts)│
     │          │   │          │      │  EAS submit) │   │            │
     └──────────┘   └──────────┘      └──────┬───────┘   └────────────┘
                                             │
                          ┌──────────────────┼───────────────────┐
                          ▼                  ▼                   ▼
                   ┌─────────────┐   ┌──────────────┐    ┌─────────────┐
                   │  zkVerify   │   │  Base Sepolia│    │  Coinbase   │
                   │  (testnet)  │   │  EAS Resolver│    │  CDP (wallet│
                   │             │   │  + attest    │    │  + paymstr) │
                   └─────────────┘   └──────────────┘    └─────────────┘
```

### 3.1 Trust boundaries
- **Browser** — holds raw Aadhaar XML / QR bytes momentarily; only proof leaves.
- **API nodes** — never see PII. Only proofs, nullifiers, attestation UIDs.
- **Workers** — never see PII. Submit proofs, write to chain, update rows.
- **Client servers (B2B)** — receive webhook with `attestationUid`, `isOver18`, `gender`, `walletAddress`, signed HMAC — nothing else.

---

## 4. The Verification Flow (the critical path)

This is the part that must be correct before anything else is built.

### 4.1 Happy path (first-time user)

```
[1] B2B client backend                 [2] B2B client frontend
    POST /v1/sessions                      Shunya.open({sessionToken})
    (api key + userRef + claims)           -> opens popup at /verify?s=token
        │
        ▼
[3] Shunya popup loads
    - Phone OTP login (Twilio-compatible self-hosted, or MSG91 for India)
    - User uploads DigiLocker Aadhaar QR screenshot (PNG/JPG/PDF)
    - jsQR parses QR -> UIDAI signed byte array
        │
        ▼
[4] Client-side proving (Web Worker)
    - @anon-aadhaar/core (forked) takes QR bytes
    - Runs Groth16 / Halo2 circuit asserting:
        (a) RSA-SHA256 signature == UIDAI public key
        (b) DOB implies age >= 18 at current date
        (c) Reveals: gender bit, name-hash, nullifier = H(UID || shunya-salt)
    - Outputs: { proof, publicSignals, nullifier }
        │
        ▼
[5] POST /v1/sessions/:id/proof  { proof, publicSignals, nullifier }
    - API does NOT verify proof inline (too slow) — writes to queue, returns 202
        │
        ▼
[6] Worker: verify on zkVerify
    - Submits proof to zkVerify testnet RPC
    - Polls until included; receives AttestationReceipt (leaf + Merkle path)
        │
        ▼
[7] Worker: resolve wallet
    - If user has no Smart Account yet (keyed by nullifier), call CDP API
      to create one. Store smart_account_address against nullifier.
        │
        ▼
[8] Worker: submit EAS attestation on Base Sepolia
    - Calls ShunyaResolver.attest(receipt, publicSignals, smartAccount)
    - Resolver verifies zkVerify Merkle proof ON-CHAIN before allowing
      EAS.attest() to write: { subject: smartAccount, isOver18: true,
      gender, nameHash, nullifier, schemaUid }
    - Paymaster pays gas (sponsored via CDP).
        │
        ▼
[9] Worker updates DB: verification.status = "verified",
    attestation_uid = 0x..., tx_hash = 0x..., wallet = 0x...
        │
        ▼
[10] Webhook fires to B2B client backend (HMAC-signed):
     { sessionId, userRef, status: "verified",
       attestationUid, walletAddress, claims: { isOver18, gender } }
        │
        ▼
[11] Popup redirects back to client's returnUrl with ?session=...&status=verified
```

### 4.2 Returning-user path (the moat)

Steps [1]–[3] identical. After QR parse, the browser computes
`nullifier = H(UID || shunya-salt)` **without** running the full circuit
(cheap, <100ms) and POSTs it to `/v1/nullifiers/check`.

- If nullifier exists AND existing attestation is still valid (age claim
  remains true — re-check DOB on server, which we don't have… so instead
  cache `isOver18=true` forever; re-check only if schema/salt rotates):
  - Skip proving entirely.
  - Worker writes a **new attestation** referencing the existing nullifier,
    tied to the new session's B2B client (so each client gets its own
    attestation pointing at the same wallet + claims).
  - Webhook fires in <3 seconds.

- Else: fall back to full flow.

**Why we write a fresh attestation per client** — it preserves per-client
auditability and lets us meter usage without B2B clients having to trust
each other's attestations. The wallet address and claims are reused;
only the attestation row is new.

### 4.3 What the B2B client actually receives

```json
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

B2B clients verify `X-Shunya-Signature: sha256=...` HMAC header using their
webhook secret.

### 4.4 What Shunya stores vs. discards

| Data | Stored? | Where |
|---|---|---|
| Raw Aadhaar QR bytes / XML | ❌ | Browser memory only; cleared after proving |
| Name, DOB, address | ❌ | Never sent to server |
| Nullifier `H(UID‖salt)` | ✅ | Postgres `verified_users.nullifier` (unique idx) |
| Name hash | ✅ | Postgres (opaque, used for dedupe hint only) |
| Gender bit, isOver18 flag | ✅ | Postgres |
| Smart account address | ✅ | Postgres |
| zkVerify receipt | ✅ | Postgres (for audit) |
| EAS attestation UID + tx hash | ✅ | Postgres |
| Phone number | ⚠️ hashed | Only for OTP rate-limiting, stored as bcrypt hash |

---

## 5. Data Model (Postgres, Drizzle ORM)

```sql
-- B2B tenants
organizations       (id, name, created_at)
users               (id, org_id, email, password_hash, role, created_at)  -- dashboard users
api_keys            (id, org_id, key_prefix, key_hash, scopes, last_used_at, revoked_at)
webhook_endpoints   (id, org_id, url, secret, active)

-- Verification sessions (ephemeral)
sessions            (id, org_id, user_ref, required_claims jsonb,
                     return_url, status, nullifier_id NULL, attestation_id NULL,
                     created_at, completed_at, expires_at)

-- The moat: one row per real human who ever verified with Shunya
verified_users      (id, nullifier UNIQUE, smart_account_address UNIQUE,
                     name_hash, gender, is_over_18, first_verified_at)

-- One row per (verified_user × org) — lets each B2B client have its own
-- on-chain attestation pointing at the same human/wallet
attestations        (id, verified_user_id, org_id, session_id,
                     attestation_uid, tx_hash, zkverify_receipt jsonb,
                     chain, created_at)

-- Webhook delivery log (at-least-once, retry with backoff)
webhook_deliveries  (id, endpoint_id, session_id, payload jsonb,
                     status, attempt, next_retry_at, response_code)
```

Indexes: `verified_users.nullifier`, `sessions.org_id, status`, `attestations.org_id, created_at`.

---

## 6. API Surface (public, used by B2B)

All requests authenticated with `Authorization: Bearer sk_live_...`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/sessions` | Create verification session → returns `{sessionId, sessionToken, popupUrl}` |
| GET  | `/v1/sessions/:id` | Poll status (fallback if no webhook) |
| GET  | `/v1/attestations/:uid` | Fetch attestation details |
| POST | `/v1/webhooks/test` | Send a test payload |

Internal (popup → API, signed with session token):

| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/sessions/:id/otp/request` | Phone OTP |
| POST | `/internal/sessions/:id/otp/verify` | OTP check |
| POST | `/internal/sessions/:id/nullifier/check` | Fast-path returning-user lookup |
| POST | `/internal/sessions/:id/proof` | Submit ZK proof, enqueue verification |

Dashboard (cookie session):

| Method | Path | Purpose |
|---|---|---|
| POST | `/dash/login` | Email+password + OTP |
| CRUD | `/dash/org/api-keys` | Key management |
| CRUD | `/dash/org/webhooks` | Webhook endpoints |
| GET  | `/dash/org/sessions` | Recent sessions log |

---

## 7. SDK Design

### 7.1 Web (drop-in)
```html
<script src="https://cdn.shunya.app/v1/shunya.js"></script>
<script>
  const shunya = Shunya.init({ publishableKey: "pk_live_..." });
  document.getElementById("verify-btn").onclick = async () => {
    const { sessionId, sessionToken } = await fetch("/my-backend/shunya/session", { method: "POST" })
      .then(r => r.json());
    shunya.open({
      sessionToken,
      onSuccess: ({ attestationUid, walletAddress, claims }) => { /* ... */ },
      onError: (err) => { /* ... */ },
      onClose: () => {}
    });
  };
</script>
```

- `shunya.js` is a ~10 KB loader that mounts an iframe pointing at
  `https://verify.shunya.app/?s={sessionToken}`.
- `postMessage` bridge for events.
- Publishable key (`pk_...`) is safe to ship to browsers; secret key (`sk_...`)
  is only used by the B2B backend to mint sessions.

### 7.2 React wrapper
```tsx
import { ShunyaProvider, useShunya } from "@shunya/react";
const { open, status } = useShunya();
```
Thin wrapper over the vanilla SDK.

### 7.3 Server SDK (Node / Bun)
```ts
import { Shunya } from "@shunya/node";
const shunya = new Shunya(process.env.SHUNYA_SECRET);
const session = await shunya.sessions.create({
  userRef: "user_42",
  requiredClaims: { isOver18: true, gender: "any" },
  returnUrl: "https://client.app/verified",
  webhookUrl: "https://client.app/hooks/shunya"
});
// pass session.sessionToken to frontend
```

---

## 8. Tech Stack (self-hosted)

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun** | Fast, first-class TS, Hono integrates cleanly |
| HTTP framework | **Hono** | Tiny, edge-friendly, good DX |
| ORM | **Drizzle** | Type-safe, introspectable, works on Bun |
| Database | **NeonDB** (managed, now) → **self-hosted Supabase** (later) | Neon for speed-to-MVP and branching dev DBs; migrate to self-hosted Supabase once we need full control. Drizzle schema makes the migration mechanical. |
| Cache / rate limit | **Redis 7** | OTP store, session token cache, BullMQ backend |
| Queue | **BullMQ** | Delayed retries for zkVerify + on-chain submit |
| Object storage | **MinIO** | S3-compatible, self-hosted, for audit blobs |
| Popup app | **Next.js 14** (App Router) | Run anon-aadhaar WASM in web workers |
| ZK circuits | **Fork of @anon-aadhaar/circuits** | Modified to reveal only {isOver18, gender, nameHash, nullifier} |
| Verification layer | **zkVerify testnet** | Per PDF mandate |
| Settlement | **Base Sepolia + EAS** | Per PDF mandate |
| Wallets | **Coinbase CDP Smart Accounts** | Invisible UX |
| Gas | **Coinbase CDP Paymaster** | Sponsored gas |
| Dashboard auth | **Lucia Auth** (self-hosted) | No third-party auth provider |
| Deployment | Docker Compose (dev) → k3s / Nomad (prod) | Self-hostable |
| Observability | **Grafana + Loki + Prometheus** | All self-hosted |

### 8.1 Hosting philosophy
Everything *except* the database is self-hosted from day one (Redis, MinIO,
workers, popup, dashboard, API). The database is on **NeonDB** short-term
because serverless branches make dev/preview/prod isolation trivial, and
migration to **self-hosted Supabase** (Postgres under the hood) is a
connection-string swap since we use Drizzle. No other managed dependency —
no Clerk, no Vercel, no Supabase-hosted, no managed Redis.

---

## 9. Phased Build Plan

### Phase 0 — Repo & Infra Skeleton (Day 0)
**Goal:** a working monorepo with empty services and local docker stack.

**Humans (manual):**
- [ ] Create GitHub repo `shunya-protocol` (or reuse `shunya-protocol` that was deleted earlier).
- [ ] Decide monorepo tool — recommend **pnpm workspaces** (simple, Bun-compatible).
- [ ] Register domain (`shunya.app` or chosen) and point `verify.` subdomain.
- [ ] Create Coinbase CDP project, generate API key, enable Paymaster on Base Sepolia.
- [ ] Fund a deployer EOA on Base Sepolia from faucet.
- [ ] Get zkVerify testnet account + RPC URL.
- [ ] Pick an OTP provider (MSG91 for India prod, or Twilio for dev) and get API key.
- [ ] Create `.env.example` — do not commit secrets.

**Agent:**
- [ ] Scaffold monorepo structure:
  ```
  shunya-protocol/
    apps/
      api/         # Bun + Hono
      popup/       # Next.js popup (verify.shunya.app)
      dashboard/   # Next.js dashboard (dash.shunya.app)
    packages/
      db/          # Drizzle schema + migrations
      sdk-js/      # browser loader
      sdk-react/   # React wrapper
      sdk-node/    # server SDK
      circuits/    # fork of anon-aadhaar/circuits
      contracts/   # EAS resolver (Foundry)
      shared/      # types, HMAC, nullifier helpers
    infra/
      docker-compose.yml   # postgres, redis, minio, grafana
      k8s/                 # stub manifests
  ```
- [ ] Write `docker-compose.yml` bringing up Redis and MinIO (DB is Neon, not in compose).
- [ ] Initial Drizzle schema from §5 + first migration.
- [ ] CI pipeline stub (lint only — no tests per instructions).

---

### Phase 1 — Bare Demo (Days 1–3)
**Goal:** replicate the PDF's minimum deliverable. One user, one flow,
no DB, no multi-tenancy. Used for grant pitch.

**Humans (manual):**
- [ ] Clone `anon-aadhaar` into `packages/circuits` as git submodule or fork.
- [ ] Run `yarn dev-setup` once to generate test zkeys locally.
- [ ] Deploy a bare EAS schema on Base Sepolia via https://base-sepolia.easscan.org/ and record the schemaUid in `.env`.

**Agent:**
- [ ] **Circuits:** modify anon-aadhaar circuit to expose outputs `{ageAbove18, genderBit, nameHash, nullifier}`. Remove state/pincode constraints.
- [ ] **Contracts (`packages/contracts`):**
  - Write `ShunyaResolver.sol` — inherits `SchemaResolver`, accepts a zkVerify Merkle proof + public signals, verifies on-chain via zkVerify's verifier contract, allows the attestation only if valid.
  - Foundry script `Deploy.s.sol` → deploy to Base Sepolia.
- [ ] **Popup app (`apps/popup`):**
  - Single page `/demo` with 3 states: upload → proving → verified.
  - File input accepts DigiLocker PDF or image, uses `jsQR` (for image) or `pdfjs` (for PDF) to read the QR.
  - Web Worker runs forked `@anon-aadhaar/core` to produce proof.
  - Directly calls a local `/api/verify` route (monolith for Phase 1) that:
    1. POSTs proof to zkVerify
    2. Polls for receipt
    3. Calls `ShunyaResolver.attest(...)` via ethers + a hardcoded deployer key
    4. Returns attestation UID to browser
  - Success screen shows tx link on BaseScan.
- [ ] **No DB yet** — Phase 1 is stateless and single-user.

**Exit criteria:** on a laptop, uploading a DigiLocker QR → within <30s shows "Verified on Base" with a live tx link. Matches PDF MVP exactly.

---

### Phase 2 — Backend, DB, and Cross-Client Reuse (Days 4–8)
**Goal:** make the flow multi-tenant and persistent. No SDK yet.

**Humans (manual):**
- [ ] Generate a strong `SHUNYA_NULLIFIER_SALT` and commit only to secrets store, never git.
- [ ] Create NeonDB project, make `dev`/`preview`/`prod` branches, paste conn strings into each env.

**Agent:**
- [ ] **`apps/api`:** Bun + Hono service implementing the endpoints in §6.
  - `POST /v1/sessions` — mints a session + short-lived `sessionToken` (JWT, 15min).
  - `POST /internal/sessions/:id/nullifier/check` — returning-user fast path.
  - `POST /internal/sessions/:id/proof` — writes row, enqueues BullMQ job, returns 202.
  - `GET /v1/sessions/:id` — status poll.
- [ ] **Worker (`apps/api/workers`):**
  - `verifyProofJob` — zkVerify submit + poll → EAS attest → update DB → fire webhook.
  - Exponential backoff on failure; retries capped at 5.
- [ ] **`packages/db`:** finalize schema from §5, add indexes.
- [ ] **HMAC webhook signer** in `packages/shared`.
- [ ] **Popup app:** replace Phase-1 direct-to-chain path with `/internal/sessions/:id/proof`. Show "Verifying…" while polling status.
- [ ] **Returning-user path:** before starting proving, compute nullifier in-browser from QR bytes using `SubtleCrypto.digest`, POST `/nullifier/check`, if hit → skip proving → server worker writes a fresh attestation reusing the stored wallet.

**Exit criteria:** two different "B2B clients" (two API keys) can each create a session for the same user; the second session completes in <3s without proving.

---

### Phase 3 — Dashboard + API Key Management (Days 9–11)
**Goal:** B2B signup → get API key → manage webhook → view logs.

**Humans (manual):**
- [ ] Choose an email provider for dashboard (self-hosted Postal, or SMTP via a cheap SES-like).
- [ ] First admin user created via seed script.

**Agent:**
- [ ] **`apps/dashboard`:** Next.js dashboard, Lucia Auth.
  - Signup → organization created.
  - API keys: generate, copy once, hash-at-rest, show prefix + last-used.
  - Webhook endpoints CRUD + "send test event".
  - Sessions table with filters.
  - "Integration snippet" page with copy-paste code.
- [ ] **Dashboard API** under `/dash/*` on the main API process with cookie auth.

**Exit criteria:** a fresh user can sign up, get a key, and create a session via `curl` in under 2 minutes.

---

### Phase 4 — Embeddable SDK (Days 12–14)
**Goal:** `<script>` drop-in works on any B2B site.

**Humans (manual):**
- [ ] Pick CDN host (Cloudflare R2 + a custom domain, or self-hosted MinIO + caddy).
- [ ] Configure CORS on `verify.shunya.app` to allow iframe embedding from anywhere.

**Agent:**
- [ ] **`packages/sdk-js`:** vanilla JS loader (~10KB). Publishes an iframe + handles `postMessage` channel. Exposes `Shunya.init`, `open`, events.
- [ ] **`packages/sdk-react`:** thin hook wrapper.
- [ ] **`packages/sdk-node`:** server SDK, matches §7.3.
- [ ] **Popup app** → treat `sessionToken` from querystring as source of truth, validate against API, show branded UI.
- [ ] Build + version artifacts, publish to `/v1/shunya.js` on CDN.

**Exit criteria:** a static HTML file on any origin, with 8 lines of code, opens the Shunya popup and receives `onSuccess` with the attestation.

---

### Phase 5 — Invisible Wallets + Gas Sponsorship (Days 15–17)
**Goal:** every verified user has a Coinbase Smart Account, created silently, with gas paid for.

**Humans (manual):**
- [ ] In Coinbase CDP console, enable Smart Accounts and Paymaster for Base Sepolia, set spending caps.
- [ ] Whitelist `ShunyaResolver.attest()` as a sponsored method in the paymaster policy.

**Agent:**
- [ ] **Wallet module (`apps/api/src/wallets`):**
  - On first proof of a nullifier, call CDP `createAccount` to mint a smart account.
  - Persist `smart_account_address` in `verified_users`.
- [ ] **On-chain submit path:** instead of sending tx from our deployer EOA, send a user operation from the user's smart account, sponsored by the paymaster. Resolver sees the smart account as `msg.sender`.
- [ ] Dashboard: show sponsored-gas usage per org.

**Exit criteria:** user never sees a wallet; attestation on BaseScan shows the smart account as subject and paymaster as gas payer.

---

### Phase 6 — Webhooks, Retries, Observability (Days 18–20)
**Goal:** production readiness shape.

**Humans (manual):**
- [ ] Provision Grafana/Loki/Prometheus docker stack (or use existing infra).
- [ ] Create Grafana dashboards for: sessions/min, proof latency p50/p95, zkVerify failures, chain failures.

**Agent:**
- [ ] Webhook delivery worker with exponential backoff, max 24h, HMAC signing.
- [ ] `/v1/webhooks/test` endpoint.
- [ ] Rate limiting on public API (Redis token bucket, per API key).
- [ ] Structured JSON logs → Loki.
- [ ] Prometheus metrics endpoint on `/metrics`.
- [ ] Dockerfiles + multi-service compose for one-command local boot.

**Exit criteria:** you can kill zkVerify, restart it 10 min later, and all stuck sessions eventually succeed without manual intervention.

---

## 10. Resolved Decisions

1. **Nullifier salt is fixed forever.** `SHUNYA_NULLIFIER_SALT` is generated once, stored in the secrets vault, and **never rotated**. Rotating it would invalidate every returning user. Document this loudly in the runbook.
2. **Hash = Poseidon.** All on-chain and in-circuit hashing (`nullifier`, `nameHash`) uses Poseidon. It's circuit-cheap and keeps proof times low. No keccak/SHA inside the circuit.
3. **zkVerify uptime is out of scope for MVP.** We do not build fallbacks for zkVerify outages. If it's down, sessions stay in `pending` and retry. Revisit only if this bites us in production.
4. **Phone-number reuse across Aadhaars is acceptable.** Identity is keyed by nullifier, not phone. One phone with two family Aadhaars simply produces two verified identities; that's fine.
5. **Database: NeonDB now, self-hosted Supabase later.** Short-term we use Neon for velocity and dev-branching. Long-term we migrate to self-hosted Supabase. Drizzle schema makes this a connection-string swap.

---

## 11. Task Split Summary

| Category | Humans do | Agents do |
|---|---|---|
| **Infra / accounts** | Domain, GitHub repo, Coinbase CDP account, zkVerify account, OTP provider, faucet funding, SMTP, CDN, EAS schema registration | Docker compose, Drizzle migrations, k8s stubs |
| **Secrets** | Generate + store salts, API keys, deployer keys in vault | Reference them via `env` only |
| **Code** | — | All API, popup, dashboard, SDK, circuits, contracts, workers |
| **Deploy** | Initial production host provisioning | Dockerfiles, deployment scripts |
| **Verification** | Manual smoke test with real DigiLocker QR on phone | Internal logging + Grafana dashboards |

---

## 12. Success Metrics (MVP exit)

- ✅ End-to-end proof → attestation in < 15s on laptop, < 30s on mid-range Android.
- ✅ Returning-user path < 3s (no proof generation).
- ✅ Gas cost per attestation < $0.05 (target from PDF).
- ✅ Zero PII columns in DB (schema review).
- ✅ One-command local boot via `docker compose up`.
- ✅ B2B client can integrate in < 15 min using dashboard snippet.

---

*End of PRD v0.1 — iterate against this as Phase 0 kicks off.*
