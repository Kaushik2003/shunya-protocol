import type { Context, Next } from 'hono';
import argon2 from 'argon2';
import { db } from '@shunya/db';
import { apiKeys } from '@shunya/db';
import { eq } from 'drizzle-orm';
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
