# 05 — SDK Design

We ship three SDKs. They all wrap the same public HTTP API.

| Package | Audience | Shape |
|---|---|---|
| `@shunya/js` | Any web frontend | `<script>` loader + `Shunya.init()` + `open()` |
| `@shunya/react` | React / Next.js frontends | `<ShunyaProvider>`, `useShunya()` hook |
| `@shunya/node` | B2B backends (Node, Bun, Deno) | Typed client for REST API |

## Design principles

1. **Razorpay-shaped.** Open popup → onSuccess → done. Developers should
   need ≤15 lines of code to integrate.
2. **Publishable vs secret keys.** Like Stripe: `pk_live_...` is safe in
   browsers, `sk_live_...` must stay on the server. The browser never
   sees a secret key.
3. **Sessions are server-minted.** The B2B backend calls `/v1/sessions`
   with `sk_...`, gets a short-lived `sessionToken`, passes it to the
   browser. This prevents a random attacker from spamming sessions.
4. **No SDK state on disk.** The SDK is stateless — all persistence is
   server-side.
5. **Zero runtime deps.** The browser SDK must be <15 KB gzipped and
   depend on nothing.

## `@shunya/js` — browser loader

```html
<script src="https://cdn.shunya.app/v1/shunya.js"></script>
<script>
  const shunya = Shunya.init({ publishableKey: "pk_live_..." });

  document.getElementById("verify").onclick = async () => {
    const res = await fetch("/api/shunya/session", { method: "POST" });
    const { sessionToken } = await res.json();

    shunya.open({
      sessionToken,
      onSuccess: ({ attestationUid, walletAddress, claims }) => {
        console.log("user verified", attestationUid);
        window.location.href = "/welcome";
      },
      onError: (err) => alert(err.message),
      onClose: () => console.log("popup closed without verification")
    });
  };
</script>
```

**How it works under the hood:**

1. `Shunya.init()` stores the publishable key.
2. `shunya.open()`:
   - Creates a full-screen `<iframe src="https://verify.shunya.app/?s=...">`.
   - Wires a `window.addEventListener('message', ...)` listener scoped to
     the popup origin.
   - Blocks interaction with the parent page via an overlay.
3. The popup inside the iframe posts messages:
   - `{type:"shunya:ready"}` — popup mounted
   - `{type:"shunya:progress", stage:"proving"}` — UI hints (we don't
     actually surface these to the host page; host only sees success/fail)
   - `{type:"shunya:success", payload:{...}}`
   - `{type:"shunya:error", message:"..."}`
   - `{type:"shunya:close"}`
4. On success/error the loader removes the iframe, calls the callback.

**CSP / origin checks** — the loader verifies `event.origin === "https://verify.shunya.app"` before trusting any message. The popup verifies the parent origin against an allowlist stored per org in our DB.

## `@shunya/react`

```tsx
import { ShunyaProvider, useShunya } from "@shunya/react";

function App() {
  return (
    <ShunyaProvider publishableKey="pk_live_...">
      <VerifyButton />
    </ShunyaProvider>
  );
}

function VerifyButton() {
  const { open, status } = useShunya();
  return (
    <button
      disabled={status === "loading"}
      onClick={async () => {
        const { sessionToken } = await fetch("/api/shunya/session", { method: "POST" }).then(r => r.json());
        const result = await open({ sessionToken });
        console.log(result); // { attestationUid, walletAddress, claims }
      }}
    >
      Verify age
    </button>
  );
}
```

`useShunya().open()` returns a Promise that resolves on success and
rejects on error/cancel. The hook internally uses the vanilla SDK.

## `@shunya/node` — server SDK

```ts
import { Shunya } from "@shunya/node";
const shunya = new Shunya({ secretKey: process.env.SHUNYA_SECRET! });

// 1. Mint a session (called from your backend route)
const session = await shunya.sessions.create({
  userRef: "user_42",
  requiredClaims: { isOver18: true, gender: "any" },
  returnUrl: "https://client.app/verified",
  webhookUrl: "https://client.app/hooks/shunya"
});

// 2. Verify an incoming webhook
app.post("/hooks/shunya", async (req, res) => {
  const event = shunya.webhooks.verify(
    req.rawBody,
    req.headers["x-shunya-signature"],
    process.env.SHUNYA_WEBHOOK_SECRET!
  );
  if (event.type === "session.verified") {
    // update your DB: user is verified
  }
  res.sendStatus(200);
});

// 3. Fetch an attestation later
const att = await shunya.attestations.retrieve("0xabc...");
```

All methods are thin wrappers over `fetch` to our REST API. No magic.

## API key types

| Prefix | Where used | Scope |
|---|---|---|
| `pk_test_...` / `pk_live_...` | Browser (`Shunya.init`) | Can open popups. Cannot create sessions or read data. |
| `sk_test_...` / `sk_live_...` | Server only | Create sessions, fetch results, manage webhooks. |

Rotating keys is a one-click action in the dashboard. Revoked keys are
soft-deleted (`revoked_at` set) so we can still attribute old logs.

## Versioning

- URL-versioned: `/v1/...`. Breaking changes bump to `/v2/`.
- `shunya.js` is loaded as `https://cdn.shunya.app/v1/shunya.js`. v2 is
  a new URL. Old integrations never break.
- Server SDK is semver. Major versions can break. Minor/patch cannot.

## Things the SDK deliberately does NOT do

- Manage user state in localStorage. (We'd become a privacy surface.)
- Cache verification results on the client. (Always round-trip through
  your backend to prevent forged success callbacks.)
- Do its own analytics. (No tracking pixels, no segment events.)
- Bundle any dependency. (Zero runtime deps in the browser package.)
