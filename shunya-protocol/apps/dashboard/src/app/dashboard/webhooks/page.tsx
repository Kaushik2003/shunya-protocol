import { db } from '@shunya/db';
import { webhookEndpoints } from '@shunya/db';
import { eq, and } from 'drizzle-orm';
import { getSession } from '../../../../lib/getSession';
import { WebhookCard } from '../../../../components/WebhookCard';
import { CreateWebhookForm } from '../../../../components/CreateWebhookForm';

export default async function WebhooksPage() {
  const { user } = await getSession();
  if (!user) return null;

  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.orgId, user.orgId), eq(webhookEndpoints.active, true)))
    .orderBy(webhookEndpoints.createdAt);

  return (
    <div>
      <h1 style={{ marginTop: 0, color: '#1f2937' }}>Webhooks</h1>

      <div style={{ background: 'white', borderRadius: '8px', padding: '1.25rem', border: '1px solid #e5e7eb', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#374151' }}>Add webhook endpoint</h3>
        <CreateWebhookForm />
      </div>

      {endpoints.length === 0 && <p style={{ color: '#9ca3af' }}>No webhook endpoints yet.</p>}

      {endpoints.map(ep => (
        <WebhookCard
          key={ep.id}
          id={ep.id}
          url={ep.url}
          events={ep.events}
          active={ep.active}
          createdAt={ep.createdAt}
        />
      ))}
    </div>
  );
}
