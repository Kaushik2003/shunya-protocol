'use client';
import { useEffect, useState } from 'react';

interface Props {
  sessionId:    string;
  sessionToken: string;
  apiUrl:       string;
  qrBytes:      Uint8Array;
  onFastPath:   () => void;
  onNeedsProof: (uidCommitment: string) => void;
}

export function NullifierCheck({ sessionId, sessionToken, apiUrl, qrBytes, onFastPath, onNeedsProof }: Props) {
  const [status, setStatus] = useState<'checking' | 'done' | 'error'>('checking');
  const [error,  setError]  = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Compute uidCommitment client-side using circomlibjs Poseidon
        const { buildPoseidon } = await import('circomlibjs');
        const poseidon = await buildPoseidon();
        const F = poseidon.F;

        // Extract reference ID bytes from QR (field at delimiter position 2)
        // Find 2nd and 3rd 0xFF delimiters
        let delimCount = 0;
        let start = -1;
        let end   = -1;
        for (let i = 0; i < qrBytes.length; i++) {
          if (qrBytes[i] === 255) {
            delimCount++;
            if (delimCount === 2) start = i + 1;
            if (delimCount === 3) { end = i; break; }
          }
        }

        const refIdBytes = start > 0 && end > start ? qrBytes.slice(start, end) : new Uint8Array(31);

        // Pack bytes into a BigInt (big endian, max 31 bytes)
        let packed = BigInt(0);
        const take = Math.min(refIdBytes.length, 31);
        for (let i = 0; i < take; i++) {
          packed = (packed << BigInt(8)) | BigInt(refIdBytes[i]!);
        }

        const commitment    = poseidon([packed]);
        const uidCommitment = '0x' + F.toString(commitment, 16).padStart(64, '0');

        const res = await fetch(`${apiUrl}/internal/sessions/${sessionId}/nullifier/check`, {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ uidCommitment }),
        });

        const data = await res.json();
        setStatus('done');

        if (data.status === 'fast_path') {
          onFastPath();
        } else {
          onNeedsProof(uidCommitment);
        }
      } catch (err: any) {
        setStatus('error');
        setError(err.message);
      }
    })();
  }, []);

  if (status === 'checking') return <p style={{ color: '#6366f1' }}>Checking identity...</p>;
  if (status === 'error')    return <p style={{ color: '#ef4444' }}>Error: {error}</p>;
  return null;
}
