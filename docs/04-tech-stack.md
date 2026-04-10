# 04 — Tech Stack & Rationale

Every choice below was made with three biases:
1. **Self-hostable or trivially portable.** No Vercel/Clerk/Supabase-managed lock-in.
2. **Bun + TypeScript end-to-end.** One runtime, one language, one mental model.
3. **Boring where possible, sharp where necessary.** The sharp bits (circuits,
   chain) are already hard — everything else should be uninteresting.

## Chosen stack

| Layer | Choice | Alternatives considered | Why chosen |
|---|---|---|---|
| **Runtime** | Bun | Node, Deno | Bun is faster, native TS, native SQLite/Postgres, native test runner. Works with Hono. |
| **HTTP framework** | Hono | Express, Fastify, Elysia | Tiny, Bun-optimised, edge-portable if we ever need it. Middleware story is clean. |
| **ORM** | Drizzle | Prisma, Kysely, raw SQL | Type-safe, no codegen daemon, introspectable SQL, Postgres-dialect portable (key for Neon→Supabase). Prisma's runtime overhead is unacceptable on Bun. |
| **Database (short-term)** | NeonDB | Postgres-in-Docker, Supabase managed | Neon's **branching** lets us make a fresh DB per preview deploy. Postgres-compatible. Decision is reversible. |
| **Database (long-term)** | Self-hosted Supabase | Self-hosted Postgres, CockroachDB | Supabase gives us Postgres + storage + auth + realtime in one self-hosted stack. We don't use the auth/realtime parts today but might later. |
| **Cache / rate limit / queue backend** | Redis 7 | Valkey, DragonflyDB | Industry default, BullMQ needs it, zero surprises. |
| **Background jobs** | BullMQ | Temporal, Trigger.dev, Inngest | BullMQ is a Redis-backed Node library — fits our existing Redis, no new infra. Temporal is overkill. |
| **Object storage** | MinIO | Garage, SeaweedFS | S3 API-compatible, battle-tested, easy k8s deployment. |
| **Frontend (popup)** | Next.js 14 (App Router) | Astro, Remix, SvelteKit | Needed for Web Worker proof generation + streaming SSR. App Router gives route-level bundling for the heavy WASM bundle. |
| **Frontend (dashboard)** | Next.js 14 | Same | Same app setup = one toolchain. |
| **Auth (dashboard)** | Lucia Auth | Better Auth, Clerk, Auth.js | Lucia is a library, not a service. No external dep. We control the DB schema. |
| **ZK library** | Fork of `@anon-aadhaar/core` | Reclaim, zkPass, custom | PSE's Anon Aadhaar is already the canonical Aadhaar ZK circuit. We need small tweaks, not a rewrite. |
| **Circuit language** | Circom (via anon-aadhaar fork) | Noir, Halo2 | anon-aadhaar is in Circom. Don't rewrite. |
| **Verification chain** | zkVerify testnet | Direct on-chain verifier, Succinct | PDF mandates zkVerify. Sub-cent verification. |
| **Settlement chain** | Base Sepolia → Base mainnet | Polygon, Arbitrum, Optimism | Base has Coinbase CDP integration (critical for wallet abstraction). |
| **Attestation layer** | EAS (Ethereum Attestation Service) | Verax, custom contract | EAS is the standard. Schema + resolver model is a clean fit. |
| **Wallets** | Coinbase CDP Smart Accounts | Privy, Dynamic, Safe | Coinbase has committed to sponsor gas. Native Base integration. No third-party vendor lock-in we can't replace. |
| **Gas abstraction** | Coinbase CDP Paymaster | Biconomy, Pimlico | Same reason. |
| **Monorepo** | pnpm workspaces | Turborepo, Nx, Bun workspaces | pnpm is the most mature. Bun workspaces are immature as of 2026-04. Turborepo adds build caching if needed later. |
| **Contracts tooling** | Foundry | Hardhat | Faster, Solidity-native, better scripting. |
| **Observability** | Grafana + Loki + Prometheus | Datadog, New Relic, Sentry | All self-hostable. Loki handles logs, Prometheus handles metrics, Grafana unifies both. |
| **CI** | GitHub Actions | Drone, Woodpecker | Good enough, no self-host burden for MVP. |
| **Container orchestration** | Docker Compose (dev) → k3s (prod) | Nomad, bare docker | k3s is a lightweight Kubernetes, runs on a single small VM, easy to scale up. |

## Why Bun specifically

- **One binary**, native TS, no ts-node dance.
- **`Bun.serve()`** + Hono is ~2× faster than Node + Fastify on our shape of workload.
- **Built-in password hashing**, `crypto.subtle`, and `fetch` mean fewer deps.
- **Drizzle + NeonDB driver** works out of the box.
- **Workspaces** still have rough edges, which is why we use pnpm.

## Why NOT some common choices

- **Not Prisma:** heavy runtime client, schema.prisma drift, poor Bun support.
- **Not Supabase managed:** lock-in, GDPR flexibility issues, price at scale.
- **Not Clerk / Auth0 / WorkOS:** dashboard auth is table stakes, we don't
  need a third party for it and we'd never want to route any end-user
  auth through a third party.
- **Not Vercel:** we'd lose control over where PII-adjacent data flows,
  and we need workers/queues anyway.
- **Not Polygon ID:** spec was pivoted to Base/EAS by the CEO.
- **Not Temporal/Inngest for jobs:** overkill for our job shapes.
- **Not gRPC:** pure REST+JSON is enough; debugging stays easy.
- **Not GraphQL:** the public API is tiny. REST + typed SDKs win.

## Dependency budget

Every new dep costs review time, security surface, and Bun compat risk.
Before adding one, check:
1. Does Bun's stdlib already do this? (Often yes.)
2. Can we write 50 lines ourselves?
3. Is the library actively maintained (last commit <6 months)?

Current allowed deps (per workspace): Hono, Drizzle, BullMQ, ioredis,
zod, jose (JWT), argon2, nodemailer, ethers, viem, @anon-aadhaar/core fork.
That's it. No lodash, no moment, no axios.
