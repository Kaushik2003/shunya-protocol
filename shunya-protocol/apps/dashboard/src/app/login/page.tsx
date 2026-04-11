import { loginAction } from './actions';

export default function LoginPage() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '2rem', width: '360px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h1 style={{ marginTop: 0, color: '#1f2937', fontSize: '1.5rem' }}>Sign in to Shunya</h1>
        <form action={loginAction}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Email</span>
            <input
              name="email"
              type="email"
              required
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }}
            />
          </label>
          <label style={{ display: 'block', marginBottom: '1.5rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Password</span>
            <input
              name="password"
              type="password"
              required
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }}
            />
          </label>
          <button
            type="submit"
            style={{ width: '100%', padding: '0.625rem', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer' }}
          >
            Sign in
          </button>
        </form>
        <p style={{ marginTop: '1rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
          No account? <a href="/register" style={{ color: '#6366f1' }}>Register</a>
        </p>
      </div>
    </main>
  );
}
