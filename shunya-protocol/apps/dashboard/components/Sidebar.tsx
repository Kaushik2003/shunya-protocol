'use client';
import { usePathname } from 'next/navigation';
import { logoutAction } from '../src/app/login/actions';

const NAV = [
  { href: '/dashboard',          label: 'Overview'  },
  { href: '/dashboard/keys',     label: 'API Keys'  },
  { href: '/dashboard/webhooks', label: 'Webhooks'  },
  { href: '/dashboard/sessions', label: 'Sessions'  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside style={{ width: '220px', background: 'white', borderRight: '1px solid #e5e7eb', padding: '1.5rem 0', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0 1.5rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
        <span style={{ fontWeight: 700, color: '#6366f1', fontSize: '1.1rem' }}>Shunya</span>
      </div>
      <nav style={{ flex: 1, padding: '1rem 0' }}>
        {NAV.map(({ href, label }) => (
          <a key={href} href={href} style={{
            display: 'block', padding: '0.5rem 1.5rem',
            color:      pathname === href ? '#6366f1' : '#374151',
            fontWeight: pathname === href ? 600 : 400,
            background: pathname === href ? '#eef2ff' : 'transparent',
            textDecoration: 'none', fontSize: '0.9rem',
          }}>
            {label}
          </a>
        ))}
      </nav>
      <form action={logoutAction} style={{ padding: '0 1.5rem' }}>
        <button type="submit" style={{ width: '100%', padding: '0.5rem', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', color: '#6b7280', fontSize: '0.875rem' }}>
          Sign out
        </button>
      </form>
    </aside>
  );
}
