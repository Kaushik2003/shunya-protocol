import { db } from '@shunya/db';
import { sessions } from '@shunya/db';
import { eq, desc } from 'drizzle-orm';
import { getSession } from '../../../../lib/getSession';
import { SessionRow } from '../../../../components/SessionRow';

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const { user } = await getSession();
  if (!user) return null;

  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.orgId, user.orgId))
    .orderBy(desc(sessions.createdAt))
    .limit(100);

  const filtered = searchParams.status
    ? rows.filter(r => r.status === searchParams.status)
    : rows;

  const STATUS_TABS = ['all', 'verified', 'failed', 'pending', 'expired'];

  return (
    <div>
      <h1 style={{ marginTop: 0, color: '#1f2937' }}>Sessions</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {STATUS_TABS.map(s => (
          <a key={s} href={s === 'all' ? '/dashboard/sessions' : `/dashboard/sessions?status=${s}`}
            style={{
              padding: '0.3rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem',
              background: (searchParams.status ?? 'all') === s ? '#6366f1' : 'white',
              color:      (searchParams.status ?? 'all') === s ? 'white' : '#374151',
              border:     '1px solid #e5e7eb', textDecoration: 'none',
            }}>
            {s}
          </a>
        ))}
      </div>

      {filtered.length === 0 && <p style={{ color: '#9ca3af' }}>No sessions found.</p>}

      {filtered.length > 0 && (
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['Session ID', 'User Ref', 'Status', 'Created', 'Completed'].map(h => (
                  <th key={h} style={{ padding: '0.75rem', textAlign: 'left', color: '#6b7280', fontWeight: 600, fontSize: '0.8rem' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <SessionRow
                  key={row.id}
                  sessionId={row.id}
                  userRef={row.userRef}
                  status={row.status}
                  createdAt={row.createdAt}
                  completedAt={row.completedAt}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
