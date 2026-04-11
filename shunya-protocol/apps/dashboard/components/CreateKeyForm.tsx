'use client';
import { useFormState } from 'react-dom';
import { createApiKeyAction, type CreateKeyState } from '../src/app/dashboard/keys/actions';

const initialState: CreateKeyState = {};

export function CreateKeyForm() {
  const [state, formAction] = useFormState(createApiKeyAction, initialState);

  return (
    <div>
      {state.key && (
        <div style={{ padding: '1rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', marginBottom: '1rem' }}>
          <p style={{ margin: '0 0 0.5rem', color: '#166534', fontWeight: 600 }}>
            Key created — copy it now. It will never be shown again.
          </p>
          <code style={{
            display: 'block', fontFamily: 'monospace', fontSize: '0.85rem',
            wordBreak: 'break-all', color: '#15803d',
            background: '#dcfce7', padding: '0.5rem 0.75rem', borderRadius: '6px',
          }}>
            {state.key}
          </code>
        </div>
      )}
      {state.error && (
        <p style={{ color: '#ef4444', marginBottom: '0.75rem' }}>{state.error}</p>
      )}
      <form action={formAction} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <select name="kind" style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.9rem' }}>
          <option value="secret">Secret key (server-only)</option>
          <option value="publishable">Publishable key (browser)</option>
        </select>
        <button type="submit"
          style={{ padding: '0.4rem 1rem', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
          Create
        </button>
      </form>
      <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#9ca3af' }}>
        The full key is shown <strong>once</strong> at creation. Store it immediately.
      </p>
    </div>
  );
}
