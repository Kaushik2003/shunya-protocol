# 08 — zkVerify & EAS

This doc covers the *middleware* (zkVerify) and *settlement* (EAS on Base)
layers. Together they turn a local ZK proof into a tamper-evident
on-chain attestation.

## Why two layers?

Verifying a Groth16 proof directly on Base Sepolia costs ~300k gas.
Attesting it via EAS costs another ~100k. At scale and on mainnet,
that's expensive.

**zkVerify** is a specialised chain (Substrate-based) that does one
thing: verify zk proofs cheaply. Cost per verification is sub-cent.
It then gives us a **Merkle receipt** — a lightweight proof that *the
original ZK proof was valid, according to zkVerify consensus*.

On Base, we only verify the Merkle inclusion of our receipt in
zkVerify's published Merkle root. That's a handful of hashes, not a
full Groth16 verification. Gas drops by an order of magnitude.

## The pipeline

```
User's proof                              Cheap to generate (client-side)
    │
    ▼
zkVerify testnet                          Cheap to verify (specialised chain)
  ── verifies Groth16 ──
  ── publishes Merkle root for a batch ──
  ── hands back a Merkle leaf + siblings ──
    │
    ▼
Base Sepolia                              Cheap inclusion check (handful of hashes)
  ShunyaResolver.attest(receipt, signals, subject)
    ── verify Merkle path against zkVerify's root ──
    ── on success, call EAS.attest() ──
    │
    ▼
EAS                                       One tiny attestation written
```

## zkVerify integration

### Submitting a proof

```ts
import { ZkVerify } from "@zkverify/sdk";

const zk = new ZkVerify({
  rpcUrl: process.env.ZKVERIFY_RPC_URL,
  seedPhrase: process.env.ZKVERIFY_SUBMITTER_SEED
});

const { receipt } = await zk.submitProof({
  proofType: "groth16",
  vk: SHUNYA_VKEY,     // our circuit's verification key, registered once
  proof,
  publicSignals,
  waitForReceipt: true
});

// receipt = { domainId, aggregationId, leaf, merkleProof, root }
```

Notes:
- We register our verification key **once** at deployment with zkVerify's
  `registerVk()`. After that, we just pass the VK hash.
- `waitForReceipt: true` blocks until our leaf is aggregated into a
  published Merkle root (typically <5s on testnet).
- If aggregation takes >2 minutes, BullMQ retries.

### What the receipt looks like

```json
{
  "domainId": "0xaabb...",
  "aggregationId": 42,
  "leaf":   "0xdead...",
  "merkleProof": ["0x01...", "0x02...", "0x03..."],
  "root":   "0xbeef..."
}
```

This is what we pass to the Base resolver. Size: a few hundred bytes.

## EAS on Base Sepolia

### Schema registration (one-time, manual)

We register one EAS schema:

```
bytes32 nullifier, bool isOver18, uint8 gender, bytes32 nameHash
```

Registered via the EAS website (https://base-sepolia.easscan.org/) →
gives us a `SHUNYA_SCHEMA_UID` we hardcode in the resolver.

### The `ShunyaResolver` contract

```solidity
pragma solidity ^0.8.23;

import { SchemaResolver } from "@ethereum-attestation-service/eas-contracts/SchemaResolver.sol";
import { IEAS, Attestation } from "@ethereum-attestation-service/eas-contracts/IEAS.sol";
import { IZkVerifyAggregation } from "./IZkVerifyAggregation.sol";

contract ShunyaResolver is SchemaResolver {
    IZkVerifyAggregation public immutable zkv;
    bytes32 public immutable shunyaVkHash;

    constructor(IEAS _eas, IZkVerifyAggregation _zkv, bytes32 _vkHash) SchemaResolver(_eas) {
        zkv = _zkv;
        shunyaVkHash = _vkHash;
    }

    /// Called externally to issue a new attestation via this resolver.
    function attest(
        uint256 aggregationId,
        uint256 leafIndex,
        bytes32[] calldata merkleProof,
        bytes calldata publicSignalsEncoded,
        address subject
    ) external returns (bytes32) {
        // 1. Re-derive the leaf the way zkVerify does
        bytes32 leaf = keccak256(abi.encode(shunyaVkHash, publicSignalsEncoded));

        // 2. Check inclusion in zkVerify's published aggregation
        require(
            zkv.verifyProofAggregation(aggregationId, leafIndex, leaf, merkleProof),
            "zkverify: invalid receipt"
        );

        // 3. Decode public signals
        (bool isOver18, uint8 gender, bytes32 nameHash, bytes32 uidCommitment)
            = abi.decode(publicSignalsEncoded, (bool, uint8, bytes32, bytes32));
        require(isOver18, "not over 18");

        // 4. Issue attestation via EAS
        return _eas.attest(
            AttestationRequest({
                schema: SHUNYA_SCHEMA_UID,
                data: AttestationRequestData({
                    recipient: subject,
                    expirationTime: 0,
                    revocable: true,
                    refUID: 0,
                    data: abi.encode(uidCommitment, isOver18, gender, nameHash),
                    value: 0
                })
            })
        );
    }

    // Reject direct attestations (must go through attest() above)
    function onAttest(Attestation calldata, uint256) internal pure override returns (bool) {
        return msg.sender == address(this);  // only self-calls allowed
    }
    function onRevoke(Attestation calldata, uint256) internal pure override returns (bool) {
        return true;
    }
}
```

Key properties:
- **Only `attest()` can create attestations.** Nobody can call EAS directly
  with our schema — `onAttest` rejects unless the caller is the resolver
  itself.
- **The zkVerify Merkle check is the only trust anchor.** If the receipt
  is invalid, the tx reverts and the paymaster doesn't pay for gas wasted.
- **Revocable.** We can revoke an attestation if we discover a circuit
  bug or salt leak. Good for MVP; might change for mainnet.

### Deployment

Via Foundry:

```bash
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --private-key $DEPLOYER_KEY \
  --broadcast --verify
```

Deployed address goes in `packages/shared/src/config.ts`.

## Ensuring only zkVerify-verified proofs reach the chain

This is the PDF's hard requirement: "The contract must only accept
verification payloads originating from the zkVerify testnet."

We satisfy it via the Merkle inclusion check. There is no code path in
`ShunyaResolver` that accepts an attestation without first calling
`zkv.verifyProofAggregation()`. If zkVerify didn't sign off on it, the
tx reverts.

## What the final on-chain attestation looks like (EAS)

```
Attestation UID:  0x7f3a...
Schema:           bytes32 nullifier, bool isOver18, uint8 gender, bytes32 nameHash
Recipient:        0x1234... (user's Shunya smart account)
Attester:         0xdead... (ShunyaResolver)
Time:             1712750400
Expiration:       0 (never)
Revoked:          false
Data:
  nullifier: 0xabcdef...
  isOver18:  true
  gender:    1
  nameHash:  0x9999...
```

Anyone with EAS tooling can verify this independently. That's the point.

## Failure modes

| Failure | Handling |
|---|---|
| zkVerify aggregation delay > 2 min | Worker retry |
| zkVerify RPC down | Worker retry with backoff, sessions pile in `pending` |
| Base RPC down | Worker retry |
| Tx revert (bad Merkle proof) | Something is wrong on our side. Alert. |
| Tx revert (not over 18) | Should never happen — circuit already enforces. Alert. |
| Tx underpriced | Resubmit with higher fee |
| Paymaster denies sponsorship | Alert. Policy misconfig or out of funds. |
