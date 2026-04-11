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
