import type { Groth16Proof, ZkVerifyReceipt } from '@shunya/shared';
import { env } from '../env';

export async function submitProofToZkVerify(
  proof: Groth16Proof,
  publicSignals: string[]
): Promise<ZkVerifyReceipt> {
  // Lazy import to avoid startup errors if SDK not yet installed
  const { ZkVerify } = await import('@stakefish/sdk-zkverify' as any);

  const zk = new ZkVerify({
    rpcUrl:     env.ZKVERIFY_RPC_URL,
    seedPhrase: env.ZKVERIFY_SUBMITTER_SEED,
  });

  const { receipt } = await zk.submitProof({
    proofType:      'groth16',
    vk:             env.ZKVERIFY_VK_HASH,
    proof,
    publicSignals,
    waitForReceipt: true,
  });

  return receipt as ZkVerifyReceipt;
}
