'use client';
import { useEffect, useRef, useState } from 'react';
import type { Groth16Proof } from '@shunya/shared';

interface Props {
  qrBytes: Uint8Array;
  onDone: (proof: Groth16Proof, publicSignals: string[]) => void;
}

export function ProofRunner({ qrBytes, onDone }: Props) {
  const [status, setStatus] = useState('Initializing proof worker...');
  const [error,  setError]  = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker('/prove.worker.js');
    workerRef.current = worker;

    worker.onerror = (e) => {
      setError(`Worker load error: ${e.message}`);
    };

    worker.onmessage = (e) => {
      const { type, payload, message } = e.data ?? {};
      if (type === 'status') {
        setStatus(payload);
      } else if (type === 'done') {
        setStatus('Proof complete!');
        onDone(payload.proof, payload.publicSignals);
      } else if (type === 'error') {
        setError(message ?? 'Unknown proof error');
      }
    };

    const buffer = qrBytes.buffer.slice(
      qrBytes.byteOffset,
      qrBytes.byteOffset + qrBytes.byteLength
    );
    worker.postMessage({
      type:    'prove',
      qrBytes: buffer,
      wasmUrl: process.env.NEXT_PUBLIC_WASM_URL ?? 'http://localhost:9000/shunya/shunya.wasm',
      zkeyUrl: process.env.NEXT_PUBLIC_ZKEY_URL ?? 'http://localhost:9000/shunya/shunya.zkey',
    }, [buffer]);

    return () => worker.terminate();
  }, []);

  if (error) return <p style={{ color: '#ef4444' }}>Proof error: {error}</p>;

  return (
    <div>
      <p style={{ color: '#6366f1' }}>{status}</p>
      <div style={{ height: '4px', background: '#e0e7ff', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', background: '#6366f1', borderRadius: '2px',
          animation: 'progress-pulse 1.5s ease-in-out infinite',
          width: '60%',
        }} />
      </div>
      <style>{`
        @keyframes progress-pulse {
          0%,100% { opacity: 1; transform: translateX(-20%); }
          50%      { opacity: 0.7; transform: translateX(80%); }
        }
      `}</style>
    </div>
  );
}
