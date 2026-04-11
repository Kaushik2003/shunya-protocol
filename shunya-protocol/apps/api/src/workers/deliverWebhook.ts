import { Worker } from 'bullmq';
import { db } from '@shunya/db';
import { sessions, webhookEndpoints, webhookDeliveries } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { signWebhook } from '@shunya/shared';
import { redis } from '../services/redis';
import { randomId } from '../lib/ids';

interface DeliverWebhookJob {
  sessionId:      string;
  orgId:          string;
  attestationUid: string;
  walletAddress:  string;
}

export function startDeliverWebhookWorker() {
  return new Worker<DeliverWebhookJob>(
    'deliver-webhook',
    async (job) => {
      const { sessionId, orgId, attestationUid, walletAddress } = job.data;

      const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
      if (!session) return;

      // Find the active webhook endpoint for this org
      const [endpoint] = await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.orgId, orgId))
        .limit(1);

      // Use session.webhookUrl if no registered endpoint
      const webhookUrl = endpoint?.url ?? session.webhookUrl;
      if (!webhookUrl) return;

      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        sessionId,
        userRef:       session.userRef,
        status:        'verified',
        attestationUid,
        walletAddress,
        claims:        { isOver18: true },
        chain:         'base-sepolia',
        verifiedAt:    new Date().toISOString(),
      };
      const rawBody = JSON.stringify(payload);
      const secret  = endpoint?.secret ?? 'dev-secret';
      const sig     = signWebhook(secret, timestamp, rawBody);

      const endpointId = endpoint?.id ?? null;
      const deliveryId = endpointId ? randomId('wdl_') : null;
      if (deliveryId && endpointId) {
        await db.insert(webhookDeliveries).values({
          id:         deliveryId,
          endpointId,
          sessionId,
          event:      'session.verified',
          payload,
          status:     'pending',
          attempt:    job.attemptsMade,
        });
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type':       'application/json',
          'X-Shunya-Timestamp': String(timestamp),
          'X-Shunya-Signature': `sha256=${sig}`,
          'X-Shunya-Event':     'session.verified',
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });

      if (deliveryId) {
        const status = res.ok ? 'delivered' : 'failed';
        await db.update(webhookDeliveries).set({
          status,
          attempt:      job.attemptsMade + 1,
          responseCode: res.status,
          responseBody: await res.text().catch(() => ''),
          deliveredAt:  res.ok ? new Date() : null,
        }).where(eq(webhookDeliveries.id, deliveryId));
      }

      if (!res.ok) throw new Error(`Webhook delivery failed: HTTP ${res.status}`);
    },
    { connection: redis, concurrency: 32 }
  );
}
