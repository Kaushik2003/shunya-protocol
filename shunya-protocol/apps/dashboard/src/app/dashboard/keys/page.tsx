import { db } from '@shunya/db';
import { apiKeys } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { getSession } from '../../../../lib/getSession';
import { KeyCard } from '../../../../components/KeyCard';
import { CreateKeyForm } from '../../../../components/CreateKeyForm';

export default async function KeysPage() {
  const { user } = await getSession();
  if (!user) return null;

  const keys = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.orgId, user.orgId))
    .orderBy(apiKeys.createdAt);

  return (
    <div>
      <h1 style={{ margin: '0 0 1.5rem', color: '#1f2937' }}>API Keys</h1>

      <div style={{ background: 'white', borderRadius: '8px', padding: '1.25rem', border: '1px solid #e5e7eb', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', color: '#374151', fontSize: '1rem' }}>Create new key</h3>
        <CreateKeyForm />
      </div>

      {keys.length === 0 && <p style={{ color: '#9ca3af' }}>No API keys yet.</p>}

      {keys.map(k => (
        <KeyCard
          key={k.id}
          id={k.id}
          kind={k.kind}
          prefix={k.keyPrefix}
          createdAt={k.createdAt}
          lastUsedAt={k.lastUsedAt}
          revokedAt={k.revokedAt}
        />
      ))}
    </div>
  );
}
