interface Props {
  sessionId:   string;
  userRef:     string;
  status:      string;
  createdAt:   Date;
  completedAt: Date | null;
}

const STATUS_COLORS: Record<string, string> = {
  verified: '#22c55e',
  failed:   '#ef4444',
  pending:  '#f59e0b',
  expired:  '#9ca3af',
};

export function SessionRow({ sessionId, userRef, status, createdAt, completedAt }: Props) {
  return (
    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
      <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#374151' }}>{sessionId.slice(0, 20)}...</td>
      <td style={{ padding: '0.75rem', color: '#374151' }}>{userRef}</td>
      <td style={{ padding: '0.75rem' }}>
        <span style={{ color: STATUS_COLORS[status] ?? '#374151', fontWeight: 600, fontSize: '0.85rem' }}>
          {status}
        </span>
      </td>
      <td style={{ padding: '0.75rem', color: '#6b7280', fontSize: '0.85rem' }}>{createdAt.toLocaleString()}</td>
      <td style={{ padding: '0.75rem', color: '#6b7280', fontSize: '0.85rem' }}>{completedAt?.toLocaleString() ?? '—'}</td>
    </tr>
  );
}
