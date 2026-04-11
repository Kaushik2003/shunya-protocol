# @shunya/js

Zero-dependency browser SDK for Shunya — zero-knowledge Aadhaar identity verification.
Bundles as a <15KB IIFE (`window.Shunya`) or an ESM module.

## CDN usage

```html
<script src="https://cdn.shunya.app/v1/shunya.js"></script>
<script>
  const shunya = Shunya.init({ publishableKey: 'pk_live_...' });

  document.getElementById('verify-btn').onclick = async () => {
    // 1. Mint a session from YOUR backend (never expose sk_ keys in the browser)
    const { sessionToken } = await fetch('/api/shunya/session', {
      method: 'POST',
    }).then(r => r.json());

    // 2. Open the verification popup
    shunya.open({
      sessionToken,
      onSuccess: ({ attestationUid, walletAddress, claims }) => {
        // Popup closed successfully. ALWAYS confirm via your webhook handler
        // before granting access — do not trust this callback alone.
        console.log('Verified:', { attestationUid, walletAddress, claims });
      },
      onError: (err) => console.error('Verification failed:', err.message),
      onClose: ()    => console.log('User closed popup'),
    });
  };
</script>
```

## npm / ESM usage

```bash
npm install @shunya/js
```

```ts
import { Shunya } from '@shunya/js';

const instance = Shunya.init({
  publishableKey: 'pk_live_...',
  popupOrigin: 'http://localhost:3001', // for local dev only
});

instance.open({ sessionToken, onSuccess, onError, onClose });
```

## API

### `Shunya.init(options)` → `ShunyaInstance`

| Option | Type | Description |
|--------|------|-------------|
| `publishableKey` | `string` | Your `pk_` key from the dashboard |
| `popupOrigin` | `string` | Override popup origin for dev (default: `https://verify.shunya.app`) |

### `instance.open(options)`

Opens the verification popup overlay.

| Option | Type | Description |
|--------|------|-------------|
| `sessionToken` | `string` | JWT from your backend (`session.sessionToken`) |
| `onSuccess` | `(result: SuccessPayload) => void` | Called when verification completes |
| `onError` | `(err: { message: string }) => void` | Called on error |
| `onClose` | `() => void` | Called when user dismisses popup |

### `instance.destroy()`

Removes the overlay and all event listeners.

## Security notes

- Never embed a `sk_` secret key in browser code.
- The `onSuccess` callback fires from a `postMessage` — always confirm via your server's webhook handler before unlocking features.
- The popup origin is verified on every incoming message (`e.origin` check).
