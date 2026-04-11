import { Hono } from 'hono';
import { db } from '@shunya/db';
import { sessions } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { SubmitProofSchema, computeNullifier } from '@shunya/shared';
import { sessionAuth } from '../../middleware/sessionAuth';
import { env } from '../../env';
import { Queue } from 'bullmq';
import { redis } from '../../services/redis';

const verifyProofQueue = new Queue('verify-proof', { connection: redis });

export const proofRouter = new Hono();

proofRouter.post('/', sessionAuth, async (c) => {
  const { sid, oid } = c.get('session');
  const json = await c.req.json().catch(() => null);
  const parsed = SubmitProofSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400);
  const body = parsed.data;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
  if (!session || session.status !== 'phone_verified') {
    return c.json({ error: 'Session not eligible for proof submission' }, 400);
  }

  // publicSignals order: [pubkeyHash, isOver18, genderBit, nameHash, uidCommitment]
  const [, isOver18Str, , , uidCommitment] = body.publicSignals;

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
