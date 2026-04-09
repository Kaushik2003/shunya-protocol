# Shunya Protocol — Engineering PRD & System Design
**Version:** 1.0 | **Status:** Internal Engineering Reference | **Classification:** Confidential

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Component Deep-Dives](#3-component-deep-dives)
   - 3.1 Client SDK (ZK Proof Generation)
   - 3.2 Wallet Abstraction Layer
   - 3.3 Middleware (Verification Bridge)
   - 3.4 Settlement Layer (EAS on Base)
   - 3.5 Frontend Application
   - 3.6 Backend API & Database
4. [Data Flow & Sequence Diagrams](#4-data-flow--sequence-diagrams)
5. [Smart Contract Specification](#5-smart-contract-specification)
6. [ZK Circuit Design](#6-zk-circuit-design)
7. [Security Model](#7-security-model)
8. [Infrastructure & DevOps](#8-infrastructure--devops)
9. [API Reference](#9-api-reference)
10. [Database Schema](#10-database-schema)
11. [Third-Party Integrations](#11-third-party-integrations)
12. [Testing Strategy](#12-testing-strategy)
13. [MVP Milestone Plan](#13-mvp-milestone-plan)
14. [Known Tradeoffs & Future Decisions](#14-known-tradeoffs--future-decisions)

---

## 1. Executive Summary

**Shunya Protocol** is a Zero-Knowledge KYC primitive for the Indian market — and eventually global markets — that allows users to prove identity attributes (age, gender, name) without transmitting any Personally Identifiable Information (PII) to any server.

### Core Value Proposition
- User scans their DigiLocker Aadhaar QR → ZK proof is generated client-side → on-chain attestation is issued on Base L2
- B2B clients (e-sports platforms, dating apps, social media) query the attestation to gate access
- No server ever sees the Aadhaar data. No wallet is visible to the user. No gas fees are paid by the user.

### Guiding Engineering Constraints
| Constraint | Target |
|---|---|
| Client-side proof generation time | < 10 seconds on a mid-range Android |
| Total cost per verification (gas + zkVerify) | < $0.05 USD |
| PII stored on any server | Zero |
| User-facing web3 friction | Zero (no wallet prompts, no MetaMask, no gas confirmations) |

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER DEVICE (Browser / React Native App)                                  │
│                                                                             │
│  ┌──────────────┐   ┌────────────────────────────────┐                     │
│  │  Phone OTP   │   │  Aadhaar QR Image Upload        │                     │
│  │  (Login)     │   │  (DigiLocker Screenshot)        │                     │
│  └──────┬───────┘   └────────────┬───────────────────┘                     │
│         │                        │                                          │
│         ▼                        ▼                                          │
│  ┌──────────────────────────────────────────────────────┐                  │
│  │  Shunya Client SDK (WASM + Circom / Rust)            │                  │
│  │  - QR decode & XML parse (client-side)               │                  │
│  │  - ZK proof generation via forked Anon Aadhaar       │                  │
│  │  - Coinbase Smart Account creation (invisible)       │                  │
│  └──────────────────────────┬───────────────────────────┘                  │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │  ZK Proof (no PII)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SHUNYA BACKEND (Node.js / Bun — Verifiable Compute, stateless)            │
│                                                                             │
│  ┌──────────────────────────────────────────────────────┐                  │
│  │  Verification Bridge (API)                           │                  │
│  │  - Receives ZK proof from client                     │                  │
│  │  - Submits to zkVerify Testnet/Mainnet               │                  │
│  │  - Receives Attestation Receipt                      │                  │
│  │  - Triggers EAS attestation on Base via Paymaster    │                  │
│  └──────────────────────────────────────────────────────┘                  │
│                                                                             │
│  ┌──────────────────┐   ┌───────────────────┐   ┌────────────────────┐    │
│  │  Auth Service    │   │  Session Manager  │   │  Audit Log (write) │    │
│  │  (OTP via MSG91) │   │  (Redis)          │   │  (no PII)          │    │
│  └──────────────────┘   └───────────────────┘   └────────────────────┘    │
└───────────┬──────────────────────────┬───────────────────────────────────────┘
            │                          │
            ▼                          ▼
┌─────────────────────┐   ┌─────────────────────────────────────────────────┐
│  zkVerify Network   │   │  BASE L2 (Ethereum L2 by Coinbase)              │
│  (Testnet → Main)   │   │                                                 │
│                     │   │  ┌─────────────────────────────────────────┐   │
│  - Verifies ZK      │   │  │  Shunya EAS Resolver Contract           │   │
│    proof off-chain  │   │  │  - Only accepts payloads from zkVerify  │   │
│  - Returns receipt  │   │  │  - Issues EAS attestation               │   │
│                     │   │  │    { wallet: 0x..., isOver18: true }    │   │
└─────────────────────┘   │  └─────────────────────────────────────────┘   │
                          │  ┌─────────────────────────────────────────┐   │
                          │  │  Coinbase Paymaster                     │   │
                          │  │  - Sponsors gas for all user txns       │   │
                          │  └─────────────────────────────────────────┘   │
                          └─────────────────────────────────────────────────┘
                                         │
                                         │ Attestation UID (queryable)
                                         ▼
                          ┌─────────────────────────────┐
                          │  B2B Client App              │
                          │  (e-sports, dating, social)  │
                          │  - Queries EAS by wallet     │
                          │  - Gets: isOver18, gender    │
                          │  - Grants / denies access    │
                          └─────────────────────────────┘
```

### Technology Stack Summary

| Layer | Technology | Why |
|---|---|---|
| ZK Circuit | Circom 2.0 + SnarkJS (WASM) | Runs in browser; Anon Aadhaar uses this |
| Proof optimization | RapidSnark (optional, native) | Faster proving on mobile if needed |
| Client framework | Next.js 14 (App Router) | SSR + WASM support; easy to embed as SDK |
| Mobile (future) | React Native + Expo | Share ZK logic via shared WASM module |
| Backend runtime | Bun + Hono | Fast, lean, TypeScript-native |
| Auth | MSG91 (OTP) | Dominant in India; Razorpay uses it |
| Wallet Abstraction | Coinbase Smart Accounts + Privy | Invisible wallets; gas sponsorship built-in |
| ZK Verification | zkVerify Network | Sub-cent verification; dedicated ZK chain |
| Settlement | Base Sepolia → Base Mainnet | Cheap, fast, Coinbase-backed L2 |
| Attestation | Ethereum Attestation Service (EAS) | Open standard; queryable by B2B clients |
| Database | PostgreSQL (via Supabase) | Stores zero PII — only nullifiers, attestation UIDs |
| Cache / Session | Redis (Upstash) | Serverless-friendly |
| Infra | Vercel (frontend) + Railway/Fly.io (backend) | Fast deploys |
| Monitoring | Sentry + Axiom | Error tracking + structured logs |

---

## 3. Component Deep-Dives

### 3.1 Client SDK — ZK Proof Generation

This is the most critical component. Everything runs on the user's device.

#### 3.1.1 QR Code Processing

The user uploads a screenshot of their DigiLocker Aadhaar page. The QR code on that page contains a **Secure QR** payload — a compressed, UIDAI-signed XML block.

**Processing pipeline (all client-side):**
```
PNG/JPG Screenshot
      │
      ▼
QR Detection (jsQR or ZXing-js, runs in browser)
      │
      ▼
Base10 → Binary decode (Aadhaar Secure QR is a big integer)
      │
      ▼
Deflate decompress (pako.js)
      │
      ▼
XML parse → Extract fields:
  - name, dob, gender, address
  - UIDAI digital signature (RSA-SHA256, 2048-bit)
      │
      ▼
Pass raw XML + signature bytes to ZK circuit
```

**Key insight:** The QR payload itself contains the UIDAI digital signature. The ZK circuit proves that the signature is valid for a given UIDAI public key, without revealing the underlying data. This is the same approach as Anon Aadhaar.

#### 3.1.2 ZK Circuit (Forked Anon Aadhaar)

**Fork target:** `github.com/privacy-scaling-explorations/anon-aadhaar`

**Modifications needed for MVP:**

The upstream Anon Aadhaar circuit proves all fields. We need a slimmed-down circuit that:
1. Proves `age > 18` from the DOB field
2. Proves `signature == valid` against UIDAI public key
3. **Optionally** reveals `gender` (as a committed value, not raw)
4. Does NOT verify state/location

**Circuit file structure:**
```
circuits/
  shunya_main.circom         # Top-level circuit
  age_check.circom           # Extracts DOB, asserts year diff > 18
  rsa_verify.circom          # RSA-SHA256 verification (from PSE lib)
  nullifier.circom           # Generates commitment = hash(UID + appSalt)
  gender_reveal.circom       # Selectively reveals gender bit
```

**Nullifier design (critical for privacy):**
- The circuit outputs a **nullifier** = `poseidon(aadhaarUID, appSpecificSalt)`
- This lets a B2B app detect duplicate verifications (same person verifying twice) WITHOUT linking across apps
- Different apps get different nullifiers for the same person — cross-app tracking is cryptographically impossible

**Proof system:** Groth16 (smallest proof size, cheapest on-chain verification)

**WASM compilation:**
```bash
circom shunya_main.circom --r1cs --wasm --sym -o build/
# This produces shunya_main.wasm + shunya_main.zkey (after trusted setup)
```

**Client-side proving (JavaScript):**
```typescript
import { groth16 } from 'snarkjs';

async function generateProof(qrPayload: AadhaarQRData): Promise<ShunyaProof> {
  const input = {
    // Private inputs (never leave device)
    aadhaarData: qrPayload.xmlBytes,       // raw XML bytes
    signature: qrPayload.signatureBytes,   // RSA signature
    uidaiPublicKey: UIDAI_PUBLIC_KEY_N,    // modulus (public, hardcoded)
    // Public inputs
    currentYear: new Date().getFullYear(),
    appSalt: APP_SPECIFIC_SALT,            // per-app constant
  };

  const { proof, publicSignals } = await groth16.fullProve(
    input,
    '/circuits/shunya_main.wasm',
    '/circuits/shunya_final.zkey'
  );

  return { proof, publicSignals }; // publicSignals = [isOver18, nullifier, genderBit]
}
```

**Performance targets & mitigations:**

| Device class | Expected time | Mitigation |
|---|---|---|
| High-end Android (Pixel 7+) | 3–5s | Baseline |
| Mid-range Android (Redmi Note) | 8–12s | Use Web Workers + show progress bar |
| Low-end Android (<4GB RAM) | 15–20s | Offer native RapidSnark fallback |
| iOS (Safari) | 5–8s | WASM runs well on WebKit |

Use a **Web Worker** to run proving off the main thread so the UI stays responsive.

#### 3.1.3 Trusted Setup

The Groth16 zkey requires a **Powers of Tau ceremony** + **circuit-specific setup**.

For MVP/Testnet: use the existing Hermez Powers of Tau (ptau) file (already public, widely used by PSE projects).

For Mainnet: conduct a Shunya-specific contribution ceremony. This is a regulatory/trust requirement, not just a technical one — document it.

```bash
# Phase 1: Powers of Tau (use existing Hermez file for MVP)
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau

# Phase 2: Circuit-specific setup
snarkjs groth16 setup shunya_main.r1cs pot20_final.ptau shunya_0000.zkey
snarkjs zkey contribute shunya_0000.zkey shunya_final.zkey --name="Shunya Team" -v

# Export verification key
snarkjs zkey export verificationkey shunya_final.zkey verification_key.json
```

---

### 3.2 Wallet Abstraction Layer

The user must NEVER see a wallet, private key, seed phrase, or gas fee. This is enforced architecturally.

#### Stack: Privy + Coinbase Smart Accounts (ERC-4337)

**Why Privy:**
- Phone number → embedded wallet creation in one SDK call
- Handles key custody (MPC-based, not custodial)
- Battle-tested: used by Blackbird, Courtyard, and others

**Why Coinbase Smart Accounts:**
- Native Base support
- Built-in Paymaster for gas sponsorship
- ERC-4337 compliant (account abstraction standard)

**Implementation:**

```typescript
// On first login (after OTP verification)
import { usePrivy, useWallets } from '@privy-io/react-auth';

// Privy auto-creates a Smart Account tied to phone number
// User never sees this happen

async function getOrCreateUserWallet(phone: string): Promise<string> {
  // Privy handles this internally after phone auth
  // Returns a deterministic Smart Account address per phone number
  const wallet = await privyClient.createSmartAccount({
    chainId: base.id, // or baseSepolia.id for testnet
    paymasterUrl: COINBASE_PAYMASTER_URL,
  });
  return wallet.address;
}
```

**Gas Sponsorship:**
- Coinbase Paymaster sponsors all transactions for Shunya-verified users
- We need to set up a Paymaster policy: "sponsor all txns originating from Shunya Resolver contract calls"
- Budget tracking: at <$0.05/verification, even 100K verifications/month = $5,000/month — manageable

**Key storage:**
- Privy uses MPC (Multi-Party Computation) — user's key is split between Privy's servers and the device
- If user loses their phone: recovery via Privy's auth flow (email or new phone OTP)
- We NEVER store or touch the private key

---

### 3.3 Middleware — Verification Bridge

A stateless backend service. Its only job: receive a ZK proof, forward to zkVerify, relay the receipt to Base.

#### Endpoints

```
POST /api/v1/verify
  Body: { proof, publicSignals, walletAddress }
  Action:
    1. Validate proof format (schema check, not ZK math)
    2. Submit to zkVerify
    3. Poll for zkVerify receipt
    4. Call EAS Resolver on Base with receipt
    5. Return attestation UID to client

GET /api/v1/attestation/:walletAddress
  Action: Query EAS GraphQL for wallet's attestations
  Returns: { isOver18, gender, attestationUID, timestamp }
```

#### zkVerify Integration

```typescript
import { ZkVerifySession, Library, ZkVerifyEvents } from 'zkverifyjs';

async function submitToZkVerify(proof: Groth16Proof, publicSignals: string[]) {
  const session = await ZkVerifySession.start()
    .Testnet()
    .withAccount(ZKVERIFY_OPERATOR_SEED); // our operator account, not user

  const { events, transactionResult } = await session.verify()
    .groth16()
    .waitForPublishedAttestation()
    .execute({
      proofData: {
        vk: SHUNYA_VERIFICATION_KEY,
        proof: proof,
        publicSignals: publicSignals
      }
    });

  return new Promise((resolve, reject) => {
    events.on(ZkVerifyEvents.AttestationConfirmed, resolve);
    events.on('error', reject);
  });
}
```

#### Error Handling & Retries

- zkVerify submission: 3 retries with exponential backoff (2s, 4s, 8s)
- If zkVerify is down: queue the proof in Redis with TTL of 10 minutes, retry async
- If Base transaction fails: retry once; if still fails, refund is N/A (gas sponsored), log for manual review
- Client receives a **job ID** immediately and polls `/api/v1/status/:jobId` — never blocks on blockchain finality

---

### 3.4 Settlement Layer — EAS on Base

#### EAS Schema

Deploy a custom schema on Base:

```solidity
// Schema: "bool isOver18, uint8 gender, bytes32 nullifier"
// gender: 0 = not revealed, 1 = male, 2 = female, 3 = other
// nullifier: app-specific commitment (prevents double-verification)
```

Register this schema on Base Sepolia EAS registry. Schema UID will be deterministic and hardcoded in our resolver.

#### Resolver Smart Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { SchemaResolver } from "@ethereum-attestation-service/eas-contracts/contracts/resolver/SchemaResolver.sol";
import { IEAS, Attestation } from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";

contract ShunyaResolver is SchemaResolver {
    address public immutable ZKVERIFY_ORACLE;    // zkVerify's trusted relayer address
    mapping(bytes32 => bool) public usedNullifiers; // prevent double-attestation

    constructor(IEAS eas, address zkVerifyOracle) SchemaResolver(eas) {
        ZKVERIFY_ORACLE = zkVerifyOracle;
    }

    function onAttest(
        Attestation calldata attestation,
        uint256 /*value*/
    ) internal override returns (bool) {
        // CRITICAL: Only accept attestations from our trusted zkVerify relayer
        require(
            attestation.attester == ZKVERIFY_ORACLE,
            "Shunya: unauthorized attester"
        );

        // Decode attestation data
        (bool isOver18, uint8 gender, bytes32 nullifier) =
            abi.decode(attestation.data, (bool, uint8, bytes32));

        // Prevent duplicate attestations (same person, same app)
        require(!usedNullifiers[nullifier], "Shunya: already attested");
        usedNullifiers[nullifier] = true;

        return true;
    }

    function onRevoke(
        Attestation calldata /*attestation*/,
        uint256 /*value*/
    ) internal pure override returns (bool) {
        // Allow admin revocation (for fraud/abuse cases)
        return true;
    }
}
```

**Deployment:**
```bash
# Deploy to Base Sepolia
forge create src/ShunyaResolver.sol:ShunyaResolver \
  --rpc-url $BASE_SEPOLIA_RPC \
  --private-key $DEPLOYER_KEY \
  --constructor-args $EAS_BASE_SEPOLIA_ADDRESS $ZKVERIFY_ORACLE_ADDRESS \
  --verify
```

**Gas costs on Base:**
- EAS attestation: ~80,000–120,000 gas
- At Base gas price (~0.001 gwei): ~$0.00001 per attestation
- zkVerify verification: ~$0.001
- Total per verification: well under $0.05 target ✅

---

### 3.5 Frontend Application

#### User Flow States (in order)

```
[1] LANDING        → Phone number input
[2] OTP VERIFY     → 6-digit OTP entry
[3] UPLOAD QR      → "Upload your Aadhaar QR screenshot"
[4] PROCESSING     → Progress bar + friendly copy ("Generating your privacy-proof...")
[5] SUCCESS        → "You're verified ✓" + optionally show attestation link
[6] ERROR          → Specific error + recovery action
```

#### Copy Strategy (Non-Web3)

Never say: "ZK Proof", "wallet", "gas", "blockchain", "attestation", "smart contract"

Always say: "Privacy Proof", "your secure ID", "verification", "your record"

| Technical term | User-facing equivalent |
|---|---|
| ZK Proof generated | "Privacy proof created" |
| Attestation issued | "Your verification is complete" |
| Wallet address | (never shown) |
| Base L2 | (never shown) |
| zkVerify | (never shown) |
| Nullifier | (never shown) |

#### Component Architecture

```
app/
  layout.tsx                    # Privy provider, global styles
  page.tsx                      # Landing / phone input
  verify/
    page.tsx                    # Main verification flow
    components/
      PhoneStep.tsx             # OTP login
      UploadStep.tsx            # QR image upload + preview
      ProcessingStep.tsx        # Animated progress (Web Worker updates)
      SuccessStep.tsx           # Completion screen
      ErrorStep.tsx             # Error with retry
  api/
    verify/route.ts             # Proxies to backend
    status/[jobId]/route.ts     # Polling endpoint
lib/
  zkProver.ts                   # Web Worker wrapper
  qrParser.ts                   # Client-side QR decode
  aadhaarExtract.ts             # XML → structured data
workers/
  prover.worker.ts              # Runs snarkjs in separate thread
```

#### Processing Step — Web Worker Pattern

```typescript
// workers/prover.worker.ts
import { groth16 } from 'snarkjs';

self.onmessage = async (e: MessageEvent) => {
  const { qrData, wasmPath, zkeyPath } = e.data;

  // Report progress stages
  self.postMessage({ stage: 'parsing', progress: 10 });
  const inputs = parseAadhaarInputs(qrData);

  self.postMessage({ stage: 'proving', progress: 30 });
  const { proof, publicSignals } = await groth16.fullProve(inputs, wasmPath, zkeyPath);

  self.postMessage({ stage: 'done', proof, publicSignals, progress: 100 });
};

// lib/zkProver.ts
export function generateProof(qrData: AadhaarQRData): Promise<ShunyaProof> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/prover.worker.ts', import.meta.url));
    worker.postMessage({ qrData, wasmPath: '/circuits/shunya.wasm', zkeyPath: '/circuits/shunya_final.zkey' });
    worker.onmessage = (e) => {
      if (e.data.stage === 'done') resolve(e.data);
      // update UI progress via callback
    };
    worker.onerror = reject;
  });
}
```

#### File Size Considerations

The `.zkey` file for Groth16 circuits can be 50–200MB. For web:
- Serve from CDN (Cloudflare R2 or Vercel Edge)
- Use HTTP Range requests + stream into snarkjs
- Cache aggressively (immutable, content-hash filename)
- Show a one-time "Downloading verification components..." progress bar on first use

---

### 3.6 Backend API & Database

#### What the Backend Stores (and doesn't)

```
STORES:
  - Phone number (hashed with bcrypt, for auth only)
  - Smart Account wallet address
  - Nullifier (commitment, not reversible to UID)
  - Attestation UID (on-chain reference)
  - Job status (for async polling)
  - Audit log events (no PII fields)

NEVER STORES:
  - Aadhaar UID
  - Name
  - Date of birth
  - Gender (raw)
  - Address
  - The ZK proof itself (ephemeral)
  - QR image or XML
```

#### Backend Service (Bun + Hono)

```typescript
// src/routes/verify.ts
import { Hono } from 'hono';
import { submitToZkVerify } from '../services/zkVerify';
import { issueAttestation } from '../services/eas';
import { jobQueue } from '../services/queue';

const app = new Hono();

app.post('/v1/verify', async (c) => {
  const { proof, publicSignals, walletAddress } = await c.req.json();

  // Validate schema (not ZK math — that's zkVerify's job)
  if (!isValidProofShape(proof)) return c.json({ error: 'invalid_proof' }, 400);

  // Create async job
  const jobId = crypto.randomUUID();
  await jobQueue.add('verify', { proof, publicSignals, walletAddress, jobId });

  return c.json({ jobId, status: 'queued' }, 202);
});

app.get('/v1/status/:jobId', async (c) => {
  const job = await jobQueue.getJob(c.req.param('jobId'));
  if (!job) return c.json({ error: 'not_found' }, 404);

  return c.json({
    jobId: job.id,
    status: job.state,           // queued | active | completed | failed
    attestationUID: job.returnvalue?.attestationUID,
    txHash: job.returnvalue?.txHash,
  });
});
```

---

## 4. Data Flow & Sequence Diagrams

### Full Verification Flow

```
User          Client SDK        Backend        zkVerify       Base (EAS)
  │               │                │               │               │
  │─upload QR────►│                │               │               │
  │               │─decode QR      │               │               │
  │               │─parse XML      │               │               │
  │               │─generate ZK    │               │               │
  │               │  proof (WASM)  │               │               │
  │               │─────POST /verify──────────────►│               │
  │◄─jobId────────│                │               │               │
  │               │                │─submit proof─►│               │
  │               │                │◄─receipt──────│               │
  │               │                │──────────────────────txn─────►│
  │               │                │◄─────────────────────UID──────│
  │──GET status──►│                │               │               │
  │◄─completed────│                │               │               │
  │               │                │               │               │
```

### B2B Client Query Flow

```
B2B App                    EAS (Base)
   │                           │
   │─query by wallet + schema─►│
   │◄─{ isOver18: true }───────│
   │                           │
   │─grant access to user       │
```

B2B clients query EAS directly on-chain. They do NOT need to call Shunya's backend. This is a key architectural win — Shunya's servers are not a runtime dependency for verification.

---

## 5. Smart Contract Specification

### Contracts to Deploy

| Contract | Network | Purpose |
|---|---|---|
| `ShunyaResolver.sol` | Base Sepolia (testnet) → Base Mainnet | EAS attestation gating |
| EAS Schema Registration | Base Sepolia | Register schema once |

### ABI (Key Functions)

```solidity
interface IShunyaResolver {
    // Called by EAS during attestation — auto-invoked, not called directly
    function onAttest(Attestation calldata attestation, uint256 value) external payable returns (bool);

    // Called by EAS during revocation
    function onRevoke(Attestation calldata attestation, uint256 value) external payable returns (bool);

    // Admin: update zkVerify oracle address (if they change their relayer)
    function setZkVerifyOracle(address newOracle) external; // onlyOwner

    // View: check if nullifier has been used (prevent double-verify)
    function isNullifierUsed(bytes32 nullifier) external view returns (bool);
}
```

### How Attestation is Issued

Our backend acts as the **attester** (the zkVerify oracle address). After receiving zkVerify's receipt:

```typescript
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';

async function issueAttestation(walletAddress: string, publicSignals: string[]) {
  const eas = new EAS(EAS_CONTRACT_ADDRESS);
  eas.connect(operatorSigner); // our backend's signer (funded for gas, or via Paymaster)

  const schemaEncoder = new SchemaEncoder("bool isOver18,uint8 gender,bytes32 nullifier");
  const encodedData = schemaEncoder.encodeData([
    { name: "isOver18", value: publicSignals[0] === '1', type: "bool" },
    { name: "gender", value: parseInt(publicSignals[2]), type: "uint8" },
    { name: "nullifier", value: publicSignals[1], type: "bytes32" },
  ]);

  const tx = await eas.attest({
    schema: SHUNYA_SCHEMA_UID,
    data: {
      recipient: walletAddress,
      expirationTime: 0n,  // no expiry
      revocable: true,
      data: encodedData,
    },
  });

  return tx.wait(); // returns attestation UID
}
```

---

## 6. ZK Circuit Design

### Circuit Inputs & Outputs

```
Private Inputs (never leave device):
  - aadhaarXmlBytes[n]     : raw Aadhaar XML byte array
  - rsaSignature[256]      : UIDAI RSA-2048 signature bytes
  - uidaiPublicKeyN[256]   : RSA modulus (2048-bit, public but private in circuit)
  - dobBytes[10]           : Date of birth string bytes ("DD-MM-YYYY")
  - genderByte[1]          : 'M', 'F', or 'T'

Public Inputs:
  - currentYear            : e.g., 2025 (provided by prover, constrained)
  - appSalt                : per-B2B-app constant (prevents cross-app nullifier linking)
  - uidaiPublicKeyHash     : hash of the expected UIDAI key (circuit checks this)

Public Outputs (go on-chain):
  - isOver18               : 1 or 0
  - nullifier              : poseidon(uid, appSalt) — unlinkable commitment
  - genderCommitment       : 0 (not revealed) or 1/2/3 (revealed)
```

### Circuit Logic (Pseudocode)

```
template ShunyaMain() {
  // 1. Verify RSA signature of XML
  component rsaVerify = RSAVerify(2048);
  rsaVerify.message <== hash(aadhaarXmlBytes);
  rsaVerify.signature <== rsaSignature;
  rsaVerify.modulus <== uidaiPublicKeyN;
  rsaVerify.valid === 1; // CONSTRAINT: signature must be valid

  // 2. Check UIDAI key is the expected one (prevent fake key attacks)
  component keyHashCheck = Poseidon(32); // 32 chunks of 64 bits
  keyHashCheck.inputs <== uidaiPublicKeyN_chunks;
  keyHashCheck.out === uidaiPublicKeyHash; // CONSTRAINT: must match expected key

  // 3. Extract DOB, compute age
  component ageCheck = AgeVerifier();
  ageCheck.dobBytes <== dobBytes;
  ageCheck.currentYear <== currentYear;
  isOver18 <== ageCheck.isAdult; // OUTPUT

  // 4. Extract UID from XML, compute nullifier
  component nullifierGen = Poseidon(2);
  nullifierGen.inputs[0] <== extractedUID;
  nullifierGen.inputs[1] <== appSalt;
  nullifier <== nullifierGen.out; // OUTPUT

  // 5. Gender (optional reveal)
  genderCommitment <== genderByte; // OUTPUT (may be 0 if user declines)
}
```

### UIDAI Public Key Rotation

UIDAI rotates their signing key periodically. The circuit hardcodes a **key hash**, not the key itself. When UIDAI rotates:
1. New key → new `verification_key.json` + new `.zkey` (circuit-specific)
2. Update the hardcoded `uidaiPublicKeyHash` constant
3. Re-run trusted setup contribution
4. Existing attestations remain valid (they were valid at time of issuance)

This is a known operational overhead — build a key rotation runbook.

---

## 7. Security Model

### Threat Model

| Threat | Mitigation |
|---|---|
| User uploads fake/forged Aadhaar QR | RSA signature verification inside ZK circuit — forgery requires breaking RSA-2048 |
| Replay attack (reuse old proof) | Nullifier stored on-chain; second attempt with same nullifier rejected by resolver |
| Cross-app tracking | App-specific salt in nullifier derivation — different nullifier per app |
| Backend logs PII | Backend receives only proof + public signals, which contain NO PII by design |
| MITM between client and backend | HTTPS/TLS; proof is valid regardless (math-based trust) |
| Malicious backend issues fake attestation | Resolver only accepts attestations from zkVerify oracle address — backend can't fabricate a zkVerify receipt |
| Compromised zkVerify oracle key | Multi-sig on oracle key (Gnosis Safe); rotation procedure documented |
| Sybil attack (many phones, many UIDs) | One nullifier per UID per app — structurally limited to one attestation |
| User's phone stolen → wallet access | Privy MPC: key is split; attacker needs both the device AND Privy's server share |

### What We Are NOT Defending Against (MVP Scope)

- Nation-state actors with access to UIDAI private key (breaks circuit assumption)
- UIDAI backend compromise (out of scope)
- Physical coercion (out of scope for any system)

### Privacy Guarantees

- The ZK proof reveals: `isOver18 = true`, `nullifier`, optionally `gender`
- The ZK proof hides: name, exact DOB, address, full UID number
- The backend logs: `nullifier`, `walletAddress`, `timestamp` — nothing else
- Even Shunya cannot de-anonymize users from the on-chain data

---

## 8. Infrastructure & DevOps

### Environments

| Environment | Networks | Purpose |
|---|---|---|
| Development | Base Sepolia, zkVerify Testnet | Local dev with hot reload |
| Staging | Base Sepolia, zkVerify Testnet | Pre-prod testing, demo builds |
| Production | Base Mainnet, zkVerify Mainnet | Live |

### Deployment Architecture

```
Cloudflare (CDN + DDoS)
       │
       ├── Vercel (Next.js Frontend + API routes)
       │       └── Edge: /api/v1/status (polling — must be fast)
       │
       └── Railway / Fly.io (Bun Backend)
               ├── Verification Bridge Service
               ├── BullMQ Workers (async proof processing)
               └── Redis (Upstash, serverless)
                   └── PostgreSQL (Supabase, serverless-friendly)
```

### CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
stages:
  - lint (biome)
  - type-check (tsc)
  - circuit tests (mocha + snarkjs)
  - contract tests (forge test)
  - integration tests (vitest)
  - build (next build)
  - deploy staging (on PR merge to main)
  - smoke test staging
  - deploy production (on tag push)
```

### Secrets Management

- All secrets in environment variables (never committed)
- `ZKVERIFY_OPERATOR_SEED` — backend zkVerify account mnemonic
- `EAS_OPERATOR_PRIVATE_KEY` — backend EAS attester key
- `PRIVY_APP_SECRET` — Privy server-side SDK key
- `MSG91_AUTH_KEY` — SMS OTP
- `DATABASE_URL` — Supabase connection string

Store in: Vercel Environment Variables + Railway Secrets + 1Password (team vault)

### Observability

```typescript
// Every verification attempt is logged (no PII)
await auditLog.write({
  event: 'verification_attempt',
  jobId: jobId,
  result: 'success' | 'zkverify_failed' | 'eas_failed',
  durationMs: Date.now() - startTime,
  // NO: walletAddress, nullifier, proof, publicSignals
});
```

Alerts:
- zkVerify submission failure rate > 5% → PagerDuty
- EAS transaction failure → PagerDuty
- Proof generation P95 > 15 seconds (backend tracks via client-reported timing) → Slack

---

## 9. API Reference

### POST /api/v1/verify

Submit a ZK proof for verification.

**Request:**
```json
{
  "proof": {
    "pi_a": ["...", "...", "1"],
    "pi_b": [["...", "..."], ["...", "..."], ["1", "0"]],
    "pi_c": ["...", "...", "1"],
    "protocol": "groth16",
    "curve": "bn128"
  },
  "publicSignals": ["1", "0x1a2b3c...", "2"],
  "walletAddress": "0xAbCd..."
}
```

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued"
}
```

---

### GET /api/v1/status/:jobId

Poll for async verification result.

**Response (completed):**
```json
{
  "jobId": "550e8400...",
  "status": "completed",
  "attestationUID": "0xdeadbeef...",
  "txHash": "0xfeedface...",
  "baseExplorerUrl": "https://sepolia.basescan.org/tx/0xfeedface..."
}
```

**Response (failed):**
```json
{
  "jobId": "550e8400...",
  "status": "failed",
  "error": "zkverify_rejection",
  "errorMessage": "Proof verification failed — ensure your Aadhaar QR is unmodified"
}
```

---

### GET /api/v1/attestation/:walletAddress

Check existing attestation for a wallet. Used by B2B clients.

**Response:**
```json
{
  "verified": true,
  "isOver18": true,
  "gender": 1,
  "attestationUID": "0xdeadbeef...",
  "issuedAt": "2025-04-01T10:30:00Z",
  "schemaUID": "0x..."
}
```

---

### POST /api/v1/auth/request-otp

**Request:** `{ "phone": "+919876543210" }`
**Response:** `{ "requestId": "abc123", "expiresIn": 300 }`

---

### POST /api/v1/auth/verify-otp

**Request:** `{ "requestId": "abc123", "otp": "492817" }`
**Response:** `{ "sessionToken": "jwt...", "walletAddress": "0x..." }`

---

## 10. Database Schema

```sql
-- Users: minimal, no PII
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash    TEXT UNIQUE NOT NULL,  -- bcrypt hash of phone number
  wallet_addr   TEXT UNIQUE NOT NULL,  -- Coinbase Smart Account address
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Nullifiers: prevent double-verification
CREATE TABLE nullifiers (
  nullifier     BYTEA PRIMARY KEY,          -- 32-byte Poseidon hash
  user_id       UUID REFERENCES users(id),
  app_id        TEXT NOT NULL,              -- which B2B app's salt was used
  attested_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Jobs: async verification tracking
CREATE TABLE verification_jobs (
  id              UUID PRIMARY KEY,
  user_id         UUID REFERENCES users(id),
  status          TEXT NOT NULL,             -- queued|active|completed|failed
  zkverify_txn    TEXT,                      -- zkVerify transaction hash
  attestation_uid TEXT,                      -- EAS attestation UID
  error_code      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log: compliance, no PII
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  event_type  TEXT NOT NULL,
  job_id      UUID,
  result      TEXT,
  duration_ms INT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 11. Third-Party Integrations

### MSG91 (OTP)

- API: `https://api.msg91.com/api/v5/otp`
- Template must be pre-approved by DLT (TRAI requirement for Indian SMS)
- Fallback: Twilio Verify (in case MSG91 has downtime)

### Privy

- SDK: `@privy-io/react-auth`
- Server SDK: `@privy-io/server-auth`
- Config: enable phone auth, disable wallet selector UI, enable smart accounts on Base

### zkVerify

- SDK: `zkverifyjs`
- Testnet endpoint: `wss://testnet-rpc.zkverify.io`
- Account: create a funded zkVerify account for the operator (not user accounts)
- Verification key must be registered on zkVerify before proofs can be submitted

### EAS

- SDK: `@ethereum-attestation-service/eas-sdk`
- Base Sepolia EAS contract: `0x4200000000000000000000000000000000000021`
- GraphQL (for querying): `https://base-sepolia.easscan.org/graphql`

### Coinbase Paymaster

- URL: `https://api.developer.coinbase.com/rpc/v1/base-sepolia/{API_KEY}`
- Policy: set to sponsor all calls to `ShunyaResolver` contract address

---

## 12. Testing Strategy

### Circuit Tests

```bash
# Unit test each circom template
# Use mocha + @noir-lang/backend_barretenberg or snarkjs test utilities

describe('AgeCheck circuit', () => {
  it('should pass for DOB 18+ years ago', async () => {
    const input = { dobBytes: encode('01-01-2000'), currentYear: 2025 };
    const { proof } = await groth16.fullProve(input, wasm, zkey);
    expect(proof).toBeDefined();
  });

  it('should fail for underage DOB', async () => {
    const input = { dobBytes: encode('01-01-2010'), currentYear: 2025 };
    await expect(groth16.fullProve(input, wasm, zkey)).rejects.toThrow();
  });
});
```

### Smart Contract Tests (Foundry)

```solidity
contract ShunyaResolverTest is Test {
    function test_RejectUnauthorizedAttester() public {
        // Try to attest from non-oracle address
        vm.prank(address(0xBad));
        vm.expectRevert("Shunya: unauthorized attester");
        resolver.onAttest(mockAttestation, 0);
    }

    function test_RejectDuplicateNullifier() public {
        // First attestation: OK
        vm.prank(ORACLE);
        resolver.onAttest(buildAttestation(nullifier1), 0);

        // Second attestation, same nullifier: FAIL
        vm.prank(ORACLE);
        vm.expectRevert("Shunya: already attested");
        resolver.onAttest(buildAttestation(nullifier1), 0);
    }
}
```

### Integration Tests (Vitest)

- Full flow: mock QR data → proof generation → mock zkVerify response → EAS attestation on local anvil fork
- Cover: happy path, zkVerify failure, duplicate submission, invalid proof

### Load Testing (k6)

- Simulate 100 concurrent `/api/v1/verify` submissions
- Target: P95 latency < 5s (excluding blockchain time)
- BullMQ queue must handle burst without data loss

---

## 13. MVP Milestone Plan

### Week 1: Foundation

| Task | Owner | Done when |
|---|---|---|
| Fork Anon Aadhaar, slim down circuit to age+sig | Dev | Circom compiles, basic test passes |
| Deploy EAS Resolver to Base Sepolia | Dev | Contract verified on Basescan |
| Register EAS schema | Dev | Schema UID obtained |
| Set up Bun + Hono backend skeleton | Dev | `/health` endpoint live on Railway |
| Privy + phone OTP login | Dev | User can log in with Indian phone number |

### Week 2: Core Flow

| Task | Owner | Done when |
|---|---|---|
| Client-side QR decode + XML parse | Dev | Extracts DOB, gender from real DigiLocker QR |
| WASM proof generation in browser (Web Worker) | Dev | Proof generated in < 15s on test device |
| zkVerify integration (testnet) | Dev | Proof successfully verified on zkVerify testnet |
| EAS attestation issuance | Dev | Attestation visible on easscan.org |
| Full async job flow (queue + polling) | Dev | End-to-end in < 30s wall time |

### Week 3: UX Polish + Hardening

| Task | Owner | Done when |
|---|---|---|
| Demo UI (Next.js, 3 states) | Dev | Upload → prove → verified flow works on mobile Chrome |
| Coinbase Paymaster integration | Dev | Zero gas shown to user |
| Error states + retry logic | Dev | All failure modes handled gracefully |
| Performance optimization (zkey CDN) | Dev | First-time load < 5s additional overhead |
| Security review of resolver contract | Dev | No critical issues from self-audit |

### April 10 — Demo Day

Demo script:
1. Open app on phone
2. Enter phone number → receive OTP → log in (< 10 seconds)
3. Upload DigiLocker screenshot → "Generating your privacy proof..." → "You're verified ✓" (< 20 seconds)
4. Show easscan.org with attestation (wow factor for non-technical audience)
5. Show B2B API call → `isOver18: true` returned instantly

---

## 14. Known Tradeoffs & Future Decisions

### Tradeoff: zkVerify vs. Direct On-Chain Verification

The build spec mentions exploring alternatives to zkVerify. Here's the assessment:

| Option | Pros | Cons |
|---|---|---|
| **zkVerify** (chosen for MVP) | Purpose-built for ZK, cheap, fast | Additional network dependency; testnet maturity |
| **On-chain Groth16 verifier (on Base)** | No middleware network; fully trustless | ~500K gas per verification → too expensive |
| **Reclaim Protocol** | Simpler integration | Different trust model; not ZK-native |

**Decision:** zkVerify for MVP. If zkVerify has reliability issues before mainnet, fall back to deploying a Groth16 verifier contract directly on Base (acceptable at $0.01/verification if gas costs drop).

### Tradeoff: Trusted Setup Ceremony

For MVP (testnet), using Hermez's existing ptau is fine. For mainnet, a public ceremony is a hard requirement — any sophisticated user or B2B client will ask about it. Plan for a Shunya-specific ceremony (can be a simple 10-contributor ceremony; document it publicly).

### Future: Native Mobile Proving

Web WASM proving is good for demo. For production scale with sub-5-second proving on low-end Androids, the path is:
1. Build a React Native module wrapping RapidSnark (Rust, compiled to Android/iOS native)
2. Share the same `.zkey` and circuit
3. Proving time drops to ~2s on mid-range Android

This is explicitly out of MVP scope but should be planned for V1.1.

### Future: Multi-Claim Attestation

MVP asserts `isOver18`. Future versions:
- `isOver16` (social media age gates, Australia/France/India)
- `isVerifiedName` (name assertion for KYC lite)
- `isUniqueHuman` (sybil resistance via nullifier uniqueness)
- State/location verification (needs circuit complexity increase)

Each new claim = new circuit + new schema + new trusted setup contribution.

### Regulatory Note

UIDAI's terms of service prohibit storing or transmitting Aadhaar data. Our architecture is designed to be compliant: no Aadhaar data ever hits our servers. However, formal UIDAI compliance certification should be pursued before commercial launch. Engage a legal counsel familiar with DPDP Act (India's data privacy law, 2023) before Series A.

---

*Document last updated: April 2025. Architecture decisions are subject to change based on zkVerify mainnet readiness and Coinbase Paymaster policy terms.*
