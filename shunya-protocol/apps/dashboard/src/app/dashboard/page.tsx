import { getSession } from '../../../lib/getSession';
import { db } from '@shunya/db';
import { sessions, apiKeys } from '@shunya/db';
import { eq, count, and, gte } from 'drizzle-orm';

export default async function OverviewPage() {
  const { user } = await getSession();
  if (!user) return null;

  const orgId      = user.orgId;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [sessionCount] = await db
    .select({ count: count() })
    .from(sessions)
    .where(and(eq(sessions.orgId, orgId), gte(sessions.createdAt, monthStart)));

  const [verifiedCount] = await db
    .select({ count: count() })
    .from(sessions)
    .where(and(eq(sessions.orgId, orgId), eq(sessions.status, 'verified'), gte(sessions.createdAt, monthStart)));

  const [keyCount] = await db
    .select({ count: count() })
    .from(apiKeys)
    .where(eq(apiKeys.orgId, orgId));

  return (
    <div>
      <h1 style={{ color: '#1f2937', marginTop: 0 }}>Overview</h1>
      <p style={{ color: '#6b7280' }}>Welcome back, {user.email}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '1.5rem' }}>
        {[
          { label: 'Sessions this month', value: sessionCount?.count ?? 0 },
          { label: 'Verified this month', value: verifiedCount?.count ?? 0 },
          { label: 'Active API keys',     value: keyCount?.count ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'white', borderRadius: '8px', padding: '1.25rem', border: '1px solid #e5e7eb' }}>
            <p style={{ margin: 0, color: '#6b7280', fontSize: '0.85rem' }}>{label}</p>
            <p style={{ margin: '0.25rem 0 0', fontSize: '2rem', fontWeight: 700, color: '#1f2937' }}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
