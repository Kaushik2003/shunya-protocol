import { Hono } from 'hono';
import { db } from '@shunya/db';
import { attestations, verifiedUsers } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { apiKeyAuth } from '../../middleware/apiKeyAuth';

export const attestationsRouter = new Hono();

attestationsRouter.get('/:uid', apiKeyAuth, async (c) => {
  const uid = c.req.param('uid');
  if (!uid) return c.json({ error: 'Attestation not found' }, 404);

  const [row] = await db
    .select({
      attestation: attestations,
      user:        verifiedUsers,
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
      isOver18: row.user.isOver18,
      gender:   row.user.gender,
    },
    walletAddress: row.user.smartAccountAddress,
  });
});
