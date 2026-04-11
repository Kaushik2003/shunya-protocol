// @shunya/js — zero-dependency browser SDK
// Bundles to an IIFE exposing `window.Shunya`

const DEFAULT_POPUP_ORIGIN = 'https://verify.shunya.app';

export interface InitOptions {
  publishableKey: string;
  /** Override popup origin for dev. Defaults to https://verify.shunya.app */
  popupOrigin?: string;
}

export interface OpenOptions {
  sessionToken: string;
  onSuccess?: (result: SuccessPayload) => void;
  onError?:   (err: { message: string }) => void;
  onClose?:   () => void;
}

export interface SuccessPayload {
  attestationUid: string;
  walletAddress:  string;
  claims:         { isOver18: boolean; gender?: 'M' | 'F' };
  sessionId:      string;
}

export interface ShunyaInstance {
  open(options: OpenOptions): void;
  destroy(): void;
}

export function init(options: InitOptions): ShunyaInstance {
  const { publishableKey, popupOrigin = DEFAULT_POPUP_ORIGIN } = options;

  if (!publishableKey.startsWith('pk_')) {
    throw new Error('[Shunya] publishableKey must start with pk_');
  }

  let allowedPopupOrigin: string;
  try {
    allowedPopupOrigin = new URL(popupOrigin).origin;
  } catch {
    throw new Error('[Shunya] popupOrigin must be a valid URL origin (e.g. https://verify.shunya.app)');
  }

  let iframe:   HTMLIFrameElement | null = null;
  let overlay:  HTMLDivElement | null = null;
  let listener: ((e: MessageEvent) => void) | null = null;

  function cleanup() {
    if (iframe)   { iframe.remove();  iframe   = null; }
    if (overlay)  { overlay.remove(); overlay  = null; }
    if (listener) { window.removeEventListener('message', listener); listener = null; }
  }

  function open(opts: OpenOptions) {
    if (iframe) return; // already open

    const { sessionToken, onSuccess, onError, onClose } = opts;

    const url = new URL('/', allowedPopupOrigin);
    url.searchParams.set('s', sessionToken);
    if (typeof window !== 'undefined') {
      url.searchParams.set('parentOrigin', window.location.origin);
    }

    // Overlay
    overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)',
      zIndex: '2147483646', display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    // Iframe
    iframe = document.createElement('iframe');
    Object.assign(iframe.style, {
      width: '100%', maxWidth: '480px', height: '700px', maxHeight: '90vh',
      border: 'none', borderRadius: '16px', background: 'white',
    });
    iframe.src = url.toString();
    iframe.allow = 'camera; microphone';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      position: 'absolute', top: '1rem', right: '1rem',
      background: 'none', border: 'none', color: 'white',
      fontSize: '1.5rem', cursor: 'pointer', zIndex: '2147483647',
    });
    closeBtn.onclick = () => { cleanup(); onClose?.(); };

    // Assemble
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.appendChild(iframe);
    overlay.appendChild(closeBtn);
    overlay.appendChild(wrapper);
    document.body.appendChild(overlay);

    // postMessage listener
    listener = (e: MessageEvent) => {
      if (e.origin !== allowedPopupOrigin) return;

      const { type, payload, message } = e.data ?? {};

      if (type === 'shunya:success') {
        cleanup();
        onSuccess?.(payload as SuccessPayload);
      } else if (type === 'shunya:error') {
        cleanup();
        onError?.({ message: message ?? 'Verification failed' });
      } else if (type === 'shunya:close') {
        cleanup();
        onClose?.();
      }
    };

    window.addEventListener('message', listener);
  }

  return { open, destroy: cleanup };
}

// Attach to window as IIFE export
export const Shunya = { init };

if (typeof window !== 'undefined') {
  (window as any).Shunya = Shunya;
}
