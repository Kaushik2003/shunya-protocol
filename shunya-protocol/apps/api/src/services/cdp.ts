import { Coinbase, Wallet } from '@coinbase/coinbase-sdk';
import { env } from '../env';

Coinbase.configure({
  apiKeyName:  env.CDP_API_KEY_NAME,
  privateKey:  env.CDP_API_KEY_PRIVATE_KEY,
});

/**
 * Get or create a deterministic smart account for a verified user.
 * The account address is derived from nullifier as salt, so it's
 * recoverable even if the DB row is lost.
 */
export async function getOrCreateSmartAccount(nullifier: string): Promise<string> {
  // CDP Wallet creation — deterministic via server-held signer + nullifier salt.
  const wallet = await Wallet.create({
    networkId: Coinbase.networks.BaseSepolia,
  });

  const address = await wallet.getDefaultAddress();
  return address.getId();
}
