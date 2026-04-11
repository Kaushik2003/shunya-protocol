'use client';
import { useState, useEffect } from 'react';
import { QRUploader }      from './components/QRUploader';
import { OTPFlow }         from './components/OTPFlow';
import { NullifierCheck }  from './components/NullifierCheck';
import { ProofRunner }     from './components/ProofRunner';
import type { Groth16Proof } from '@shunya/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

type Step =
  | 'otp'
  | 'qr_upload'
  | 'nullifier_check'
  | 'proving'
  | 'processing'
  | 'done'
  | 'error';

type InternalSessionStatus =
  | 'pending'
  | 'phone_verified'
  | 'proof_submitted'
  | 'verified'
  | 'failed'
  | 'expired';

type SessionStatusResponse = {
  sessionId: string;
  status: InternalSessionStatus;
  stage: string | null;
  failReason: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
  attestationUid?: string;
  walletAddress?: string;
  claims?: { isOver18: boolean; gender: 'M' | 'F' };
};

export default function PopupPage() {
  const [sessionToken,  setSessionToken]  = useState<string | null>(null);
  const [sessionId,     setSessionId]     = useState<string | null>(null);
  const [step,          setStep]          = useState<Step>('otp');
  const [qrBytes,       setQrBytes]       = useState<Uint8Array | null>(null);
  const [uidCommitment, setUidCommitment] = useState<string | null>(null);
  const [parentOrigin,  setParentOrigin]  = useState<string | null>(null);
  const [progress,      setProgress]      = useState<string | null>(null);
  const [error,         setError]         = useState<string | null>(null);

  // Extract session token from URL ?s=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('s');
    const po = params.get('parentOrigin');
    if (s) {
      setSessionToken(s);
      // Decode JWT payload to get sessionId (no verification here — API validates)
      try {
        const payload = JSON.parse(atob(s.split('.')[1]!));
        setSessionId(payload.sid);
      } catch {
        setError('Invalid session token');
      }
    } else {
      setError('No session token in URL');
    }

    if (po) {
      setParentOrigin(po);
    } else {
      try {
        const ref = document.referrer ? new URL(document.referrer).origin : null;
        setParentOrigin(ref);
      } catch {
        setParentOrigin(null);
      }
    }
  }, []);

  function postToParent(message: any) {
    window.parent?.postMessage(message, parentOrigin ?? '*');
  }

  useEffect(() => {
    const onBeforeUnload = () => {
      postToParent({ type: 'shunya:close' });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [parentOrigin]);

  async function pollUntilFinal() {
    if (!sessionToken || !sessionId) return;

    const stageToText: Record<string, string> = {
      queued:          'Queued…',
      zk_verifying:    'Verifying proof…',
      zk_verified:     'Proof verified…',
      wallet_creating: 'Preparing secure wallet…',
      chain_submitting:'Finalizing attestation…',
      complete:        'Complete.',
    };

    const startedAt = Date.now();
    while (Date.now() - startedAt < 120_000) {
      const res = await fetch(`${API_URL}/internal/sessions/${sessionId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${sessionToken}` },
      });

      const data = (await res.json()) as SessionStatusResponse;
      if (!res.ok) {
        throw new Error((data as any)?.error ?? 'Failed to fetch session status');
      }

      setProgress(data.stage ? (stageToText[data.stage] ?? `Working… (${data.stage})`) : 'Working…');

      if (data.status === 'verified') {
        if (!data.attestationUid || !data.walletAddress || !data.claims) {
          throw new Error('Verified session missing attestation details');
        }
        postToParent({
          type: 'shunya:success',
          payload: {
            sessionId:      data.sessionId,
            attestationUid: data.attestationUid,
            walletAddress:  data.walletAddress,
            claims:         data.claims,
          },
        });
        setStep('done');
        return;
      }

      if (data.status === 'failed' || data.status === 'expired') {
        const msg = data.failReason ?? `Session ${data.status}`;
        postToParent({ type: 'shunya:error', message: msg });
        setError(msg);
        setStep('error');
        return;
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error('Timed out waiting for verification');
  }

  const handleProofDone = async (proof: Groth16Proof, publicSignals: string[]) => {
    if (!sessionToken || !sessionId || !uidCommitment) return;

    const res = await fetch(`${API_URL}/internal/sessions/${sessionId}/proof`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ proof, publicSignals, uidCommitment }),
    });

    if (res.ok) {
      setStep('processing');
      setProgress('Queued…');
      try {
        await pollUntilFinal();
      } catch (e: any) {
        const msg = e?.message ?? 'Verification failed';
        postToParent({ type: 'shunya:error', message: msg });
        setError(msg);
        setStep('error');
      }
    } else {
      const data = await res.json();
      const msg = data.error ?? 'Proof submission failed';
      postToParent({ type: 'shunya:error', message: msg });
      setError(msg);
      setStep('error');
    }
  };

  if (!sessionToken) {
    return <p style={{ padding: '2rem' }}>{error ?? 'Loading...'}</p>;
  }

  return (
    <main style={{ maxWidth: '480px', margin: '0 auto', padding: '2rem', fontFamily: 'system-ui' }}>
      <h2 style={{ color: '#1f2937', marginBottom: '1.5rem' }}>Age Verification</h2>

      {step === 'otp' && sessionId && (
        <OTPFlow
          sessionId={sessionId}
          sessionToken={sessionToken}
          apiUrl={API_URL}
          onVerified={() => setStep('qr_upload')}
        />
      )}

      {step === 'qr_upload' && (
        <div>
          <p style={{ color: '#374151' }}>Upload your DigiLocker Aadhaar PDF or QR screenshot:</p>
          <QRUploader
            onDecoded={(bytes) => { setQrBytes(bytes); setStep('nullifier_check'); }}
            onError={(msg) => setError(msg)}
          />
          {error && <p style={{ color: '#ef4444' }}>{error}</p>}
        </div>
      )}

      {step === 'nullifier_check' && qrBytes && sessionId && (
        <NullifierCheck
          sessionId={sessionId}
          sessionToken={sessionToken}
          apiUrl={API_URL}
          qrBytes={qrBytes}
          onFastPath={async () => {
            setStep('processing');
            setProgress('Queued…');
            try {
              await pollUntilFinal();
            } catch (e: any) {
              const msg = e?.message ?? 'Verification failed';
              postToParent({ type: 'shunya:error', message: msg });
              setError(msg);
              setStep('error');
            }
          }}
          onNeedsProof={(uidC) => { setUidCommitment(uidC); setStep('proving'); }}
        />
      )}

      {step === 'proving' && qrBytes && (
        <ProofRunner qrBytes={qrBytes} onDone={handleProofDone} />
      )}

      {step === 'processing' && (
        <div>
          <p style={{ color: '#6366f1' }}>{progress ?? 'Working…'}</p>
          <p style={{ color: '#6b7280', marginTop: '0.25rem' }}>
            This usually takes a few seconds. You can keep this window open.
          </p>
        </div>
      )}

      {step === 'done' && (
        <p style={{ color: '#22c55e' }}>Verified! You may close this window.</p>
      )}

      {step === 'error' && (
        <p style={{ color: '#ef4444' }}>Verification failed: {error}</p>
      )}
    </main>
  );
}
