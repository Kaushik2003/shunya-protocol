import { Worker, Queue } from 'bullmq';
import { db } from '@shunya/db';
import { sessions, verifiedUsers, attestations } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import type { Groth16Proof, ZkVerifyReceipt } from '@shunya/shared';
import { redis } from '../services/redis';
import { submitProofToZkVerify } from '../services/zkverify';
import { getOrCreateSmartAccount } from '../services/cdp';
import { callResolverAttest } from '../services/eas';
import { uploadAuditArtifact } from '../services/minio';
import { randomId } from '../lib/ids';

const deliverWebhookQueue = new Queue('deliver-webhook', { connection: redis });

interface VerifyProofJob {
  sessionId:     string;
  orgId:         string;
  proof:         Groth16Proof;
  publicSignals: string[];
  uidCommitment: string;
  nullifier:     string;
}

export function startVerifyProofWorker() {
  return new Worker<VerifyProofJob>(
    'verify-proof',
    async (job) => {
      const { sessionId, orgId, proof, publicSignals, nullifier } = job.data;

      // Stage: zk_verifying
      await db.update(sessions).set({ stage: 'zk_verifying' }).where(eq(sessions.id, sessionId));

      const receipt: ZkVerifyReceipt = await submitProofToZkVerify(proof, publicSignals);

      // Stage: zk_verified
      await db.update(sessions).set({ stage: 'zk_verified' }).where(eq(sessions.id, sessionId));

      // Stage: wallet_creating
      await db.update(sessions).set({ stage: 'wallet_creating' }).where(eq(sessions.id, sessionId));

      const [existingUser] = await db
        .select()
        .from(verifiedUsers)
        .where(eq(verifiedUsers.nullifier, nullifier))
        .limit(1);

      let smartAccountAddress: string;
      let verifiedUserId: string;

      if (existingUser) {
        smartAccountAddress = existingUser.smartAccountAddress;
        verifiedUserId = existingUser.id;
      } else {
        smartAccountAddress = await getOrCreateSmartAccount(nullifier);
        verifiedUserId = randomId('vu_');

        // publicSignals order: [pubkeyHash, isOver18, genderBit, nameHash, uidCommitment]
        const [, , genderBitStr, nameHash] = publicSignals;
        const gender = Number(genderBitStr) === 70 ? 'F' : 'M';

        await db.insert(verifiedUsers).values({
          id:                  verifiedUserId,
          nullifier,
          smartAccountAddress,
          nameHash:            nameHash!,
          gender,
          isOver18:            true,
        });
      }

      // Stage: chain_submitting
      await db.update(sessions).set({ stage: 'chain_submitting' }).where(eq(sessions.id, sessionId));

      const [, , genderBitStr, nameHash, uidCommit] = publicSignals;
      const publicSignalsEncoded = encodeAbiParameters(
        parseAbiParameters('bool isOver18, uint8 genderBit, bytes32 nameHash, bytes32 uidCommitment'),
        [true, Number(genderBitStr) as any, nameHash as `0x${string}`, uidCommit as `0x${string}`]
      );

      const { txHash, attestationUid } = await callResolverAttest(
        receipt,
        publicSignalsEncoded,
        smartAccountAddress as `0x${string}`
      );

      // Insert attestation row
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

      // Update session to verified
      await db.update(sessions).set({
        status:        'verified',
        stage:         'complete',
        attestationId,
        completedAt:   new Date(),
      }).where(eq(sessions.id, sessionId));

      // Upload audit artifact to MinIO (non-critical)
      await uploadAuditArtifact(sessionId, {
        proof, publicSignals, receipt, txHash, attestationUid,
      }).catch(() => {});

      // Enqueue webhook delivery
      await deliverWebhookQueue.add(
        'deliver-webhook',
        { sessionId, orgId, attestationUid, walletAddress: smartAccountAddress },
        { jobId: `webhook:${sessionId}`, attempts: 6, backoff: { type: 'exponential', delay: 60000 } }
      );
    },
    {
      connection:  redis,
      concurrency: 8,
    }
  );
}
