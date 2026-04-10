# 01 — System Architecture

## High-level diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              B2B CLIENT APP                              │
│  (Dating / Gaming / Social) — embeds shunya.js, calls our server SDK     │
└─────┬──────────────────────────────────────────────────▲─────────────────┘
      │ 1. POST /v1/sessions (from their backend, sk_...)│ 7. Webhook (HMAC)
      │ 2. Shunya.open({sessionToken}) (from their page) │
      ▼                                                  │
┌──────────────────────────────────────────────────────────────────────────┐
│                     SHUNYA POPUP  (verify.shunya.app)                    │
│   Next.js 14 — phone OTP → QR upload → WASM proving → success            │
│   Forked @anon-aadhaar/core runs in Web Worker                           │
└─────┬────────────────────────────────────────────────────────────────────┘
      │ 3. /internal/sessions/:id/proof  (proof + publicSignals + nullifier)
      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│              SHUNYA API  (Bun + Hono, stateless, horizontal)             │
│                                                                          │
│  Public:  /v1/sessions, /v1/sessions/:id, /v1/attestations/:uid          │
│  Internal:/internal/sessions/:id/{otp,nullifier,proof}                   │
│  Dash:    /dash/*  (Lucia cookie auth)                                   │
└─────┬─────────────────┬──────────────────┬──────────────────┬────────────┘
      │                 │                  │                  │
      ▼                 ▼                  ▼                  ▼
┌──────────┐     ┌──────────┐      ┌──────────────┐    ┌────────────┐
│  NeonDB  │     │  Redis   │      │   BullMQ     │    │   MinIO    │
│ (Drizzle)│     │ (cache + │      │  Workers     │    │ (session   │
│          │     │  OTP)    │      │              │    │  artefacts)│
└──────────┘     └──────────┘      └──────┬───────┘    └────────────┘
                                          │
                        ┌─────────────────┼─────────────────┐
                        ▼                 ▼                 ▼
                 ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
                 │  zkVerify   │  │  Base Sepolia│  │ Coinbase CDP │
                 │  (testnet)  │  │  EAS Resolver│  │ (wallet +    │
                 │             │  │  + attest()  │  │  paymaster)  │
                 └─────────────┘  └──────────────┘  └──────────────┘
```

## Component responsibilities

### 1. B2B client app (not ours)
- **Frontend:** embeds `shunya.js`, calls `Shunya.open({sessionToken})`.
- **Backend:** calls our `/v1/sessions` with `sk_live_...` to mint a session.
  Receives our webhook later and updates its own user row.

### 2. Shunya popup (`apps/popup`, Next.js, `verify.shunya.app`)
- The only Shunya surface that runs JS *on the user's device with their
  Aadhaar bytes in memory*.
- Handles: phone OTP, QR upload, QR parsing, **client-side proof generation
  in a Web Worker**, progress UI, redirect back to client.
- **Hard rule:** the raw QR bytes never leave this iframe. Only
  `{proof, publicSignals, nullifier}` is POSTed out.
- Runs the forked `@anon-aadhaar/core` with a pre-downloaded zkey cached in
  IndexedDB after first use (so repeat visits feel instant).

### 3. Shunya API (`apps/api`, Bun + Hono)
- **Stateless.** Scale horizontally by running N copies behind a load
  balancer. State lives in NeonDB + Redis + MinIO.
- Three route groups:
  - **Public `/v1/*`** — authenticated with B2B secret keys (`sk_...`).
  - **Internal `/internal/*`** — authenticated with a short-lived session
    JWT that the popup carries.
  - **Dashboard `/dash/*`** — cookie-auth via Lucia for B2B humans logging
    in to manage keys / webhooks.
- API never verifies ZK proofs inline. It writes the proof to the DB,
  enqueues a BullMQ job, returns 202.

### 4. Workers (BullMQ, same process as API or split later)
- `verifyProofJob`: submit to zkVerify → poll receipt → (create smart
  account if needed) → submit `ShunyaResolver.attest()` on Base Sepolia
  → update DB → enqueue webhook delivery.
- `deliverWebhookJob`: HMAC-sign, POST to the B2B webhook URL, retry with
  exponential backoff up to 24h.
- Workers are idempotent and restartable. If a worker dies mid-job,
  BullMQ re-queues and a retry picks up where the last one left off
  (tracked via a `stage` column on the session row).

### 5. NeonDB (managed Postgres, short-term)
- Schema lives in `packages/db` via Drizzle.
- Branches: `dev`, `preview`, `prod` — matches Neon's branching model.
- Migration path: move to self-hosted Supabase later; Drizzle's
  migration output is portable (both speak vanilla Postgres).

### 6. Redis
- OTP storage (ephemeral, TTL 5 min).
- Rate-limit token buckets per API key.
- BullMQ job queues.
- Session-token → session-id lookup cache.

### 7. MinIO
- S3-compatible self-hosted blob store.
- Stores: zkVerify receipts (JSON), audit snapshots per session
  (proof bytes, publicSignals), dashboard-uploaded client logos.

### 8. zkVerify (external, testnet)
- Takes the Groth16 proof, verifies it cheaply, returns an Attestation
  Receipt (Merkle leaf + sibling path).
- We treat it as a dumb RPC. No fallback for MVP.

### 9. Base Sepolia + EAS
- **`ShunyaResolver`** contract: inherits OpenZeppelin's `SchemaResolver`,
  verifies the zkVerify Merkle proof *on-chain*, then permits `attest()`.
- **EAS schema** (one schema, one UID): `bytes32 nullifier, bool isOver18,
  uint8 gender, bytes32 nameHash`.
- Subject of the attestation is the user's Coinbase Smart Account.

### 10. Coinbase CDP
- **Smart Accounts** — we mint a 4337 smart account for each new verified
  user, keyed internally by nullifier. The user never sees it.
- **Paymaster** — sponsors gas for `ShunyaResolver.attest()` calls only
  (tight policy). We pay Coinbase; user pays nothing; B2B client pays
  nothing at the gas level.

## Trust boundaries (who sees what)

| Actor | Sees raw Aadhaar? | Sees PII? | Sees proof? | Sees wallet? | Sees claims? |
|---|---|---|---|---|---|
| User's browser | ✅ momentarily | ✅ | ✅ | ✅ | ✅ |
| Shunya API nodes | ❌ | ❌ | ✅ | ✅ | ✅ |
| Shunya workers | ❌ | ❌ | ✅ | ✅ | ✅ |
| NeonDB | ❌ | ❌ | only hashed artefacts | ✅ | ✅ |
| B2B client backend | ❌ | ❌ | ❌ | ✅ | ✅ |
| Base Sepolia (public) | ❌ | ❌ | ❌ (only zkVerify receipt) | ✅ | ✅ |

## Deployment topology

Dev:
- `docker compose up` brings Redis + MinIO + API + popup + dashboard.
- NeonDB is accessed over the internet (dev branch).

Prod:
- API, popup, dashboard: N containers each behind an L7 load balancer.
- Workers: M containers in a worker pool.
- Redis: 1 primary + 1 replica (later Redis Cluster).
- MinIO: 4-node cluster with erasure coding.
- Observability: Grafana + Loki + Prometheus stack, separate compose/k8s namespace.
- NeonDB: prod branch with compute autoscaling.

## Data flow summary

```
Browser (popup)
 ├─ 1. OTP to API (/internal/otp)
 ├─ 2. QR parsed in memory (jsQR / pdf.js)
 ├─ 3. Nullifier computed & checked (/internal/nullifier/check) — returning-user fast path
 ├─ 4. Proof generated in Web Worker (if not fast path)
 └─ 5. POST proof to API → 202

API
 ├─ 6. Row in `verification_jobs`, push to BullMQ
 └─ 7. Return 202 immediately

Worker
 ├─ 8. zkVerify.submit(proof) → poll → receipt
 ├─ 9. CDP.createSmartAccount(nullifier) if new
 ├─ 10. ShunyaResolver.attest(receipt, publicSignals) via paymaster
 ├─ 11. Update DB, upsert `verified_users`, insert `attestations`
 └─ 12. Enqueue webhook delivery

Webhook worker
 └─ 13. POST signed payload to B2B client
```
