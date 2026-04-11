'use client';
import { useState } from 'react';

interface Props {
  sessionId:    string;
  sessionToken: string;
  apiUrl:       string;
  onVerified:   () => void;
}

export function OTPFlow({ sessionId, sessionToken, apiUrl, onVerified }: Props) {
  const [phone,   setPhone]   = useState('');
  const [otp,     setOtp]     = useState('');
  const [step,    setStep]    = useState<'phone' | 'otp'>('phone');
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestOtp = async () => {
    setLoading(true); setError(null);
    const res = await fetch(`${apiUrl}/internal/sessions/${sessionId}/otp/request`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone }),
    });
    setLoading(false);
    if (res.ok) {
      setStep('otp');
    } else {
      const data = await res.json();
      setError(data.error ?? 'Failed to send OTP');
    }
  };

  const verifyOtp = async () => {
    setLoading(true); setError(null);
    const res = await fetch(`${apiUrl}/internal/sessions/${sessionId}/otp/verify`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone, otp }),
    });
    setLoading(false);
    if (res.ok) {
      onVerified();
    } else {
      const data = await res.json();
      setError(data.error ?? 'Invalid OTP');
    }
  };

  return (
    <div>
      {step === 'phone' && (
        <div>
          <p style={{ color: '#374151' }}>Enter your mobile number to receive a verification code:</p>
          <input
            type="tel"
            placeholder="+919876543210"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            style={{ padding: '0.5rem', fontSize: '1rem', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%', marginBottom: '0.5rem', boxSizing: 'border-box' }}
          />
          <button
            onClick={requestOtp}
            disabled={loading || phone.length < 10}
            style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', padding: '0.5rem 1.5rem', cursor: 'pointer' }}
          >
            {loading ? 'Sending...' : 'Send OTP'}
          </button>
        </div>
      )}
      {step === 'otp' && (
        <div>
          <p style={{ color: '#374151' }}>Enter the 6-digit code sent to {phone}:</p>
          <input
            type="text"
            placeholder="123456"
            value={otp}
            onChange={e => setOtp(e.target.value)}
            maxLength={6}
            style={{ padding: '0.5rem', fontSize: '1.5rem', letterSpacing: '0.5rem', textAlign: 'center', borderRadius: '6px', border: '1px solid #d1d5db', width: '100%', marginBottom: '0.5rem', boxSizing: 'border-box' }}
          />
          <button
            onClick={verifyOtp}
            disabled={loading || otp.length !== 6}
            style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', padding: '0.5rem 1.5rem', cursor: 'pointer' }}
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </div>
      )}
      {error && <p style={{ color: '#ef4444', marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}
