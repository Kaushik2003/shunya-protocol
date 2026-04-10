# Phase 2 — API, Workers & Full Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Bun/Hono API (`apps/api`), BullMQ background workers, and wire the popup to use the real verification pipeline. End-to-end: a B2B client mints a session → popup runs OTP + proof → workers process zkVerify → EAS attestation → webhook delivered.

**Architecture:** `apps/api` is a single Bun process with two roles: HTTP server (Hono) and BullMQ worker pool. `packages/shared` is expanded with HMAC utilities, nullifier helpers, and zod schemas. The popup is updated to call the real `/internal/*` API routes instead of the Phase 1 demo flow.

**Tech Stack:** Bun 1.1, Hono 4.5, Drizzle 0.32, BullMQ 5.21, ioredis 5.4, zod 3.23, jose 5.9, argon2 0.41, circomlibjs 0.1.7, viem 2.19, @coinbase/coinbase-sdk 0.10, @zkverify/sdk.

**Pre-requisites:**
- Phase 0 + Phase 1 complete
- `ShunyaResolver` deployed, `SHUNYA_RESOLVER_ADDRESS` in `.env`
- `ZKVERIFY_VK_HASH`, `CDP_API_KEY_NAME`, `CDP_API_KEY_PRIVATE_KEY` in `.env`
- Docker stack running (`pnpm infra:up`)

---

## Files Created / Modified in This Phase

```
packages/shared/src/
  hmac.ts             NEW — HMAC signer + verifier for webhooks
  nullifier.ts        NEW — poseidon nullifier computation (server-side)
  schemas.ts          NEW — zod schemas for API request/response bodies
  index.ts            UPDATED

apps/api/src/
  index.ts            NEW — Hono app bootstrap + worker startup
  env.ts              NEW — typed env validation
  middleware/
    apiKeyAuth.ts     NEW — sk_ Bearer auth
    sessionAuth.ts    NEW — popup JWT auth
  routes/
    v1/
      sessions.ts     NEW — POST/GET /v1/sessions, GET /v1/sessions/:id
      attestations.ts NEW — GET /v1/attestations/:uid
    internal/
      otp.ts          NEW — POST /internal/sessions/:id/otp/request|verify
      nullifier.ts    NEW — POST /internal/sessions/:id/nullifier/check
      proof.ts        NEW — POST /internal/sessions/:id/proof
  services/
    redis.ts          NEW — ioredis singleton
    otp.ts            NEW — OTP generate/verify via Redis
    zkverify.ts       NEW — submit proof, poll receipt
    cdp.ts            NEW — create/lookup smart account
    eas.ts            NEW — call ShunyaResolver.attest() via viem
    minio.ts          NEW — upload audit artifacts
  workers/
    verifyProof.ts    NEW — zkVerify + CDP + EAS pipeline
    copyAttestation.ts NEW — returning-user fast path
    deliverWebhook.ts NEW — HMAC-signed HTTP delivery + retry
    index.ts          NEW — register all worker queues

apps/popup/
  app/page.tsx        UPDATED — wired to real API
  app/components/
    OTPFlow.tsx       NEW — phone OTP entry UI
    NullifierCheck.tsx NEW — sends uidCommitment, handles fast-path
```

---

### Task 1: `packages/shared` — HMAC, Nullifier, Zod Schemas

**Files:**
- Create: `packages/shared/src/hmac.ts`
- Create: `packages/shared/src/nullifier.ts`
- Create: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/src/hmac.ts`**

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Sign a webhook payload.
 * Formula: hex(hmac_sha256(secret, timestamp + "." + rawBody))
 */
export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

/**
 * Verify an incoming webhook signature. Returns false if timestamp is >5 min old.
 */
export function verifyWebhook(
  secret: string,
  timestamp: number,
  rawBody: string,
  signature: string
): boolean {
  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > 300) return false; // 5-minute replay window

  const expected = signWebhook(secret, timestamp, rawBody);
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signature.replace(/^sha256=/, ''));
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
```

- [ ] **Step 2: Create `packages/shared/src/nullifier.ts`**

```typescript
import { buildPoseidon } from 'circomlibjs';

let _poseidon: Awaited<ReturnType<typeof buildPoseidon>> | null = null;

async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

/**
 * Compute the server-side nullifier: poseidon(uidCommitment, SALT)
 * uidCommitment is the in-circuit output poseidon(referenceId).
 * SALT is SHUNYA_NULLIFIER_SALT from env — never rotated.
 */
export async function computeNullifier(
  uidCommitment: string,    // hex string from public signals
  salt: string              // SHUNYA_NULLIFIER_SALT (hex)
): Promise<string> {
  const poseidon = await getPoseidon();
  const F = poseidon.F;

  const commitment = BigInt(uidCommitment);
  const saltBig    = BigInt('0x' + salt);

  const hash = poseidon([commitment, saltBig]);
  return '0x' + F.toString(hash, 16).padStart(64, '0');
}
```

- [ ] **Step 3: Create `packages/shared/src/schemas.ts`**

```typescript
import { z } from 'zod';

// POST /v1/sessions
export const CreateSessionSchema = z.object({
  userRef:        z.string().min(1).max(255),
  requiredClaims: z.object({
    isOver18: z.boolean().optional(),
    gender:   z.enum(['M', 'F', 'any']).optional(),
  }),
  returnUrl:  z.string().url(),
  webhookUrl: z.string().url().optional(),
});

// POST /internal/sessions/:id/otp/request
export const OtpRequestSchema = z.object({
  phone: z.string().regex(/^\+91[0-9]{10}$/, 'Must be +91 followed by 10 digits'),
});

// POST /internal/sessions/:id/otp/verify
export const OtpVerifySchema = z.object({
  phone: z.string(),
  otp:   z.string().length(6),
});

// POST /internal/sessions/:id/nullifier/check
export const NullifierCheckSchema = z.object({
  uidCommitment: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'Must be a hex field element'),
});

// POST /internal/sessions/:id/proof
export const SubmitProofSchema = z.object({
  proof: z.object({
    pi_a:     z.tuple([z.string(), z.string(), z.string()]),
    pi_b:     z.tuple([
                z.tuple([z.string(), z.string()]),
                z.tuple([z.string(), z.string()]),
                z.tuple([z.string(), z.string()]),
              ]),
    pi_c:     z.tuple([z.string(), z.string(), z.string()]),
    protocol: z.literal('groth16'),
    curve:    z.literal('bn128'),
  }),
  publicSignals: z.array(z.string()).length(5),
  // publicSignals order: [pubkeyHash, isOver18, genderBit, nameHash, uidCommitment]
  uidCommitment: z.string(),
});
```

- [ ] **Step 4: Update `packages/shared/src/index.ts`**

```typescript
export * from './types';
export * from './config';
export * from './hmac';
export * from './nullifier';
export * from './schemas';
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/
git commit -m "feat(shared): hmac signer, nullifier helper, zod schemas"
```

---

### Task 2: API Environment Validation

**Files:**
- Create: `apps/api/src/env.ts`

- [ ] **Step 1: Create `apps/api/src/env.ts`**

```typescript
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL:              z.string().url(),
  REDIS_URL:                 z.string().url(),
  JWT_SECRET:                z.string().min(32),
  SHUNYA_NULLIFIER_SALT:     z.string().min(32),

  MINIO_ENDPOINT:            z.string(),
  MINIO_PORT:                z.coerce.number().default(9000),
  MINIO_ACCESS_KEY:          z.string(),
  MINIO_SECRET_KEY:          z.string(),
  MINIO_BUCKET:              z.string(),
  MINIO_USE_SSL:             z.string().transform(v => v === 'true').default('false'),

  BASE_SEPOLIA_RPC:          z.string().url(),
  SHUNYA_RESOLVER_ADDRESS:   z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  SHUNYA_SCHEMA_UID:         z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  ZKVERIFY_RPC_URL:          z.string().url(),
  ZKVERIFY_SUBMITTER_SEED:   z.string(),
  ZKVERIFY_VK_HASH:          z.string(),

  CDP_API_KEY_NAME:          z.string(),
  CDP_API_KEY_PRIVATE_KEY:   z.string(),

  POPUP_URL:                 z.string().url().default('http://localhost:3001'),
  API_URL:                   z.string().url().default('http://localhost:3000'),

  // OTP — require at least one provider
  MSG91_AUTH_KEY:            z.string().optional(),
  TWILIO_ACCOUNT_SID:        z.string().optional(),
  TWILIO_AUTH_TOKEN:         z.string().optional(),
  TWILIO_FROM_NUMBER:        z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

---

### Task 3: Services (Redis, OTP, zkVerify, CDP, EAS, MinIO)

**Files:**
- Create: `apps/api/src/services/redis.ts`
- Create: `apps/api/src/services/otp.ts`
- Create: `apps/api/src/services/zkverify.ts`
- Create: `apps/api/src/services/cdp.ts`
- Create: `apps/api/src/services/eas.ts`
- Create: `apps/api/src/services/minio.ts`

- [ ] **Step 1: Create `apps/api/src/services/redis.ts`**

```typescript
import Redis from 'ioredis';
import { env } from '../env';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableAutoPipelining: true,
});
```

- [ ] **Step 2: Create `apps/api/src/services/otp.ts`**

```typescript
import { createHash, randomInt } from 'crypto';
import { redis } from './redis';
import { env } from '../env';

const OTP_TTL_SEC = 300; // 5 minutes
const OTP_MAX_ATTEMPTS = 3;

function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

function otpKey(phone: string): string {
  return `otp:${createHash('sha256').update(phone).digest('hex')}`;
}

function rateLimitKey(phone: string): string {
  return `otp_rate:${createHash('sha256').update(phone).digest('hex')}`;
}

export async function generateAndSendOtp(phone: string): Promise<void> {
  // Rate limit: 3 OTP requests per phone per 15 min
  const rl = rateLimitKey(phone);
  const count = await redis.incr(rl);
  if (count === 1) await redis.expire(rl, 900); // 15 min window
  if (count > 3) throw new Error('Too many OTP requests. Try again later.');

  const otp = String(randomInt(100000, 999999));
  const hash = hashOtp(otp);
  await redis.set(otpKey(phone), hash, 'EX', OTP_TTL_SEC);

  // Send via MSG91 (primary) or Twilio (fallback)
  if (env.MSG91_AUTH_KEY) {
    await sendViaMSG91(phone, otp);
  } else if (env.TWILIO_ACCOUNT_SID) {
    await sendViaTwilio(phone, otp);
  } else {
    // Dev mode: log OTP
    console.log(`[DEV OTP] ${phone}: ${otp}`);
  }
}

export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const stored = await redis.get(otpKey(phone));
  if (!stored) return false;
  const match = stored === hashOtp(otp);
  if (match) await redis.del(otpKey(phone)); // single-use
  return match;
}

async function sendViaMSG91(phone: string, otp: string): Promise<void> {
  const url = 'https://api.msg91.com/api/v5/otp';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authkey': env.MSG91_AUTH_KEY!,
    },
    body: JSON.stringify({
      template_id: 'YOUR_MSG91_TEMPLATE_ID', // set in .env if using MSG91
      mobile:      phone.replace('+', ''),
      otp,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MSG91 error: ${text}`);
  }
}

async function sendViaTwilio(phone: string, otp: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const body = new URLSearchParams({
    To:   phone,
    From: env.TWILIO_FROM_NUMBER!,
    Body: `Your Shunya verification code is: ${otp}. Valid for 5 minutes.`,
  });
  const creds = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio error: ${text}`);
  }
}
```

- [ ] **Step 3: Create `apps/api/src/services/zkverify.ts`**

```typescript
import type { Groth16Proof, ZkVerifyReceipt } from '@shunya/shared';
import { env } from '../env';

// Using dynamic import since @zkverify/sdk may not be installed yet.
// Install: pnpm --filter @shunya/api add @zkverify/sdk

export async function submitProofToZkVerify(
  proof: Groth16Proof,
  publicSignals: string[]
): Promise<ZkVerifyReceipt> {
  // Lazy import to avoid startup errors if SDK not yet installed
  const { ZkVerify } = await import('@zkverify/sdk' as any);

  const zk = new ZkVerify({
    rpcUrl:     env.ZKVERIFY_RPC_URL,
    seedPhrase: env.ZKVERIFY_SUBMITTER_SEED,
  });

  const { receipt } = await zk.submitProof({
    proofType:      'groth16',
    vk:             env.ZKVERIFY_VK_HASH,
    proof,
    publicSignals,
    waitForReceipt: true,
  });

  return receipt as ZkVerifyReceipt;
}
```

- [ ] **Step 4: Create `apps/api/src/services/cdp.ts`**

```typescript
import { Coinbase, Wallet } from '@coinbase/coinbase-sdk';
import { env } from '../env';

Coinbase.configure({
  apiKeyName:       env.CDP_API_KEY_NAME,
  privateKey:       env.CDP_API_KEY_PRIVATE_KEY,
});

/**
 * Get or create a deterministic smart account for a verified user.
 * The account address is derived from nullifier as salt, so it's
 * recoverable even if the DB row is lost.
 */
export async function getOrCreateSmartAccount(nullifier: string): Promise<string> {
  // CDP Smart Account creation — deterministic via server-held signer + nullifier salt.
  // The nullifier is used as an external identifier; CDP derives the address internally.
  const wallet = await Wallet.create({
    networkId: Coinbase.networks.BaseSepolia,
  });

  // Return the default address of the newly created wallet
  const address = await wallet.getDefaultAddress();
  return address.getId();
}
```

> **Note:** The real CDP Smart Account flow uses ERC-4337 with `salt=nullifier`. Replace the stub above with the actual CDP SDK call once you've reviewed the latest `@coinbase/coinbase-sdk` docs for Smart Account creation with a deterministic salt.

- [ ] **Step 5: Create `apps/api/src/services/eas.ts`**

```typescript
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import type { ZkVerifyReceipt } from '@shunya/shared';
import { env } from '../env';

const RESOLVER_ABI = parseAbi([
  'function attest(uint256 aggregationId, uint256 leafIndex, bytes32[] calldata merkleProof, bytes calldata publicSignalsEncoded, address subject) external returns (bytes32)',
]);

export async function callResolverAttest(
  receipt: ZkVerifyReceipt,
  publicSignalsEncoded: `0x${string}`,
  subject: `0x${string}`
): Promise<{ txHash: string; attestationUid: string }> {
  const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain:     baseSepolia,
    transport: http(env.BASE_SEPOLIA_RPC),
  });

  const publicClient = createPublicClient({
    chain:     baseSepolia,
    transport: http(env.BASE_SEPOLIA_RPC),
  });

  const txHash = await walletClient.writeContract({
    address:      env.SHUNYA_RESOLVER_ADDRESS as `0x${string}`,
    abi:          RESOLVER_ABI,
    functionName: 'attest',
    args: [
      BigInt(receipt.aggregationId),
      BigInt(receipt.leafIndex),
      receipt.merkleProof as `0x${string}`[],
      publicSignalsEncoded,
      subject,
    ],
  });

  const txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Extract attestation UID from the AttestationCreated event log
  // Event: AttestationCreated(bytes32 indexed uid, address indexed subject)
  const log = txReceipt.logs.find(l => l.address.toLowerCase() === env.SHUNYA_RESOLVER_ADDRESS.toLowerCase());
  const attestationUid = log?.topics[1] ?? '0x';

  return { txHash, attestationUid };
}
```

- [ ] **Step 6: Create `apps/api/src/services/minio.ts`**

```typescript
import * as Minio from 'minio';
import { env } from '../env';

export const minioClient = new Minio.Client({
  endPoint:  env.MINIO_ENDPOINT,
  port:      env.MINIO_PORT,
  useSSL:    env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

export async function uploadAuditArtifact(
  sessionId: string,
  data: object
): Promise<string> {
  const key  = `sessions/${sessionId}/proof_artifact.json`;
  const json = JSON.stringify(data);
  await minioClient.putObject(env.MINIO_BUCKET, key, json, json.length, {
    'Content-Type': 'application/json',
  });
  return key;
}
```

Add `minio` to `apps/api` dependencies:

```bash
pnpm --filter @shunya/api add minio
```

- [ ] **Step 7: Commit services**

```bash
git add apps/api/src/
git commit -m "feat(api): services — redis, otp, zkverify, cdp, eas, minio"
```

---

### Task 4: Auth Middleware

**Files:**
- Create: `apps/api/src/middleware/apiKeyAuth.ts`
- Create: `apps/api/src/middleware/sessionAuth.ts`

- [ ] **Step 1: Create `apps/api/src/middleware/apiKeyAuth.ts`**

```typescript
import type { Context, Next } from 'hono';
import argon2 from 'argon2';
import { db } from '@shunya/db';
import { apiKeys, organizations } from '@shunya/db';
import { eq, isNull } from 'drizzle-orm';
import { redis } from '../services/redis';

export type AuthedContext = {
  orgId: string;
  keyId: string;
};

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthedContext;
  }
}

export async function apiKeyAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  const rawKey = header.slice(7);
  // Keys are prefixed: sk_live_XXXX... or sk_test_XXXX...
  if (!rawKey.startsWith('sk_')) {
    return c.json({ error: 'Invalid API key format' }, 401);
  }

  const prefix = rawKey.slice(0, 12); // sk_live_XXXX

  // Cache lookup: prefix → orgId (5-min TTL)
  const cacheKey = `apikey:${prefix}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    const { orgId, keyId } = JSON.parse(cached) as AuthedContext;
    c.set('auth', { orgId, keyId });
    return next();
  }

  // DB lookup
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefix))
    .limit(5);

  for (const row of rows) {
    if (row.revokedAt) continue;
    const match = await argon2.verify(row.keyHash, rawKey);
    if (match) {
      // Update last used (fire and forget)
      db.update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, row.id))
        .catch(() => {});

      const ctx: AuthedContext = { orgId: row.orgId, keyId: row.id };
      await redis.set(cacheKey, JSON.stringify(ctx), 'EX', 300);
      c.set('auth', ctx);
      return next();
    }
  }

  return c.json({ error: 'Invalid or revoked API key' }, 401);
}
```

- [ ] **Step 2: Create `apps/api/src/middleware/sessionAuth.ts`**

```typescript
import type { Context, Next } from 'hono';
import { jwtVerify } from 'jose';
import { env } from '../env';

export type SessionClaims = {
  sid: string; // session ID
  oid: string; // org ID
  exp: number;
};

declare module 'hono' {
  interface ContextVariableMap {
    session: SessionClaims;
  }
}

const secret = new TextEncoder().encode(env.JWT_SECRET);

export async function sessionAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing session token' }, 401);
  }

  try {
    const token = header.slice(7);
    const { payload } = await jwtVerify(token, secret, {
      audience: 'shunya-popup',
    });

    c.set('session', {
      sid: payload['sid'] as string,
      oid: payload['oid'] as string,
      exp: payload.exp as number,
    });
    return next();
  } catch {
    return c.json({ error: 'Invalid or expired session token' }, 401);
  }
}
```

---

### Task 5: API Routes — `/v1/*`

**Files:**
- Create: `apps/api/src/routes/v1/sessions.ts`
- Create: `apps/api/src/routes/v1/attestations.ts`

- [ ] **Step 1: Create `apps/api/src/routes/v1/sessions.ts`**

```typescript
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { nanoid } from 'nanoid';
import { db } from '@shunya/db';
import { sessions, attestations, verifiedUsers } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { CreateSessionSchema } from '@shunya/shared';
import { apiKeyAuth } from '../../middleware/apiKeyAuth';
import { env } from '../../env';

export const sessionsRouter = new Hono();

const secret = new TextEncoder().encode(env.JWT_SECRET);

sessionsRouter.post('/', apiKeyAuth, zValidator('json', CreateSessionSchema), async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');

  const sessionId    = `ses_${nanoid(21)}`;
  const expiresAt    = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  await db.insert(sessions).values({
    id:             sessionId,
    orgId:          auth.orgId,
    userRef:        body.userRef,
    requiredClaims: body.requiredClaims,
    returnUrl:      body.returnUrl,
    webhookUrl:     body.webhookUrl ?? null,
    status:         'pending',
    expiresAt,
  });

  const sessionToken = await new SignJWT({
    sid: sessionId,
    oid: auth.orgId,
    reqClaims: body.requiredClaims,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('shunya-popup')
    .setExpirationTime('15m')
    .sign(secret);

  const popupUrl = `${env.POPUP_URL}/?s=${sessionToken}`;

  return c.json({ sessionId, sessionToken, popupUrl }, 201);
});

sessionsRouter.get('/:id', apiKeyAuth, async (c) => {
  const auth = c.get('auth');
  const { id } = c.req.param();

  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row || row.orgId !== auth.orgId) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json({
    sessionId:    row.id,
    status:       row.status,
    stage:        row.stage,
    attestationId: row.attestationId,
    createdAt:    row.createdAt,
    completedAt:  row.completedAt,
    expiresAt:    row.expiresAt,
  });
});
```

- [ ] **Step 2: Create `apps/api/src/routes/v1/attestations.ts`**

```typescript
import { Hono } from 'hono';
import { db } from '@shunya/db';
import { attestations, verifiedUsers } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { apiKeyAuth } from '../../middleware/apiKeyAuth';

export const attestationsRouter = new Hono();

attestationsRouter.get('/:uid', apiKeyAuth, async (c) => {
  const { uid } = c.req.param();

  const [row] = await db
    .select({
      attestation: attestations,
      user: verifiedUsers,
    })
    .from(attestations)
    .innerJoin(verifiedUsers, eq(attestations.verifiedUserId, verifiedUsers.id))
    .where(eq(attestations.attestationUid, uid))
    .limit(1);

  if (!row) return c.json({ error: 'Attestation not found' }, 404);

  return c.json({
    attestationUid: row.attestation.attestationUid,
    txHash:         row.attestation.txHash,
    chain:          row.attestation.chain,
    createdAt:      row.attestation.createdAt,
    claims: {
      isOver18:  row.user.isOver18,
      gender:    row.user.gender,
    },
    walletAddress: row.user.smartAccountAddress,
  });
});
```

---

### Task 6: API Routes — `/internal/*`

**Files:**
- Create: `apps/api/src/routes/internal/otp.ts`
- Create: `apps/api/src/routes/internal/nullifier.ts`
- Create: `apps/api/src/routes/internal/proof.ts`

- [ ] **Step 1: Create `apps/api/src/routes/internal/otp.ts`**

```typescript
import { Hono } from 'hono';
import { db } from '@shunya/db';
import { sessions } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { OtpRequestSchema, OtpVerifySchema } from '@shunya/shared';
import { sessionAuth } from '../../middleware/sessionAuth';
import { generateAndSendOtp, verifyOtp } from '../../services/otp';

export const otpRouter = new Hono();

otpRouter.post('/request', sessionAuth, zValidator('json', OtpRequestSchema), async (c) => {
  const { sid } = c.get('session');
  const { phone } = c.req.valid('json');

  // Verify session is still pending or phone_verified
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
  if (!row || !['pending', 'phone_verified'].includes(row.status)) {
    return c.json({ error: 'Session not eligible for OTP' }, 400);
  }

  await generateAndSendOtp(phone);
  return c.json({ sent: true });
});

otpRouter.post('/verify', sessionAuth, zValidator('json', OtpVerifySchema), async (c) => {
  const { sid } = c.get('session');
  const { phone, otp } = c.req.valid('json');

  const ok = await verifyOtp(phone, otp);
  if (!ok) return c.json({ error: 'Invalid or expired OTP' }, 400);

  await db.update(sessions)
    .set({ status: 'phone_verified' })
    .where(eq(sessions.id, sid));

  return c.json({ verified: true });
});
```

- [ ] **Step 2: Create `apps/api/src/routes/internal/nullifier.ts`**

```typescript
import { Hono } from 'hono';
import { db } from '@shunya/db';
import { sessions, verifiedUsers } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { NullifierCheckSchema } from '@shunya/shared';
import { computeNullifier } from '@shunya/shared';
import { sessionAuth } from '../../middleware/sessionAuth';
import { env } from '../../env';
import { Queue } from 'bullmq';
import { redis } from '../../services/redis';

const copyAttestationQueue = new Queue('copy-attestation', { connection: redis });

export const nullifierRouter = new Hono();

nullifierRouter.post('/check', sessionAuth, zValidator('json', NullifierCheckSchema), async (c) => {
  const { sid, oid } = c.get('session');
  const { uidCommitment } = c.req.valid('json');

  const nullifier = await computeNullifier(uidCommitment, env.SHUNYA_NULLIFIER_SALT);

  // Check if we've seen this human before
  const [existing] = await db
    .select()
    .from(verifiedUsers)
    .where(eq(verifiedUsers.nullifier, nullifier))
    .limit(1);

  if (existing) {
    // Fast path: enqueue copy-attestation job
    await db.update(sessions)
      .set({ status: 'proof_submitted', stage: 'queued', nullifier })
      .where(eq(sessions.id, sid));

    await copyAttestationQueue.add(
      'copy-attestation',
      { sessionId: sid, orgId: oid, verifiedUserId: existing.id, nullifier },
      { jobId: `copy:${sid}`, attempts: 5, backoff: { type: 'exponential', delay: 5000 } }
    );

    return c.json({ status: 'fast_path', message: 'Returning user detected, attestation in progress.' });
  }

  return c.json({ status: 'needs_proof' });
});
```

- [ ] **Step 3: Create `apps/api/src/routes/internal/proof.ts`**

```typescript
import { Hono } from 'hono';
import { db } from '@shunya/db';
import { sessions } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { SubmitProofSchema } from '@shunya/shared';
import { computeNullifier } from '@shunya/shared';
import { sessionAuth } from '../../middleware/sessionAuth';
import { env } from '../../env';
import { Queue } from 'bullmq';
import { redis } from '../../services/redis';

const verifyProofQueue = new Queue('verify-proof', { connection: redis });

export const proofRouter = new Hono();

proofRouter.post('/', sessionAuth, zValidator('json', SubmitProofSchema), async (c) => {
  const { sid, oid } = c.get('session');
  const body = c.req.valid('json');

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
  if (!session || session.status !== 'phone_verified') {
    return c.json({ error: 'Session not eligible for proof submission' }, 400);
  }

  // Validate publicSignals array length = 5
  // [pubkeyHash, isOver18, genderBit, nameHash, uidCommitment]
  const [pubkeyHash, isOver18Str, genderBitStr, nameHash, uidCommitment] = body.publicSignals;

  if (isOver18Str !== '1') {
    await db.update(sessions)
      .set({ status: 'failed', failReason: 'Age verification failed: not over 18' })
      .where(eq(sessions.id, sid));
    return c.json({ error: 'Age requirement not met' }, 400);
  }

  const nullifier = await computeNullifier(uidCommitment!, env.SHUNYA_NULLIFIER_SALT);

  await db.update(sessions)
    .set({ status: 'proof_submitted', stage: 'queued', nullifier })
    .where(eq(sessions.id, sid));

  await verifyProofQueue.add(
    'verify-proof',
    {
      sessionId:     sid,
      orgId:         oid,
      proof:         body.proof,
      publicSignals: body.publicSignals,
      uidCommitment: uidCommitment!,
      nullifier,
    },
    { jobId: `verify:${sid}`, attempts: 5, backoff: { type: 'exponential', delay: 10000 } }
  );

  return c.json({ status: 'queued', sessionId: sid }, 202);
});
```

---

### Task 7: BullMQ Workers

**Files:**
- Create: `apps/api/src/workers/verifyProof.ts`
- Create: `apps/api/src/workers/copyAttestation.ts`
- Create: `apps/api/src/workers/deliverWebhook.ts`
- Create: `apps/api/src/workers/index.ts`

- [ ] **Step 1: Create `apps/api/src/workers/verifyProof.ts`**

```typescript
import { Worker, Queue } from 'bullmq';
import { db } from '@shunya/db';
import { sessions, verifiedUsers, attestations } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import type { Groth16Proof, ZkVerifyReceipt } from '@shunya/shared';
import { redis } from '../services/redis';
import { submitProofToZkVerify } from '../services/zkverify';
import { getOrCreateSmartAccount } from '../services/cdp';
import { callResolverAttest } from '../services/eas';
import { uploadAuditArtifact } from '../services/minio';

const deliverWebhookQueue = new Queue('deliver-webhook', { connection: redis });

interface VerifyProofJob {
  sessionId:     string;
  orgId:         string;
  proof:         Groth16Proof;
  publicSignals: string[];
  uidCommitment: string;
  nullifier:     string;
}

export function startVerifyProofWorker() {
  return new Worker<VerifyProofJob>(
    'verify-proof',
    async (job) => {
      const { sessionId, orgId, proof, publicSignals, uidCommitment, nullifier } = job.data;

      // Stage: zk_verifying
      await db.update(sessions).set({ stage: 'zk_verifying' }).where(eq(sessions.id, sessionId));

      const receipt: ZkVerifyReceipt = await submitProofToZkVerify(proof, publicSignals);

      // Stage: zk_verified
      await db.update(sessions).set({ stage: 'zk_verified' }).where(eq(sessions.id, sessionId));

      // Stage: wallet_creating
      await db.update(sessions).set({ stage: 'wallet_creating' }).where(eq(sessions.id, sessionId));

      const [existingUser] = await db
        .select()
        .from(verifiedUsers)
        .where(eq(verifiedUsers.nullifier, nullifier))
        .limit(1);

      let smartAccountAddress: string;
      let verifiedUserId: string;

      if (existingUser) {
        smartAccountAddress = existingUser.smartAccountAddress;
        verifiedUserId = existingUser.id;
      } else {
        smartAccountAddress = await getOrCreateSmartAccount(nullifier);
        verifiedUserId = `vu_${nanoid(21)}`;

        // Parse public signals
        const [, , genderBitStr, nameHash] = publicSignals;
        const gender = Number(genderBitStr) === 70 ? 'F' : 'M';

        await db.insert(verifiedUsers).values({
          id:                  verifiedUserId,
          nullifier,
          smartAccountAddress,
          nameHash:            nameHash!,
          gender,
          isOver18:            true,
        });
      }

      // Stage: chain_submitting
      await db.update(sessions).set({ stage: 'chain_submitting' }).where(eq(sessions.id, sessionId));

      // Encode public signals for on-chain call
      // abi.encode(bool isOver18, uint8 genderBit, bytes32 nameHash, bytes32 uidCommitment)
      const [, isOver18Str, genderBitStr, nameHash, uidCommit] = publicSignals;
      const publicSignalsEncoded = encodeAbiParameters(
        parseAbiParameters('bool isOver18, uint8 genderBit, bytes32 nameHash, bytes32 uidCommitment'),
        [true, Number(genderBitStr) as any, nameHash as `0x${string}`, uidCommit as `0x${string}`]
      );

      const { txHash, attestationUid } = await callResolverAttest(
        receipt,
        publicSignalsEncoded,
        smartAccountAddress as `0x${string}`
      );

      // Insert attestation row
      const attestationId = `att_${nanoid(21)}`;
      await db.insert(attestations).values({
        id:             attestationId,
        verifiedUserId,
        orgId,
        sessionId,
        attestationUid,
        txHash,
        chain:          'base-sepolia',
        zkverifyReceipt: receipt,
      });

      // Update session to verified
      await db.update(sessions).set({
        status:        'verified',
        stage:         'complete',
        attestationId,
        completedAt:   new Date(),
      }).where(eq(sessions.id, sessionId));

      // Upload audit artifact to MinIO
      await uploadAuditArtifact(sessionId, {
        proof, publicSignals, receipt, txHash, attestationUid,
      }).catch(() => {}); // non-critical

      // Enqueue webhook delivery
      await deliverWebhookQueue.add(
        'deliver-webhook',
        { sessionId, orgId, attestationUid, walletAddress: smartAccountAddress },
        { jobId: `webhook:${sessionId}`, attempts: 6, backoff: { type: 'exponential', delay: 60000 } }
      );
    },
    {
      connection:  redis,
      concurrency: 8,
    }
  );
}
```

- [ ] **Step 2: Create `apps/api/src/workers/copyAttestation.ts`**

```typescript
import { Worker, Queue } from 'bullmq';
import { db } from '@shunya/db';
import { sessions, verifiedUsers, attestations } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { redis } from '../services/redis';
import { callResolverAttest } from '../services/eas';

const deliverWebhookQueue = new Queue('deliver-webhook', { connection: redis });

// Stubbed receipt for returning users — the chain call still needs a valid receipt.
// For Phase 2 returning users, we call ShunyaResolver.attest() with the existing
// verified user's public data. The receipt is reused from the original proof.
// TODO: query the original attestation's zkverify_receipt from DB.
async function getOriginalReceipt(verifiedUserId: string) {
  const [att] = await db
    .select()
    .from(attestations)
    .where(eq(attestations.verifiedUserId, verifiedUserId))
    .orderBy(attestations.createdAt)
    .limit(1);
  return att?.zkverifyReceipt ?? null;
}

interface CopyAttestationJob {
  sessionId:      string;
  orgId:          string;
  verifiedUserId: string;
  nullifier:      string;
}

export function startCopyAttestationWorker() {
  return new Worker<CopyAttestationJob>(
    'copy-attestation',
    async (job) => {
      const { sessionId, orgId, verifiedUserId } = job.data;

      await db.update(sessions).set({ stage: 'chain_submitting' }).where(eq(sessions.id, sessionId));

      const [user] = await db
        .select()
        .from(verifiedUsers)
        .where(eq(verifiedUsers.id, verifiedUserId))
        .limit(1);

      if (!user) throw new Error(`verifiedUser ${verifiedUserId} not found`);

      const receipt = await getOriginalReceipt(verifiedUserId);
      if (!receipt) throw new Error('No original receipt found for returning user');

      const genderBit = user.gender === 'F' ? 70 : 77;
      const publicSignalsEncoded = encodeAbiParameters(
        parseAbiParameters('bool isOver18, uint8 genderBit, bytes32 nameHash, bytes32 uidCommitment'),
        [true, genderBit as any, user.nameHash as `0x${string}`, '0x' + '0'.repeat(64) as `0x${string}`]
      );

      const { txHash, attestationUid } = await callResolverAttest(
        receipt as any,
        publicSignalsEncoded,
        user.smartAccountAddress as `0x${string}`
      );

      const attestationId = `att_${nanoid(21)}`;
      await db.insert(attestations).values({
        id:             attestationId,
        verifiedUserId,
        orgId,
        sessionId,
        attestationUid,
        txHash,
        chain:          'base-sepolia',
        zkverifyReceipt: receipt,
      });

      await db.update(sessions).set({
        status:      'verified',
        stage:       'complete',
        attestationId,
        completedAt: new Date(),
      }).where(eq(sessions.id, sessionId));

      await deliverWebhookQueue.add(
        'deliver-webhook',
        { sessionId, orgId, attestationUid, walletAddress: user.smartAccountAddress },
        { jobId: `webhook:${sessionId}`, attempts: 6, backoff: { type: 'exponential', delay: 60000 } }
      );
    },
    { connection: redis, concurrency: 16 }
  );
}
```

- [ ] **Step 3: Create `apps/api/src/workers/deliverWebhook.ts`**

```typescript
import { Worker } from 'bullmq';
import { db } from '@shunya/db';
import { sessions, webhookEndpoints, webhookDeliveries } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { signWebhook } from '@shunya/shared';
import { redis } from '../services/redis';

interface DeliverWebhookJob {
  sessionId:     string;
  orgId:         string;
  attestationUid: string;
  walletAddress: string;
}

export function startDeliverWebhookWorker() {
  return new Worker<DeliverWebhookJob>(
    'deliver-webhook',
    async (job) => {
      const { sessionId, orgId, attestationUid, walletAddress } = job.data;

      const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
      if (!session) return;

      // Find the active webhook endpoint for this org
      const [endpoint] = await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.orgId, orgId))
        .limit(1);

      // Use session.webhookUrl if no registered endpoint
      const webhookUrl = endpoint?.url ?? session.webhookUrl;
      if (!webhookUrl) return;

      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        sessionId,
        userRef:       session.userRef,
        status:        'verified',
        attestationUid,
        walletAddress,
        claims:        { isOver18: true },
        chain:         'base-sepolia',
        verifiedAt:    new Date().toISOString(),
      };
      const rawBody = JSON.stringify(payload);
      const secret  = endpoint?.secret ?? 'dev-secret';
      const sig     = signWebhook(secret, timestamp, rawBody);

      const deliveryId = `wdl_${nanoid(21)}`;
      await db.insert(webhookDeliveries).values({
        id:         deliveryId,
        endpointId: endpoint?.id ?? 'none',
        sessionId,
        event:      'session.verified',
        payload,
        status:     'pending',
        attempt:    job.attemptsMade,
      });

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type':        'application/json',
          'X-Shunya-Timestamp':  String(timestamp),
          'X-Shunya-Signature':  `sha256=${sig}`,
          'X-Shunya-Event':      'session.verified',
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });

      const status = res.ok ? 'delivered' : 'failed';
      await db.update(webhookDeliveries).set({
        status,
        attempt:      job.attemptsMade + 1,
        responseCode: res.status,
        responseBody: await res.text().catch(() => ''),
        deliveredAt:  res.ok ? new Date() : null,
      }).where(eq(webhookDeliveries.id, deliveryId));

      if (!res.ok) throw new Error(`Webhook delivery failed: HTTP ${res.status}`);
    },
    { connection: redis, concurrency: 32 }
  );
}
```

- [ ] **Step 4: Create `apps/api/src/workers/index.ts`**

```typescript
import { startVerifyProofWorker }      from './verifyProof';
import { startCopyAttestationWorker }  from './copyAttestation';
import { startDeliverWebhookWorker }   from './deliverWebhook';

export function startAllWorkers() {
  const workers = [
    startVerifyProofWorker(),
    startCopyAttestationWorker(),
    startDeliverWebhookWorker(),
  ];

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      console.error(`[worker:${worker.name}] job ${job?.id} failed:`, err.message);
    });
    worker.on('completed', (job) => {
      console.log(`[worker:${worker.name}] job ${job.id} completed`);
    });
  }

  console.log('Workers started: verify-proof, copy-attestation, deliver-webhook');
  return workers;
}
```

---

### Task 8: Hono App Bootstrap

**Files:**
- Create: `apps/api/src/index.ts`

- [ ] **Step 1: Create `apps/api/src/index.ts`**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { env } from './env';
import { sessionsRouter }     from './routes/v1/sessions';
import { attestationsRouter } from './routes/v1/attestations';
import { otpRouter }          from './routes/internal/otp';
import { nullifierRouter }    from './routes/internal/nullifier';
import { proofRouter }        from './routes/internal/proof';
import { startAllWorkers }    from './workers/index';

const app = new Hono();

app.use('*', logger());
app.use('*', cors({
  origin: [env.POPUP_URL, env.DASHBOARD_URL ?? ''],
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Health check
app.get('/healthz', (c) => c.json({ ok: true, ts: Date.now() }));

// Public API routes (sk_ auth)
app.route('/v1/sessions',     sessionsRouter);
app.route('/v1/attestations', attestationsRouter);

// Internal popup routes (JWT session auth)
app.route('/internal/sessions/:id/otp',       otpRouter);
app.route('/internal/sessions/:id/nullifier', nullifierRouter);
app.route('/internal/sessions/:id/proof',     proofRouter);

// Start background workers (same process, split to separate process later if needed)
startAllWorkers();

export default {
  port: 3000,
  fetch: app.fetch,
};
```

Install missing deps:
```bash
pnpm --filter @shunya/api add nanoid @hono/zod-validator
```

- [ ] **Step 2: Start the API and verify it boots**

```bash
pnpm dev:api
```

Expected:
```
Workers started: verify-proof, copy-attestation, deliver-webhook
Listening on http://localhost:3000
```

- [ ] **Step 3: Smoke-test health check**

```bash
curl http://localhost:3000/healthz
```

Expected: `{"ok":true,"ts":...}`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/
git commit -m "feat(api): full Hono API + BullMQ workers — v1 routes, internal routes, workers"
```

---

### Task 9: Update Popup to Use Real API

**Files:**
- Modify: `apps/popup/app/page.tsx` (replace demo flow with real session flow)
- Create: `apps/popup/app/components/OTPFlow.tsx`
- Create: `apps/popup/app/components/NullifierCheck.tsx`

- [ ] **Step 1: Create `apps/popup/app/components/OTPFlow.tsx`**

```tsx
'use client';
import { useState } from 'react';

interface Props {
  sessionId: string;
  sessionToken: string;
  apiUrl: string;
  onVerified: () => void;
}

export function OTPFlow({ sessionId, sessionToken, apiUrl, onVerified }: Props) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestOtp = async () => {
    setLoading(true); setError(null);
    const res = await fetch(`${apiUrl}/internal/sessions/${sessionId}/otp/request`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    setLoading(false);
    if (res.ok) { setStep('otp'); } else {
      const data = await res.json();
      setError(data.error ?? 'Failed to send OTP');
    }
  };

  const verifyOtp = async () => {
    setLoading(true); setError(null);
    const res = await fetch(`${apiUrl}/internal/sessions/${sessionId}/otp/verify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp }),
    });
    setLoading(false);
    if (res.ok) { onVerified(); } else {
      const data = await res.json();
      setError(data.error ?? 'Invalid OTP');
    }
  };

  return (
    <div>
      {step === 'phone' && (
        <div>
          <p style={{ color: '#374151' }}>Enter your mobile number to receive a verification code:</p>
          <input
            type="tel"
            placeholder="+919876543210"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            style={{ padding: '0.5rem', fontSize: '1rem', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%', marginBottom: '0.5rem' }}
          />
          <button
            onClick={requestOtp}
            disabled={loading || phone.length < 10}
            style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', padding: '0.5rem 1.5rem', cursor: 'pointer' }}
          >
            {loading ? 'Sending...' : 'Send OTP'}
          </button>
        </div>
      )}
      {step === 'otp' && (
        <div>
          <p style={{ color: '#374151' }}>Enter the 6-digit code sent to {phone}:</p>
          <input
            type="text"
            placeholder="123456"
            value={otp}
            onChange={e => setOtp(e.target.value)}
            maxLength={6}
            style={{ padding: '0.5rem', fontSize: '1.5rem', letterSpacing: '0.5rem', textAlign: 'center', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%', marginBottom: '0.5rem' }}
          />
          <button
            onClick={verifyOtp}
            disabled={loading || otp.length !== 6}
            style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', padding: '0.5rem 1.5rem', cursor: 'pointer' }}
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </div>
      )}
      {error && <p style={{ color: '#ef4444' }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/popup/app/components/NullifierCheck.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';

interface Props {
  sessionId: string;
  sessionToken: string;
  apiUrl: string;
  qrBytes: Uint8Array;
  onFastPath: () => void;
  onNeedsProof: (uidCommitment: string) => void;
}

export function NullifierCheck({ sessionId, sessionToken, apiUrl, qrBytes, onFastPath, onNeedsProof }: Props) {
  const [status, setStatus] = useState<'checking' | 'done' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Compute uidCommitment client-side using circomlibjs Poseidon
        const { buildPoseidon } = await import('circomlibjs');
        const poseidon = await buildPoseidon();
        const F = poseidon.F;

        // Extract reference ID bytes from QR (field at delimiter position 2)
        // Simplified extraction: find 2nd and 3rd 0xFF delimiters
        let delimCount = 0;
        let start = -1;
        let end = -1;
        for (let i = 0; i < qrBytes.length; i++) {
          if (qrBytes[i] === 255) {
            delimCount++;
            if (delimCount === 2) start = i + 1;
            if (delimCount === 3) { end = i; break; }
          }
        }

        const refIdBytes = start > 0 && end > start ? qrBytes.slice(start, end) : new Uint8Array(31);

        // Pack bytes into a BigInt (big endian, max 31 bytes)
        let packed = BigInt(0);
        const take = Math.min(refIdBytes.length, 31);
        for (let i = 0; i < take; i++) {
          packed = (packed << BigInt(8)) | BigInt(refIdBytes[i]!);
        }

        const commitment = poseidon([packed]);
        const uidCommitment = '0x' + F.toString(commitment, 16).padStart(64, '0');

        const res = await fetch(`${apiUrl}/internal/sessions/${sessionId}/nullifier/check`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uidCommitment }),
        });

        const data = await res.json();
        setStatus('done');

        if (data.status === 'fast_path') {
          onFastPath();
        } else {
          onNeedsProof(uidCommitment);
        }
      } catch (err: any) {
        setStatus('error');
        setError(err.message);
      }
    })();
  }, []);

  if (status === 'checking') return <p style={{ color: '#6366f1' }}>Checking identity...</p>;
  if (status === 'error')    return <p style={{ color: '#ef4444' }}>Error: {error}</p>;
  return null;
}
```

- [ ] **Step 3: Update `apps/popup/app/page.tsx` for real API flow**

Replace the Phase 1 demo page with the full flow:

```tsx
'use client';
import { useState, useEffect } from 'react';
import { QRUploader } from './components/QRUploader';
import { OTPFlow } from './components/OTPFlow';
import { NullifierCheck } from './components/NullifierCheck';
import { ProofRunner } from './components/ProofRunner';
import type { Groth16Proof } from '@shunya/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

type Step = 'otp' | 'qr_upload' | 'nullifier_check' | 'proving' | 'done' | 'fast_path' | 'error';

export default function PopupPage() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('otp');
  const [qrBytes, setQrBytes] = useState<Uint8Array | null>(null);
  const [uidCommitment, setUidCommitment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<string | null>(null);

  // Extract session token from URL ?s=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('s');
    if (s) {
      setSessionToken(s);
      // Decode JWT payload to get sessionId (no verification here — API validates)
      try {
        const payload = JSON.parse(atob(s.split('.')[1]!));
        setSessionId(payload.sid);
      } catch { setError('Invalid session token'); }
    } else {
      setError('No session token in URL');
    }
  }, []);

  // Poll session status after proof is submitted
  useEffect(() => {
    if (step !== 'proving' && step !== 'fast_path') return;
    if (!sessionId || !sessionToken) return;

    const interval = setInterval(async () => {
      try {
        // Poll via /v1/sessions/:id — but that needs a sk_ key. Instead, poll popup status endpoint.
        // For MVP, the popup simply waits and the webhook signals the B2B client.
        // We post a message to the parent when done.
      } catch {}
    }, 2000);

    return () => clearInterval(interval);
  }, [step, sessionId, sessionToken]);

  const handleProofDone = async (proof: Groth16Proof, publicSignals: string[]) => {
    if (!sessionToken || !sessionId || !uidCommitment) return;

    const res = await fetch(`${API_URL}/internal/sessions/${sessionId}/proof`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ proof, publicSignals, uidCommitment }),
    });

    if (res.ok) {
      setStep('done');
      // Notify parent via postMessage
      window.parent?.postMessage({ type: 'shunya:success', payload: { publicSignals } }, '*');
    } else {
      const data = await res.json();
      setError(data.error ?? 'Proof submission failed');
      setStep('error');
    }
  };

  if (!sessionToken) return <p style={{ padding: '2rem' }}>{error ?? 'Loading...'}</p>;

  return (
    <main style={{ maxWidth: '480px', margin: '0 auto', padding: '2rem', fontFamily: 'system-ui' }}>
      <h2 style={{ color: '#1f2937', marginBottom: '1.5rem' }}>Age Verification</h2>

      {step === 'otp' && sessionId && (
        <OTPFlow
          sessionId={sessionId}
          sessionToken={sessionToken}
          apiUrl={API_URL}
          onVerified={() => setStep('qr_upload')}
        />
      )}

      {step === 'qr_upload' && (
        <div>
          <p style={{ color: '#374151' }}>Upload your DigiLocker Aadhaar PDF or QR screenshot:</p>
          <QRUploader
            onDecoded={(bytes) => { setQrBytes(bytes); setStep('nullifier_check'); }}
            onError={(msg) => setError(msg)}
          />
          {error && <p style={{ color: '#ef4444' }}>{error}</p>}
        </div>
      )}

      {step === 'nullifier_check' && qrBytes && sessionId && (
        <NullifierCheck
          sessionId={sessionId}
          sessionToken={sessionToken}
          apiUrl={API_URL}
          qrBytes={qrBytes}
          onFastPath={() => setStep('fast_path')}
          onNeedsProof={(uidC) => { setUidCommitment(uidC); setStep('proving'); }}
        />
      )}

      {step === 'proving' && qrBytes && (
        <ProofRunner qrBytes={qrBytes} onDone={handleProofDone} />
      )}

      {step === 'fast_path' && (
        <p style={{ color: '#22c55e' }}>✓ Identity recognized — verification in progress (usually &lt;5s).</p>
      )}

      {step === 'done' && (
        <p style={{ color: '#22c55e' }}>✓ Verified! You may close this window.</p>
      )}

      {step === 'error' && (
        <p style={{ color: '#ef4444' }}>Verification failed: {error}</p>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Add `NEXT_PUBLIC_API_URL` to popup env**

In `apps/popup/.env.local` (create if absent):
```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_ZKEY_URL=http://localhost:9000/shunya-artifacts/circuit_final.zkey
NEXT_PUBLIC_WASM_URL=http://localhost:9000/shunya-artifacts/shunya.wasm
```

- [ ] **Step 5: Commit**

```bash
git add apps/popup/ apps/api/
git commit -m "feat(phase-2): full pipeline — API, workers, popup wired to real backend"
```

---

## Phase 2 Exit Criteria

- ✅ `curl http://localhost:3000/healthz` returns `{"ok":true,...}`
- ✅ `POST /v1/sessions` with a valid `sk_` key returns `{sessionId, sessionToken, popupUrl}`
- ✅ Popup OTP flow calls `/internal/sessions/:id/otp/request` and `/otp/verify`
- ✅ QR upload → nullifier check → proof submission → `202 Accepted`
- ✅ BullMQ workers start without errors (check logs)
- ✅ End-to-end with a real Aadhaar QR: session reaches `status: verified` in DB
- ✅ Webhook delivery attempt logged in `webhook_deliveries` table



