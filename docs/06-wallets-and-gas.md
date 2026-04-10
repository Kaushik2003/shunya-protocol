# 06 — Wallets & Gas

The user must never see a wallet, a seed phrase, a gas fee, a network
selector, or a transaction hash. This doc explains how we achieve that.

## The goal

For each verified human, produce:

1. A deterministic EVM address (their "Shunya wallet") tied to their
   Aadhaar identity.
2. On-chain attestations with that address as the subject.
3. Zero out-of-pocket gas cost to the user or the B2B client.

## The tools

- **Coinbase CDP Smart Accounts** — ERC-4337 account abstraction wallets,
  created and managed via Coinbase's API.
- **Coinbase CDP Paymaster** — sponsors the gas for specific method calls
  on specific contracts, funded by us (or Coinbase's grant credits).
- **Base Sepolia** — the L2 where everything lands.

## How a smart account gets created

```ts
async function getOrCreateSmartAccount(nullifier: Hex): Promise<Address> {
  const existing = await db.verified_users.findOne({ nullifier });
  if (existing) return existing.smart_account_address;

  const account = await cdp.createSmartAccount({
    // deterministic: same nullifier → same address
    salt: nullifier,
    // we custody the owner key (Privy-style)
    owner: await cdp.getMasterSigner(),
    chain: "base-sepolia"
  });

  await db.verified_users.insert({
    nullifier,
    smart_account_address: account.address,
    // ... claims from publicSignals
  });

  return account.address;
}
```

### Key custody model

- **We hold the owner signing key** for all smart accounts, stored in
  CDP's key management (HSM-backed).
- Users never see a key. This is intentional — it's the Privy model.
- Trade-off: we're a custodian of wallet *control*, but those wallets
  only ever hold attestations, never assets. Custody of an empty wallet
  is a low-risk posture.
- Future: we can add "export to self-custody" as a power-user feature,
  but that's not in MVP.

### Determinism

Using `salt: nullifier` with CDP's deterministic factory means:
- Same human → same smart account address, forever.
- Even if we lose the DB, we can recompute the address from the nullifier.
- Cross-org reuse: every org attestation points at the same address,
  which is exactly what we want for "verify once, use everywhere".

## How gas gets sponsored

### Paymaster policy

In the Coinbase CDP console we configure a paymaster policy:

```
allow:
  - to: ShunyaResolver.attest(bytes,bytes32[],address)
    on: base-sepolia
    from: any smart account
  - to: EAS.attest(...)
    on: base-sepolia
    from: ShunyaResolver
deny: everything else
cap:
  perAccount: 5 tx/day
  global: 10000 tx/day
```

This means the paymaster will only pay gas when the tx:
1. Is a `attest()` call on our resolver, OR
2. Is the internal EAS call triggered from within our resolver.

Anything else — even someone who somehow gets hold of one of our smart
accounts — gets refused. The worst an attacker could do is spam `attest`
calls, which are rate-limited per account.

### The tx flow

```
Worker
  ├─ construct UserOperation {
  │    sender:      smartAccount,
  │    callData:    ShunyaResolver.attest(receipt, publicSignals, smartAccount),
  │    paymaster:   CDP_PAYMASTER,
  │    nonce, gas…
  │  }
  ├─ sign with owner key (via CDP API, we never hold the key bytes)
  ├─ submit via CDP bundler → mempool → Base Sepolia
  └─ await receipt
```

At no point does anyone other than us pay gas. The user doesn't. The
B2B client doesn't. We pay Coinbase at the end of the month, in USD.

## Cost model

Target from the PDF: < $0.05 per full verification.

| Component | Est. cost |
|---|---|
| zkVerify testnet proof verification | ~$0.001 (testnet free; mainnet target ~$0.01) |
| Base L2 gas for `attest()` | ~$0.005–0.02 at current Base gas |
| CDP paymaster markup | Absorbed by us until scale |
| **Total** | **< $0.05** ✅ |

At ₹5 charged per verification to B2B clients, gross margin is ~80%.

## Failure modes

| Failure | Handling |
|---|---|
| CDP API down | Worker retries with backoff. Sessions stay `pending`. |
| Paymaster out of funds | Alert fires (Grafana), sessions fail with `gas_sponsorship_failed` until topped up. |
| Smart account creation fails | Retry ×3, then mark session failed, fire webhook with failed status. |
| Chain reorg / tx dropped | We track by `userOpHash`; resubmit if not mined within 2 min. |
| Paymaster policy changes mid-flight | New tx fails validation, next retry uses new policy. |

## Security considerations

- **Owner key compromise** = attacker can sign arbitrary UserOperations from
  any of our smart accounts. But the paymaster only sponsors `attest()`,
  and the wallets hold no assets, so the realistic damage is "attacker
  creates bogus attestations". We detect this via on-chain monitoring and
  rotate the owner key.
- **Paymaster policy misconfiguration** = potential griefing / spam. We
  audit the policy after every change.
- **Deterministic address = UID linkability?** No — the nullifier is
  salted with our secret. Even knowing a wallet address, an attacker
  cannot recover the UID without our salt.

## What we do NOT do

- We don't let end-users export private keys. Out of scope.
- We don't let B2B clients send tx *from* user wallets. They get read-only
  attestation info.
- We don't support mainnet Base in MVP. Testnet only until product-market fit.
- We don't support any other chain. Base is the only target for now.
