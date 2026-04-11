import { buildPoseidon } from 'circomlibjs';
import { createHash } from 'node:crypto';

let _poseidon: Awaited<ReturnType<typeof buildPoseidon>> | null = null;

async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

/**
 * Compute the server-side nullifier: poseidon(uidCommitment, SALT)
 * uidCommitment is the in-circuit output poseidon(referenceId).
 * SALT is SHUNYA_NULLIFIER_SALT from env — never rotated.
 *
 * The salt is a plain string (any characters). We sha256-hash it to get
 * a deterministic 256-bit field element, which is always valid for BN128.
 */
export async function computeNullifier(
  uidCommitment: string,  // hex string from public signals (e.g. "0x1a2b...")
  salt: string            // SHUNYA_NULLIFIER_SALT — any string, min 32 chars
): Promise<string> {
  const poseidon = await getPoseidon();
  const F = poseidon.F;

  const commitment = BigInt(uidCommitment);
  // Hash the salt to a deterministic hex value so any string works as a salt
  const saltHex = createHash('sha256').update(salt, 'utf8').digest('hex');
  const saltBig = BigInt('0x' + saltHex);

  const hash = poseidon([commitment, saltBig]);
  return '0x' + F.toString(hash, 16).padStart(64, '0');
}
