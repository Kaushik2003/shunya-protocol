# Phase 3 — B2B Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js 14 B2B dashboard (`apps/dashboard`) with Lucia cookie auth, allowing B2B clients to log in, create/revoke API keys, manage webhook endpoints, and view session history.

**Architecture:** Next.js 14 App Router. Lucia handles session auth (HTTP-only cookie, 7-day sliding). Dashboard has four sections: API Keys, Webhooks, Sessions log, Account. All mutations go through Next.js Server Actions or route handlers. Reads use React Server Components.

**Tech Stack:** Next.js 14, Lucia 3.2, @lucia-auth/adapter-drizzle 1.1, oslo 1.2.1, argon2 0.41, Drizzle, zod.

**Pre-requisites:**
- Phase 0 complete (monorepo scaffold, DB schema)
- Phase 2 complete (API running, NeonDB populated)
- `DATABASE_URL` available in `.env`

---

## Files Created in This Phase

```
apps/dashboard/
  next.config.js
  middleware.ts                 Lucia session cookie validation
  app/
    layout.tsx                  Root layout
    login/
      page.tsx                  Login form (email + password)
      actions.ts                Server actions: login, logout
    register/
      page.tsx                  Registration form (first org setup)
      actions.ts                Server action: register
    dashboard/
      layout.tsx                Authenticated layout with sidebar
      page.tsx                  Overview (stats)
      keys/
        page.tsx                List API keys
        actions.ts              Create / revoke API key
      webhooks/
        page.tsx                List webhook endpoints
        actions.ts              Create / delete webhook endpoint
      sessions/
        page.tsx                Session log with status filter
  lib/
    auth.ts                     Lucia instance + adapter
    db.ts                       Re-export db client
  components/
    Sidebar.tsx
    KeyCard.tsx
    WebhookCard.tsx
    SessionRow.tsx
```

---

### Task 1: Lucia Auth Setup

**Files:**
- Create: `apps/dashboard/next.config.js`
- Create: `apps/dashboard/lib/auth.ts`
- Create: `apps/dashboard/lib/db.ts`
- Create: `apps/dashboard/middleware.ts`

- [ ] **Step 1: Create `apps/dashboard/next.config.js`**

```js
/** @type {import('next').NextConfig} */
module.exports = {
  experimental: { serverActions: { allowedOrigins: ['localhost:3002'] } },
};
```

- [ ] **Step 2: Create `apps/dashboard/lib/db.ts`**

```typescript
export { db } from '@shunya/db';
```

- [ ] **Step 3: Create `apps/dashboard/lib/auth.ts`**

```typescript
import { Lucia } from 'lucia';
import { DrizzlePostgreSQLAdapter } from '@lucia-auth/adapter-drizzle';
import { db } from '@shunya/db';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// Lucia requires a `sessions` table of its own (different from our verification sessions table).
// We define it inline here. Add it to the Drizzle schema in packages/db/src/schema.ts as well.
export const authSessionsTable = pgTable('auth_sessions', {
  id:        text('id').primaryKey(),
  userId:    text('user_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

const adapter = new DrizzlePostgreSQLAdapter(db, authSessionsTable, {
  // The users table Lucia uses — matches packages/db/src/schema.ts `users` table
  id:       'id',
  username: 'email',
} as any);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    name: 'shunya_auth_session',
    attributes: {
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  },
  getUserAttributes: (attributes: any) => ({
    email: attributes.email,
    orgId: attributes.org_id,
    role:  attributes.role,
  }),
});

declare module 'lucia' {
  interface Register {
    Lucia:         typeof lucia;
    DatabaseUserAttributes: {
      email:  string;
      org_id: string;
      role:   string;
    };
  }
}
```

> **Important:** Add `auth_sessions` table to `packages/db/src/schema.ts` and run `pnpm db:generate && pnpm db:migrate`.

`packages/db/src/schema.ts` — append:
```typescript
export const authSessions = pgTable('auth_sessions', {
  id:        text('id').primaryKey(),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
```

Then:
```bash
pnpm db:generate && pnpm db:migrate
```

- [ ] **Step 4: Create `apps/dashboard/middleware.ts`**

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('shunya_auth_session');
  const isAuthPage = request.nextUrl.pathname.startsWith('/login') ||
                     request.nextUrl.pathname.startsWith('/register');

  if (!sessionCookie && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (sessionCookie && isAuthPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/
git commit -m "feat(dashboard): lucia auth setup, middleware"
```

---

### Task 2: Login and Registration Pages

**Files:**
- Create: `apps/dashboard/app/layout.tsx`
- Create: `apps/dashboard/app/login/page.tsx`
- Create: `apps/dashboard/app/login/actions.ts`
- Create: `apps/dashboard/app/register/page.tsx`
- Create: `apps/dashboard/app/register/actions.ts`

- [ ] **Step 1: Create `apps/dashboard/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Shunya Dashboard' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb' }}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create `apps/dashboard/app/login/actions.ts`**

```typescript
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import argon2 from 'argon2';
import { db } from '@shunya/db';
import { users } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { lucia } from '../../lib/auth';

export async function loginAction(formData: FormData) {
  const email    = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) return { error: 'Email and password required' };

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { error: 'Invalid credentials' };

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) return { error: 'Invalid credentials' };

  const session = await lucia.createSession(user.id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

  redirect('/dashboard');
}

export async function logoutAction() {
  const sessionId = cookies().get('shunya_auth_session')?.value;
  if (sessionId) await lucia.invalidateSession(sessionId);
  cookies().delete('shunya_auth_session');
  redirect('/login');
}
```

- [ ] **Step 3: Create `apps/dashboard/app/login/page.tsx`**

```tsx
import { loginAction } from './actions';

export default function LoginPage() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '2rem', width: '360px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h1 style={{ marginTop: 0, color: '#1f2937', fontSize: '1.5rem' }}>Sign in to Shunya</h1>
        <form action={loginAction}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Email</span>
            <input
              name="email"
              type="email"
              required
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }}
            />
          </label>
          <label style={{ display: 'block', marginBottom: '1.5rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Password</span>
            <input
              name="password"
              type="password"
              required
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }}
            />
          </label>
          <button
            type="submit"
            style={{ width: '100%', padding: '0.625rem', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer' }}
          >
            Sign in
          </button>
        </form>
        <p style={{ marginTop: '1rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
          No account? <a href="/register" style={{ color: '#6366f1' }}>Register</a>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Create `apps/dashboard/app/register/actions.ts`**

```typescript
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { db } from '@shunya/db';
import { users, organizations } from '@shunya/db';
import { lucia } from '../../lib/auth';

export async function registerAction(formData: FormData) {
  const orgName  = formData.get('orgName')  as string;
  const email    = formData.get('email')    as string;
  const password = formData.get('password') as string;

  if (!orgName || !email || !password) return { error: 'All fields required' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters' };

  const slug         = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const orgId        = `org_${nanoid(21)}`;
  const userId       = `usr_${nanoid(21)}`;
  const passwordHash = await argon2.hash(password, { memoryCost: 65536 });

  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: orgId, name: orgName, slug,
    });
    await tx.insert(users).values({
      id: userId, orgId, email, passwordHash, role: 'owner',
    });
  });

  const session = await lucia.createSession(userId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

  redirect('/dashboard');
}
```

- [ ] **Step 5: Create `apps/dashboard/app/register/page.tsx`**

```tsx
import { registerAction } from './actions';

export default function RegisterPage() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '2rem', width: '400px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h1 style={{ marginTop: 0, color: '#1f2937', fontSize: '1.5rem' }}>Create your Shunya account</h1>
        <form action={registerAction}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Organization name</span>
            <input name="orgName" type="text" required
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }} />
          </label>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Email</span>
            <input name="email" type="email" required
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }} />
          </label>
          <label style={{ display: 'block', marginBottom: '1.5rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Password</span>
            <input name="password" type="password" required minLength={8}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }} />
          </label>
          <button type="submit"
            style={{ width: '100%', padding: '0.625rem', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer' }}>
            Create account
          </button>
        </form>
        <p style={{ marginTop: '1rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
          Already have an account? <a href="/login" style={{ color: '#6366f1' }}>Sign in</a>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/app/login/ apps/dashboard/app/register/ apps/dashboard/app/layout.tsx
git commit -m "feat(dashboard): login + registration pages with Lucia auth"
```

---

### Task 3: Auth Helper + Session Validation

**Files:**
- Create: `apps/dashboard/lib/getSession.ts`

- [ ] **Step 1: Create `apps/dashboard/lib/getSession.ts`**

```typescript
import { cookies } from 'next/headers';
import { cache } from 'react';
import { lucia } from './auth';

export const getSession = cache(async () => {
  const sessionId = cookies().get('shunya_auth_session')?.value ?? null;
  if (!sessionId) return { user: null, session: null };

  const result = await lucia.validateSession(sessionId);

  // Slide the session cookie
  if (result.session?.fresh) {
    const newCookie = lucia.createSessionCookie(result.session.id);
    cookies().set(newCookie.name, newCookie.value, newCookie.attributes);
  }
  if (!result.session) {
    const blank = lucia.createBlankSessionCookie();
    cookies().set(blank.name, blank.value, blank.attributes);
  }

  return result;
});
```

---

### Task 4: Dashboard Layout + Sidebar

**Files:**
- Create: `apps/dashboard/components/Sidebar.tsx`
- Create: `apps/dashboard/app/dashboard/layout.tsx`
- Create: `apps/dashboard/app/dashboard/page.tsx`

- [ ] **Step 1: Create `apps/dashboard/components/Sidebar.tsx`**

```tsx
import { logoutAction } from '../app/login/actions';

const NAV = [
  { href: '/dashboard',          label: 'Overview' },
  { href: '/dashboard/keys',     label: 'API Keys' },
  { href: '/dashboard/webhooks', label: 'Webhooks' },
  { href: '/dashboard/sessions', label: 'Sessions' },
];

export function Sidebar({ currentPath }: { currentPath: string }) {
  return (
    <aside style={{ width: '220px', background: 'white', borderRight: '1px solid #e5e7eb', padding: '1.5rem 0', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0 1.5rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
        <span style={{ fontWeight: 700, color: '#6366f1', fontSize: '1.1rem' }}>Shunya</span>
      </div>
      <nav style={{ flex: 1, padding: '1rem 0' }}>
        {NAV.map(({ href, label }) => (
          <a key={href} href={href} style={{
            display: 'block', padding: '0.5rem 1.5rem',
            color: currentPath === href ? '#6366f1' : '#374151',
            fontWeight: currentPath === href ? 600 : 400,
            background: currentPath === href ? '#eef2ff' : 'transparent',
            textDecoration: 'none', fontSize: '0.9rem',
          }}>
            {label}
          </a>
        ))}
      </nav>
      <form action={logoutAction} style={{ padding: '0 1.5rem' }}>
        <button type="submit" style={{ width: '100%', padding: '0.5rem', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', color: '#6b7280', fontSize: '0.875rem' }}>
          Sign out
        </button>
      </form>
    </aside>
  );
}
```

- [ ] **Step 2: Create `apps/dashboard/app/dashboard/layout.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSession } from '../../lib/getSession';
import { Sidebar } from '../../components/Sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getSession();
  if (!user) redirect('/login');

  const headersList = headers();
  const currentPath = headersList.get('x-invoke-path') ?? '/dashboard';

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar currentPath={currentPath} />
      <main style={{ flex: 1, padding: '2rem', maxWidth: '900px' }}>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/dashboard/app/dashboard/page.tsx`**

```tsx
import { getSession } from '../../lib/getSession';
import { db } from '@shunya/db';
import { sessions, apiKeys, attestations } from '@shunya/db';
import { eq, count, and, gte } from 'drizzle-orm';

export default async function OverviewPage() {
  const { user } = await getSession();
  if (!user) return null;

  const orgId = user.orgId;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [sessionCount] = await db
    .select({ count: count() })
    .from(sessions)
    .where(and(eq(sessions.orgId, orgId), gte(sessions.createdAt, monthStart)));

  const [verifiedCount] = await db
    .select({ count: count() })
    .from(sessions)
    .where(and(eq(sessions.orgId, orgId), eq(sessions.status, 'verified'), gte(sessions.createdAt, monthStart)));

  const [keyCount] = await db
    .select({ count: count() })
    .from(apiKeys)
    .where(eq(apiKeys.orgId, orgId));

  return (
    <div>
      <h1 style={{ color: '#1f2937', marginTop: 0 }}>Overview</h1>
      <p style={{ color: '#6b7280' }}>Welcome back, {user.email}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '1.5rem' }}>
        {[
          { label: 'Sessions this month', value: sessionCount?.count ?? 0 },
          { label: 'Verified this month', value: verifiedCount?.count ?? 0 },
          { label: 'Active API keys',     value: keyCount?.count ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'white', borderRadius: '8px', padding: '1.25rem', border: '1px solid #e5e7eb' }}>
            <p style={{ margin: 0, color: '#6b7280', fontSize: '0.85rem' }}>{label}</p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '2rem', fontWeight: 700, color: '#1f2937' }}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/dashboard/ apps/dashboard/components/ apps/dashboard/lib/
git commit -m "feat(dashboard): authenticated layout, sidebar, overview page"
```

---

### Task 5: API Keys Management

**Files:**
- Create: `apps/dashboard/app/dashboard/keys/page.tsx`
- Create: `apps/dashboard/app/dashboard/keys/actions.ts`
- Create: `apps/dashboard/components/KeyCard.tsx`

- [ ] **Step 1: Create `apps/dashboard/app/dashboard/keys/actions.ts`**

```typescript
'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { nanoid } from 'nanoid';
import argon2 from 'argon2';
import { db } from '@shunya/db';
import { apiKeys } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { getSession } from '../../../lib/getSession';

export async function createApiKeyAction(formData: FormData): Promise<{ key?: string; error?: string }> {
  const { user } = await getSession();
  if (!user) return { error: 'Not authenticated' };

  const kind = formData.get('kind') as 'publishable' | 'secret';
  if (!['publishable', 'secret'].includes(kind)) return { error: 'Invalid key kind' };

  const prefix  = kind === 'secret' ? 'sk_live' : 'pk_live';
  const rawKey  = `${prefix}_${nanoid(32)}`;
  const keyHash = await argon2.hash(rawKey, { memoryCost: 65536 });
  const keyId   = `key_${nanoid(21)}`;

  await db.insert(apiKeys).values({
    id:        keyId,
    orgId:     user.orgId,
    kind,
    keyPrefix: rawKey.slice(0, 12),
    keyHash,
    scopes:    [],
  });

  revalidatePath('/dashboard/keys');
  // Return the raw key ONCE — it won't be retrievable after this
  return { key: rawKey };
}

export async function revokeApiKeyAction(keyId: string): Promise<void> {
  const { user } = await getSession();
  if (!user) return;

  await db.update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, keyId));

  revalidatePath('/dashboard/keys');
}
```

- [ ] **Step 2: Create `apps/dashboard/components/KeyCard.tsx`**

```tsx
'use client';
import { revokeApiKeyAction } from '../app/dashboard/keys/actions';

interface Props {
  id:        string;
  kind:      string;
  prefix:    string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export function KeyCard({ id, kind, prefix, createdAt, lastUsedAt, revokedAt }: Props) {
  const revoked = !!revokedAt;

  return (
    <div style={{
      background: 'white', borderRadius: '8px', padding: '1rem 1.25rem',
      border: '1px solid #e5e7eb', marginBottom: '0.75rem',
      opacity: revoked ? 0.5 : 1,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <code style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: '#374151' }}>{prefix}...</code>
        <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', background: '#e0e7ff', color: '#4338ca', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>
          {kind}
        </span>
        {revoked && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#ef4444' }}>revoked</span>}
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#9ca3af' }}>
          Created {createdAt.toLocaleDateString()}
          {lastUsedAt && ` · Last used ${lastUsedAt.toLocaleDateString()}`}
        </p>
      </div>
      {!revoked && (
        <form action={revokeApiKeyAction.bind(null, id)}>
          <button type="submit"
            style={{ background: 'none', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: '6px', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            Revoke
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/dashboard/app/dashboard/keys/page.tsx`**

```tsx
import { db } from '@shunya/db';
import { apiKeys } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { getSession } from '../../../lib/getSession';
import { createApiKeyAction } from './actions';
import { KeyCard } from '../../../components/KeyCard';

export default async function KeysPage() {
  const { user } = await getSession();
  if (!user) return null;

  const keys = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.orgId, user.orgId))
    .orderBy(apiKeys.createdAt);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, color: '#1f2937' }}>API Keys</h1>
      </div>

      <div style={{ background: 'white', borderRadius: '8px', padding: '1.25rem', border: '1px solid #e5e7eb', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', color: '#374151', fontSize: '1rem' }}>Create new key</h3>
        <form action={createApiKeyAction} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select name="kind" style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.9rem' }}>
            <option value="secret">Secret key (server-only)</option>
            <option value="publishable">Publishable key (browser)</option>
          </select>
          <button type="submit"
            style={{ padding: '0.4rem 1rem', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
            Create
          </button>
        </form>
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#9ca3af' }}>
          The full key is shown <strong>once</strong> at creation. Store it immediately.
        </p>
      </div>

      {keys.length === 0 && <p style={{ color: '#9ca3af' }}>No API keys yet.</p>}

      {keys.map(k => (
        <KeyCard
          key={k.id}
          id={k.id}
          kind={k.kind}
          prefix={k.keyPrefix}
          createdAt={k.createdAt}
          lastUsedAt={k.lastUsedAt}
          revokedAt={k.revokedAt}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/dashboard/keys/ apps/dashboard/components/KeyCard.tsx
git commit -m "feat(dashboard): API key management — create, list, revoke"
```

---

### Task 6: Webhook Endpoints Management

**Files:**
- Create: `apps/dashboard/app/dashboard/webhooks/page.tsx`
- Create: `apps/dashboard/app/dashboard/webhooks/actions.ts`
- Create: `apps/dashboard/components/WebhookCard.tsx`

- [ ] **Step 1: Create `apps/dashboard/app/dashboard/webhooks/actions.ts`**

```typescript
'use server';
import { revalidatePath } from 'next/cache';
import { nanoid } from 'nanoid';
import { db } from '@shunya/db';
import { webhookEndpoints } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { getSession } from '../../../lib/getSession';

export async function createWebhookAction(formData: FormData) {
  const { user } = await getSession();
  if (!user) return;

  const url    = formData.get('url') as string;
  const secret = `whsec_${nanoid(32)}`;

  if (!url || !url.startsWith('https://')) {
    return { error: 'URL must start with https://' };
  }

  await db.insert(webhookEndpoints).values({
    id:     `wh_${nanoid(21)}`,
    orgId:  user.orgId,
    url,
    secret,
    events: ['session.verified', 'session.failed'],
    active: true,
  });

  revalidatePath('/dashboard/webhooks');
  return { secret }; // shown once
}

export async function deleteWebhookAction(endpointId: string) {
  const { user } = await getSession();
  if (!user) return;

  await db.update(webhookEndpoints)
    .set({ active: false })
    .where(eq(webhookEndpoints.id, endpointId));

  revalidatePath('/dashboard/webhooks');
}
```

- [ ] **Step 2: Create `apps/dashboard/components/WebhookCard.tsx`**

```tsx
'use client';
import { deleteWebhookAction } from '../app/dashboard/webhooks/actions';

interface Props {
  id:        string;
  url:       string;
  events:    string[];
  active:    boolean;
  createdAt: Date;
}

export function WebhookCard({ id, url, events, active, createdAt }: Props) {
  return (
    <div style={{
      background: 'white', borderRadius: '8px', padding: '1rem 1.25rem',
      border: '1px solid #e5e7eb', marginBottom: '0.75rem',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    }}>
      <div>
        <code style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: '#374151' }}>{url}</code>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#9ca3af' }}>
          Events: {events.join(', ')} · Created {createdAt.toLocaleDateString()}
        </p>
      </div>
      {active && (
        <form action={deleteWebhookAction.bind(null, id)}>
          <button type="submit"
            style={{ background: 'none', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: '6px', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            Remove
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/dashboard/app/dashboard/webhooks/page.tsx`**

```tsx
import { db } from '@shunya/db';
import { webhookEndpoints } from '@shunya/db';
import { eq, and } from 'drizzle-orm';
import { getSession } from '../../../lib/getSession';
import { createWebhookAction } from './actions';
import { WebhookCard } from '../../../components/WebhookCard';

export default async function WebhooksPage() {
  const { user } = await getSession();
  if (!user) return null;

  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.orgId, user.orgId), eq(webhookEndpoints.active, true)))
    .orderBy(webhookEndpoints.createdAt);

  return (
    <div>
      <h1 style={{ marginTop: 0, color: '#1f2937' }}>Webhooks</h1>

      <div style={{ background: 'white', borderRadius: '8px', padding: '1.25rem', border: '1px solid #e5e7eb', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151' }}>Add webhook endpoint</h3>
        <form action={createWebhookAction} style={{ display: 'flex', gap: '0.75rem' }}>
          <input
            name="url"
            type="url"
            placeholder="https://your-app.com/hooks/shunya"
            required
            style={{ flex: 1, padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.9rem' }}
          />
          <button type="submit"
            style={{ padding: '0.4rem 1rem', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
            Add
          </button>
        </form>
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#9ca3af' }}>
          The webhook signing secret is shown once at creation. Verify signatures with X-Shunya-Signature.
        </p>
      </div>

      {endpoints.length === 0 && <p style={{ color: '#9ca3af' }}>No webhook endpoints yet.</p>}

      {endpoints.map(ep => (
        <WebhookCard
          key={ep.id}
          id={ep.id}
          url={ep.url}
          events={ep.events}
          active={ep.active}
          createdAt={ep.createdAt}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/dashboard/webhooks/ apps/dashboard/components/WebhookCard.tsx
git commit -m "feat(dashboard): webhook endpoint management"
```

---

### Task 7: Sessions Log

**Files:**
- Create: `apps/dashboard/components/SessionRow.tsx`
- Create: `apps/dashboard/app/dashboard/sessions/page.tsx`

- [ ] **Step 1: Create `apps/dashboard/components/SessionRow.tsx`**

```tsx
interface Props {
  sessionId: string;
  userRef:   string;
  status:    string;
  createdAt: Date;
  completedAt: Date | null;
}

const STATUS_COLORS: Record<string, string> = {
  verified: '#22c55e',
  failed:   '#ef4444',
  pending:  '#f59e0b',
  expired:  '#9ca3af',
};

export function SessionRow({ sessionId, userRef, status, createdAt, completedAt }: Props) {
  return (
    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
      <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#374151' }}>{sessionId.slice(0, 20)}...</td>
      <td style={{ padding: '0.75rem', color: '#374151' }}>{userRef}</td>
      <td style={{ padding: '0.75rem' }}>
        <span style={{ color: STATUS_COLORS[status] ?? '#374151', fontWeight: 600, fontSize: '0.85rem' }}>
          {status}
        </span>
      </td>
      <td style={{ padding: '0.75rem', color: '#6b7280', fontSize: '0.85rem' }}>{createdAt.toLocaleString()}</td>
      <td style={{ padding: '0.75rem', color: '#6b7280', fontSize: '0.85rem' }}>{completedAt?.toLocaleString() ?? '—'}</td>
    </tr>
  );
}
```

- [ ] **Step 2: Create `apps/dashboard/app/dashboard/sessions/page.tsx`**

```tsx
import { db } from '@shunya/db';
import { sessions } from '@shunya/db';
import { eq, desc } from 'drizzle-orm';
import { getSession } from '../../../lib/getSession';
import { SessionRow } from '../../../components/SessionRow';

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const { user } = await getSession();
  if (!user) return null;

  const query = db
    .select()
    .from(sessions)
    .where(eq(sessions.orgId, user.orgId))
    .orderBy(desc(sessions.createdAt))
    .limit(100);

  const rows = await query;

  const filtered = searchParams.status
    ? rows.filter(r => r.status === searchParams.status)
    : rows;

  const STATUS_TABS = ['all', 'verified', 'failed', 'pending', 'expired'];

  return (
    <div>
      <h1 style={{ marginTop: 0, color: '#1f2937' }}>Sessions</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {STATUS_TABS.map(s => (
          <a key={s} href={s === 'all' ? '/dashboard/sessions' : `/dashboard/sessions?status=${s}`}
            style={{
              padding: '0.3rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem',
              background: (searchParams.status ?? 'all') === s ? '#6366f1' : 'white',
              color:      (searchParams.status ?? 'all') === s ? 'white' : '#374151',
              border:     '1px solid #e5e7eb', textDecoration: 'none',
            }}>
            {s}
          </a>
        ))}
      </div>

      {filtered.length === 0 && <p style={{ color: '#9ca3af' }}>No sessions found.</p>}

      {filtered.length > 0 && (
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['Session ID', 'User Ref', 'Status', 'Created', 'Completed'].map(h => (
                  <th key={h} style={{ padding: '0.75rem', textAlign: 'left', color: '#6b7280', fontWeight: 600, fontSize: '0.8rem' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <SessionRow
                  key={row.id}
                  sessionId={row.id}
                  userRef={row.userRef}
                  status={row.status}
                  createdAt={row.createdAt}
                  completedAt={row.completedAt}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/dashboard/sessions/ apps/dashboard/components/SessionRow.tsx
git commit -m "feat(dashboard): sessions log with status filter"
```

---

### Task 8: Verify Dashboard Boots

- [ ] **Step 1: Start the dashboard dev server**

```bash
pnpm dev:dashboard
```

Expected: Next.js starts on http://localhost:3002

- [ ] **Step 2: Register a test account**

Open http://localhost:3002/register — create an org + user. You should be redirected to `/dashboard`.

- [ ] **Step 3: Create an API key**

Navigate to `/dashboard/keys` → Create secret key. The full key should appear once in a success message (add a `useActionState` or flash banner — optional for MVP).

- [ ] **Step 4: Final commit**

```bash
git add apps/dashboard/
git commit -m "feat(phase-3): complete dashboard — auth, keys, webhooks, sessions"
```

---

## Phase 3 Exit Criteria

- ✅ `pnpm dev:dashboard` starts without errors at http://localhost:3002
- ✅ Registration creates an org + user in NeonDB
- ✅ Login redirects to `/dashboard`
- ✅ API key creation inserts a row in `api_keys`, shows key prefix in the list
- ✅ Webhook endpoint creation inserts a row in `webhook_endpoints`
- ✅ Sessions log shows rows from the `sessions` table filtered by org
- ✅ Logout clears the Lucia session cookie and redirects to login
