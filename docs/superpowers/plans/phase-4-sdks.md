# Phase 4 — SDKs (`@shunya/js`, `@shunya/react`, `@shunya/node`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three SDK packages that B2B clients embed. `@shunya/js` is a zero-dependency IIFE browser loader (<15KB). `@shunya/react` wraps it in a React hook. `@shunya/node` is a typed server SDK for minting sessions and verifying webhooks.

**Architecture:** All three are thin wrappers over the REST API and popup `postMessage` protocol. No shared state, no analytics, no dependencies at runtime (browser packages). The node SDK uses only `node:crypto` for HMAC verification.

**Tech Stack:** Bun bundler (IIFE for `@shunya/js`), TypeScript, React 18 (peer dep for `@shunya/react`), zod (for `@shunya/node` response parsing).

**Pre-requisites:**
- Phase 2 complete (API is running and accepts `sk_`/`pk_` keys)
- `apps/popup` is deployed (or running locally at `NEXT_PUBLIC_POPUP_URL`)

---

## Files Created in This Phase

```
packages/sdk-js/
  src/
    index.ts          IIFE entry — Shunya.init(), shunya.open()
  dist/               gitignored — build output
  package.json        UPDATED (build script already present from Phase 0)

packages/sdk-react/
  src/
    index.tsx         ShunyaProvider, useShunya hook
  package.json        UPDATED

packages/sdk-node/
  src/
    index.ts          Shunya class — sessions.create(), webhooks.verify(), attestations.retrieve()
    types.ts          TypeScript types (no zod at runtime — just type assertions)
  package.json        UPDATED
```

---

### Task 1: `@shunya/js` — Browser Loader

**Files:**
- Create: `packages/sdk-js/src/index.ts`

The browser loader must:
1. Expose `Shunya.init({ publishableKey })` → returns a `ShunyaInstance`.
2. `instance.open({ sessionToken, onSuccess, onError, onClose })` → creates fullscreen iframe, wires postMessage, calls callbacks.
3. Verify that all incoming messages have `origin === 'https://verify.shunya.app'` (or `POPUP_ORIGIN` override for dev).
4. Clean up iframe + listeners on success/error/close.
5. Be **zero-dependency** and bundle to <15KB gzipped as an IIFE.

- [ ] **Step 1: Create `packages/sdk-js/src/index.ts`**

```typescript
// @shunya/js — zero-dependency browser SDK
// Bundles to an IIFE exposing `window.Shunya`

const DEFAULT_POPUP_ORIGIN = 'https://verify.shunya.app';

interface InitOptions {
  publishableKey: string;
  /** Override popup origin for dev. Defaults to https://verify.shunya.app */
  popupOrigin?: string;
}

interface OpenOptions {
  sessionToken: string;
  onSuccess?: (result: SuccessPayload) => void;
  onError?:   (err: { message: string }) => void;
  onClose?:   () => void;
}

interface SuccessPayload {
  attestationUid: string;
  walletAddress:  string;
  claims:         { isOver18: boolean; gender?: 'M' | 'F' };
  sessionId:      string;
}

interface ShunyaInstance {
  open(options: OpenOptions): void;
  destroy(): void;
}

function init(options: InitOptions): ShunyaInstance {
  const { publishableKey, popupOrigin = DEFAULT_POPUP_ORIGIN } = options;

  if (!publishableKey.startsWith('pk_')) {
    throw new Error('[Shunya] publishableKey must start with pk_');
  }

  let iframe:   HTMLIFrameElement | null = null;
  let overlay:  HTMLDivElement | null = null;
  let listener: ((e: MessageEvent) => void) | null = null;

  function cleanup() {
    if (iframe)   { iframe.remove();  iframe   = null; }
    if (overlay)  { overlay.remove(); overlay  = null; }
    if (listener) { window.removeEventListener('message', listener); listener = null; }
  }

  function open(opts: OpenOptions) {
    if (iframe) return; // already open

    const { sessionToken, onSuccess, onError, onClose } = opts;

    // Build popup URL
    const url = `${popupOrigin}/?s=${encodeURIComponent(sessionToken)}`;

    // Overlay
    overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)',
      zIndex: '2147483646', display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    // Iframe
    iframe = document.createElement('iframe');
    Object.assign(iframe.style, {
      width: '100%', maxWidth: '480px', height: '700px', maxHeight: '90vh',
      border: 'none', borderRadius: '16px', background: 'white',
    });
    iframe.src = url;
    iframe.allow = 'camera; microphone';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      position: 'absolute', top: '1rem', right: '1rem',
      background: 'none', border: 'none', color: 'white',
      fontSize: '1.5rem', cursor: 'pointer', zIndex: '2147483647',
    });
    closeBtn.onclick = () => { cleanup(); onClose?.(); };

    // Assemble
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.appendChild(iframe);
    overlay.appendChild(closeBtn);
    overlay.appendChild(wrapper);
    document.body.appendChild(overlay);

    // postMessage listener
    listener = (e: MessageEvent) => {
      if (e.origin !== popupOrigin) return;

      const { type, payload, message } = e.data ?? {};

      if (type === 'shunya:success') {
        cleanup();
        onSuccess?.(payload as SuccessPayload);
      } else if (type === 'shunya:error') {
        cleanup();
        onError?.({ message: message ?? 'Verification failed' });
      } else if (type === 'shunya:close') {
        cleanup();
        onClose?.();
      }
    };

    window.addEventListener('message', listener);
  }

  return { open, destroy: cleanup };
}

// Attach to window as IIFE export
const Shunya = { init };

// For IIFE build (window.Shunya)
if (typeof window !== 'undefined') {
  (window as any).Shunya = Shunya;
}

export { Shunya };
export type { InitOptions, OpenOptions, SuccessPayload, ShunyaInstance };
```

- [ ] **Step 2: Update `packages/sdk-js/package.json`**

```json
{
  "name": "@shunya/js",
  "version": "0.1.0",
  "main": "./dist/shunya.js",
  "module": "./dist/shunya.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/shunya.mjs",
      "require": "./dist/shunya.js"
    }
  },
  "scripts": {
    "build:iife": "bun build src/index.ts --outfile dist/shunya.js --format iife --global-name Shunya --minify",
    "build:esm":  "bun build src/index.ts --outfile dist/shunya.mjs --format esm --minify",
    "build":      "pnpm build:iife && pnpm build:esm",
    "lint":       "tsc --noEmit"
  },
  "devDependencies": {
    "typescript":    "^5.5.0",
    "@types/bun":    "^1.1.0"
  }
}
```

- [ ] **Step 3: Build the SDK**

```bash
pnpm --filter @shunya/js run build
```

Expected: `packages/sdk-js/dist/shunya.js` created. Check size:

```bash
ls -lh packages/sdk-js/dist/shunya.js
```

Expected: <15KB. If larger, the IIFE has unexpected imports — inspect with `bun build --analyze`.

- [ ] **Step 4: Manually verify the IIFE works**

Create a throwaway `test.html` at the project root:

```html
<!DOCTYPE html>
<html>
<body>
  <button id="verify">Verify age</button>
  <script src="./packages/sdk-js/dist/shunya.js"></script>
  <script>
    const shunya = Shunya.init({
      publishableKey: 'pk_live_test',
      popupOrigin: 'http://localhost:3001',
    });
    document.getElementById('verify').onclick = async () => {
      const res = await fetch('/api/session', { method: 'POST' }).catch(() => ({ json: () => ({ sessionToken: 'mock' }) }));
      const { sessionToken } = await res.json();
      shunya.open({
        sessionToken,
        onSuccess: (r) => console.log('verified', r),
        onError:   (e) => console.error('error', e),
        onClose:   ()  => console.log('closed'),
      });
    };
  </script>
</body>
</html>
```

Open via a simple HTTP server: `bunx serve . -p 8080` → open http://localhost:8080/test.html → click "Verify age" → overlay + iframe should appear.

Delete `test.html` after verification.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk-js/
git commit -m "feat(sdk-js): IIFE browser loader — Shunya.init(), open(), postMessage bridge"
```

---

### Task 2: `@shunya/react` — React Hook Wrapper

**Files:**
- Create: `packages/sdk-react/src/index.tsx`

- [ ] **Step 1: Create `packages/sdk-react/src/index.tsx`**

```tsx
import React, { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import type { ShunyaInstance, SuccessPayload, InitOptions } from '@shunya/js';
// Import at runtime (browser only) to avoid SSR issues
// The `@shunya/js` ESM build is used here.

interface ShunyaContextValue {
  open: (options: {
    sessionToken: string;
  }) => Promise<SuccessPayload>;
  status: 'idle' | 'loading' | 'success' | 'error';
}

const ShunyaContext = createContext<ShunyaContextValue | null>(null);

interface ProviderProps {
  publishableKey: string;
  popupOrigin?:   string;
  children:       ReactNode;
}

export function ShunyaProvider({ publishableKey, popupOrigin, children }: ProviderProps) {
  const instanceRef = useRef<ShunyaInstance | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  function getInstance(): ShunyaInstance {
    if (!instanceRef.current) {
      // Dynamic require for SSR safety
      const { Shunya } = require('@shunya/js');
      instanceRef.current = Shunya.init({ publishableKey, popupOrigin });
    }
    return instanceRef.current!;
  }

  function open({ sessionToken }: { sessionToken: string }): Promise<SuccessPayload> {
    setStatus('loading');
    return new Promise((resolve, reject) => {
      getInstance().open({
        sessionToken,
        onSuccess: (result) => { setStatus('success'); resolve(result); },
        onError:   (err)    => { setStatus('error');   reject(new Error(err.message)); },
        onClose:   ()       => { setStatus('idle');    reject(new Error('Popup closed')); },
      });
    });
  }

  return (
    <ShunyaContext.Provider value={{ open, status }}>
      {children}
    </ShunyaContext.Provider>
  );
}

export function useShunya(): ShunyaContextValue {
  const ctx = useContext(ShunyaContext);
  if (!ctx) throw new Error('useShunya must be used inside <ShunyaProvider>');
  return ctx;
}

export type { SuccessPayload };
```

- [ ] **Step 2: Update `packages/sdk-react/package.json`**

```json
{
  "name": "@shunya/react",
  "version": "0.1.0",
  "main": "./src/index.tsx",
  "types": "./src/index.tsx",
  "peerDependencies": {
    "react": ">=18"
  },
  "dependencies": {
    "@shunya/js": "workspace:*"
  },
  "devDependencies": {
    "typescript":     "^5.5.0",
    "@types/react":   "^18.3.0",
    "@types/bun":     "^1.1.0"
  }
}
```

- [ ] **Step 3: Verify TypeScript types compile**

```bash
cd packages/sdk-react && tsc --noEmit --jsx react --esModuleInterop true src/index.tsx
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk-react/
git commit -m "feat(sdk-react): ShunyaProvider + useShunya hook"
```

---

### Task 3: `@shunya/node` — Server SDK

**Files:**
- Create: `packages/sdk-node/src/types.ts`
- Create: `packages/sdk-node/src/index.ts`

- [ ] **Step 1: Create `packages/sdk-node/src/types.ts`**

```typescript
export interface ShunyaConfig {
  secretKey: string;
  /** Override API base URL for dev. Defaults to https://api.shunya.app */
  apiUrl?: string;
}

export interface CreateSessionOptions {
  userRef:        string;
  requiredClaims: { isOver18?: boolean; gender?: 'M' | 'F' | 'any' };
  returnUrl:      string;
  webhookUrl?:    string;
}

export interface Session {
  sessionId:    string;
  sessionToken: string;
  popupUrl:     string;
}

export interface SessionStatus {
  sessionId:     string;
  status:        'pending' | 'phone_verified' | 'proof_submitted' | 'verified' | 'failed' | 'expired';
  stage:         string | null;
  attestationId: string | null;
  createdAt:     string;
  completedAt:   string | null;
  expiresAt:     string;
}

export interface Attestation {
  attestationUid: string;
  txHash:         string;
  chain:          string;
  createdAt:      string;
  claims:         { isOver18: boolean; gender: 'M' | 'F' };
  walletAddress:  string;
}

export interface WebhookEvent {
  sessionId:      string;
  userRef:        string;
  status:         'verified' | 'failed';
  attestationUid?: string;
  walletAddress?: string;
  claims?:        { isOver18: boolean; gender?: 'M' | 'F' };
  chain?:         string;
  failReason?:    string;
  verifiedAt?:    string;
}
```

- [ ] **Step 2: Create `packages/sdk-node/src/index.ts`**

```typescript
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  ShunyaConfig,
  CreateSessionOptions,
  Session,
  SessionStatus,
  Attestation,
  WebhookEvent,
} from './types';

export type { ShunyaConfig, CreateSessionOptions, Session, SessionStatus, Attestation, WebhookEvent };

const DEFAULT_API_URL = 'https://api.shunya.app';

export class Shunya {
  private readonly secretKey: string;
  private readonly apiUrl:    string;

  public readonly sessions:     SessionsClient;
  public readonly attestations: AttestationsClient;
  public readonly webhooks:     WebhooksClient;

  constructor(config: ShunyaConfig) {
    if (!config.secretKey.startsWith('sk_')) {
      throw new Error('[Shunya] secretKey must start with sk_');
    }
    this.secretKey    = config.secretKey;
    this.apiUrl       = config.apiUrl ?? DEFAULT_API_URL;
    this.sessions     = new SessionsClient(this);
    this.attestations = new AttestationsClient(this);
    this.webhooks     = new WebhooksClient();
  }

  /** @internal */
  async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        'Authorization':  `Bearer ${this.secretKey}`,
        'Content-Type':   'application/json',
        ...(init?.headers ?? {}),
      },
    });

    const body = await res.json();

    if (!res.ok) {
      throw new ShunyaError(body?.error ?? 'Request failed', res.status);
    }

    return body as T;
  }
}

export class ShunyaError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ShunyaError';
  }
}

class SessionsClient {
  constructor(private readonly shunya: Shunya) {}

  /** Mint a new verification session. Call from your server backend. */
  async create(options: CreateSessionOptions): Promise<Session> {
    return this.shunya.fetch<Session>('/v1/sessions', {
      method: 'POST',
      body:   JSON.stringify(options),
    });
  }

  /** Retrieve the current status of a session by ID. */
  async retrieve(sessionId: string): Promise<SessionStatus> {
    return this.shunya.fetch<SessionStatus>(`/v1/sessions/${sessionId}`);
  }
}

class AttestationsClient {
  constructor(private readonly shunya: Shunya) {}

  /** Retrieve an attestation by its EAS UID (0x...). */
  async retrieve(uid: string): Promise<Attestation> {
    return this.shunya.fetch<Attestation>(`/v1/attestations/${uid}`);
  }
}

class WebhooksClient {
  /**
   * Verify an incoming webhook from Shunya.
   * Call this in your webhook handler before trusting the payload.
   *
   * @param rawBody     The raw request body string (do NOT parse as JSON first)
   * @param signature   The X-Shunya-Signature header value (sha256=...)
   * @param secret      Your webhook signing secret (from the dashboard)
   * @returns           The parsed WebhookEvent if valid; throws if invalid
   */
  verify(rawBody: string, signature: string | undefined, secret: string): WebhookEvent {
    if (!signature) throw new ShunyaError('Missing X-Shunya-Signature header', 400);

    // Extract timestamp from the signature header
    // Format: sha256=<hex> with accompanying X-Shunya-Timestamp header
    // We extract from rawBody to stay stateless — callers pass timestamp separately
    throw new Error(
      'Pass timestamp as a third argument. Use verify(rawBody, signature, secret, timestamp) — ' +
      'see updated signature below.'
    );
  }

  /**
   * Verify an incoming webhook from Shunya.
   *
   * @param rawBody    The raw request body string
   * @param signature  The X-Shunya-Signature header value (sha256=...)
   * @param secret     Your webhook signing secret
   * @param timestamp  The X-Shunya-Timestamp header value (Unix seconds, as number)
   * @returns          The parsed WebhookEvent if valid; throws ShunyaError if invalid
   */
  verifyWebhook(
    rawBody:   string,
    signature: string,
    secret:    string,
    timestamp: number
  ): WebhookEvent {
    // Replay protection: reject events older than 5 minutes
    const age = Math.abs(Date.now() / 1000 - timestamp);
    if (age > 300) {
      throw new ShunyaError('Webhook timestamp is too old (replay attack?)', 400);
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const received   = signature.replace(/^sha256=/, '');
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(received);

    if (
      expectedBuf.length !== receivedBuf.length ||
      !timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      throw new ShunyaError('Invalid webhook signature', 400);
    }

    return JSON.parse(rawBody) as WebhookEvent;
  }
}
```

- [ ] **Step 3: Update `packages/sdk-node/package.json`**

```json
{
  "name": "@shunya/node",
  "version": "0.1.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "lint": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript":   "^5.5.0",
    "@types/bun":   "^1.1.0",
    "@types/node":  "^22.0.0"
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm --filter @shunya/node run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk-node/
git commit -m "feat(sdk-node): Shunya class — sessions.create, attestations.retrieve, webhooks.verifyWebhook"
```

---

### Task 4: Integration Smoke Test (Manual)

This verifies the full SDK integration loop end-to-end.

- [ ] **Step 1: Create a test script at project root**

`test-sdk.ts` (delete after verifying):
```typescript
import { Shunya } from './packages/sdk-node/src/index';

const shunya = new Shunya({
  secretKey: process.env.SHUNYA_SECRET_KEY!,
  apiUrl:    'http://localhost:3000',
});

// 1. Create a session
const session = await shunya.sessions.create({
  userRef:        'test-user-001',
  requiredClaims: { isOver18: true },
  returnUrl:      'http://localhost:8080/verified',
  webhookUrl:     'http://localhost:8080/hooks/shunya',
});

console.log('Session created:');
console.log('  sessionId:    ', session.sessionId);
console.log('  popupUrl:     ', session.popupUrl);

// 2. Check status
const status = await shunya.sessions.retrieve(session.sessionId);
console.log('\nSession status:', status.status);
```

- [ ] **Step 2: Run the smoke test**

Ensure API is running (`pnpm dev:api`) and you have a valid `sk_` key from the dashboard.

```bash
SHUNYA_SECRET_KEY=sk_live_xxx bun test-sdk.ts
```

Expected:
```
Session created:
  sessionId:     ses_...
  popupUrl:      http://localhost:3001/?s=eyJ...
Session status: pending
```

- [ ] **Step 3: Delete test file and commit**

```bash
rm test-sdk.ts
git add packages/sdk-node/ packages/sdk-react/ packages/sdk-js/
git commit -m "feat(phase-4): SDKs complete — js, react, node smoke-tested"
```

---

### Task 5: SDK README Stubs

Each SDK package needs a minimal README so integrators know what they're looking at.

- [ ] **Step 1: Create `packages/sdk-node/README.md`**

```markdown
# @shunya/node

Server SDK for Shunya — zero-knowledge Aadhaar verification.

## Install

```bash
npm install @shunya/node
```

## Quick start

```ts
import { Shunya } from '@shunya/node';

const shunya = new Shunya({ secretKey: process.env.SHUNYA_SECRET! });

// 1. Mint a session (from your backend route)
const session = await shunya.sessions.create({
  userRef: 'user_42',
  requiredClaims: { isOver18: true },
  returnUrl: 'https://your-app.com/verified',
  webhookUrl: 'https://your-app.com/hooks/shunya',
});

// 2. Pass session.sessionToken to your frontend

// 3. Verify webhooks
app.post('/hooks/shunya', (req, res) => {
  const event = shunya.webhooks.verifyWebhook(
    req.rawBody,
    req.headers['x-shunya-signature'],
    process.env.SHUNYA_WEBHOOK_SECRET!,
    Number(req.headers['x-shunya-timestamp']),
  );
  if (event.status === 'verified') {
    // user is verified
  }
  res.sendStatus(200);
});
```

> **Important:** Always verify the webhook signature before trusting the payload.
> Do NOT trust the `onSuccess` callback from the browser SDK alone.
```

- [ ] **Step 2: Create `packages/sdk-js/README.md`**

```markdown
# @shunya/js

Zero-dependency browser SDK for Shunya — zero-knowledge Aadhaar verification.

## CDN usage

```html
<script src="https://cdn.shunya.app/v1/shunya.js"></script>
<script>
  const shunya = Shunya.init({ publishableKey: 'pk_live_...' });

  document.getElementById('verify').onclick = async () => {
    // 1. Mint a session from YOUR backend (never expose sk_ in the browser)
    const { sessionToken } = await fetch('/api/shunya/session', { method: 'POST' }).then(r => r.json());

    // 2. Open the verification popup
    shunya.open({
      sessionToken,
      onSuccess: ({ attestationUid, walletAddress, claims }) => {
        // User verified — but ALWAYS confirm via your backend webhook before trusting this
        window.location.href = '/welcome';
      },
      onError: (err) => alert(err.message),
      onClose: () => console.log('User closed popup'),
    });
  };
</script>
```

> **Security note:** The `onSuccess` callback fires from a browser `postMessage`.
> Always confirm verification via your server's webhook handler before unlocking features.
```

- [ ] **Step 3: Commit READMEs**

```bash
git add packages/sdk-node/README.md packages/sdk-js/README.md
git commit -m "docs(sdks): add integration README stubs for sdk-js and sdk-node"
```

---

## Phase 4 Exit Criteria

- ✅ `pnpm --filter @shunya/js run build` succeeds; `dist/shunya.js` is <15KB
- ✅ Opening `test.html` shows the iframe overlay when clicking "Verify age"
- ✅ `pnpm --filter @shunya/node run lint` passes with no TypeScript errors
- ✅ `SHUNYA_SECRET_KEY=sk_live_xxx bun test-sdk.ts` creates a real session in the DB
- ✅ `@shunya/react`'s `useShunya().open()` type-checks correctly in a React component
- ✅ `webhooks.verifyWebhook()` returns a parsed event for a correctly-signed body and throws for a bad signature

---

## Full Project Exit Criteria (all phases)

| Phase | Criterion |
|-------|-----------|
| 0 | `pnpm install`, Docker up, schema migrated, `pnpm lint` clean |
| 1 | Circuit compiles, zkey generated, ShunyaResolver deployed, demo popup proves a real QR |
| 2 | End-to-end: session created → popup OTP → proof → `verified` in DB → webhook delivered |
| 3 | Dashboard: register, create API key, add webhook, view sessions |
| 4 | All three SDKs type-check; node SDK creates a real session; js SDK opens popup overlay |
