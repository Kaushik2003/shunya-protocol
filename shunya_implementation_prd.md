# Shunya Protocol — Implementation PRD
**Version:** 2.0 | **Type:** Step-by-Step Execution Guide | **Classification:** Internal Engineering

---

## How to Read This Document

This document is written for two audiences simultaneously:

- **Humans** handle tasks marked `[HUMAN]` — judgment calls, account creation, credential management, architecture reviews, and anything requiring contextual decision-making.
- **AI Agents** handle tasks marked `[AGENT]` — file generation, boilerplate scaffolding, repetitive code, config files, test suites, schema definitions.

Each task has:
- A **Type** tag: `[HUMAN]` or `[AGENT]`
- A **Depends On** field: what must be done before this task
- A **Done When** field: exact definition of completion (not "probably done")
- **Code snippets** showing structure, not full implementation

Work through phases in order. Do not skip ahead. Each phase ends with a **gate** — a checkpoint that must pass before the next phase begins.

---

## Key Architectural Decisions

### Use Anon Aadhaar (Not Custom Circuits)
We have a forked copy of [anon-aadhaar](https://github.com/privacy-scaling-explorations/anon-aadhaar) at `./anon-aadhaar/`. This repo provides:
- **`@anon-aadhaar/core`** — ZK proof generation & verification (Groth16 via snarkjs), QR data processing, RSA signature verification
- **`@anon-aadhaar/react`** — React components with a modal-based proof flow (upload QR -> verify signature -> generate proof), context/hooks (`useAnonAadhaar`, `useProver`), styled-components UI
- **`@anon-aadhaar/circuits`** — Circom circuits for Aadhaar QR verification (RSA sig check, age extraction, gender, pincode, state, nullifier generation)

**We do NOT write custom circuits, QR parsers, or proof generators.** We wrap anon-aadhaar's existing SDK and extend it with our backend, database, organization management, and embeddable SDK popup.

### Neon Postgres (Not Supabase)
We use **Neon Serverless Postgres** for the database. Neon provides branching, serverless scaling, and a standard Postgres interface. Use `@neondatabase/serverless` driver with Drizzle ORM.

### Bun Everywhere (Not pnpm)
All package management, script running, and server runtime use **Bun**. No pnpm, no npm, no yarn.

### Local-First Development
Everything runs locally. No hosted frontend or backend deployments for now. Backend can optionally run via Docker. Frontend runs on `localhost`.

### Managed Wallet Creation via Coinbase CDP (No Privy for End Users)
Shunya handles wallet creation internally using **Coinbase CDP Server Wallet v2**. For each verified user, our backend creates a CDP-managed EVM account plus a **smart account** on Base/Base Sepolia. The end user never installs a wallet, never sees a seed phrase, and never needs ETH for gas. The B2B client never touches wallet infrastructure. All wallet operations hit our backend through CDP.

Use **CDP Server Wallet v2 Managed Mode** for backend-controlled wallets and **CDP Paymaster / gas sponsorship** for smart-account user operations. This replaces the earlier idea of generating raw Ethereum private keys on our own backend.

### Organization-Based Multi-Tenancy
Each B2B client is an **Organization** with an API key. Each organization gets isolated data in our database. B2B clients pass their user's ID (from their own database) during verification, so they can query verification status using their own user IDs instead of wallet addresses.

---

## Repository Structure (Establish First)

```
shunya-protocol/
  apps/
    web/                    # Next.js 14 frontend (local dev only)
    backend/                # Bun + Hono API server
  packages/
    sdk/                    # Embeddable SDK (popup widget for B2B clients)
    shared/                 # Shared TypeScript types
    contracts/              # Foundry smart contracts
  anon-aadhaar/             # Forked repo (git submodule) — DO NOT modify unless necessary
  infra/
    docker/
    scripts/
  docs/
```

Use a **Bun workspace** monorepo with Turborepo. The `anon-aadhaar/` fork is consumed as a local dependency.

---

## Phase 0 — Repository & Tooling Setup

*Goal: Every developer and every agent can clone this repo and have a running dev environment in under 10 minutes.*

---

### Task 0.1 — Create Monorepo Scaffold `[AGENT]`

**Depends On:** Nothing
**Done When:** `bun install` runs without error; `turbo dev` starts all apps

**What to do:**

Initialize the monorepo root:
```bash
mkdir shunya-protocol && cd shunya-protocol
bun init
bun add -D turbo typescript @types/node
```

Create `package.json` workspaces:
```json
{
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

Create `turbo.json` with pipelines for `dev`, `build`, `test`, `lint`.

The pipeline must define that `backend#build` depends on `shared#build`, and `web#build` depends on `sdk#build` and `shared#build`.

Create the directory skeleton with a `package.json` in each app and package. Each package needs:
- `name` scoped to `@shunya/` (e.g., `@shunya/shared`)
- `"type": "module"`
- TypeScript config extending from a root `tsconfig.base.json`

Root `tsconfig.base.json` must enable `strict`, `moduleResolution: bundler`, `target: ES2022`.

Link the anon-aadhaar fork as a local dependency where needed:
```json
{
  "dependencies": {
    "@anon-aadhaar/core": "file:../../anon-aadhaar/packages/core",
    "@anon-aadhaar/react": "file:../../anon-aadhaar/packages/react"
  }
}
```

---

### Task 0.2 — Install Core Tooling `[HUMAN]`

**Depends On:** Task 0.1
**Done When:** All tools verified with `--version` checks

Install on the development machine:
1. **Node.js 20+** via nvm
2. **Bun 1.1+** — `curl -fsSL https://bun.sh/install | bash`
3. **Foundry** — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
4. **Docker** — for optional local backend containerization

Verify:
```bash
node --version      # >= 20
bun --version       # >= 1.1
forge --version     # any
docker --version    # any
```

---

### Task 0.3 — Create External Accounts & Credentials `[HUMAN]`

**Depends On:** Nothing (can be parallel with 0.1)
**Done When:** All credentials are stored securely and `.env.example` is committed to repo

Create accounts in this order:

1. **Coinbase CDP** (docs.cdp.coinbase.com / portal.cdp.coinbase.com) — create a project for Base Sepolia/Base. Save the CDP server API credentials and enable **Server Wallet v2** plus **Paymaster**.
2. **Alchemy** (rpc.alchemyapi.io) — create app targeting Base Sepolia. Save `ALCHEMY_BASE_SEPOLIA_URL`. Keep this as optional fallback RPC/debug infra; CDP managed mode can cover Base/Base Sepolia wallet RPC paths.
3. **Neon** (neon.tech) — create project. Save `DATABASE_URL` (Postgres connection string).
4. **Upstash Redis** (upstash.com) — create serverless Redis instance. Save `REDIS_URL` and `REDIS_TOKEN`.
5. **MSG91** (msg91.com) — create account. Create an OTP template. Save `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID`.
6. **zkVerify** (zkverify.io) — create testnet operator account. Fund with testnet tokens. Save `ZKVERIFY_OPERATOR_SEED`.
7. **Sentry** — create two projects: `shunya-web` and `shunya-backend`. Save DSN for each.

After collecting all credentials, commit `.env.example` (with dummy values, no real secrets) to the repo root showing every variable name that will be needed.

---

### Task 0.4 — Create `.env` Files Per App `[AGENT]`

**Depends On:** Task 0.3
**Done When:** Each app directory has `.env.local` (gitignored) populated from vault

Generate `.env.local` for `apps/web/`:
```
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_BASE_CHAIN_ID=84532
SENTRY_DSN=
```

Generate `.env` for `apps/backend/`:
```
PORT=3001
DATABASE_URL=                     # Neon Postgres connection string
REDIS_URL=
REDIS_TOKEN=
MSG91_AUTH_KEY=
MSG91_TEMPLATE_ID=
ZKVERIFY_OPERATOR_SEED=
EAS_OPERATOR_PRIVATE_KEY=
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=
CDP_PROJECT_ID=
CDP_USE_SERVER_WALLETS=true
CDP_USE_PAYMASTER=true
ALCHEMY_BASE_SEPOLIA_URL=
SENTRY_DSN=
APP_ENV=development
JWT_SECRET=                       # 32+ byte random secret
SHUNYA_MASTER_API_KEY=            # For creating orgs via admin endpoints
```

Generate `.env` for `packages/contracts/`:
```
PRIVATE_KEY=           # deployer wallet (fund with Base Sepolia ETH from faucet)
BASE_SEPOLIA_RPC_URL=
BASESCAN_API_KEY=      # for contract verification
ZKVERIFY_ORACLE_ADDRESS=  # filled after Task 5.2
```

**Gate: Phase 0 is complete when:**
- [ ] `bun install` runs clean
- [ ] All accounts created and credentials secured
- [ ] `.env.example` committed to repo
- [ ] Each app has its `.env.local` / `.env` populated locally
- [ ] `@anon-aadhaar/core` and `@anon-aadhaar/react` resolve from the fork

---

## Phase 1 — Shared Types & Database

*Goal: Define the data contracts that every other component will use. Nothing else is built without this.*

---

### Task 1.1 — Define Shared TypeScript Types `[AGENT]`

**Depends On:** Task 0.1
**Done When:** `packages/shared/src/index.ts` exports all types; `tsc` passes with no errors

Create `packages/shared/src/types/`:

```
types/
  proof.ts          # ZK proof shapes (re-export from @anon-aadhaar/core types)
  attestation.ts    # EAS attestation shapes
  api.ts            # Request/response types for all API endpoints
  user.ts           # User, session, and organization types
  job.ts            # Verification job states
  organization.ts   # Organization / B2B client types
```

**`proof.ts`** — re-export and extend Anon Aadhaar's proof types:
```typescript
import type { AnonAadhaarProof, AnonAadhaarClaim } from '@anon-aadhaar/core';

// Re-export for consumers
export type { AnonAadhaarProof, AnonAadhaarClaim };

// Shunya-specific wrapper
export interface ShunyaProofPayload {
  proof: AnonAadhaarProof;
  serializedProof: string;         // JSON serialized PCD
  revealedFields: {
    ageAbove18: boolean | null;
    gender: string | null;
    pincode: string | null;
    state: string | null;
  };
}
```

**`organization.ts`** — B2B client types:
```typescript
export interface Organization {
  id: string;                       // UUID
  name: string;
  apiKey: string;                   // hashed in DB, plaintext returned only on creation
  apiKeyPrefix: string;             // first 8 chars for display: "sk_live_..."
  webhookUrl?: string;              // optional callback URL
  createdAt: Date;
  isActive: boolean;
}

export interface OrganizationUser {
  id: string;                       // UUID (internal Shunya ID)
  organizationId: string;           // FK to organization
  externalUserId?: string;          // B2B client's user ID (from their database)
  walletAddress: string;            // CDP smart account address exposed to clients
  cdpOwnerAccountId?: string;       // CDP server wallet account ID
  cdpSmartAccountId?: string;       // CDP smart account ID
  isVerified: boolean;
  verifiedAt?: Date;
  createdAt: Date;
}
```

**`job.ts`** — define `VerificationJobStatus` as a union type:
```typescript
type VerificationJobStatus = 'queued' | 'zkverify_pending' | 'eas_pending' | 'completed' | 'failed'
```

**`api.ts`** — define request/response types for every endpoint:
```typescript
type ApiError = { success: false; error: string; code: ErrorCode }
type ApiSuccess<T> = { success: true; data: T }
type ApiResponse<T> = ApiSuccess<T> | ApiError

// B2B verification request (from SDK popup)
export interface VerifyRequest {
  serializedProof: string;
  externalUserId?: string;          // B2B client's user ID
}

// B2B verification query (by org API key)
export interface VerificationQueryRequest {
  externalUserId?: string;          // lookup by B2B client's user ID
  walletAddress?: string;           // OR lookup by wallet address
}

export interface VerificationResult {
  verified: boolean;
  externalUserId?: string;
  walletAddress: string;
  ageAbove18?: boolean;
  gender?: string;
  attestationUID?: string;
  verifiedAt?: string;
}
```

---

### Task 1.2 — Write Database Schema Migration `[AGENT]`

**Depends On:** Task 0.3 (Neon account)
**Done When:** Migration runs against Neon Postgres without errors; all tables exist with correct constraints

Create `apps/backend/src/db/migrations/001_initial.sql`.

Tables to create (no PII in any column):

**`organizations` table:**
- `id` UUID primary key default gen_random_uuid()
- `name` TEXT not null
- `api_key_hash` TEXT unique not null — store as bcrypt hash of API key
- `api_key_prefix` TEXT not null — first 8 chars for identification (e.g., `sk_live_`)
- `webhook_url` TEXT nullable
- `is_active` BOOLEAN default true
- `created_at` TIMESTAMPTZ default now()
- `updated_at` TIMESTAMPTZ default now()

**`users` table:**
- `id` UUID primary key default gen_random_uuid()
- `organization_id` UUID foreign key -> organizations(id) not null
- `external_user_id` TEXT nullable — B2B client's user ID from their database
- `wallet_address` TEXT not null — CDP smart account address (checksummed)
- `cdp_owner_account_id` TEXT nullable — CDP server wallet account ID
- `cdp_smart_account_id` TEXT nullable — CDP smart account ID
- `phone_hash` TEXT nullable — store as bcrypt(phone, 12), never raw phone
- `is_verified` BOOLEAN default false
- `verified_at` TIMESTAMPTZ nullable
- `created_at` TIMESTAMPTZ default now()
- `last_seen_at` TIMESTAMPTZ
- Add unique constraint on `(organization_id, external_user_id)` where `external_user_id IS NOT NULL`
- Add unique constraint on `(organization_id, wallet_address)`

**`nullifiers` table:**
- `nullifier` TEXT primary key — Poseidon hash hex string, prevents double-verify
- `user_id` UUID foreign key -> users(id)
- `organization_id` UUID foreign key -> organizations(id)
- `attested_at` TIMESTAMPTZ default now()
- Add index on `(user_id, organization_id)` for lookups

**`verification_jobs` table:**
- `id` UUID primary key default gen_random_uuid()
- `user_id` UUID foreign key -> users(id)
- `organization_id` UUID foreign key -> organizations(id)
- `status` TEXT not null with check constraint (only valid statuses from VerificationJobStatus)
- `zkverify_txn_hash` TEXT nullable
- `zkverify_attestation_id` BIGINT nullable
- `eas_attestation_uid` TEXT nullable (bytes32 hex)
- `eas_tx_hash` TEXT nullable
- `error_code` TEXT nullable
- `error_message` TEXT nullable
- `proof_submitted_at` TIMESTAMPTZ
- `completed_at` TIMESTAMPTZ
- `created_at` TIMESTAMPTZ default now()
- `updated_at` TIMESTAMPTZ default now()
- Add index on `status` for queue worker queries
- Add index on `organization_id` for per-org queries

**`audit_log` table:**
- `id` BIGSERIAL primary key
- `organization_id` UUID nullable
- `event_type` TEXT not null (enum-like: `otp_requested`, `otp_verified`, `proof_submitted`, `zkverify_success`, `zkverify_failure`, `eas_success`, `eas_failure`, `org_created`, `api_key_rotated`)
- `job_id` UUID nullable
- `result` TEXT
- `duration_ms` INTEGER
- `metadata` JSONB — only non-PII metadata (error codes, retry counts)
- `created_at` TIMESTAMPTZ default now()

---

### Task 1.3 — Set Up Database Client `[AGENT]`

**Depends On:** Task 1.2
**Done When:** Backend can query the database; type-safe query results

In `apps/backend/`:

Install:
```bash
bun add drizzle-orm @neondatabase/serverless
bun add -D drizzle-kit
```

Create `src/db/schema.ts` that mirrors the SQL schema using Drizzle's schema definition syntax. Each table should be a typed object.

Create `src/db/client.ts` that initializes the connection using `DATABASE_URL` from env with `@neondatabase/serverless`:
```typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

Create `src/db/queries/` with one file per domain:
- `organizations.ts` — `createOrganization`, `findByApiKey`, `rotateApiKey`, `deactivateOrganization`
- `users.ts` — `findByExternalUserId`, `findByWalletAddress`, `createUser`, `updateVerificationStatus`, `updateLastSeen`
- `nullifiers.ts` — `checkNullifier`, `insertNullifier`
- `jobs.ts` — `createJob`, `updateJobStatus`, `getJobById`, `getJobsByOrganization`
- `audit.ts` — `insertAuditEvent`

Each query function must be typed end-to-end. No raw SQL in routes — only use these query functions.

**Gate: Phase 1 is complete when:**
- [ ] `packages/shared` builds with no TypeScript errors
- [ ] Migration runs on Neon Postgres successfully
- [ ] `drizzle-kit push` syncs schema without errors
- [ ] A test script can insert and retrieve a user record
- [ ] Organization CRUD operations work

---

## Phase 2 — Anon Aadhaar Integration (Not Custom Circuits)

*Goal: Verify that our forked anon-aadhaar works, understand the API surface, and prepare it for integration.*

> **We do NOT write custom circuits.** Anon Aadhaar already provides production-grade Circom circuits for Aadhaar QR verification including RSA signature verification, age check, gender/pincode/state extraction, and nullifier generation. Our fork at `./anon-aadhaar/` is used as-is.

---

### Task 2.1 — Verify Fork & Build Anon Aadhaar `[HUMAN]`

**Depends On:** Task 0.2
**Done When:** All packages in anon-aadhaar build successfully; tests pass

```bash
cd anon-aadhaar
bun install     # or use yarn since the repo uses yarn — keep its package manager for the fork
yarn build      # build all packages
yarn test       # run existing tests
```

Verify these specific exports work:
- `@anon-aadhaar/core`: `init()`, `prove()`, `verify()`, `serialize()`, `deserialize()`
- `@anon-aadhaar/react`: `AnonAadhaarProvider`, `useAnonAadhaar()`, `useProver()`, `LaunchProveModal`, `LogInWithAnonAadhaar`

Key things to understand from the code:
1. **Proof flow:** QR image -> jsQR decode -> verifySignature() -> processAadhaarArgs() -> groth16.fullProve() -> verify()
2. **What's revealed:** ageAbove18, gender, pincode, state (all optional via `revealAgeAbove18`, etc.)
3. **What's private:** Name, full DOB, UID, address — never leave the client
4. **Artifacts:** WASM + zkey files loaded from S3 (chunked, ~150MB total, cached in LocalForage)
5. **Modal flow:** VerifyModal (upload QR) -> ProveModal (select fields) -> LoaderView (proving) -> done

---

### Task 2.2 — Create Test Proof Generation Script `[HUMAN]`

**Depends On:** Task 2.1
**Done When:** Script generates a valid proof from a test QR code and verifies it

Create `scripts/test-proof.ts`:

```typescript
import { init, prove, verify } from '@anon-aadhaar/core';

// Use anon-aadhaar's test mode (test certificate, not production UIDAI cert)
// Generate a test QR from their provided tools

async function main() {
  // 1. Initialize with test artifacts
  await init({ useTestAadhaar: true });

  // 2. Generate proof from test QR data
  // (use processAadhaarArgs from @anon-aadhaar/react)

  // 3. Verify the proof
  const isValid = await verify(proof);
  console.log('Proof valid:', isValid);
}
```

This confirms our fork works end-to-end before we build anything on top of it.

**Gate: Phase 2 is complete when:**
- [ ] Anon Aadhaar fork builds cleanly
- [ ] Test proof generation works
- [ ] We understand the full API surface
- [ ] Artifacts (WASM/zkey) load correctly (from S3 or locally)

---

## Phase 3 — Smart Contracts

*Goal: Deploy the EAS Resolver to Base Sepolia. Register the schema.*

---

### Task 3.1 — Initialize Foundry Project `[AGENT]`

**Depends On:** Task 0.2 (Foundry installed)
**Done When:** `forge build` succeeds in `packages/contracts/`

```bash
cd packages/contracts
forge init --no-git --no-commit .
```

Install dependencies:
```bash
forge install ethereum-attestation-service/eas-contracts
forge install OpenZeppelin/openzeppelin-contracts
```

Update `foundry.toml`:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.26"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
base_sepolia = "${BASE_SEPOLIA_RPC_URL}"
base = "${BASE_RPC_URL}"

[etherscan]
base_sepolia = { key = "${BASESCAN_API_KEY}", url = "https://api-sepolia.basescan.org/api" }
```

---

### Task 3.2 — Write EAS Resolver Contract `[HUMAN]`

**Depends On:** Task 3.1
**Done When:** Contract compiles, logic reviewed, all tests pass

Create `src/ShunyaResolver.sol`. The contract inherits from EAS's `SchemaResolver`.

Key logic to implement:

```solidity
// Storage
address public zkVerifyOracle;           // only this address can create attestations
mapping(bytes32 => bool) public usedNullifiers;
address public owner;

// onAttest must:
// 1. require msg.sender comes from the EAS contract (inherited check)
// 2. require attestation.attester == zkVerifyOracle
// 3. decode attestation.data into (bool isOver18, uint8 gender, bytes32 nullifier)
// 4. require !usedNullifiers[nullifier]
// 5. set usedNullifiers[nullifier] = true
// 6. return true

// onRevoke must:
// 1. return true (allow admin revocation for abuse cases)

// Admin functions:
// setZkVerifyOracle(address) — onlyOwner
// transferOwnership(address) — onlyOwner
```

Do NOT use OpenZeppelin's Ownable (adds unnecessary complexity). Implement a minimal two-step ownership transfer manually.

Emit events:
- `AttestationIssued(address indexed recipient, bytes32 indexed nullifier, bool isOver18)`
- `OracleUpdated(address indexed oldOracle, address indexed newOracle)`

---

### Task 3.3 — Write Contract Tests `[AGENT]`

**Depends On:** Task 3.2
**Done When:** `forge test -vv` passes all tests with no failures

Create `test/ShunyaResolver.t.sol`.

Write tests covering:

**Happy path:**
- Valid oracle address can create an attestation -> `usedNullifiers[nullifier]` becomes true

**Failure cases:**
- Non-oracle address attempts attestation -> reverts with "Shunya: unauthorized attester"
- Same nullifier submitted twice -> reverts with "Shunya: already attested"
- Malformed attestation data (wrong schema) -> reverts

**Admin cases:**
- `setZkVerifyOracle` called by owner -> updates oracle
- `setZkVerifyOracle` called by non-owner -> reverts
- Two-step ownership transfer works correctly

Use `forge test --gas-report` to check gas costs. `onAttest` should use < 150,000 gas. Document the actual gas usage.

---

### Task 3.4 — Write Deployment Script `[AGENT]`

**Depends On:** Task 3.3
**Done When:** Script exists; dry-run works with `--dry-run` flag

Create `script/Deploy.s.sol`:

```solidity
// The script should:
// 1. Read EAS contract address from environment (different per chain)
// 2. Read ZKVERIFY_ORACLE_ADDRESS from environment
// 3. Deploy ShunyaResolver
// 4. Call EAS schema registry to register our schema string
// 5. console.log the resolver address and schema UID
// 6. Write deployed addresses to deployments/{chainId}.json
```

The schema string to register:
```
"bool isOver18,uint8 gender,bytes32 nullifier"
```

EAS contract addresses to hardcode as constants:
- Base Sepolia: `0x4200000000000000000000000000000000000021`
- Base Mainnet: `0x4200000000000000000000000000000000000021` (same on Base)

---

### Task 3.5 — Deploy to Base Sepolia `[HUMAN]`

**Depends On:** Task 3.4, funded deployer wallet
**Done When:** Contract verified on Basescan; schema UID noted in `deployments/84532.json`

Get Base Sepolia ETH from faucet: `https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet`

Deploy:
```bash
cd packages/contracts

forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  -vvvv
```

After deployment:
1. Note the contract address and schema UID
2. Commit `deployments/84532.json` to the repo
3. Update `apps/backend/.env` with `SHUNYA_RESOLVER_ADDRESS` and `SHUNYA_SCHEMA_UID`
4. Update `packages/contracts/.env` with `ZKVERIFY_ORACLE_ADDRESS` (the backend's signing wallet address — generate one with `cast wallet new`)

> **Important:** The `EAS_OPERATOR_PRIVATE_KEY` in the backend env is the private key for the zkVerify oracle address you just set. This wallet will be the attester on all EAS attestations.

**Gate: Phase 3 is complete when:**
- [ ] Contract deployed and verified on Basescan (link noted in README)
- [ ] Schema registered; Schema UID committed to repo
- [ ] `forge test` passes 100%
- [ ] Gas report reviewed; `onAttest` < 150K gas confirmed

---

## Phase 4 — Backend API

*Goal: A running API server that handles auth, org management, receives ZK proofs via the SDK, manages wallets internally, and orchestrates zkVerify -> EAS.*

---

### Task 4.1 — Initialize Bun + Hono App `[AGENT]`

**Depends On:** Phase 1 complete
**Done When:** Server starts on port 3001; `/health` returns 200

```bash
cd apps/backend
bun init
bun add hono @hono/node-server
bun add bullmq ioredis
bun add @ethereum-attestation-service/eas-sdk
bun add zkverifyjs
bun add ethers
bun add drizzle-orm @neondatabase/serverless
bun add bcrypt
bun add jose                      # JWT handling
bun add zod                       # request validation
bun add @anon-aadhaar/core        # proof verification on backend
bun add -D @types/bun @types/bcrypt typescript drizzle-kit
```

Create `src/index.ts` as the entry point. It should:
1. Import the Hono app
2. Attach middleware: CORS (allow SDK popup origins), request logging, error handler
3. Register route groups: `/api/v1/auth`, `/api/v1/verify`, `/api/v1/attestation`, `/api/v1/org`
4. Start the server

Create `src/middleware/`:
- `apiKey.ts` — API key validation middleware. Extracts `x-api-key` header, looks up org by hashed key, attaches `orgId` to context.
- `auth.ts` — JWT session validation middleware. Validates session token issued by Shunya backend (not Privy). Attaches `userId` and `orgId` to context.
- `rateLimit.ts` — simple in-memory rate limiter: max 5 OTP requests per phone per 15 minutes, max 3 proof submissions per user per day
- `errorHandler.ts` — catch all unhandled errors, log to Sentry, return generic error response

---

### Task 4.2 — Implement Organization Management Routes `[AGENT]`

**Depends On:** Task 4.1, Task 1.3 (DB queries)
**Done When:** Can create orgs, get API keys, and rotate keys via curl

Create `src/routes/org.ts`:

**`POST /api/v1/org`** (requires master API key in header)

Request body: `{ name: string, webhookUrl?: string }`

Logic:
1. Validate master API key from `x-master-key` header against `SHUNYA_MASTER_API_KEY` env var
2. Generate a new API key: `sk_live_` + 32 random hex chars
3. Hash the API key with bcrypt(12)
4. Insert org record with name, hashed key, prefix
5. Return `{ orgId, apiKey, apiKeyPrefix }` — **this is the only time the plaintext API key is returned**

**`POST /api/v1/org/:orgId/rotate-key`** (requires master API key)

Logic:
1. Generate new API key
2. Hash and update in DB
3. Invalidate old key
4. Return new `{ apiKey, apiKeyPrefix }`

**`GET /api/v1/org/:orgId`** (requires master API key)

Returns org details (without API key hash).

---

### Task 4.3 — Implement Auth Routes `[AGENT]`

**Depends On:** Task 4.1, Task 1.3 (DB queries)
**Done When:** Can request OTP and verify it via curl; session token returned

Create `src/routes/auth.ts` with two endpoints:

**`POST /api/v1/auth/request-otp`** (requires API key middleware — identifies the org)

Request body: `{ phone: string, externalUserId?: string }`

Logic:
1. Validate phone format with a regex (must start with +91 for MVP, expandable later)
2. Check rate limit (5 requests per phone per 15 min — store count in Redis with TTL)
3. Call MSG91 OTP API:
   ```
   POST https://api.msg91.com/api/v5/otp
   Headers: authkey: MSG91_AUTH_KEY
   Body: { template_id, mobile, otp_length: 6, otp_expiry: 5 }
   ```
4. Store `{ requestId, phone_hash, orgId, externalUserId }` in Redis with 5-minute TTL
5. Return `{ requestId, expiresIn: 300 }`

Do NOT return the OTP. Do NOT log the phone number in plaintext.

**`POST /api/v1/auth/verify-otp`** (requires API key middleware)

Request body: `{ requestId: string, otp: string }`

Logic:
1. Look up `requestId` in Redis -> get `phone_hash`, `orgId`, `externalUserId`
2. If not found: return 400 "expired or invalid request"
3. Call MSG91 verify API to check OTP
4. If invalid: increment fail count in Redis; after 3 fails, invalidate the requestId
5. If valid:
   - Delete requestId from Redis
   - **Create or fetch the user's wallet internally via Coinbase CDP Server Wallet v2**
   - Use `cdp.evm.getOrCreateAccount(...)` for the backend-controlled owner account
   - Use `cdp.evm.getOrCreateSmartAccount(...)` with the owner account to create the user's smart account on Base/Base Sepolia
   - Persist the CDP owner account ID, CDP smart account ID, and smart account address in our DB
   - Do **not** generate or store raw private keys in our database; CDP secures the keys for this flow
   - `findOrCreate` user by `phone_hash` + `orgId` in DB
   - If `externalUserId` was provided, store it on the user record
   - Generate a JWT session token: `{ userId, orgId, walletAddress, iat, exp: +7d }` signed with `JWT_SECRET`
   - Return `{ sessionToken, walletAddress, userId }`

Implementation note:
- For all Shunya-triggered onchain writes on Base/Base Sepolia, prefer the user's **CDP smart account** over a plain EOA so we can use ERC-4337 user operations, batching, and built-in gas sponsorship. This is how we keep the UX fully Web2-like for the end user.

---

### Task 4.4 — Implement Verification Routes `[AGENT]`

**Depends On:** Task 4.3, Task 4.6 (queue setup)
**Done When:** POST /verify returns a jobId; job appears in BullMQ dashboard

Create `src/routes/verify.ts`:

**`POST /api/v1/verify`** (requires auth middleware — user must be authenticated)

Request body: `{ serializedProof: string }`

Logic:
1. Auth middleware validates session token; extract `userId`, `orgId`, `walletAddress` from token
2. Deserialize the proof using `@anon-aadhaar/core`'s `deserialize()`
3. **Verify the proof server-side** using `@anon-aadhaar/core`'s `verify()` — do not trust client-side verification alone
4. Extract nullifier from proof's public signals
5. Check nullifier against DB scoped to the organization — if already exists: return 409 "already verified for this organization"
6. Create a job record in DB with status `queued`, linked to `orgId`
7. Add job to BullMQ queue `'verification'` with payload `{ jobId, serializedProof, walletAddress, userId, orgId }`
8. Return 202 `{ jobId, status: 'queued' }`

**`GET /api/v1/status/:jobId`** (requires auth middleware)

Logic:
1. Validate `jobId` is a valid UUID
2. Verify the job belongs to the requesting user and org
3. Fetch job from DB
4. If job completed: include `attestationUID` and `txHash`
5. Return job status object

---

### Task 4.5 — Implement B2B Query Routes `[AGENT]`

**Depends On:** Task 4.1
**Done When:** B2B clients can query verification status by external user ID or wallet address

Create `src/routes/attestation.ts`:

**`GET /api/v1/attestation/check`** (requires API key middleware — identifies the org)

Query params: `?externalUserId=xxx` OR `?walletAddress=0x...`

Logic:
1. API key middleware identifies the org
2. If `externalUserId` is provided:
   - Look up user by `(orgId, externalUserId)` in users table
   - Return verification status
3. If `walletAddress` is provided:
   - Look up user by `(orgId, walletAddress)` in users table
   - Return verification status
4. If user found and verified:
   ```json
   {
     "verified": true,
     "externalUserId": "usr_123",
     "walletAddress": "0x...",
     "ageAbove18": true,
     "gender": "M",
     "attestationUID": "0x...",
     "verifiedAt": "2026-04-08T..."
   }
   ```
5. If user not found or not verified:
   ```json
   { "verified": false }
   ```

This is the primary endpoint B2B clients use. They send their user's ID and get back a simple verified/not-verified response. No wallet knowledge required on their end.

---

### Task 4.6 — Implement BullMQ Queue & Worker `[HUMAN]`

**Depends On:** Task 4.1, Task 4.4
**Done When:** Worker processes jobs end-to-end on testnet; attestation appears on easscan.org

Create `src/workers/verificationWorker.ts`:

```typescript
// Worker processes one job at a time (concurrency: 1 for MVP, increase later)
// Job flow:

async function processVerificationJob(job: Job) {
  const { jobId, serializedProof, walletAddress, userId, orgId } = job.data;

  // STEP 1: Submit to zkVerify
  // - Update job status to 'zkverify_pending'
  // - Call zkVerify SDK
  // - On success: get attestation ID
  // - Update job with zkverify_txn_hash and zkverify_attestation_id

  // STEP 2: Issue EAS attestation on Base
  // - Update job status to 'eas_pending'
  // - Use EAS SDK to call attest() on Base Sepolia
  // - Sign with EAS_OPERATOR_PRIVATE_KEY
  // - Wait for transaction confirmation (1 block)
  // - Get attestation UID from transaction receipt

  // STEP 3: Store nullifier
  // - Insert nullifier into DB scoped to orgId

  // STEP 4: Update user verification status
  // - Set user.is_verified = true, user.verified_at = now()

  // STEP 5: Complete job
  // - Update job status to 'completed' with attestationUID and txHash
  // - Write success audit log event

  // STEP 6: Webhook notification (optional)
  // - If org has webhookUrl configured, POST the result to it

  // ERROR HANDLING:
  // - zkVerify failure: retry up to 3 times with 5s backoff
  // - EAS failure: retry once; if still fails, mark 'failed' and alert
  // - Any failure: write failure audit log with error_code
}
```

BullMQ config:
```typescript
const queue = new Queue('verification', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  }
});
```

---

### Task 4.7 — Write Backend Tests `[AGENT]`

**Depends On:** Task 4.2-4.6
**Done When:** `bun test` passes; all routes covered with unit tests

Use Bun's built-in test runner.

Create `src/__tests__/`:
- `org.test.ts` — test org creation, API key generation/rotation, key validation
- `auth.test.ts` — mock MSG91; test OTP request rate limiting, OTP verification success/failure, session token generation, wallet creation
- `verify.test.ts` — mock BullMQ; test proof validation, nullifier duplicate detection (scoped to org), jobId return
- `attestation.test.ts` — test B2B query by externalUserId, by walletAddress, org isolation (org A can't see org B's users)
- `worker.test.ts` — mock zkVerify and EAS SDK; test happy path and each failure mode

**Gate: Phase 4 is complete when:**
- [ ] All unit tests pass (`bun test`)
- [ ] Server starts without errors (`bun run dev`)
- [ ] Can create an organization and get an API key
- [ ] Can request + verify OTP via curl against local server
- [ ] Can submit a proof and get a jobId back
- [ ] Worker processes a job end-to-end on zkVerify testnet + Base Sepolia (manual test)
- [ ] B2B query by externalUserId works
- [ ] B2B query by walletAddress works
- [ ] Org isolation confirmed (org A's key cannot see org B's data)

---

## Phase 5 — Embeddable SDK (Razorpay-style Popup)

*Goal: A drop-in JavaScript SDK that B2B clients embed in their apps. It opens a popup/iframe where the entire Aadhaar verification flow happens, powered by anon-aadhaar under the hood. B2B clients never handle wallets, proofs, or ZK infrastructure.*

---

### Task 5.1 — Initialize SDK Package `[AGENT]`

**Depends On:** Phase 2 complete (anon-aadhaar verified)
**Done When:** Package builds; exports are accessible

Create `packages/sdk/`:
```
sdk/
  src/
    index.ts              # public exports: ShunyaVerify class
    popup.ts              # popup/iframe manager
    api.ts                # backend API client
    types.ts              # SDK-specific types
    ui/
      PopupApp.tsx         # React app that runs inside the popup
      steps/
        PhoneStep.tsx      # Phone + OTP entry
        AadhaarStep.tsx    # Wraps anon-aadhaar's proof modal
        ProcessingStep.tsx # Progress while backend processes
        SuccessStep.tsx    # Verification complete
        ErrorStep.tsx      # Error with retry
      components/
        ProgressBar.tsx
        Modal.tsx          # Styled popup container
  package.json
```

Install:
```bash
bun add @anon-aadhaar/core @anon-aadhaar/react react react-dom styled-components
bun add -D @types/react @types/react-dom typescript vite
```

The SDK must be bundled as a single JS file that B2B clients include via `<script>` tag or `import`.

---

### Task 5.2 — Implement SDK Public API `[AGENT]`

**Depends On:** Task 5.1
**Done When:** B2B client can trigger verification with 3 lines of code

The SDK's public API should be dead simple:

```typescript
// B2B client's code:
import { ShunyaVerify } from '@shunya/sdk';

const shunya = new ShunyaVerify({
  apiKey: 'sk_live_abc123...',        // their org API key
  backendUrl: 'http://localhost:3001', // Shunya backend
  onSuccess: (result) => {
    // result = { verified: true, externalUserId: 'usr_123', walletAddress: '0x...' }
    console.log('User verified!', result);
  },
  onError: (error) => {
    console.error('Verification failed', error);
  },
  onClose: () => {
    console.log('User closed the popup');
  }
});

// Open the verification popup
// externalUserId is the B2B client's own user ID — stored in Shunya's DB for later lookup
shunya.open({ externalUserId: 'usr_123' });
```

Create `src/index.ts`:

```typescript
export class ShunyaVerify {
  private config: ShunyaConfig;
  private popup: PopupManager | null = null;

  constructor(config: ShunyaConfig) {
    this.config = config;
  }

  open(options: { externalUserId?: string }) {
    // 1. Create a popup window or iframe overlay (like Razorpay)
    // 2. Load the PopupApp React component inside it
    // 3. Pass config + options to the popup via postMessage
    // 4. Listen for completion/error/close events via postMessage
  }

  close() {
    // Close the popup
  }
}
```

---

### Task 5.3 — Build Popup UI (Wrapping Anon Aadhaar) `[HUMAN]`

**Depends On:** Task 5.2, Phase 4 (backend running)
**Done When:** Full flow works in popup: phone -> OTP -> Aadhaar QR upload -> proof generation -> verified

The popup runs a mini React app with these steps:

**Step 1: Phone + OTP (PhoneStep.tsx)**
- Phone input (country code +91 default + 10-digit number)
- "Get OTP" button -> calls `POST /api/v1/auth/request-otp` with org's API key
- 6-digit OTP input -> calls `POST /api/v1/auth/verify-otp`
- On success: store session token, move to step 2

**Step 2: Aadhaar Verification (AadhaarStep.tsx)**
- Wrap `@anon-aadhaar/react`'s components:
  - Use `AnonAadhaarProvider` with `useTestAadhaar: true` for dev
  - Use `LaunchProveModal` or build a custom trigger that opens anon-aadhaar's modal
  - Configure `fieldsToRevealArray` to reveal `ageAbove18` (and optionally gender)
- When `useAnonAadhaar()` returns status `logged-in`:
  - Extract the serialized proof
  - Move to step 3

**Step 3: Processing (ProcessingStep.tsx)**
- Submit proof to `POST /api/v1/verify` with session token
- Poll `GET /api/v1/status/:jobId` every 2 seconds
- Show progress stages with friendly copy:

| Internal stage | User sees |
|---|---|
| `queued` | "Verifying your proof..." |
| `zkverify_pending` | "Confirming verification..." |
| `eas_pending` | "Issuing your certificate..." |
| `completed` | -> transition to SuccessStep |
| `error` | -> transition to ErrorStep |

**Step 4: Success (SuccessStep.tsx)**
- "You're verified!" with a checkmark
- Auto-close popup after 3 seconds
- Send result back to parent window via postMessage

**Step 5: Error (ErrorStep.tsx)**
- User-friendly error message
- Retry button (goes back to appropriate step)

**Popup styling:**
- Fixed overlay with semi-transparent background
- Centered modal, max-width 450px
- Clean, branded design (like Razorpay's popup)
- Mobile responsive

> **Key insight:** We use anon-aadhaar's built-in modal for the QR upload + proof generation part. We don't rebuild that. We wrap it with our auth flow (phone/OTP) and backend submission flow around it.

---

### Task 5.4 — Build SDK Bundle `[AGENT]`

**Depends On:** Task 5.3
**Done When:** Single JS file can be included via script tag; `ShunyaVerify` available on `window`

Configure Vite to build the SDK as a UMD bundle:

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'ShunyaVerify',
      formats: ['umd', 'es'],
      fileName: (format) => `shunya-sdk.${format}.js`
    },
    rollupOptions: {
      // Don't externalize anything — bundle everything (React, styled-components, etc.)
      // The SDK must be self-contained
    }
  }
});
```

The built file should be usable as:
```html
<!-- Via script tag -->
<script src="shunya-sdk.umd.js"></script>
<script>
  const shunya = new ShunyaVerify({ apiKey: '...', backendUrl: '...' });
  shunya.open({ externalUserId: 'usr_123' });
</script>
```

Or:
```typescript
// Via npm/import
import { ShunyaVerify } from '@shunya/sdk';
```

**Gate: Phase 5 is complete when:**
- [ ] SDK builds to a single JS file
- [ ] B2B client can trigger verification with 3 lines of code
- [ ] Phone OTP flow works in the popup
- [ ] Anon Aadhaar QR upload + proof generation works in the popup
- [ ] Proof submission to backend works
- [ ] Result is communicated back to the parent page via postMessage
- [ ] Popup is styled and responsive

---

## Phase 6 — Demo Frontend Application

*Goal: A simple Next.js app that demonstrates the SDK integration from a B2B client's perspective. This simulates what an e-sports company or age-gated platform would build.*

---

### Task 6.1 — Initialize Next.js Demo App `[AGENT]`

**Depends On:** Phase 5 (SDK built)
**Done When:** `next dev` starts; root page renders without errors

```bash
cd apps/web
bun create next-app . --typescript --tailwind --app --no-src-dir --import-alias "@/*"
```

Install:
```bash
bun add @shunya/sdk          # workspace package
bun add @shunya/shared
```

---

### Task 6.2 — Build Demo Page `[AGENT]`

**Depends On:** Task 6.1
**Done When:** Demo page shows a "Verify Age" button that opens the Shunya popup

Create `app/page.tsx` — a simple demo page simulating a B2B client:

```typescript
'use client';
import { ShunyaVerify } from '@shunya/sdk';
import { useState } from 'react';

export default function DemoPage() {
  const [result, setResult] = useState(null);

  const handleVerify = () => {
    const shunya = new ShunyaVerify({
      apiKey: process.env.NEXT_PUBLIC_SHUNYA_API_KEY!,
      backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL!,
      onSuccess: (res) => setResult(res),
      onError: (err) => console.error(err),
    });
    shunya.open({ externalUserId: 'demo_user_001' });
  };

  return (
    <div>
      <h1>Age-Gated Platform Demo</h1>
      <p>This simulates a B2B client integrating Shunya.</p>
      <button onClick={handleVerify}>Verify My Age</button>

      {result && (
        <div>
          <h2>Verification Result</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}

      {/* Also demo the B2B query API */}
      <button onClick={checkStatus}>Check User Status via API</button>
    </div>
  );
}
```

Also create `app/b2b-demo/page.tsx` — demonstrates the server-side B2B query:

```typescript
// Shows how a B2B client would check verification status
// using their API key and the user's externalUserId
// GET /api/v1/attestation/check?externalUserId=demo_user_001
```

**Gate: Phase 6 is complete when:**
- [ ] Demo page renders
- [ ] Clicking "Verify Age" opens the Shunya popup
- [ ] Full flow works locally (phone -> OTP -> Aadhaar QR -> verified)
- [ ] B2B query demo shows verification result
- [ ] Zero Web3 terminology visible to the end user at any point

---

## Phase 7 — Integration & End-to-End Testing

*Goal: Prove that all components work together on testnet before claiming the MVP is done.*

---

### Task 7.1 — Write E2E Test Suite `[AGENT]`

**Depends On:** All previous phases
**Done When:** `bun test:e2e` runs; all critical paths covered

Use Playwright for E2E tests. Create `apps/web/e2e/`:

**`verification_flow.spec.ts`** — happy path:
1. Navigate to demo app
2. Click "Verify Age" -> popup opens
3. Enter phone number -> mock OTP via MSG91 sandbox
4. Upload test QR image (synthetic Aadhaar, stored in `e2e/fixtures/`)
5. Wait for processing (up to 90 seconds)
6. Assert success message appears
7. Assert B2B query returns verified status

**`error_states.spec.ts`** — failure paths:
- Upload a non-Aadhaar image -> assert error state in popup
- Upload a tampered QR (broken signature) -> assert error
- Simulate network timeout -> assert error with retry

**`org_isolation.spec.ts`** — multi-tenant:
- Create two orgs
- Verify a user under org A
- Query with org B's API key -> should NOT return org A's user

---

### Task 7.2 — Local Docker Setup `[AGENT]`

**Depends On:** Phase 4 complete
**Done When:** `docker compose up` starts backend + worker + Redis; health check passes

Create `infra/docker/docker-compose.yml`:

```yaml
services:
  backend:
    build:
      context: ../../apps/backend
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    env_file:
      - ../../apps/backend/.env
    depends_on:
      - redis

  worker:
    build:
      context: ../../apps/backend
      dockerfile: Dockerfile.worker
    env_file:
      - ../../apps/backend/.env
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

Create `apps/backend/Dockerfile`:
```dockerfile
FROM oven/bun:1.1-alpine
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
COPY src/ ./src/
EXPOSE 3001
CMD ["bun", "run", "src/index.ts"]
```

Create `apps/backend/Dockerfile.worker`:
```dockerfile
FROM oven/bun:1.1-alpine
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
COPY src/ ./src/
CMD ["bun", "run", "src/workers/verificationWorker.ts"]
```

---

### Task 7.3 — Security Review `[HUMAN]`

**Depends On:** All phases complete
**Done When:** Security checklist signed off; critical issues resolved

Work through this checklist manually:

**Smart Contract:**
- [ ] No reentrancy possible in `onAttest`
- [ ] `zkVerifyOracle` address is correctly enforced
- [ ] Nullifier storage prevents replay
- [ ] Owner functions have correct access control

**Backend:**
- [ ] No PII logged anywhere (grep codebase for `phone`, `name`, `dob`, `uid`, `aadhaar`)
- [ ] JWT secret is sufficiently random (32+ bytes)
- [ ] Rate limiting enforced on all auth endpoints
- [ ] Redis TTLs set on all temporary data
- [ ] API key hashing is correct (bcrypt, not plaintext)
- [ ] Org isolation: org A's API key cannot access org B's data
- [ ] CDP API secrets are stored securely and never exposed to the browser
- [ ] No raw end-user wallet private keys are generated or stored by Shunya
- [ ] Paymaster allowlist is restricted to approved contracts/methods to prevent gas abuse

**SDK/Popup:**
- [ ] postMessage origin validation (popup only talks to expected parent)
- [ ] API key not exposed in client-side code beyond the popup's API calls
- [ ] No PII leaked to the parent page

---

## Phase 8 — Demo Preparation

*Goal: A polished, reliable demo that works locally every time.*

---

### Task 8.1 — Prepare Demo Environment `[HUMAN]`

**Depends On:** All phases complete
**Done When:** Demo script runs successfully 5 times in a row without failure

Prepare locally:
- Backend running via `bun run dev` or `docker compose up`
- Frontend running via `bun run dev` in apps/web
- Pre-funded zkVerify operator account with enough testnet tokens for 50+ verifications
- Pre-funded Base Sepolia deployer with ETH
- Pre-generated test QR code (anon-aadhaar provides test QR generation tools)
- A test organization created with an API key

**Demo script (practice until it takes < 3 minutes):**

1. Open demo app on browser (localhost:3000)
2. Click "Verify Age" -> popup opens (2 seconds)
3. Enter phone -> OTP -> authenticated (30 seconds)
4. Upload pre-prepared QR screenshot -> anon-aadhaar modal processes it (15 seconds)
5. Proof generated + submitted -> "You're verified!" (10-15 seconds)
6. Show B2B query: `curl -H "x-api-key: sk_live_..." localhost:3001/api/v1/attestation/check?externalUserId=demo_user_001` -> `{ verified: true, ageAbove18: true }`
7. Show that querying with a different org's API key returns `{ verified: false }`

---

### Task 8.2 — Write B2B Integration Guide `[AGENT]`

**Depends On:** Phase 5 (SDK complete)
**Done When:** A developer at an e-sports company could integrate in < 30 minutes using this guide

Create `docs/b2b-integration.md` covering:

1. **What you get:** Drop-in age verification. User clicks a button, a popup handles everything, you get a callback with the result.

2. **Quick start (3 lines of code):**
   ```javascript
   const shunya = new ShunyaVerify({ apiKey: 'YOUR_API_KEY', backendUrl: '...' });
   shunya.open({
     externalUserId: 'your-user-id-123',  // YOUR user's ID from YOUR database
     onSuccess: (result) => { /* user is verified */ }
   });
   ```

3. **Checking verification status server-side:**
   ```bash
   # Using YOUR user's ID (recommended)
   curl -H "x-api-key: YOUR_API_KEY" \
     https://api.shunya.xyz/api/v1/attestation/check?externalUserId=your-user-id-123

   # Or using wallet address (if you have it)
   curl -H "x-api-key: YOUR_API_KEY" \
     https://api.shunya.xyz/api/v1/attestation/check?walletAddress=0x...
   ```

4. **Response format:**
   ```json
   {
     "verified": true,
     "externalUserId": "your-user-id-123",
     "ageAbove18": true,
     "verifiedAt": "2026-04-08T12:00:00Z"
   }
   ```

5. **Getting your API key:** Contact Shunya team. You'll receive an `sk_live_...` key.

6. **Webhooks (optional):** Configure a webhook URL to get notified when a user completes verification.

---

## Final Checklist Before Demo

Work through this list the day before the demo. Every item must be checked.

### Backend (Local)
- [ ] `bun run dev` starts without errors
- [ ] Worker processes jobs without error
- [ ] Organization created with test API key
- [ ] zkVerify operator account has sufficient testnet tokens
- [ ] Neon Postgres accessible and migrations applied
- [ ] Audit log is writing; no PII in logs

### SDK
- [ ] SDK popup opens correctly from demo app
- [ ] Phone OTP flow works in popup
- [ ] Anon Aadhaar proof generation works in popup
- [ ] Result communicated back to parent page
- [ ] Popup is styled and responsive on mobile

### Smart Contracts
- [ ] Resolver deployed and verified on Base Sepolia
- [ ] Schema registered; UID correct in env files
- [ ] `onAttest` gate tested: non-oracle cannot attest

### B2B API
- [ ] Query by externalUserId works
- [ ] Query by walletAddress works
- [ ] Org isolation confirmed
- [ ] API key rotation works

### Demo Materials
- [ ] Test QR code ready
- [ ] Test organization and API key created
- [ ] Demo flow rehearsed 5 times successfully
- [ ] curl commands for B2B API demo ready

---

## Appendix A — Agent Task Summary

Tasks suitable for AI agents to execute autonomously:

| Task | Phase | What the agent does |
|---|---|---|
| 0.1 | Setup | Monorepo scaffold, package.json, turbo.json |
| 0.4 | Setup | Generate .env files from template |
| 1.1 | Types | All TypeScript type definitions including org types |
| 1.2 | DB | SQL migration files (with organizations table) |
| 1.3 | DB | Drizzle schema + query functions (with Neon driver) |
| 3.1 | Contracts | Foundry init + foundry.toml |
| 3.3 | Contracts | Solidity test file |
| 3.4 | Contracts | Deployment script |
| 4.1 | Backend | Bun + Hono app skeleton, middleware (API key + JWT) |
| 4.2 | Backend | Organization management routes |
| 4.3 | Backend | Auth routes (OTP request + verify + wallet creation) |
| 4.4 | Backend | Verify + status routes |
| 4.5 | Backend | B2B attestation query routes |
| 4.7 | Backend | Backend unit tests |
| 5.1 | SDK | SDK package init + directory structure |
| 5.2 | SDK | SDK public API (ShunyaVerify class) |
| 5.4 | SDK | Vite bundle config |
| 6.1 | Frontend | Next.js demo app init |
| 6.2 | Frontend | Demo page with SDK integration |
| 7.1 | Testing | Playwright E2E test suite |
| 7.2 | Testing | Docker compose + Dockerfiles |
| 8.2 | Demo | B2B integration guide |

---

## Appendix B — Human Task Summary

Tasks requiring human judgment, credentials, or physical devices:

| Task | Phase | Why it requires a human |
|---|---|---|
| 0.2 | Setup | Installing dev tools; machine access |
| 0.3 | Setup | Creating real accounts; handling real credentials |
| 2.1 | Integration | Building and verifying anon-aadhaar fork; understanding the API |
| 2.2 | Integration | Testing proof generation with real/test QR data |
| 3.2 | Contracts | Security-critical contract logic |
| 3.5 | Contracts | Deploying with real private key |
| 4.6 | Backend | Error handling strategy; retry policy; orchestration logic |
| 5.3 | SDK | Building popup UI; integrating anon-aadhaar React components; UX decisions |
| 7.3 | Testing | Security review; org isolation verification |
| 8.1 | Demo | Rehearsing demo; preparing environment |

---

## Appendix C — B2B Integration Flow (Visual)

```
B2B Client's App                    Shunya SDK Popup                    Shunya Backend
     |                                    |                                   |
     |-- shunya.open({                    |                                   |
     |     externalUserId: 'usr_123'      |                                   |
     |   })                               |                                   |
     |                                    |                                   |
     |                              [Popup Opens]                             |
     |                                    |                                   |
     |                              Phone + OTP -------- POST /auth/request-otp
     |                              entry               POST /auth/verify-otp
     |                                    |              (CDP server wallet + smart account created internally)
     |                                    |                                   |
     |                              Aadhaar QR                                |
     |                              upload + proof                            |
     |                              generation                                |
     |                              (anon-aadhaar)                            |
     |                                    |                                   |
     |                              Submit proof ------- POST /verify
     |                              Poll status  ------- GET /status/:jobId
     |                                    |              (zkVerify + EAS)
     |                                    |                                   |
     |                              "You're verified!"                        |
     |                              [Popup Closes]                            |
     |                                    |                                   |
     |<-- onSuccess({ verified: true,     |                                   |
     |      externalUserId: 'usr_123',    |                                   |
     |      walletAddress: '0x...' })     |                                   |
     |                                                                        |
     |-- Later: Server-side check -------------------------------- GET /attestation/check
     |   curl -H "x-api-key: sk_live_..."                         ?externalUserId=usr_123
     |                                                             -> { verified: true }
```

---

*End of Implementation PRD — Shunya Protocol v2.0*
