import { Hono } from 'hono';
import { db } from '@shunya/db';
import { sessions, attestations, verifiedUsers } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { sessionAuth } from '../../middleware/sessionAuth';

export const statusRouter = new Hono();

statusRouter.get('/', sessionAuth, async (c) => {
  const { sid, oid } = c.get('session');
  const { id } = c.req.param();

  // Ensure the session token can only access its own session ID.
  if (id !== sid) return c.json({ error: 'Forbidden' }, 403);

  const [row] = await db
    .select({
      session:     sessions,
      attestation: attestations,
      user:        verifiedUsers,
    })
    .from(sessions)
    .leftJoin(attestations, eq(attestations.id, sessions.attestationId))
    .leftJoin(verifiedUsers, eq(verifiedUsers.id, attestations.verifiedUserId))
    .where(eq(sessions.id, sid))
    .limit(1);

  if (!row) return c.json({ error: 'Session not found' }, 404);

  // Extra guard (should be redundant because sid came from the JWT)
  if (row.session.orgId !== oid) return c.json({ error: 'Session not found' }, 404);

  const base = {
    sessionId:     row.session.id,
    status:        row.session.status,
    stage:         row.session.stage,
    attestationId: row.session.attestationId,
    failReason:    row.session.failReason,
    createdAt:     row.session.createdAt,
    completedAt:   row.session.completedAt,
    expiresAt:     row.session.expiresAt,
  };

  if (row.session.status !== 'verified' || !row.attestation || !row.user) {
    return c.json(base);
  }

  return c.json({
    ...base,
    attestationUid: row.attestation.attestationUid,
    walletAddress:  row.user.smartAccountAddress,
    claims: {
      isOver18: row.user.isOver18,
      gender:   row.user.gender,
    },
    verifiedAt: row.session.completedAt,
  });
});

