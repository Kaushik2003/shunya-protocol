import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { db } from '@shunya/db';
import { sessions } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { CreateSessionSchema } from '@shunya/shared';
import { apiKeyAuth } from '../../middleware/apiKeyAuth';
import { env } from '../../env';
import { randomId } from '../../lib/ids';

export const sessionsRouter = new Hono();

const secret = new TextEncoder().encode(env.JWT_SECRET);

sessionsRouter.post('/', apiKeyAuth, async (c) => {
  const auth = c.get('auth');
  const json = await c.req.json().catch(() => null);
  const parsed = CreateSessionSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400);
  const body = parsed.data;

  const sessionId = randomId('ses_');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

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
    sid:       sessionId,
    oid:       auth.orgId,
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
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Session not found' }, 404);

  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row || row.orgId !== auth.orgId) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json({
    sessionId:     row.id,
    status:        row.status,
    stage:         row.stage,
    attestationId: row.attestationId,
    createdAt:     row.createdAt,
    completedAt:   row.completedAt,
    expiresAt:     row.expiresAt,
  });
});
