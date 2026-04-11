# @shunya/node

Server SDK for Shunya — zero-knowledge Aadhaar identity verification.

## Install

```bash
npm install @shunya/node
```

## Quick start

```ts
import { Shunya } from '@shunya/node';

const shunya = new Shunya({ secretKey: process.env.SHUNYA_SECRET! });

// 1. Mint a session (from your backend route)
const session = await shunya.sessions.create({
  userRef:        'user_42',
  requiredClaims: { isOver18: true },
  returnUrl:      'https://your-app.com/verified',
  webhookUrl:     'https://your-app.com/hooks/shunya',
});

// 2. Pass session.sessionToken to your frontend (e.g. via API response)
//    The frontend opens the popup with Shunya.init().open({ sessionToken })

// 3. Verify webhooks in your handler
app.post('/hooks/shunya', express.raw({ type: '*/*' }), (req, res) => {
  const event = shunya.webhooks.verifyWebhook(
    req.body.toString(),
    req.headers['x-shunya-signature'] as string,
    process.env.SHUNYA_WEBHOOK_SECRET!,
    Number(req.headers['x-shunya-timestamp']),
  );

  if (event.status === 'verified') {
    // User is verified. event.walletAddress, event.claims are available.
  }
  res.sendStatus(200);
});
```

> **Important:** Always verify the webhook signature before trusting the payload.
> Do NOT trust the `onSuccess` browser callback alone — it can be spoofed.

## API

### `shunya.sessions.create(options)`

Creates a new verification session. Call from your server.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userRef` | `string` | ✓ | Your internal user ID |
| `requiredClaims` | `{ isOver18?: boolean; gender?: 'M'\|'F'\|'any' }` | ✓ | Claims to verify |
| `returnUrl` | `string` | ✓ | Where to redirect after verification |
| `webhookUrl` | `string` | | One-off webhook for this session |

Returns `{ sessionId, sessionToken, popupUrl }`.

### `shunya.sessions.retrieve(sessionId)`

Returns the current status of a session.

### `shunya.attestations.retrieve(uid)`

Returns a verified attestation by its EAS UID.

### `shunya.webhooks.verifyWebhook(rawBody, signature, secret, timestamp)`

Verifies an incoming webhook. Throws `ShunyaError` on failure.
