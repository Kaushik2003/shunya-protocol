# Shunya Protocol — Implementation Plans Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Shunya Protocol MVP — zero-knowledge Aadhaar verification delivered as a B2B SDK.

**Architecture:** Five sequential phases, each independently shippable. Phase 0 creates the monorepo skeleton; Phase 1 produces a working single-user demo; Phase 2 adds multi-tenant API + async workers; Phase 3 adds the B2B dashboard; Phase 4 ships the embeddable SDKs.

**Tech Stack:** Bun, Hono, Drizzle, NeonDB, Redis, BullMQ, MinIO, Next.js 14, Circom, Foundry, Solidity, EAS, zkVerify, Coinbase CDP, pnpm workspaces.

---

## Phase Plans

| Phase | File | Goal | Dependency |
|-------|------|------|------------|
| 0 | [phase-0-monorepo.md](./phase-0-monorepo.md) | Repo scaffold, Docker stack, Drizzle schema | None |
| 1 | [phase-1-circuits-demo.md](./phase-1-circuits-demo.md) | ZK circuit fork, ShunyaResolver contract, stateless demo popup | Phase 0 complete |
| 2 | [phase-2-api-workers.md](./phase-2-api-workers.md) | Bun/Hono API, BullMQ workers, full multi-tenant pipeline | Phase 0+1 complete |
| 3 | [phase-3-dashboard.md](./phase-3-dashboard.md) | Next.js dashboard, Lucia auth, API key + webhook management | Phase 2 complete |
| 4 | [phase-4-sdks.md](./phase-4-sdks.md) | @shunya/js browser loader, @shunya/react, @shunya/node | Phase 2 complete |

---

## Human Pre-work (do before Phase 0)

- [ ] Create GitHub repo `shunya-protocol` and push initial commit
- [ ] Install tools: `bun >= 1.1`, `pnpm >= 9.0`, `node >= 20`, Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- [ ] Install `circom` v2.1.9: `cargo install circom` (requires Rust)
- [ ] Create NeonDB project → create `dev` and `prod` branches → save both connection strings
- [ ] Create Coinbase CDP project → generate API key → enable Smart Accounts + Paymaster on Base Sepolia
- [ ] Fund deployer EOA on Base Sepolia faucet: https://faucet.quicknode.com/base/sepolia
- [ ] Get zkVerify testnet account + RPC URL from https://zkverify.io
- [ ] Choose OTP provider (MSG91 recommended for India, or Twilio for dev) → get API key
- [ ] Generate nullifier salt **once, permanently**: `openssl rand -hex 32` → store in password manager/vault
- [ ] Register EAS schema on Base Sepolia: https://base-sepolia.easscan.org → use schema string `bytes32 nullifier,bool isOver18,uint8 gender,bytes32 nameHash` → save the resulting `SHUNYA_SCHEMA_UID`

---

## Monorepo Structure (final shape)

```
shunya-protocol/
  apps/
    api/              # Bun + Hono — stateless API + BullMQ workers
    popup/            # Next.js 14 — verify.shunya.app
    dashboard/        # Next.js 14 — dash.shunya.app
  packages/
    db/               # Drizzle schema + migrations
    shared/           # types, HMAC signer, nullifier helpers, zod schemas
    circuits/         # Forked anon-aadhaar Circom circuits
    contracts/        # ShunyaResolver.sol (Foundry)
    sdk-js/           # Browser loader (~10KB)
    sdk-react/        # React wrapper over sdk-js
    sdk-node/         # Server SDK for B2B backends
  infra/
    docker-compose.yml
    k8s/              # Stub manifests
  anon-aadhaar/       # Upstream repo (already present — read-only reference)
```

---

## Shared Type Contract

These types flow across all phases. Defined in `packages/shared/src/types.ts`.

```
SessionStatus:  'pending' | 'phone_verified' | 'proof_submitted' | 'verified' | 'failed' | 'expired'
WorkerStage:    'queued' | 'zk_verifying' | 'zk_verified' | 'wallet_creating' | 'chain_submitting' | 'complete'
ApiKeyKind:     'publishable' | 'secret'
Chain:          'base-sepolia' | 'base-mainnet'
Gender:         'M' | 'F'
```

---

## Cross-Phase Dependencies

- `packages/shared` — imported by `apps/api`, `apps/popup`, `apps/dashboard`, all SDK packages
- `packages/db` — imported by `apps/api`, `apps/dashboard`
- `packages/circuits/build/` — consumed by `apps/popup` (wasm) and `apps/api` (vkey for worker registration)
- `packages/contracts` — deployed address written to `packages/shared/src/config.ts`
