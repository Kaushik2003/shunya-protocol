# 12 — Glossary

Terms you'll see across the Shunya codebase and docs.

| Term | Meaning |
|---|---|
| **Aadhaar** | India's national ID system, run by UIDAI. Every resident has a 12-digit number and supporting biographic/biometric data. |
| **Aadhaar QR** | A 2D QR code in the DigiLocker Aadhaar PDF containing a UIDAI-signed blob of user data (name, DOB, gender, address, photo). |
| **Attestation** | An on-chain EAS record asserting "Shunya verified this claim about this address". |
| **Attestation UID** | The unique `bytes32` identifier EAS assigns to each attestation. |
| **Base** | Coinbase's Ethereum L2. We use Base Sepolia (testnet) for MVP. |
| **BullMQ** | A Redis-backed Node.js job queue we use for async worker tasks. |
| **CDP** | Coinbase Developer Platform — the umbrella for Coinbase's wallet, paymaster, and account APIs. |
| **Circuit** | A ZK circuit — mathematical description of what the proof proves. Ours is written in Circom. |
| **Circom** | DSL for writing ZK circuits, compiled to R1CS, proved with Groth16 (among others). |
| **Client-side proving** | Generating the ZK proof in the user's browser so raw PII never leaves the device. |
| **DigiLocker** | Indian government app that lets citizens download their Aadhaar as a signed PDF. We ingest screenshots of this. |
| **DPDP Act** | India's Digital Personal Data Protection Act 2023. Governs PII handling. |
| **Drizzle** | The TypeScript ORM we use for Postgres. |
| **EAS** | Ethereum Attestation Service. A standard contract system for making on-chain claims. |
| **Fast path** | The returning-user flow: if we've seen this nullifier before, skip proving and issue a new attestation directly. |
| **Groth16** | A zero-knowledge proving system. Small proofs (~192 bytes), trusted setup required, fast verification. |
| **HMAC** | Hash-based message authentication. Used to sign webhooks. |
| **Hono** | The HTTP framework we use. Tiny, fast, edge-friendly. |
| **Lucia** | Self-hostable TypeScript auth library for the dashboard. |
| **MinIO** | Self-hosted, S3-compatible object storage. |
| **Moat** | The cross-client reuse effect: once a user verifies with Shunya, every other Shunya client can instantly verify them. |
| **Nullifier** | `poseidon(poseidon(UID), SALT)` — a per-human identifier we store. One-way, salted. |
| **OTP** | One-time password. Used for phone login in the popup. |
| **Paymaster** | A 4337 contract that pays gas on behalf of a user. Coinbase's CDP Paymaster is the one we use. |
| **PII** | Personally Identifiable Information. Our goal is to never store any. |
| **Poseidon** | A SNARK-friendly hash function. Cheap inside circuits. |
| **Popup** | The Shunya-hosted iframe (`verify.shunya.app`) where the user uploads their QR and proving runs. |
| **Publishable key** | `pk_live_...` — safe to ship in browser code. Cannot mint sessions. |
| **Public signals** | The inputs/outputs of a ZK proof that are not private. For us: `{isOver18, genderBit, nameHash, uidCommitment}`. |
| **Resolver (EAS)** | A contract hooked into EAS that gates which attestations are allowed. Ours verifies zkVerify receipts before permitting attestation. |
| **Secret key** | `sk_live_...` — server-only. Mints sessions and reads attestations. |
| **Session (Shunya)** | One verification attempt. Has `sessionId` (server) and `sessionToken` (JWT for the popup). |
| **Shunya** | Sanskrit for "zero". Our project name, referencing zero-knowledge. |
| **Smart account** | An ERC-4337 abstract account. We use CDP Smart Accounts, one per verified human, deterministic via `salt=nullifier`. |
| **Trusted setup** | The one-time ceremony required for Groth16 to be secure. We reuse PSE's phase-1 output and run a small phase-2 ourselves. |
| **UID** | A user's 12-digit Aadhaar number. We never store it. |
| **uidCommitment** | `poseidon(UID)` — a one-way commitment produced in the circuit. Half of the nullifier derivation. |
| **UIDAI** | The Unique Identification Authority of India. They sign Aadhaar data; their public key is what the circuit verifies against. |
| **Verification key (VK)** | The public half of a trusted-setup output. Used to verify proofs. Registered once with zkVerify. |
| **Verified user** | A row in `verified_users`. Represents one real human across all Shunya B2B clients. |
| **Webhook** | The HTTP callback we fire to a B2B client's server when a session completes. |
| **zkey** | The compiled circuit + proving key, ~30 MB, downloaded once by the popup and cached in IndexedDB. |
| **zkVerify** | A specialised Substrate-based chain that verifies ZK proofs cheaply and publishes Merkle roots. Our middleware layer. |
