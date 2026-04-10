# Phase 0 — Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a working pnpm monorepo with all workspace stubs, a local Docker stack (Redis + MinIO), and the full Drizzle schema migrated to NeonDB.

**Architecture:** pnpm workspaces at root; each app/package has its own `package.json`; Drizzle schema in `packages/db` is the single source of truth for the database; Docker Compose brings up Redis and MinIO locally (NeonDB is remote).

**Tech Stack:** pnpm 9, Bun 1.1, TypeScript 5.5, Drizzle ORM 0.32, NeonDB serverless driver, Docker Compose.

---

## Files Created in This Phase

```
package.json                        root workspace manifest
pnpm-workspace.yaml                 workspace globs
tsconfig.base.json                  shared TS config
.gitignore
.env.example
infra/docker-compose.yml
apps/api/package.json
apps/api/tsconfig.json
apps/popup/package.json
apps/popup/tsconfig.json
apps/dashboard/package.json
apps/dashboard/tsconfig.json
packages/db/package.json
packages/db/tsconfig.json
packages/db/drizzle.config.ts
packages/db/src/schema.ts           all 7 tables
packages/db/src/client.ts           NeonDB + Drizzle connection
packages/db/src/migrate.ts          migration runner
packages/db/src/index.ts            re-exports schema + client
packages/shared/package.json
packages/shared/tsconfig.json
packages/shared/src/index.ts        empty re-export stub
packages/circuits/package.json
packages/contracts/package.json
packages/sdk-js/package.json
packages/sdk-react/package.json
packages/sdk-node/package.json
```

---

### Task 1: Root Config Files

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "shunya-protocol",
  "private": true,
  "version": "0.0.1",
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev:api": "pnpm --filter @shunya/api run dev",
    "dev:popup": "pnpm --filter @shunya/popup run dev",
    "dev:dashboard": "pnpm --filter @shunya/dashboard run dev",
    "build:packages": "pnpm -r --filter='./packages/*' run build",
    "lint": "pnpm -r run lint",
    "db:generate": "pnpm --filter @shunya/db run generate",
    "db:migrate": "pnpm --filter @shunya/db run migrate",
    "infra:up": "docker compose -f infra/docker-compose.yml up -d",
    "infra:down": "docker compose -f infra/docker-compose.yml down"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.env
.env.local
dist/
build/
.next/
*.zkey
*.ptau
*.wasm
*.r1cs
*.sym
packages/circuits/build/
packages/contracts/out/
packages/contracts/cache/
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore
git commit -m "feat(phase-0): root monorepo config"
```

---

### Task 2: Workspace Package Stubs

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`
- Create: `apps/popup/package.json`, `apps/popup/tsconfig.json`
- Create: `apps/dashboard/package.json`, `apps/dashboard/tsconfig.json`
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/circuits/package.json`
- Create: `packages/contracts/package.json`
- Create: `packages/sdk-js/package.json`
- Create: `packages/sdk-react/package.json`
- Create: `packages/sdk-node/package.json`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@shunya/api",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.5.0",
    "drizzle-orm": "^0.32.0",
    "@neondatabase/serverless": "^0.9.5",
    "ws": "^8.18.0",
    "bullmq": "^5.21.0",
    "ioredis": "^5.4.1",
    "zod": "^3.23.8",
    "jose": "^5.9.0",
    "argon2": "^0.41.1",
    "circomlibjs": "^0.1.7",
    "viem": "^2.19.0",
    "@coinbase/coinbase-sdk": "^0.10.0",
    "@shunya/db": "workspace:*",
    "@shunya/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/bun": "^1.1.0",
    "@types/ws": "^8.5.0"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/popup/package.json`**

```json
{
  "name": "@shunya/popup",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "jsqr": "^1.4.0",
    "pdfjs-dist": "^4.6.0",
    "snarkjs": "^0.7.4",
    "circomlibjs": "^0.1.7",
    "@shunya/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/react": "^18.3.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 4: Create `apps/popup/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create `apps/dashboard/package.json`**

```json
{
  "name": "@shunya/dashboard",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "dev": "next dev -p 3002",
    "build": "next build",
    "start": "next start -p 3002",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "lucia": "^3.2.0",
    "@lucia-auth/adapter-drizzle": "^1.1.0",
    "oslo": "^1.2.1",
    "zod": "^3.23.8",
    "@shunya/db": "workspace:*",
    "@shunya/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/react": "^18.3.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 6: Create `apps/dashboard/tsconfig.json`** — same shape as popup tsconfig.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 7: Create `packages/db/package.json`**

```json
{
  "name": "@shunya/db",
  "version": "0.0.1",
  "main": "./src/index.ts",
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "bun src/migrate.ts",
    "push": "drizzle-kit push",
    "studio": "drizzle-kit studio"
  },
  "dependencies": {
    "drizzle-orm": "^0.32.0",
    "@neondatabase/serverless": "^0.9.5",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.23.0",
    "typescript": "^5.5.0",
    "@types/bun": "^1.1.0",
    "@types/ws": "^8.5.0"
  }
}
```

- [ ] **Step 8: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src", "drizzle.config.ts"]
}
```

- [ ] **Step 9: Create `packages/shared/package.json`**

```json
{
  "name": "@shunya/shared",
  "version": "0.0.1",
  "main": "./src/index.ts",
  "dependencies": {
    "zod": "^3.23.8",
    "circomlibjs": "^0.1.7"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/bun": "^1.1.0"
  }
}
```

- [ ] **Step 10: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 11: Create remaining package stubs**

`packages/circuits/package.json`:
```json
{
  "name": "@shunya/circuits",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "bash scripts/build.sh",
    "setup": "bash scripts/trusted_setup.sh"
  }
}
```

`packages/contracts/package.json`:
```json
{
  "name": "@shunya/contracts",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "forge build",
    "deploy:sepolia": "forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify"
  }
}
```

`packages/sdk-js/package.json`:
```json
{
  "name": "@shunya/js",
  "version": "0.1.0",
  "main": "./dist/shunya.js",
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --format iife --global-name Shunya --minify",
    "lint": "tsc --noEmit"
  },
  "devDependencies": { "typescript": "^5.5.0", "@types/bun": "^1.1.0" }
}
```

`packages/sdk-react/package.json`:
```json
{
  "name": "@shunya/react",
  "version": "0.1.0",
  "main": "./src/index.tsx",
  "peerDependencies": { "react": ">=18" },
  "dependencies": { "@shunya/js": "workspace:*" },
  "devDependencies": { "typescript": "^5.5.0", "@types/react": "^18.3.0" }
}
```

`packages/sdk-node/package.json`:
```json
{
  "name": "@shunya/node",
  "version": "0.1.0",
  "main": "./src/index.ts",
  "scripts": { "lint": "tsc --noEmit" },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.5.0", "@types/bun": "^1.1.0", "@types/node": "^22.0.0" }
}
```

- [ ] **Step 12: Install all dependencies**

```bash
pnpm install
```

Expected: `node_modules` populated in each workspace, no errors.

- [ ] **Step 13: Commit**

```bash
git add apps/ packages/ 
git commit -m "feat(phase-0): workspace package.json stubs"
```

---

### Task 3: Docker Compose (Redis + MinIO)

**Files:**
- Create: `infra/docker-compose.yml`

- [ ] **Step 1: Create `infra/docker-compose.yml`**

```yaml
version: '3.9'

services:
  redis:
    image: redis:7-alpine
    container_name: shunya-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  minio:
    image: minio/minio:RELEASE.2024-09-13T20-26-02Z
    container_name: shunya-minio
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # Console UI
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3
    restart: unless-stopped

volumes:
  redis_data:
  minio_data:
```

- [ ] **Step 2: Start the stack**

```bash
pnpm infra:up
```

Expected output: containers `shunya-redis` and `shunya-minio` start healthy.

- [ ] **Step 3: Verify Redis**

```bash
docker exec shunya-redis redis-cli ping
```

Expected: `PONG`

- [ ] **Step 4: Verify MinIO**

Open http://localhost:9001 — login with `minioadmin / minioadmin`. Create a bucket called `shunya-artifacts`.

- [ ] **Step 5: Commit**

```bash
git add infra/docker-compose.yml
git commit -m "feat(phase-0): docker compose for redis + minio"
```

---

### Task 4: `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

```bash
# ─── Database ────────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"

# ─── Redis ───────────────────────────────────────────────────────────────────
REDIS_URL="redis://localhost:6379"

# ─── MinIO ───────────────────────────────────────────────────────────────────
MINIO_ENDPOINT="localhost"
MINIO_PORT="9000"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_BUCKET="shunya-artifacts"
MINIO_USE_SSL="false"

# ─── App Auth ────────────────────────────────────────────────────────────────
JWT_SECRET="generate-with: openssl rand -hex 32"

# ─── Nullifier (NEVER ROTATE — generate once with: openssl rand -hex 32) ─────
SHUNYA_NULLIFIER_SALT=""

# ─── OTP Provider (use MSG91 for India, Twilio for dev) ──────────────────────
MSG91_AUTH_KEY=""
MSG91_SENDER_ID="SHUNYA"
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_FROM_NUMBER=""

# ─── Chain ───────────────────────────────────────────────────────────────────
BASE_SEPOLIA_RPC="https://sepolia.base.org"
DEPLOYER_PRIVATE_KEY=""
SHUNYA_RESOLVER_ADDRESS=""
SHUNYA_SCHEMA_UID=""

# ─── zkVerify ────────────────────────────────────────────────────────────────
ZKVERIFY_RPC_URL=""
ZKVERIFY_SUBMITTER_SEED=""
ZKVERIFY_VK_HASH=""

# ─── Coinbase CDP ─────────────────────────────────────────────────────────────
CDP_API_KEY_NAME=""
CDP_API_KEY_PRIVATE_KEY=""

# ─── App URLs ─────────────────────────────────────────────────────────────────
POPUP_URL="http://localhost:3001"
DASHBOARD_URL="http://localhost:3002"
API_URL="http://localhost:3000"
```

- [ ] **Step 2: Copy to `.env` and fill in real values**

```bash
cp .env.example .env
# Edit .env with your actual DATABASE_URL, JWT_SECRET, SHUNYA_NULLIFIER_SALT
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "feat(phase-0): env example"
```

---

### Task 5: Drizzle Schema

**Files:**
- Create: `packages/db/src/schema.ts`

- [ ] **Step 1: Create `packages/db/src/schema.ts`**

```typescript
import {
  pgTable, text, boolean, integer, jsonb,
  timestamp, index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── B2B Tenants ────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('free'),
  quotaMonth: integer('quota_month').notNull().default(1000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('orgs_slug_idx').on(t.slug),
]);

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('owner'), // 'owner' | 'admin' | 'viewer'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
}, (t) => [
  index('users_org_id_idx').on(t.orgId),
]);

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'publishable' | 'secret'
  keyPrefix: text('key_prefix').notNull(),   // first 8 chars, shown in UI
  keyHash: text('key_hash').notNull(),        // argon2id hash of full key
  scopes: text('scopes').array().notNull().default(sql`ARRAY[]::text[]`),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('api_keys_org_id_idx').on(t.orgId),
  index('api_keys_prefix_idx').on(t.keyPrefix),
]);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret').notNull(), // HMAC signing secret, shown once
  events: text('events').array().notNull().default(sql`ARRAY['session.verified']::text[]`),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('webhook_endpoints_org_id_idx').on(t.orgId),
]);

// ─── Core Verification ───────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  userRef: text('user_ref').notNull(),
  requiredClaims: jsonb('required_claims').notNull(),
  returnUrl: text('return_url').notNull(),
  webhookUrl: text('webhook_url'),
  status: text('status').notNull().default('pending'),
  // 'pending' | 'phone_verified' | 'proof_submitted' | 'verified' | 'failed' | 'expired'
  stage: text('stage'),
  // 'queued' | 'zk_verifying' | 'zk_verified' | 'wallet_creating' | 'chain_submitting' | 'complete'
  nullifier: text('nullifier'),
  attestationId: text('attestation_id'),
  failReason: text('fail_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('sessions_org_created_idx').on(t.orgId, t.createdAt),
  index('sessions_status_idx').on(t.status),
  index('sessions_expires_idx').on(t.expiresAt),
]);

export const verifiedUsers = pgTable('verified_users', {
  id: text('id').primaryKey(),
  nullifier: text('nullifier').notNull().unique(),         // poseidon(uidCommitment, SALT)
  smartAccountAddress: text('smart_account_address').notNull().unique(),
  nameHash: text('name_hash').notNull(),                   // poseidon(name packed)
  gender: text('gender').notNull(),                        // 'M' | 'F'
  isOver18: boolean('is_over_18').notNull().default(true),
  firstVerifiedAt: timestamp('first_verified_at', { withTimezone: true }).notNull().defaultNow(),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('verified_users_nullifier_idx').on(t.nullifier),
  index('verified_users_wallet_idx').on(t.smartAccountAddress),
]);

export const attestations = pgTable('attestations', {
  id: text('id').primaryKey(),
  verifiedUserId: text('verified_user_id').notNull().references(() => verifiedUsers.id),
  orgId: text('org_id').notNull().references(() => organizations.id),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  attestationUid: text('attestation_uid').notNull().unique(), // EAS UID on Base
  txHash: text('tx_hash').notNull(),
  chain: text('chain').notNull().default('base-sepolia'),
  zkverifyReceipt: jsonb('zkverify_receipt').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('attestations_org_created_idx').on(t.orgId, t.createdAt),
  index('attestations_verified_user_idx').on(t.verifiedUserId),
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  endpointId: text('endpoint_id').notNull().references(() => webhookEndpoints.id),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),
  // 'pending' | 'delivered' | 'failed' | 'dead'
  attempt: integer('attempt').notNull().default(0),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  responseCode: integer('response_code'),
  responseBody: text('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
}, (t) => [
  index('webhook_deliveries_endpoint_idx').on(t.endpointId),
  index('webhook_deliveries_session_idx').on(t.sessionId),
  index('webhook_deliveries_retry_idx').on(t.nextRetryAt),
]);
```

- [ ] **Step 2: Commit schema**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(phase-0): drizzle schema — all 7 tables"
```

---

### Task 6: DB Client + Drizzle Config

**Files:**
- Create: `packages/db/src/client.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/db/src/client.ts`**

```typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);

export const db = drizzle(sql, { schema });

export type DB = typeof db;
```

- [ ] **Step 2: Create `packages/db/drizzle.config.ts`**

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
```

- [ ] **Step 3: Create `packages/db/src/migrate.ts`**

```typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function main() {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './migrations' });
  console.log('Migrations complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Create `packages/db/src/index.ts`**

```typescript
export * from './schema';
export { db } from './client';
export type { DB } from './client';
```

- [ ] **Step 5: Create `packages/shared/src/index.ts`** (stub, filled in Phase 2)

```typescript
// Populated in Phase 2
export {};
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/ packages/shared/src/index.ts
git commit -m "feat(phase-0): db client, drizzle config, migrate script"
```

---

### Task 7: Generate and Run Initial Migration

**Files:**
- Create: `packages/db/migrations/` (auto-generated)

- [ ] **Step 1: Generate migration SQL from schema**

```bash
cd packages/db && DATABASE_URL="$DATABASE_URL" pnpm run generate
```

Expected: `migrations/0000_initial.sql` created with `CREATE TABLE` statements for all 7 tables.

- [ ] **Step 2: Apply migration to NeonDB dev branch**

```bash
DATABASE_URL="$DATABASE_URL" pnpm run migrate
```

Expected:
```
Running migrations...
Migrations complete.
```

- [ ] **Step 3: Verify tables exist in NeonDB**

```bash
DATABASE_URL="$DATABASE_URL" bun -e "
  import { neon } from '@neondatabase/serverless';
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql\`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name\`;
  console.log(rows.map(r => r.table_name).join(', '));
"
```

Expected output:
```
api_keys, attestations, organizations, sessions, verified_users, webhook_deliveries, webhook_endpoints, users
```

- [ ] **Step 4: Commit migrations**

```bash
git add packages/db/migrations/
git commit -m "feat(phase-0): initial drizzle migration — all tables"
```

---

### Task 8: Verify Full Stack Boots

- [ ] **Step 1: Confirm Docker stack is healthy**

```bash
docker compose -f infra/docker-compose.yml ps
```

Expected: both `shunya-redis` and `shunya-minio` show `healthy`.

- [ ] **Step 2: Confirm pnpm workspace resolution**

```bash
pnpm --filter @shunya/api list --depth 0
```

Expected: `@shunya/db`, `@shunya/shared`, `hono`, `drizzle-orm` all listed.

- [ ] **Step 3: Confirm TypeScript compiles across workspaces**

```bash
pnpm lint
```

Expected: no errors (only empty stubs exist so far).

- [ ] **Step 4: Final Phase 0 commit**

```bash
git add .
git commit -m "feat(phase-0): complete — repo scaffold, docker, schema migrated"
```

---

## Phase 0 Exit Criteria

- ✅ `pnpm install` succeeds with zero peer dep errors
- ✅ `docker compose up -d` → both containers healthy
- ✅ `pnpm run migrate` applies to NeonDB without errors
- ✅ All 7 tables visible in NeonDB console
- ✅ `pnpm lint` passes
