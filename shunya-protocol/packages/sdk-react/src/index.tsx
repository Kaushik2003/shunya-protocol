'use client';
import React, { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { init, type ShunyaInstance, type SuccessPayload } from '@shunya/js';

interface ShunyaContextValue {
  open: (options: { sessionToken: string }) => Promise<SuccessPayload>;
  status: 'idle' | 'loading' | 'success' | 'error';
}

const ShunyaContext = createContext<ShunyaContextValue | null>(null);

interface ProviderProps {
  publishableKey: string;
  popupOrigin?: string;
  children: ReactNode;
}

export function ShunyaProvider({ publishableKey, popupOrigin, children }: ProviderProps) {
  const instanceRef = useRef<ShunyaInstance | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  function getInstance(): ShunyaInstance {
    if (!instanceRef.current) {
      instanceRef.current = init({ publishableKey, popupOrigin });
    }
    return instanceRef.current;
  }

  function open({ sessionToken }: { sessionToken: string }): Promise<SuccessPayload> {
    setStatus('loading');
    return new Promise((resolve, reject) => {
      getInstance().open({
        sessionToken,
        onSuccess: (result) => { setStatus('success'); resolve(result); },
        onError:   (err)    => { setStatus('error');   reject(new Error(err.message)); },
        onClose:   ()       => { setStatus('idle');    reject(new Error('Popup closed')); },
      });
    });
  }

  return (
    <ShunyaContext.Provider value={{ open, status }}>
      {children}
    </ShunyaContext.Provider>
  );
}

export function useShunya(): ShunyaContextValue {
  const ctx = useContext(ShunyaContext);
  if (!ctx) throw new Error('useShunya must be used inside <ShunyaProvider>');
  return ctx;
}

export type { SuccessPayload };
