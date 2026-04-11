import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import type { ZkVerifyReceipt } from '@shunya/shared';
import { env } from '../env';

const RESOLVER_ABI = parseAbi([
  'function attest(uint256 aggregationId, uint256 leafIndex, bytes32[] calldata merkleProof, bytes calldata publicSignalsEncoded, address subject) external returns (bytes32)',
]);

export async function callResolverAttest(
  receipt: ZkVerifyReceipt,
  publicSignalsEncoded: `0x${string}`,
  subject: `0x${string}`
): Promise<{ txHash: string; attestationUid: string }> {
  const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain:     baseSepolia,
    transport: http(env.BASE_SEPOLIA_RPC),
  });

  const publicClient = createPublicClient({
    chain:     baseSepolia,
    transport: http(env.BASE_SEPOLIA_RPC),
  });

  const txHash = await walletClient.writeContract({
    address:      env.SHUNYA_RESOLVER_ADDRESS as `0x${string}`,
    abi:          RESOLVER_ABI,
    functionName: 'attest',
    args: [
      BigInt(receipt.aggregationId),
      BigInt(receipt.leafIndex),
      receipt.merkleProof as `0x${string}`[],
      publicSignalsEncoded,
      subject,
    ],
  });

  const txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  // Extract attestation UID from the AttestationCreated event log
  const log = txReceipt.logs.find(l => l.address.toLowerCase() === env.SHUNYA_RESOLVER_ADDRESS.toLowerCase());
  const attestationUid = log?.topics[1] ?? '0x';

  return { txHash, attestationUid };
}
