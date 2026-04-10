# Phase 1 — ZK Circuits, Contracts & Demo Popup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the anon-aadhaar Circom circuit, build a ZK circuit that proves age ≥ 18 + gender + nameHash + uidCommitment from an Aadhaar QR, deploy `ShunyaResolver.sol` to Base Sepolia, and produce a stateless demo popup that runs the full proof in the browser.

**Architecture:** Copy source files from `anon-aadhaar/packages/circuits/src/` into `packages/circuits/circuits/`, make targeted modifications to `extractor.circom` and create a new `shunya.circom` entry point. Build with `circom` + `snarkjs`. Deploy the Foundry contract. The demo popup (`apps/popup`) runs the proof in a Web Worker and shows public signals — no backend calls in Phase 1.

**Tech Stack:** Circom 2.1.9, snarkjs 0.7.4, Node.js 20+, Foundry (forge/cast), Next.js 14, Bun.

**Pre-requisites:**
- Phase 0 complete (monorepo scaffold, NeonDB migrated)
- `circom` 2.1.9 installed (`cargo install circom`)
- Foundry installed (`foundryup`)
- `BASE_SEPOLIA_RPC`, `DEPLOYER_PRIVATE_KEY`, `SHUNYA_SCHEMA_UID` in `.env`

---

## Files Created in This Phase

```
packages/circuits/
  circuits/
    shunya.circom                   NEW entry point
    helpers/
      extractor.circom              MODIFIED — add nameHash, uidCommitment; remove photo/pinCode/state
      constants.circom              COPIED unchanged from anon-aadhaar
      signature.circom              COPIED unchanged
      nullifier.circom              COPIED (kept for reference, not used in shunya.circom)
    utils/
      pack.circom                   COPIED unchanged
  scripts/
    build.sh                        NEW — compile circuit
    trusted_setup.sh                NEW — Powers of Tau + phase-2 setup
  build/                            gitignored — compiled artifacts

packages/contracts/
  src/
    IZkVerifyAggregation.sol        NEW interface stub
    ShunyaResolver.sol              NEW resolver contract
  script/
    Deploy.s.sol                    NEW deployment script
  foundry.toml                      NEW
  remappings.txt                    NEW

packages/shared/src/
  types.ts                          NEW shared type definitions
  config.ts                         NEW chain addresses (filled after deploy)
  index.ts                          UPDATED to re-export types + config

apps/popup/
  next.config.js                    NEW — enable WASM + Web Worker
  public/
    worker/
      prove.worker.js               NEW placeholder (real worker built after circuit compiles)
  app/
    page.tsx                        NEW — QR upload + demo prove UI
    layout.tsx                      NEW — minimal layout
    components/
      QRUploader.tsx                NEW — file drop → jsQR decode
      ProofRunner.tsx               NEW — spawns Web Worker, shows progress + result
```

---

### Task 1: Copy Upstream Circuit Files

**Files:**
- Create: `packages/circuits/circuits/helpers/constants.circom`
- Create: `packages/circuits/circuits/helpers/signature.circom`
- Create: `packages/circuits/circuits/helpers/nullifier.circom`
- Create: `packages/circuits/circuits/utils/pack.circom`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p packages/circuits/circuits/helpers
mkdir -p packages/circuits/circuits/utils
mkdir -p packages/circuits/scripts
mkdir -p packages/circuits/build
```

- [ ] **Step 2: Copy upstream helper files verbatim**

```bash
cp anon-aadhaar/packages/circuits/src/helpers/constants.circom  packages/circuits/circuits/helpers/
cp anon-aadhaar/packages/circuits/src/helpers/signature.circom  packages/circuits/circuits/helpers/
cp anon-aadhaar/packages/circuits/src/helpers/nullifier.circom  packages/circuits/circuits/helpers/
cp anon-aadhaar/packages/circuits/src/utils/pack.circom         packages/circuits/circuits/utils/
```

- [ ] **Step 3: Verify copies landed**

```bash
ls packages/circuits/circuits/helpers/
```

Expected: `constants.circom  nullifier.circom  signature.circom`

- [ ] **Step 4: Commit**

```bash
git add packages/circuits/
git commit -m "feat(circuits): copy upstream helper files from anon-aadhaar"
```

---

### Task 2: Write Modified `extractor.circom`

**Files:**
- Create: `packages/circuits/circuits/helpers/extractor.circom`

This replaces the upstream extractor. Key differences:
- `QRDataExtractor` now takes `currentYear`, `currentMonth`, `currentDay` as inputs (instead of deriving them from the QR timestamp).
- Removes `photo`, `pinCode`, `state` outputs.
- Adds `nameHash = Poseidon([name_packed_int])`.
- Adds `uidCommitment = Poseidon([refId_packed_int])` using position 2 (reference ID = last 4 digits + timestamp — unique per person's QR).
- Renames `ageAbove18` → `isOver18`, `gender` → `genderBit`.

- [ ] **Step 1: Create `packages/circuits/circuits/helpers/extractor.circom`**

```circom
pragma circom 2.1.9;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";
include "@zk-email/circuits/utils/array.circom";
include "@zk-email/circuits/utils/bytes.circom";
include "../helpers/constants.circom";
include "../utils/pack.circom";


// ── Copied helpers (unchanged) ──────────────────────────────────────────────

template ExtractAndPackAsInt(maxDataLength, extractPosition) {
    signal input nDelimitedData[maxDataLength];
    signal input delimiterIndices[18];
    signal output out;

    signal startDelimiterIndex <== delimiterIndices[extractPosition - 1];
    signal endDelimiterIndex   <== delimiterIndices[extractPosition];

    var extractMaxLength = maxFieldByteSize();
    var byteLength = extractMaxLength + 1;

    component subArraySelector = SelectSubArray(maxDataLength, byteLength);
    subArraySelector.in          <== nDelimitedData;
    subArraySelector.startIndex  <== startDelimiterIndex;
    subArraySelector.length      <== endDelimiterIndex - startDelimiterIndex;
    signal shiftedBytes[byteLength] <== subArraySelector.out;

    shiftedBytes[0] === extractPosition * 255;

    component endDelimiterSelector = ItemAtIndex(maxDataLength);
    endDelimiterSelector.in    <== nDelimitedData;
    endDelimiterSelector.index <== endDelimiterIndex;
    endDelimiterSelector.out   === (extractPosition + 1) * 255;

    component outInt = PackBytes(extractMaxLength);
    for (var i = 0; i < extractMaxLength; i++) {
        outInt.in[i] <== shiftedBytes[i + 1];
    }
    out <== outInt.out[0];
}


template TimestampExtractor(maxDataLength) {
    signal input nDelimitedData[maxDataLength];
    signal output timestamp;
    signal output year  <== DigitBytesToInt(4)([nDelimitedData[9],  nDelimitedData[10], nDelimitedData[11], nDelimitedData[12]]);
    signal output month <== DigitBytesToInt(2)([nDelimitedData[13], nDelimitedData[14]]);
    signal output day   <== DigitBytesToInt(2)([nDelimitedData[15], nDelimitedData[16]]);
    signal hour         <== DigitBytesToInt(2)([nDelimitedData[17], nDelimitedData[18]]);

    component dateToUnixTime = DigitBytesToTimestamp(2032);
    dateToUnixTime.year   <== year;
    dateToUnixTime.month  <== month;
    dateToUnixTime.day    <== day;
    dateToUnixTime.hour   <== hour;
    dateToUnixTime.minute <== 0;
    dateToUnixTime.second <== 0;

    timestamp <== dateToUnixTime.out - 19800;
}


template AgeExtractor(maxDataLength) {
    signal input nDelimitedData[maxDataLength];
    signal input startDelimiterIndex;
    signal input currentYear;
    signal input currentMonth;
    signal input currentDay;

    signal output age;
    signal output nDelimitedDataShiftedToDob[maxDataLength];

    component shifter = VarShiftLeft(maxDataLength, maxDataLength);
    shifter.in    <== nDelimitedData;
    shifter.shift <== startDelimiterIndex;
    signal shiftedBytes[maxDataLength] <== shifter.out;

    shiftedBytes[0]  === dobPosition() * 255;
    shiftedBytes[11] === (dobPosition() + 1) * 255;

    signal year  <== DigitBytesToInt(4)([shiftedBytes[7], shiftedBytes[8], shiftedBytes[9],  shiftedBytes[10]]);
    signal month <== DigitBytesToInt(2)([shiftedBytes[4], shiftedBytes[5]]);
    signal day   <== DigitBytesToInt(2)([shiftedBytes[1], shiftedBytes[2]]);

    signal ageByYear <== currentYear - year - 1;

    signal monthGt <== GreaterThan(4)([currentMonth, month]);
    signal monthEq <== IsEqual()([currentMonth, month]);
    signal dayGt   <== GreaterThan(5)([currentDay + 1, day]);
    signal isHigherDayOnSameMonth <== monthEq * dayGt;

    age <== ageByYear + (monthGt + isHigherDayOnSameMonth);
    nDelimitedDataShiftedToDob <== shiftedBytes;
}


template GenderExtractor(maxDataLength) {
    signal input nDelimitedDataShiftedToDob[maxDataLength];
    signal output out;

    nDelimitedDataShiftedToDob[11] === genderPosition() * 255;
    nDelimitedDataShiftedToDob[13] === (genderPosition() + 1) * 255;
    out <== nDelimitedDataShiftedToDob[12];
}


// ── Shunya QRDataExtractor (modified) ────────────────────────────────────────
//
// Changes vs. upstream:
//  + currentYear / currentMonth / currentDay are inputs (not derived from QR timestamp)
//  + nameHash output  = Poseidon([packed name field])
//  + uidCommitment    = Poseidon([packed reference-ID field])
//  - Removed: photo, pinCode, state outputs

template QRDataExtractor(maxDataLength) {
    signal input data[maxDataLength];
    signal input qrDataPaddedLength;
    signal input delimiterIndices[18];
    signal input currentYear;
    signal input currentMonth;
    signal input currentDay;

    signal output timestamp;
    signal output isOver18;
    signal output genderBit;
    signal output nameHash;
    signal output uidCommitment;

    // Build nDelimitedData (n-th 255 becomes n*255)
    component is255[maxDataLength];
    component indexBeforePhoto[maxDataLength];
    signal is255AndIndexBeforePhoto[maxDataLength];
    signal nDelimitedData[maxDataLength];
    signal n255Filter[maxDataLength + 1];
    n255Filter[0] <== 0;

    for (var i = 0; i < maxDataLength; i++) {
        is255[i] = IsEqual();
        is255[i].in[0] <== 255;
        is255[i].in[1] <== data[i];

        indexBeforePhoto[i] = LessThan(12);
        indexBeforePhoto[i].in[0] <== i;
        indexBeforePhoto[i].in[1] <== delimiterIndices[photoPosition() - 1] + 1;

        is255AndIndexBeforePhoto[i] <== is255[i].out * indexBeforePhoto[i].out;
        n255Filter[i + 1] <== is255AndIndexBeforePhoto[i] * 255 + n255Filter[i];
        nDelimitedData[i] <== is255AndIndexBeforePhoto[i] * n255Filter[i] + data[i];
    }

    // Timestamp (still extracted from QR for anti-replay via pubkeyHash path)
    component timestampExtractor = TimestampExtractor(maxDataLength);
    timestampExtractor.nDelimitedData <== nDelimitedData;
    timestamp <== timestampExtractor.timestamp;

    // Age check using external currentYear/Month/Day
    component ageExtractor = AgeExtractor(maxDataLength);
    ageExtractor.nDelimitedData        <== nDelimitedData;
    ageExtractor.startDelimiterIndex   <== delimiterIndices[dobPosition() - 1];
    ageExtractor.currentYear           <== currentYear;
    ageExtractor.currentMonth          <== currentMonth;
    ageExtractor.currentDay            <== currentDay;

    component ageAbove18Checker = GreaterThan(8);
    ageAbove18Checker.in[0] <== ageExtractor.age;
    ageAbove18Checker.in[1] <== 18;
    isOver18 <== ageAbove18Checker.out;

    // Gender
    component genderExtractor = GenderExtractor(maxDataLength);
    genderExtractor.nDelimitedDataShiftedToDob <== ageExtractor.nDelimitedDataShiftedToDob;
    // Gender byte: 70='F', 77='M'. Map to bit: F=1, M=0 via (out - 77) * (-1/7) ... simpler: IsEqual
    // We output the raw byte (70 or 77) and let the TypeScript layer map it.
    genderBit <== genderExtractor.out;

    // nameHash = Poseidon([packed name field at position 3])
    component namePacker = ExtractAndPackAsInt(maxDataLength, namePosition());
    namePacker.nDelimitedData    <== nDelimitedData;
    namePacker.delimiterIndices  <== delimiterIndices;

    component nameHasher = Poseidon(1);
    nameHasher.inputs[0] <== namePacker.out;
    nameHash <== nameHasher.out;

    // uidCommitment = Poseidon([reference ID field at position 2])
    // Reference ID contains last 4 digits of Aadhaar + timestamp — unique per person's QR
    component refIdPacker = ExtractAndPackAsInt(maxDataLength, referenceIdPosition());
    refIdPacker.nDelimitedData   <== nDelimitedData;
    refIdPacker.delimiterIndices <== delimiterIndices;

    component uidHasher = Poseidon(1);
    uidHasher.inputs[0] <== refIdPacker.out;
    uidCommitment <== uidHasher.out;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/circuits/circuits/helpers/extractor.circom
git commit -m "feat(circuits): modified extractor — nameHash, uidCommitment, external currentDate"
```

---

### Task 3: Write `shunya.circom` (Main Circuit)

**Files:**
- Create: `packages/circuits/circuits/shunya.circom`

- [ ] **Step 1: Create `packages/circuits/circuits/shunya.circom`**

```circom
pragma circom 2.1.9;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "./helpers/signature.circom";
include "./helpers/extractor.circom";

/// @title ShunyaVerifier
/// @notice Proves: (1) UIDAI RSA signature is valid, (2) person is ≥18 on currentDate,
///         revealing only {isOver18, genderBit, nameHash, uidCommitment}.
/// @param n  RSA chunk bit size (121 for 2048-bit key split into 17 chunks)
/// @param k  Number of RSA chunks (17)
/// @param maxDataLength  Max byte length of padded QR data (3072)
template ShunyaVerifier(n, k, maxDataLength) {
    // ── Private inputs ──────────────────────────────────────────────────────
    signal input qrDataPadded[maxDataLength];
    signal input qrDataPaddedLength;
    signal input delimiterIndices[18];
    signal input signature[k];
    signal input pubKey[k];

    // Date witnesses — must satisfy: year*10000 + month*100 + day === currentDate
    signal input currentYear;
    signal input currentMonth;
    signal input currentDay;

    // ── Public inputs ───────────────────────────────────────────────────────
    signal input currentDate;  // YYYYMMDD integer, e.g. 20260411

    // ── Outputs ─────────────────────────────────────────────────────────────
    signal output pubkeyHash;      // Poseidon hash of RSA pubkey chunks
    signal output isOver18;        // 1 if age ≥ 18 on currentDate
    signal output genderBit;       // 70 = F, 77 = M (raw byte from QR)
    signal output nameHash;        // Poseidon(packed name)
    signal output uidCommitment;   // Poseidon(packed reference-ID)


    // ── 1. Constrain date witnesses to public currentDate ───────────────────
    signal dateReconstructed <== currentYear * 10000 + currentMonth * 100 + currentDay;
    dateReconstructed === currentDate;


    // ── 2. Verify RSA signature ─────────────────────────────────────────────
    component n2bHeaderLength = Num2Bits(log2Ceil(maxDataLength));
    n2bHeaderLength.in <== qrDataPaddedLength;

    component signatureVerifier = SignatureVerifier(n, k, maxDataLength);
    signatureVerifier.qrDataPadded       <== qrDataPadded;
    signatureVerifier.qrDataPaddedLength <== qrDataPaddedLength;
    signatureVerifier.pubKey             <== pubKey;
    signatureVerifier.signature          <== signature;
    pubkeyHash <== signatureVerifier.pubkeyHash;

    AssertZeroPadding(maxDataLength)(qrDataPadded, qrDataPaddedLength);


    // ── 3. Extract fields ───────────────────────────────────────────────────
    component extractor = QRDataExtractor(maxDataLength);
    extractor.data                <== qrDataPadded;
    extractor.qrDataPaddedLength  <== qrDataPaddedLength;
    extractor.delimiterIndices    <== delimiterIndices;
    extractor.currentYear         <== currentYear;
    extractor.currentMonth        <== currentMonth;
    extractor.currentDay          <== currentDay;


    // ── 4. Assign outputs ───────────────────────────────────────────────────
    isOver18      <== extractor.isOver18;
    genderBit     <== extractor.genderBit;
    nameHash      <== extractor.nameHash;
    uidCommitment <== extractor.uidCommitment;


    // ── 5. Assert isOver18 ──────────────────────────────────────────────────
    // Circuit rejects proofs for anyone under 18.
    isOver18 === 1;
}

// Instantiate with UIDAI 2048-bit RSA key: n=121, k=17, maxDataLength=3072
component main { public [currentDate] } = ShunyaVerifier(121, 17, 3072);
```

- [ ] **Step 2: Commit**

```bash
git add packages/circuits/circuits/shunya.circom
git commit -m "feat(circuits): shunya.circom main entry — external currentDate, no nullifierSeed"
```

---

### Task 4: Circuit Build and Trusted Setup Scripts

**Files:**
- Create: `packages/circuits/scripts/build.sh`
- Create: `packages/circuits/scripts/trusted_setup.sh`

- [ ] **Step 1: Create `packages/circuits/scripts/build.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CIRCUITS_DIR="$SCRIPT_DIR/../circuits"
BUILD_DIR="$SCRIPT_DIR/../build"

mkdir -p "$BUILD_DIR"

echo "==> Compiling shunya.circom..."
circom "$CIRCUITS_DIR/shunya.circom" \
  --r1cs \
  --wasm \
  --sym \
  --output "$BUILD_DIR" \
  -l node_modules

echo "==> Outputs in $BUILD_DIR:"
ls -lh "$BUILD_DIR"
echo ""
echo "Next: run trusted_setup.sh to generate .zkey"
```

- [ ] **Step 2: Create `packages/circuits/scripts/trusted_setup.sh`**

```bash
#!/usr/bin/env bash
# Trusted setup (phase 1 reuse + phase 2 contribution).
# Run once. The resulting circuit_final.zkey must be committed to MinIO / IPFS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/../build"

PTAU="$BUILD_DIR/powersOfTau28_hez_final_25.ptau"
R1CS="$BUILD_DIR/shunya.r1cs"
ZKEY_0="$BUILD_DIR/circuit_0000.zkey"
ZKEY_FINAL="$BUILD_DIR/circuit_final.zkey"
VKEY="$BUILD_DIR/verification_key.json"

# 1. Download PSE phase-1 powers of tau (if not cached)
if [ ! -f "$PTAU" ]; then
  echo "==> Downloading ptau (Hermez 25)..."
  curl -L -o "$PTAU" \
    "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_25.ptau"
fi

# 2. Phase 2 setup (circuit-specific)
echo "==> Phase-2 setup..."
npx snarkjs groth16 setup "$R1CS" "$PTAU" "$ZKEY_0"

# 3. Contribute (single ceremony for dev; production needs 3+ contributors)
echo "==> Contributing to phase-2 ceremony (dev contribution)..."
echo "dev-contribution-random-$(date +%s)" | \
  npx snarkjs zkey contribute "$ZKEY_0" "$ZKEY_FINAL" \
    --name="Shunya dev ceremony" -e="$(openssl rand -hex 32)"

# 4. Export verification key
echo "==> Exporting verification key..."
npx snarkjs zkey export verificationkey "$ZKEY_FINAL" "$VKEY"

echo ""
echo "==> Done. Files in $BUILD_DIR:"
ls -lh "$BUILD_DIR"
echo ""
echo "IMPORTANT: Upload circuit_final.zkey and verification_key.json to MinIO bucket shunya-artifacts."
echo "IMPORTANT: Run 'npx snarkjs zkey export solidityverifier $ZKEY_FINAL packages/contracts/src/Verifier.sol'"
```

- [ ] **Step 3: Make scripts executable**

```bash
chmod +x packages/circuits/scripts/build.sh
chmod +x packages/circuits/scripts/trusted_setup.sh
```

- [ ] **Step 4: Install snarkjs in circuits package**

In `packages/circuits/package.json`, add:
```json
{
  "name": "@shunya/circuits",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "bash scripts/build.sh",
    "setup": "bash scripts/trusted_setup.sh"
  },
  "devDependencies": {
    "snarkjs": "^0.7.4"
  }
}
```

Then:
```bash
pnpm install
```

- [ ] **Step 5: Run the build**

```bash
cd packages/circuits && pnpm run build
```

Expected output: `build/shunya.r1cs`, `build/shunya_js/shunya.wasm`, `build/shunya.sym`

If circomlib / @zk-email imports fail, install them:
```bash
cd packages/circuits
npm init -y  # temp, just to get node_modules for circom includes
npm install circomlib @zk-email/circuits
```

Then re-run the build.

- [ ] **Step 6: Run trusted setup**

```bash
cd packages/circuits && pnpm run setup
```

Expected: `build/circuit_final.zkey`, `build/verification_key.json` created. The `.zkey` will be ~30-100 MB.

- [ ] **Step 7: Commit scripts (not build artifacts)**

```bash
git add packages/circuits/scripts/ packages/circuits/package.json
git commit -m "feat(circuits): build + trusted setup scripts"
```

---

### Task 5: Foundry Contracts Setup

**Files:**
- Create: `packages/contracts/foundry.toml`
- Create: `packages/contracts/remappings.txt`
- Create: `packages/contracts/src/IZkVerifyAggregation.sol`
- Create: `packages/contracts/src/ShunyaResolver.sol`
- Create: `packages/contracts/script/Deploy.s.sol`

- [ ] **Step 1: Initialize Foundry in contracts package**

```bash
cd packages/contracts
forge init --no-git --no-commit .
```

This creates `src/`, `script/`, `test/`, `lib/`, `foundry.toml`.

- [ ] **Step 2: Overwrite `packages/contracts/foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.23"
optimizer = true
optimizer_runs = 200
remappings_file = "remappings.txt"

[rpc_endpoints]
base_sepolia = "${BASE_SEPOLIA_RPC}"
```

- [ ] **Step 3: Install EAS contracts via forge**

```bash
cd packages/contracts
forge install ethereum-attestation-service/eas-contracts --no-git
```

- [ ] **Step 4: Create `packages/contracts/remappings.txt`**

```
@ethereum-attestation-service/eas-contracts/=lib/eas-contracts/contracts/
```

- [ ] **Step 5: Create `packages/contracts/src/IZkVerifyAggregation.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice Minimal interface for zkVerify's on-chain aggregation verifier.
/// @dev The real contract is deployed by the zkVerify team. This interface
///      is what ShunyaResolver calls to check Merkle inclusion.
interface IZkVerifyAggregation {
    /// @param aggregationId  The aggregation batch ID returned by zkVerify's SDK.
    /// @param leafIndex      Index of our proof's leaf within the batch.
    /// @param leaf           keccak256(abi.encode(vkHash, publicSignalsEncoded))
    /// @param merkleProof    Sibling hashes for the Merkle path.
    /// @return               True if the leaf is included in the published root.
    function verifyProofAggregation(
        uint256 aggregationId,
        uint256 leafIndex,
        bytes32 leaf,
        bytes32[] calldata merkleProof
    ) external view returns (bool);
}
```

- [ ] **Step 6: Create `packages/contracts/src/ShunyaResolver.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { SchemaResolver } from "@ethereum-attestation-service/eas-contracts/resolver/SchemaResolver.sol";
import { IEAS, Attestation, AttestationRequest, AttestationRequestData } from "@ethereum-attestation-service/eas-contracts/IEAS.sol";
import { IZkVerifyAggregation } from "./IZkVerifyAggregation.sol";

/// @title ShunyaResolver
/// @notice EAS SchemaResolver that gates attestations behind a zkVerify Merkle receipt.
///         Only this contract can write attestations to the Shunya schema.
contract ShunyaResolver is SchemaResolver {
    IZkVerifyAggregation public immutable zkv;
    bytes32 public immutable shunyaVkHash;
    bytes32 public immutable shunyaSchemaUid;

    event AttestationCreated(bytes32 indexed uid, address indexed subject);

    constructor(
        IEAS _eas,
        IZkVerifyAggregation _zkv,
        bytes32 _vkHash,
        bytes32 _schemaUid
    ) SchemaResolver(_eas) {
        zkv          = _zkv;
        shunyaVkHash = _vkHash;
        shunyaSchemaUid = _schemaUid;
    }

    /// @notice Called externally (by our backend worker) to issue a verified attestation.
    /// @param aggregationId      zkVerify aggregation batch ID
    /// @param leafIndex          Index of our proof's leaf in the batch
    /// @param merkleProof        Sibling hashes
    /// @param publicSignalsEncoded  abi.encode(isOver18, genderBit, nameHash, uidCommitment)
    /// @param subject            User's Coinbase smart account address
    /// @return uid               The EAS attestation UID
    function attest(
        uint256 aggregationId,
        uint256 leafIndex,
        bytes32[] calldata merkleProof,
        bytes calldata publicSignalsEncoded,
        address subject
    ) external returns (bytes32 uid) {
        // 1. Re-derive the leaf the way zkVerify SDK does
        bytes32 leaf = keccak256(abi.encode(shunyaVkHash, publicSignalsEncoded));

        // 2. Verify Merkle inclusion in zkVerify's published aggregation
        require(
            zkv.verifyProofAggregation(aggregationId, leafIndex, leaf, merkleProof),
            "ShunyaResolver: invalid zkVerify receipt"
        );

        // 3. Decode public signals
        (bool isOver18, uint8 genderBit, bytes32 nameHash, bytes32 uidCommitment)
            = abi.decode(publicSignalsEncoded, (bool, uint8, bytes32, bytes32));

        require(isOver18, "ShunyaResolver: subject is not over 18");

        // 4. Issue EAS attestation
        uid = _eas.attest(
            AttestationRequest({
                schema: shunyaSchemaUid,
                data: AttestationRequestData({
                    recipient:      subject,
                    expirationTime: 0,
                    revocable:      true,
                    refUID:         bytes32(0),
                    data:           abi.encode(uidCommitment, isOver18, genderBit, nameHash),
                    value:          0
                })
            })
        );

        emit AttestationCreated(uid, subject);
    }

    /// @notice Reject direct EAS attestations to this schema.
    ///         All attestations must go through attest() above.
    function onAttest(Attestation calldata, uint256)
        internal view override returns (bool)
    {
        return msg.sender == address(this);
    }

    function onRevoke(Attestation calldata, uint256)
        internal pure override returns (bool)
    {
        return true;
    }
}
```

- [ ] **Step 7: Create `packages/contracts/script/Deploy.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { Script, console } from "forge-std/Script.sol";
import { ShunyaResolver } from "../src/ShunyaResolver.sol";
import { IZkVerifyAggregation } from "../src/IZkVerifyAggregation.sol";
import { IEAS } from "@ethereum-attestation-service/eas-contracts/IEAS.sol";

contract DeployScript is Script {
    // EAS on Base Sepolia (official deployment)
    address constant EAS_BASE_SEPOLIA = 0x4200000000000000000000000000000000000021;

    // zkVerify aggregation contract on Base Sepolia — fill in once zkVerify publishes address
    // Check: https://docs.zkverify.io/tutorials/submit-proofs/evm-optimistic
    address constant ZKV_AGGREGATION   = 0x0000000000000000000000000000000000000000; // TODO

    function run() external {
        bytes32 vkHash    = vm.envBytes32("ZKVERIFY_VK_HASH");
        bytes32 schemaUid = vm.envBytes32("SHUNYA_SCHEMA_UID");

        vm.startBroadcast();

        ShunyaResolver resolver = new ShunyaResolver(
            IEAS(EAS_BASE_SEPOLIA),
            IZkVerifyAggregation(ZKV_AGGREGATION),
            vkHash,
            schemaUid
        );

        console.log("ShunyaResolver deployed at:", address(resolver));

        vm.stopBroadcast();
    }
}
```

- [ ] **Step 8: Build contracts**

```bash
cd packages/contracts && forge build
```

Expected: `out/ShunyaResolver.sol/ShunyaResolver.json` created with no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/
git commit -m "feat(contracts): ShunyaResolver + IZkVerifyAggregation + Deploy script"
```

---

### Task 6: Deploy ShunyaResolver to Base Sepolia

- [ ] **Step 1: Register verification key with zkVerify**

Before deploying the resolver, you need the `ZKVERIFY_VK_HASH`. Follow the zkVerify docs to:
1. Upload `packages/circuits/build/verification_key.json` to zkVerify testnet.
2. Get back a VK hash (bytes32).
3. Set `ZKVERIFY_VK_HASH=0x...` in `.env`.

- [ ] **Step 2: Set env vars**

Ensure your `.env` contains:
```
BASE_SEPOLIA_RPC=https://sepolia.base.org
DEPLOYER_PRIVATE_KEY=0x...     # funded on Base Sepolia
SHUNYA_SCHEMA_UID=0x...        # from EAS registration (human pre-work)
ZKVERIFY_VK_HASH=0x...         # from zkVerify VK registration
```

- [ ] **Step 3: Deploy**

```bash
cd packages/contracts
source ../../.env
forge script script/Deploy.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

Expected output:
```
ShunyaResolver deployed at: 0x<address>
```

- [ ] **Step 4: Save address to config**

Copy the deployed address. It goes into `packages/shared/src/config.ts` in the next task.

---

### Task 7: `packages/shared` — Types and Config

**Files:**
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/config.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/src/types.ts`**

```typescript
export type SessionStatus =
  | 'pending'
  | 'phone_verified'
  | 'proof_submitted'
  | 'verified'
  | 'failed'
  | 'expired';

export type WorkerStage =
  | 'queued'
  | 'zk_verifying'
  | 'zk_verified'
  | 'wallet_creating'
  | 'chain_submitting'
  | 'complete';

export type ApiKeyKind = 'publishable' | 'secret';

export type Chain = 'base-sepolia' | 'base-mainnet';

export type Gender = 'M' | 'F';

// Public signals output by shunya.circom
export interface ShunyaPublicSignals {
  pubkeyHash: string;    // BN254 field element as hex string
  isOver18: boolean;
  genderBit: number;     // 70 = F, 77 = M (raw QR byte)
  nameHash: string;      // BN254 field element as hex string
  uidCommitment: string; // BN254 field element as hex string
}

// Groth16 proof structure (snarkjs output)
export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: 'bn128';
}

export interface ZkVerifyReceipt {
  domainId: string;
  aggregationId: number;
  leaf: string;
  merkleProof: string[];
  root: string;
  leafIndex: number;
}

export interface WebhookEvent {
  sessionId: string;
  userRef: string;
  status: 'verified' | 'failed';
  attestationUid?: string;
  walletAddress?: string;
  claims?: { isOver18: boolean; gender: Gender };
  chain?: Chain;
  failReason?: string;
  verifiedAt?: string;
}
```

- [ ] **Step 2: Create `packages/shared/src/config.ts`**

```typescript
// Chain addresses — update SHUNYA_RESOLVER_ADDRESS after Phase 1 deploy.

export const CHAIN_CONFIG = {
  'base-sepolia': {
    rpcUrl: process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org',
    easAddress:      '0x4200000000000000000000000000000000000021' as `0x${string}`,
    resolverAddress: (process.env.SHUNYA_RESOLVER_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    schemaUid:       (process.env.SHUNYA_SCHEMA_UID ?? '') as `0x${string}`,
  },
} as const;

export const CIRCUIT_CONFIG = {
  // URL where the popup downloads the zkey (CDN or local dev server)
  zkeyUrl: process.env.NEXT_PUBLIC_ZKEY_URL ?? 'http://localhost:9000/shunya-artifacts/circuit_final.zkey',
  wasmUrl: process.env.NEXT_PUBLIC_WASM_URL ?? 'http://localhost:9000/shunya-artifacts/shunya.wasm',
};
```

- [ ] **Step 3: Update `packages/shared/src/index.ts`**

```typescript
export * from './types';
export * from './config';
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/
git commit -m "feat(shared): types, config — ShunyaPublicSignals, CHAIN_CONFIG, CIRCUIT_CONFIG"
```

---

### Task 8: Demo Popup — Next.js App (Phase 1 Stateless)

**Files:**
- Create: `apps/popup/next.config.js`
- Create: `apps/popup/app/layout.tsx`
- Create: `apps/popup/app/page.tsx`
- Create: `apps/popup/app/components/QRUploader.tsx`
- Create: `apps/popup/app/components/ProofRunner.tsx`
- Create: `apps/popup/public/prove.worker.js`

This is a stateless demo — no API calls. The user uploads a QR, the Web Worker runs the Groth16 proof, and the public signals are displayed.

- [ ] **Step 1: Create `apps/popup/next.config.js`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow loading large .wasm and .zkey files as static assets
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { fs: false, path: false };
    }
    // Enable async WebAssembly
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

module.exports = nextConfig;
```

- [ ] **Step 2: Create `apps/popup/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shunya Verify',
  description: 'Zero-knowledge Aadhaar verification',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '2rem', background: '#f9fafb' }}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Create `apps/popup/app/components/QRUploader.tsx`**

```tsx
'use client';
import { useRef } from 'react';
import jsQR from 'jsqr';

interface Props {
  onDecoded: (qrBytes: Uint8Array) => void;
  onError: (msg: string) => void;
}

export function QRUploader({ onDecoded, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';

    if (!isImage && !isPdf) {
      onError('Please upload a PNG, JPG, or PDF file.');
      return;
    }

    let imageData: ImageData;

    if (isPdf) {
      // Dynamically import pdfjs to avoid SSR issues
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } else {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (!code) {
      onError('No QR code found in image. Try a clearer screenshot.');
      return;
    }

    // QR data is binary — convert the raw bytes
    const bytes = new Uint8Array(code.data.length);
    for (let i = 0; i < code.data.length; i++) {
      bytes[i] = code.data.charCodeAt(i);
    }
    onDecoded(bytes);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      style={{
        border: '2px dashed #6366f1',
        borderRadius: '12px',
        padding: '3rem',
        textAlign: 'center',
        cursor: 'pointer',
        background: 'white',
      }}
    >
      <p style={{ margin: 0, color: '#4b5563', fontSize: '1rem' }}>
        Click to upload your DigiLocker Aadhaar PDF or screenshot (PNG/JPG)
      </p>
      <p style={{ margin: '0.5rem 0 0', color: '#9ca3af', fontSize: '0.85rem' }}>
        Your Aadhaar data never leaves this browser.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  );
}
```

- [ ] **Step 4: Create `apps/popup/public/prove.worker.js`**

This Web Worker loads snarkjs and runs the Groth16 full prove. It receives the raw QR bytes via `postMessage` and returns the proof + public signals.

```js
// apps/popup/public/prove.worker.js
// Loaded as a dedicated Web Worker.
// Message in:  { type: 'PROVE', qrBytes: Uint8Array, currentDate: number,
//                zkeyUrl: string, wasmUrl: string }
// Message out: { type: 'PROGRESS', stage: string }
//              { type: 'DONE', proof: {...}, publicSignals: [...] }
//              { type: 'ERROR', message: string }

importScripts('https://cdn.jsdelivr.net/npm/snarkjs@0.7.4/build/snarkjs.min.js');

self.onmessage = async function (e) {
  const { type, qrBytes, currentDate, zkeyUrl, wasmUrl } = e.data;
  if (type !== 'PROVE') return;

  try {
    self.postMessage({ type: 'PROGRESS', stage: 'parsing_qr' });

    // Parse QR bytes into circuit inputs
    // The anon-aadhaar QR format: first bytes are version header, rest are
    // fields separated by 0xFF (255), last 256 bytes are RSA signature.
    const bytes = new Uint8Array(qrBytes);
    const sigLen = 256;
    const qrDataLength = bytes.length - sigLen;
    const qrData = bytes.slice(0, qrDataLength);
    const signature = bytes.slice(qrDataLength);

    // Pad qrData to maxDataLength (3072)
    const maxDataLength = 3072;
    const qrDataPadded = new Array(maxDataLength).fill(0);
    for (let i = 0; i < qrData.length && i < maxDataLength; i++) {
      qrDataPadded[i] = qrData[i];
    }
    const qrDataPaddedLength = qrData.length;

    // Find delimiter indices (positions of 0xFF bytes)
    const delimiterIndices = new Array(18).fill(0);
    let count = 0;
    for (let i = 0; i < qrData.length && count < 18; i++) {
      if (qrData[i] === 255) {
        delimiterIndices[count] = i;
        count++;
      }
    }

    // Parse RSA public key from QR (simplified — in production, use UIDAI's published key)
    // For the demo, we embed the known UIDAI test public key chunks.
    // TODO: Replace with real UIDAI public key fetched from their API or embedded constant.
    // The pubKey is split into k=17 chunks of n=121 bits each.
    // For a working demo, use the key from anon-aadhaar's test fixtures.
    throw new Error(
      'TODO: embed UIDAI public key chunks. ' +
      'Copy from anon-aadhaar/packages/circuits/test/test.ts or UIDAI official certificate.'
    );

    // Decompose signature into k=17 chunks of n=121 bits
    const k = 17;
    const sigChunks = new Array(k).fill('0');
    // TODO: chunk the 256-byte RSA signature into 17 × 121-bit chunks
    // using anon-aadhaar's chunking utility from @anon-aadhaar/core

    // currentDate is YYYYMMDD integer
    const year  = Math.floor(currentDate / 10000);
    const month = Math.floor((currentDate % 10000) / 100);
    const day   = currentDate % 100;

    const inputs = {
      qrDataPadded:       qrDataPadded.map(String),
      qrDataPaddedLength: String(qrDataPaddedLength),
      delimiterIndices:   delimiterIndices.map(String),
      signature:          sigChunks,
      pubKey:             pubKeyChunks,  // from above TODO
      currentYear:        String(year),
      currentMonth:       String(month),
      currentDay:         String(day),
      currentDate:        String(currentDate),
    };

    self.postMessage({ type: 'PROGRESS', stage: 'downloading_zkey' });

    // Download zkey (cached in IndexedDB by snarkjs automatically after first fetch)
    const zkeyResponse = await fetch(zkeyUrl);
    const zkeyBuffer = await zkeyResponse.arrayBuffer();
    const zkey = new Uint8Array(zkeyBuffer);

    self.postMessage({ type: 'PROGRESS', stage: 'proving' });

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, wasmUrl, zkey);

    self.postMessage({ type: 'DONE', proof, publicSignals });
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: err.message ?? String(err) });
  }
};
```

> **Note:** The worker has two TODOs: embed the UIDAI RSA public key chunks and chunk the signature. These require adapting the key-parsing utilities from `anon-aadhaar/packages/core/src/`. Copy `generateArgs` from there and extract the relevant helpers. The full integration is completed in Phase 2 when the popup is wired to the real API.

- [ ] **Step 5: Create `apps/popup/app/components/ProofRunner.tsx`**

```tsx
'use client';
import { useState, useRef } from 'react';
import type { Groth16Proof } from '@shunya/shared';
import { CIRCUIT_CONFIG } from '@shunya/shared';

interface Props {
  qrBytes: Uint8Array;
  onDone: (proof: Groth16Proof, publicSignals: string[]) => void;
}

type Stage = 'idle' | 'parsing_qr' | 'downloading_zkey' | 'proving' | 'done' | 'error';

const STAGE_LABELS: Record<string, string> = {
  parsing_qr:      'Parsing QR data...',
  downloading_zkey:'Downloading proving key (~30MB, cached after first use)...',
  proving:         'Generating zero-knowledge proof (this takes ~10s)...',
};

export function ProofRunner({ qrBytes, onDone }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const runProof = () => {
    if (stage !== 'idle') return;
    setStage('parsing_qr');
    setError(null);

    const worker = new Worker('/prove.worker.js');
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type } = e.data;
      if (type === 'PROGRESS') {
        setStage(e.data.stage as Stage);
      } else if (type === 'DONE') {
        setStage('done');
        worker.terminate();
        onDone(e.data.proof, e.data.publicSignals);
      } else if (type === 'ERROR') {
        setStage('error');
        setError(e.data.message);
        worker.terminate();
      }
    };

    worker.postMessage({
      type: 'PROVE',
      qrBytes: qrBytes.buffer,
      currentDate: Number(
        new Date().toISOString().slice(0, 10).replace(/-/g, '')
      ),
      zkeyUrl: CIRCUIT_CONFIG.zkeyUrl,
      wasmUrl: CIRCUIT_CONFIG.wasmUrl,
    }, [qrBytes.buffer]);
  };

  if (stage === 'idle') {
    return (
      <button
        onClick={runProof}
        style={{
          background: '#6366f1', color: 'white', border: 'none',
          borderRadius: '8px', padding: '0.75rem 2rem',
          fontSize: '1rem', cursor: 'pointer', marginTop: '1rem',
        }}
      >
        Generate Proof
      </button>
    );
  }

  if (stage === 'error') {
    return <p style={{ color: '#ef4444', marginTop: '1rem' }}>Error: {error}</p>;
  }

  if (stage === 'done') {
    return <p style={{ color: '#22c55e', marginTop: '1rem' }}>Proof generated!</p>;
  }

  return (
    <p style={{ color: '#6366f1', marginTop: '1rem' }}>
      {STAGE_LABELS[stage] ?? `${stage}...`}
    </p>
  );
}
```

- [ ] **Step 6: Create `apps/popup/app/page.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { QRUploader } from './components/QRUploader';
import { ProofRunner } from './components/ProofRunner';
import type { Groth16Proof, ShunyaPublicSignals } from '@shunya/shared';

export default function DemoPage() {
  const [qrBytes, setQrBytes] = useState<Uint8Array | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [proof, setProof] = useState<Groth16Proof | null>(null);
  const [publicSignals, setPublicSignals] = useState<string[] | null>(null);

  const handleProofDone = (p: Groth16Proof, sigs: string[]) => {
    setProof(p);
    setPublicSignals(sigs);
  };

  // publicSignals order: [pubkeyHash, isOver18, genderBit, nameHash, uidCommitment]
  const signals: ShunyaPublicSignals | null = publicSignals ? {
    pubkeyHash:    publicSignals[0]!,
    isOver18:      publicSignals[1] === '1',
    genderBit:     Number(publicSignals[2]),
    nameHash:      publicSignals[3]!,
    uidCommitment: publicSignals[4]!,
  } : null;

  return (
    <main style={{ maxWidth: '640px', margin: '0 auto' }}>
      <h1 style={{ color: '#1f2937' }}>Shunya — ZK Aadhaar Demo</h1>
      <p style={{ color: '#6b7280' }}>
        Upload your DigiLocker Aadhaar PDF or QR screenshot. The proof runs entirely
        in your browser. No data is sent to any server.
      </p>

      {!qrBytes && (
        <QRUploader
          onDecoded={(bytes) => { setQrBytes(bytes); setQrError(null); }}
          onError={(msg) => setQrError(msg)}
        />
      )}

      {qrError && (
        <p style={{ color: '#ef4444' }}>{qrError}</p>
      )}

      {qrBytes && !proof && (
        <div>
          <p style={{ color: '#22c55e' }}>✓ QR decoded — {qrBytes.length} bytes</p>
          <ProofRunner qrBytes={qrBytes} onDone={handleProofDone} />
        </div>
      )}

      {proof && signals && (
        <div style={{
          background: 'white', borderRadius: '12px', padding: '1.5rem',
          marginTop: '1.5rem', border: '1px solid #e5e7eb',
        }}>
          <h2 style={{ color: '#1f2937', marginTop: 0 }}>Proof Public Signals</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <tbody>
              {[
                ['isOver18',      String(signals.isOver18)],
                ['genderBit',     signals.genderBit === 70 ? 'F (70)' : 'M (77)'],
                ['nameHash',      signals.nameHash.slice(0, 20) + '...'],
                ['uidCommitment', signals.uidCommitment.slice(0, 20) + '...'],
                ['pubkeyHash',    signals.pubkeyHash.slice(0, 20) + '...'],
              ].map(([label, value]) => (
                <tr key={label} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem', color: '#6b7280', width: '40%' }}>{label}</td>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace' }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details style={{ marginTop: '1rem' }}>
            <summary style={{ cursor: 'pointer', color: '#6366f1' }}>View raw proof JSON</summary>
            <pre style={{ fontSize: '0.75rem', overflow: 'auto', maxHeight: '300px' }}>
              {JSON.stringify({ proof, publicSignals }, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Start the popup dev server**

```bash
pnpm dev:popup
```

Open http://localhost:3001 — you should see the upload UI.

- [ ] **Step 8: Commit**

```bash
git add apps/popup/
git commit -m "feat(popup): phase-1 stateless demo — QR upload, Web Worker proving, results display"
```

---

## Phase 1 Exit Criteria

- ✅ `packages/circuits/build/` contains `shunya.r1cs`, `shunya_js/shunya.wasm`, `circuit_final.zkey`, `verification_key.json`
- ✅ `forge build` in `packages/contracts` succeeds with no errors
- ✅ `ShunyaResolver` deployed to Base Sepolia (address saved to `.env` + `packages/shared/src/config.ts`)
- ✅ VK registered with zkVerify testnet (`ZKVERIFY_VK_HASH` in `.env`)
- ✅ `pnpm dev:popup` shows the demo upload UI at http://localhost:3001
- ✅ Proof generation works with a real DigiLocker Aadhaar QR (requires resolving the TODO in `prove.worker.js` for UIDAI pubkey + signature chunking)
