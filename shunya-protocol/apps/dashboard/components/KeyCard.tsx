'use client';
import { revokeApiKeyAction } from '../src/app/dashboard/keys/actions';

interface Props {
  id:         string;
  kind:       string;
  prefix:     string;
  createdAt:  Date;
  lastUsedAt: Date | null;
  revokedAt:  Date | null;
}

export function KeyCard({ id, kind, prefix, createdAt, lastUsedAt, revokedAt }: Props) {
  const revoked = !!revokedAt;

  return (
    <div style={{
      background: 'white', borderRadius: '8px', padding: '1rem 1.25rem',
      border: '1px solid #e5e7eb', marginBottom: '0.75rem',
      opacity: revoked ? 0.5 : 1,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <code style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: '#374151' }}>{prefix}...</code>
        <span style={{ marginLeft: '0.75rem', fontSize: '0.75rem', background: '#e0e7ff', color: '#4338ca', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>
          {kind}
        </span>
        {revoked && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#ef4444' }}>revoked</span>}
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#9ca3af' }}>
          Created {createdAt.toLocaleDateString()}
          {lastUsedAt && ` · Last used ${lastUsedAt.toLocaleDateString()}`}
        </p>
      </div>
      {!revoked && (
        <form action={revokeApiKeyAction.bind(null, id)}>
          <button type="submit"
            style={{ background: 'none', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: '6px', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            Revoke
          </button>
        </form>
      )}
    </div>
  );
}
