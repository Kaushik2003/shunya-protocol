'use client';
import { deleteWebhookAction } from '../src/app/dashboard/webhooks/actions';

interface Props {
  id:        string;
  url:       string;
  events:    string[];
  active:    boolean;
  createdAt: Date;
}

export function WebhookCard({ id, url, events, active, createdAt }: Props) {
  return (
    <div style={{
      background: 'white', borderRadius: '8px', padding: '1rem 1.25rem',
      border: '1px solid #e5e7eb', marginBottom: '0.75rem',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    }}>
      <div>
        <code style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: '#374151' }}>{url}</code>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: '#9ca3af' }}>
          Events: {events.join(', ')} · Created {createdAt.toLocaleDateString()}
        </p>
      </div>
      {active && (
        <form action={deleteWebhookAction.bind(null, id)}>
          <button type="submit"
            style={{ background: 'none', border: '1px solid #fca5a5', color: '#ef4444', borderRadius: '6px', padding: '0.25rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            Remove
          </button>
        </form>
      )}
    </div>
  );
}
