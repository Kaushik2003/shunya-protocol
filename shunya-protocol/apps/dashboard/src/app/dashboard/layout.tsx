import { redirect } from 'next/navigation';
import { getSession } from '../../../lib/getSession';
import { Sidebar } from '../../../components/Sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getSession();
  if (!user) redirect('/login');

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', maxWidth: '900px' }}>
        {children}
      </main>
    </div>
  );
}
