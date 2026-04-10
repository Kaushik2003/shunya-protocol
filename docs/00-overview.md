# 00 — Overview

## The problem

Indian law (UIDAI rules, DPDP Act) forbids private companies from storing
Aadhaar data on their own servers. But consumer apps still need to verify
that their users are:

- **Real humans** (not bots / fake accounts),
- **Above the legal age** (18 for RMG/gaming, 16/18 for social media under
  upcoming age-gate laws),
- **Of a claimed gender** (dating apps need this to prevent catfishing).

Today they either skip verification (and lose the user base to fraud), or
they use sketchy "KYC" vendors who do store PII and create a compliance
bomb. There is no clean solution.

## The Shunya bet

Shunya is **Razorpay for privacy-preserving identity**. B2B apps drop an
SDK into their site; when they need to verify a user, they open the Shunya
popup; the user uploads their DigiLocker Aadhaar QR; a **zero-knowledge
proof** is generated **on the user's device**; the proof is verified on
**zkVerify**; an **EAS attestation** is written on **Base**; the client
app receives a webhook saying "yes, verified, here's the wallet address
and the minimal claims".

**No raw Aadhaar data ever touches any server — ours or the client's.**

## Why this can win

1. **Regulatory tailwind.** UIDAI is actively cracking down on PII storage.
   Companies need a compliant alternative *now*.
2. **No direct competitor.** Worldcoin does hardware, Polygon ID drifted,
   Gitcoin Passport isn't India-focused.
3. **Network effect.** Once a user verifies once with Shunya, every other
   Shunya client can verify them instantly. Each integration increases the
   value of all prior integrations. Classic Stripe/Plaid moat.
4. **Sub-cent cost.** zkVerify + Base L2 + paymaster makes per-verification
   cost <$0.05, which means we can charge B2B clients ~₹5/verification and
   still run at high gross margin.

## What a user actually experiences

1. They're signing up for a dating app.
2. A Shunya popup appears: "Verify your age to continue."
3. They enter their phone number, get an OTP, punch it in.
4. They upload a screenshot of their DigiLocker Aadhaar QR.
5. "Verifying… this takes about 10 seconds."
6. "✅ Verified." The popup closes, the dating app lets them in.

They never see the word "wallet", "blockchain", "proof", or "crypto".
Gas is paid by Coinbase's paymaster. A Coinbase Smart Account was
created for them silently, tied to a hash of their Aadhaar UID.

## What a B2B developer experiences

```html
<script src="https://cdn.shunya.app/v1/shunya.js"></script>
<script>
  const shunya = Shunya.init({ publishableKey: "pk_live_..." });
  document.getElementById("verify").onclick = async () => {
    const { sessionToken } = await fetch("/api/shunya/session", {method:"POST"}).then(r=>r.json());
    shunya.open({
      sessionToken,
      onSuccess: ({ attestationUid, walletAddress, claims }) => {
        // tell your backend, unlock the user, done
      }
    });
  };
</script>
```

Their backend:

```ts
import { Shunya } from "@shunya/node";
const shunya = new Shunya(process.env.SHUNYA_SECRET);
const session = await shunya.sessions.create({
  userRef: "user_42",
  requiredClaims: { isOver18: true, gender: "any" },
  webhookUrl: "https://client.app/hooks/shunya"
});
return { sessionToken: session.sessionToken };
```

That's the whole integration. It's Razorpay-shaped on purpose.

## Core principles (don't violate these)

1. **Zero PII at rest.** We don't store name, DOB, Aadhaar number, address.
   Only a nullifier (hash), a wallet address, and the boolean claims.
2. **Client-side proving.** The proof is generated in the browser.
   Raw Aadhaar bytes never cross a network.
3. **Minimum friction, not zero.** Users will accept 10 seconds. They will
   not accept installing MetaMask. Design accordingly.
4. **Every user is a non-web3 user.** No jargon. No "connect wallet".
   No gas. No tx hashes shown (unless they want receipts).
5. **Self-hostable by design.** Every dependency except NeonDB (temporary)
   runs in our containers. We are not Vercel-captive, Clerk-captive, or
   Supabase-captive.

## What we are NOT building (MVP)

- Native iOS/Android SDKs.
- Liveness / face match / deepfake detection.
- State / pincode / address claims.
- A consumer wallet app.
- Fiat invoicing & billing (flat org quota for now).
- Anything at all on mainnet (all testnet for MVP).

See [`../shunya_prd.md`](../shunya_prd.md) for the phased build plan.
