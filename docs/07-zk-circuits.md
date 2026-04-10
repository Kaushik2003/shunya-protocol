# 07 — ZK Circuits

We fork PSE's `@anon-aadhaar/circuits` (Circom) and modify it for our
specific needs. This doc explains **what anon-aadhaar does**, **what we
change**, and **why**.

## Background: how Aadhaar QR data is signed

The DigiLocker Aadhaar QR code contains a binary blob:

```
[ sha256(masked Aadhaar data) ]
 || [ name ]
 || [ DOB ]
 || [ gender ]
 || [ address fields ]
 || [ photo (jpeg) ]
 || [ UIDAI RSA-2048 signature ]
```

The signature covers everything before it. UIDAI publishes its public
key. Anyone with the QR bytes and the UIDAI public key can verify the
signature — meaning the data is authentic government-issued PII.

## What anon-aadhaar proves (upstream)

The upstream Anon Aadhaar circuit proves, in zero knowledge:

> "I know a QR payload `P` and a signature `σ` such that
> `RSA_verify(UIDAI_pk, σ, P) == true`, and I am revealing only the
> fields you asked me to reveal."

The reveal-or-hide is controlled by "reveal flags" passed as public
inputs. The circuit always verifies the signature, and conditionally
copies fields to the public output depending on the flags.

Upstream supports revealing: name, DOB, gender, age bucket, state, pincode.

## What we change

Our fork (`packages/circuits`) makes two changes:

### Change 1: restrict outputs

We remove state, pincode, and full DOB reveal paths. Our circuit **only**
outputs:

```
publicOutputs {
  isOver18:      1 bit    // computed inside circuit: now - DOB >= 18 years
  genderBit:     1 bit    // 0 = M, 1 = F
  nameHash:      field    // poseidon(name)
  uidCommitment: field    // poseidon(UID)
}
```

Why:
- **Smaller circuit** → faster proving on phones.
- **Principle of least privilege** — we can't accidentally leak more
  than we committed to.
- **Fewer constraints** → smaller zkey download (target <30MB).

### Change 2: compute `isOver18` inside the circuit

Upstream reveals the DOB field and lets the verifier do the math.
That's wrong for us — we don't want the DOB anywhere, not even in the
proof's public signals. So we pass `currentDate` as a **public input**
and the circuit asserts `DOB + 18y <= currentDate`, outputting only the
boolean.

```circom
// pseudo-circom
signal input currentDate;       // YYYYMMDD, public
signal input dobYear, dobMonth, dobDay;  // private

signal ageInDays <== (currentDate - dob) / ...;
signal output isOver18 <== (ageInDays >= 18*365) ? 1 : 0;
```

`currentDate` being public means the verifier (zkVerify + our resolver)
can check that the proof isn't replaying an old date. We enforce in
the resolver that `currentDate` is within ±24h of block timestamp.

### Change 3: Poseidon nullifier commitment

We add a new public output: `uidCommitment = poseidon(UID)`. The server
then computes the final nullifier as `poseidon(uidCommitment, SALT)`
off-chain.

Why two-stage?
- Keeping `SALT` server-side prevents anyone from grinding nullifiers
  offline. If the salt were in the circuit, it'd leak into the proving
  key and could be extracted.
- Poseidon (instead of SHA/keccak) keeps the circuit cheap.

## The public inputs/outputs contract

```
PUBLIC INPUTS:
  - uidaiPubKey (hash)    // identifies which UIDAI key was used
  - currentDate           // anti-replay

PUBLIC OUTPUTS:
  - isOver18              // must be 1 for us to attest
  - genderBit             // 0 or 1
  - nameHash              // debug only
  - uidCommitment         // used by server to compute nullifier
```

Private witness: raw QR bytes, UIDAI signature, UID, DOB, name.

## Proving system

- **Groth16** over BN254.
- zkey ~30 MB after optimisation.
- Trusted setup: we run our own Powers of Tau ceremony (phase 2 only).
  The anon-aadhaar team publishes a trusted phase 1 output we reuse.
- Proof size: ~192 bytes. Verification: microseconds.

## Performance targets

| Metric | Target | Mid-Android reality |
|---|---|---|
| zkey download (first visit) | <30 MB | cached in IndexedDB after |
| Witness generation | <3 s | |
| Proof generation | <7 s | |
| **Total** | **<10 s** | |

If we miss the target on low-end devices, options are:
1. Switch to Halo2 / Plonky3 (no trusted setup, potentially faster on mobile).
2. Server-assisted proving (*violates our "client-side only" principle*, avoid).
3. Reduce circuit size further by dropping `nameHash`.

## Trusted setup ceremony

- Phase 1 (powers of tau) — reuse PSE's `ptau-28`.
- Phase 2 — we run a small ceremony internally (3–5 contributors) before
  launch. Contributions are public. Artifacts stored in MinIO + pinned to IPFS.
- **The SALT is NOT part of the ceremony.** It's a server-side secret,
  generated separately via `openssl rand -hex 32` and stored in vault.

## On-chain verifier

We generate a Solidity verifier via snarkjs:

```bash
snarkjs zkey export solidityverifier circuit_final.zkey Verifier.sol
```

But we **don't** call this verifier from Base directly — we route through
zkVerify, which is the whole point of the PDF's architecture. The
Solidity verifier is kept as a fallback option only.

## Circuit audit status

- Upstream anon-aadhaar is audited (PSE, 2024). Our diffs are tiny and
  should be re-audited before mainnet launch. MVP testnet is OK without.

## Files

```
packages/circuits/
  circuits/
    shunya.circom             # our entry point
    components/
      rsa_verify.circom       # from upstream
      age_check.circom        # NEW
      poseidon_commitment.circom
  build/                      # zkey, wasm, verifier.sol (gitignored)
  scripts/
    build.sh
    trusted_setup.sh
  test/                       # (out of scope per user instruction)
```
