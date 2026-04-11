import { registerAction } from './actions';

export default function RegisterPage() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '2rem', width: '400px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h1 style={{ marginTop: 0, color: '#1f2937', fontSize: '1.5rem' }}>Create your Shunya account</h1>
        <form action={registerAction}>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Organization name</span>
            <input name="orgName" type="text" required
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }} />
          </label>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Email</span>
            <input name="email" type="email" required
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }} />
          </label>
          <label style={{ display: 'block', marginBottom: '1.5rem' }}>
            <span style={{ color: '#374151', fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>Password</span>
            <input name="password" type="password" required minLength={8}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '1rem', boxSizing: 'border-box' }} />
          </label>
          <button type="submit"
            style={{ width: '100%', padding: '0.625rem', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer' }}>
            Create account
          </button>
        </form>
        <p style={{ marginTop: '1rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
          Already have an account? <a href="/login" style={{ color: '#6366f1' }}>Sign in</a>
        </p>
      </div>
    </main>
  );
}
