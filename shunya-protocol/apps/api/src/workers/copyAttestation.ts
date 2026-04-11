import { Worker, Queue } from 'bullmq';
import { db } from '@shunya/db';
import { sessions, verifiedUsers, attestations } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { redis } from '../services/redis';
import { callResolverAttest } from '../services/eas';
import { randomId } from '../lib/ids';

const deliverWebhookQueue = new Queue('deliver-webhook', { connection: redis });

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

      const attestationId = randomId('att_');
      await db.insert(attestations).values({
        id:              attestationId,
        verifiedUserId,
        orgId,
        sessionId,
        attestationUid,
        txHash,
        chain:           'base-sepolia',
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
