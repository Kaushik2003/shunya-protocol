import { Hono } from 'hono';
import { db } from '@shunya/db';
import { sessions, verifiedUsers } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { NullifierCheckSchema, computeNullifier } from '@shunya/shared';
import { sessionAuth } from '../../middleware/sessionAuth';
import { env } from '../../env';
import { Queue } from 'bullmq';
import { redis } from '../../services/redis';

const copyAttestationQueue = new Queue('copy-attestation', { connection: redis });

export const nullifierRouter = new Hono();

nullifierRouter.post('/check', sessionAuth, async (c) => {
  const { sid, oid } = c.get('session');
  const json = await c.req.json().catch(() => null);
  const parsed = NullifierCheckSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400);
  const { uidCommitment } = parsed.data;

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
