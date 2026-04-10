# 11 — Decisions Log (ADRs)

Lightweight ADR format. Each entry: **Decision / Context / Consequences**.
Add new entries at the bottom. Do not edit old ones — supersede them.

---

## ADR-001: Fork `@anon-aadhaar/core`, don't write from scratch

**Date:** 2026-04-10
**Status:** Accepted

**Context.** We need a Circom circuit that verifies UIDAI's RSA-SHA256
signature over Aadhaar QR bytes. PSE already built this in the
`anon-aadhaar` repo. Writing our own would take weeks and be less audited.

**Decision.** Fork `@anon-aadhaar/circuits` and make minimal diffs:
- Restrict public outputs to `{isOver18, genderBit, nameHash, uidCommitment}`.
- Compute `isOver18` inside the circuit (using `currentDate` public input).
- Add a Poseidon commitment output for UID.

**Consequences.** Smaller diff → faster review. We inherit PSE's audit.
Upstream updates can be pulled periodically.

---

## ADR-002: Poseidon for all hashing, not keccak/SHA

**Date:** 2026-04-10
**Status:** Accepted

**Context.** Circuit cost is dominated by hash function choice. Poseidon
is ~100× cheaper than SHA-256 inside a SNARK.

**Decision.** All in-circuit and system-wide business hashes use Poseidon:
- `uidCommitment = poseidon(UID)` (in-circuit)
- `nullifier = poseidon(uidCommitment, SALT)` (server-side)
- `nameHash = poseidon(name)` (in-circuit)

**Consequences.** Proof time stays under 10s on mid-tier Android. Must
use the `circomlibjs` Poseidon impl server-side to match.

---

## ADR-003: Nullifier salt lives server-side, never rotates

**Date:** 2026-04-10
**Status:** Accepted

**Context.** We need a deterministic per-human key (nullifier) that:
1. Outside attackers cannot reverse.
2. Cannot be pre-computed offline across all possible Aadhaar UIDs.

**Decision.** Compute `poseidon(UID)` in the circuit (client-side), then
hash again with a server-held `SHUNYA_NULLIFIER_SALT` on the backend.
The salt is 32 random bytes, stored in vault, **never rotated**.

**Consequences.**
- (+) External brute force of Aadhaar UID space is infeasible.
- (+) We can still recognise returning users server-side.
- (−) Rotating the salt invalidates every returning user forever — so we
  treat rotation as a P0 incident, not a routine operation.
- (−) We become a high-value target for attackers. Vault hygiene is critical.

---

## ADR-004: EAS on Base Sepolia, via a custom resolver

**Date:** 2026-04-10
**Status:** Accepted

**Context.** We need on-chain attestations that anyone can verify without
trusting Shunya. EAS is the canonical Ethereum primitive for this.

**Decision.** Deploy a `ShunyaResolver` contract on Base Sepolia that:
1. Inherits `SchemaResolver`.
2. Verifies a zkVerify Merkle receipt on-chain before permitting any
   `EAS.attest()` for our schema.
3. Rejects direct EAS attestations to our schema (only self-calls pass).

**Consequences.**
- (+) Cheap per-tx.
- (+) Third parties can verify attestations with standard EAS tooling.
- (−) We're coupled to EAS's contract ABI changes. Low risk.

---

## ADR-005: zkVerify as the verification middleware

**Date:** 2026-04-10
**Status:** Accepted (per PDF mandate; out of scope to revisit for MVP)

**Context.** Directly verifying Groth16 on Base costs ~300k gas.
zkVerify amortises verification across many proofs in an aggregation.

**Decision.** Route all proofs through zkVerify testnet; the resolver
only accepts attestations backed by a valid zkVerify Merkle receipt.

**Consequences.**
- (+) Sub-cent verification cost.
- (−) Extra network hop and dependency. If zkVerify goes down, we queue.
  No fallback in MVP (per user instruction).

---

## ADR-006: Coinbase CDP Smart Accounts for invisible wallets

**Date:** 2026-04-10
**Status:** Accepted

**Context.** Users are non-web3. They must never see a wallet, seed
phrase, or gas prompt. Privy is the reference UX but we want native
Base integration for paymaster.

**Decision.** Use Coinbase CDP to:
- Create deterministic 4337 smart accounts with `salt = nullifier`.
- Sponsor all gas via the CDP Paymaster (policy locked to
  `ShunyaResolver.attest()`).
- Custody owner keys in CDP's KMS (we don't hold raw key bytes).

**Consequences.**
- (+) True zero-friction UX.
- (+) Deterministic addresses — DB-loss recoverable.
- (−) Vendor dependency on Coinbase. We accept this because Base is our
  only target chain anyway.

---

## ADR-007: NeonDB short-term, self-hosted Supabase long-term

**Date:** 2026-04-10
**Status:** Accepted

**Context.** User constraint is "self-hostable or self-reliant". Initially
we chose self-hosted Postgres. User has since pivoted: use Neon now,
self-hosted Supabase later.

**Decision.** Use NeonDB for MVP (branching is a productivity win).
Plan migration to self-hosted Supabase post-MVP. Use Drizzle so the
schema stays portable — no Neon-specific or Supabase-specific features.

**Consequences.**
- (+) Fast MVP velocity.
- (+) Dev/preview/prod branch isolation comes for free.
- (−) Managed dep we'll need to migrate off. Mitigated by Drizzle.
- (−) Slight compliance ambiguity: NeonDB hosts our data. But we store
  zero PII, so the blast radius is claims + wallet addresses, not PII.

---

## ADR-008: Per-org attestation rows, not one global attestation

**Date:** 2026-04-10
**Status:** Accepted

**Context.** When a user verifies once and a second B2B client later
wants to verify the same user, do we:
(A) Return the existing attestation UID to client B, or
(B) Write a fresh attestation for client B pointing at the same wallet?

**Decision.** Option B. One `verified_users` row per human, one
`attestations` row per (human × org) pair.

**Consequences.**
- (+) Each B2B client has its own auditable on-chain receipt.
- (+) We can meter and bill per org cleanly.
- (+) Revoking one org's access doesn't affect the others.
- (−) Slightly more on-chain writes (each returning-user hit still costs
  ~1 attestation tx, though no proving).

---

## ADR-009: Bun + Hono + Drizzle stack

**Date:** 2026-04-10
**Status:** Accepted

**Context.** Need a fast, TS-native backend with a low dep budget.

**Decision.** Bun runtime, Hono framework, Drizzle ORM. pnpm workspaces
for monorepo (Bun workspaces still immature).

**Consequences.**
- (+) Single language end-to-end, fast dev loop, small bundle.
- (−) Smaller ecosystem than Node. We accept this; our dep list is short.

---

## ADR-010: BullMQ for background jobs, not Temporal

**Date:** 2026-04-10
**Status:** Accepted

**Context.** The verification pipeline (zkVerify → CDP → Base → webhook)
is a multi-step async flow. We need retry, idempotency, backoff.

**Decision.** BullMQ on Redis. Idempotency via `session_id` + a `stage`
column on `sessions`. No Temporal / Inngest / Trigger.dev.

**Consequences.**
- (+) No new infra beyond Redis (already present).
- (+) Simple mental model.
- (−) Less powerful than Temporal (no workflow versioning, no signal
  replay). Fine for our needs.

---

## ADR-011: No end-user key custody in MVP

**Date:** 2026-04-10
**Status:** Accepted

**Context.** Self-custody would require users to manage keys — we'd lose
the "invisible wallet" UX immediately.

**Decision.** Coinbase (via CDP) custodies the owner key for each smart
account. Users never see a key. No export feature in MVP.

**Consequences.**
- (+) Matches Privy's proven UX model.
- (−) We (and Coinbase) are a custodian. Wallets hold no assets, which
  keeps the legal surface small — but the EAS attestations are tied to
  these wallets, so custody = identity. Document this clearly in ToS.

---

## ADR-012: Webhooks as the only success signal, polling as fallback

**Date:** 2026-04-10
**Status:** Accepted

**Context.** B2B clients need to know when a verification completes.

**Decision.** Primary channel: HMAC-signed webhook. Fallback: client
polls `GET /v1/sessions/:id`. SDK's `onSuccess` fires when the popup
receives the "verified" event over `postMessage`; but clients MUST
verify via webhook before trusting.

**Consequences.**
- (+) Server-verified, tamper-proof success signal.
- (−) Clients that skip webhook verification can be tricked by a
  malicious iframe postMessage. Document heavily in SDK README.
