# 10 — Scalability

MVP targets ~10 sessions/min. Production targets 1000 sessions/min
(≈50M/month). This doc explains how the architecture gets there.

## Where the bottlenecks actually are

Contrary to instinct, the ZK proof is **not** our bottleneck — it runs
on the user's device. Our server-side bottlenecks, in order:

1. **Chain submit latency** (Base Sepolia tx inclusion, ~2s).
2. **zkVerify aggregation latency** (aggregates every few seconds).
3. **Webhook delivery to B2B clients** (depends on them).
4. **NeonDB write throughput** during burst.
5. **Redis job queue throughput** (rarely binds).

API RPS itself is trivial (Bun + Hono handles 50k rps on a small box).

## Scaling strategy per component

### API nodes
- **Horizontal, stateless.** Scale out by adding containers behind an L7
  LB. Target 500 RPS per node comfortably.
- Zero sticky sessions. All state in DB/Redis.
- Health check: `GET /healthz` pings DB + Redis.

### Workers
- **Pool of BullMQ consumers.** Start with 4 workers, scale up on queue
  depth.
- **Shard by job type:**
  - `verify-proof` queue: bottlenecked by zkVerify + chain; 8 concurrent is usually enough.
  - `copy-attestation` queue (returning users): bottlenecked by chain only; can run higher concurrency.
  - `deliver-webhook` queue: network I/O bound, 32 concurrent is fine.
- **Idempotency key = `session_id`.** Safe to retry without double-submits.

### NeonDB
- Compute autoscaling up to 8 vCPU before we need to shard.
- Read replicas for dashboard/analytics queries.
- Beyond that: we migrate to self-hosted Supabase with read replicas and
  eventually partition `attestations` by `(org_id, created_at)`.

### Redis
- Single primary + replica to start.
- BullMQ's backpressure signals saturation early.
- Eventual plan: Redis Cluster, sharded by queue name.

### MinIO
- 4-node cluster with erasure coding.
- Not in the hot path — only stores audit blobs. Scales linearly with disk.

### Popup app
- Stateless Next.js. Horizontal scale. zkey hosted on CDN, not the origin.

### Contracts / chain
- Chain throughput is the hardest ceiling. Base can do ~100 TPS today.
  Per-attestation tx = one slot; ≈8.6M attestations/day theoretical.
- **Batching is the escape valve.** EAS supports multi-attestations in
  a single tx — we can batch N successful proofs per block if we get close.
- Paymaster daily caps need to scale with us; Coinbase has committed to
  sponsor, but we should plan for the day we self-fund.

## Capacity planning math

At 1000 sessions/min:

| Resource | Load | Headroom |
|---|---|---|
| API RPS (peak) | ~50 rps public + 50 rps internal | 10× headroom on a 2-node cluster |
| DB writes | ~2000 writes/min | trivially within Neon free/scale tier |
| zkVerify submissions | 1000/min | within testnet + mainnet specs |
| Base tx/min | 1000 | ~15% of Base's block capacity (tight) |
| Paymaster spend | ~$5/min at $0.05/tx | $7200/day — needs funding plan |
| Webhook deliveries | 1000/min outbound | I/O bound, trivial |

**First real bottleneck:** Base L2 gas. At 1000/min we're using ~15% of
Base mainnet throughput, which will drive fees up. Mitigations:
- Batch attestations.
- Move to a Shunya-specific rollup or app-chain (long-term).

## Caching

| Cache | TTL | Purpose |
|---|---|---|
| `session_token → session_row` | 15 min | Avoid DB hit on every popup request |
| `org → api_key_hash` | 5 min | Avoid DB hit on auth middleware |
| `nullifier → verified_user_id` | 24 h | Fast returning-user path |
| `org → webhook_endpoint` | 1 min | Worker reads on every delivery |

Redis handles all of this. Invalidation is explicit on the mutation paths.

## Load testing (plan, not MVP scope)

- **k6** scripts in `infra/loadtest/`.
- Scenarios:
  1. 100 concurrent new users (worst case — full proving)
  2. 1000 concurrent returning users (fast path)
  3. Sustained 500 rps for 10 min
- Run against the `preview` environment (Neon branch + separate k3s namespace).

## What we're choosing NOT to optimise (yet)

- **Microservices split.** API + workers + dashboard all run in one
  monorepo as separate processes. Splitting into repos adds ops burden
  with no perf win at MVP scale.
- **Event sourcing.** Overkill. We use simple CRUD + outbox for webhooks.
- **Multi-region.** India is our primary market, one region is fine.
  Later: a second region for DR.
- **GraphQL gateway.** REST is enough.
- **WebAssembly on the server.** Unnecessary, proving is client-side.

## SLA targets (post-MVP)

- API uptime: 99.9%
- Verification end-to-end p95: <30 s (first-time) / <5 s (returning)
- Webhook delivery p95: <10 s
- Data durability: Neon/Supabase backups + MinIO erasure coding
