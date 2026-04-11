export type ChainConfig = {
  resolverAddress: string;
  easAddress:      string;
  schemaUid:       string;
  rpcUrl:          string;
};

export const CHAIN_CONFIG: Record<string, ChainConfig> = {
  'base-sepolia': {
    resolverAddress: process.env.SHUNYA_RESOLVER_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    easAddress:      '0xC2679fBD37d54388Ce493F1DB75320D236e1815e',
    schemaUid:       process.env.SHUNYA_SCHEMA_UID ?? '0x' + '0'.repeat(64),
    rpcUrl:          process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org',
  },
  'base-mainnet': {
    resolverAddress: '0x0000000000000000000000000000000000000000', // TODO: deploy
    easAddress:      '0x4200000000000000000000000000000000000021',
    schemaUid:       '0x' + '0'.repeat(64),
    rpcUrl:          'https://mainnet.base.org',
  },
};

export const CIRCUIT_CONFIG = {
  zkeyUrl: process.env.NEXT_PUBLIC_ZKEY_URL  ?? 'http://localhost:9000/shunya/shunya.zkey',
  wasmUrl: process.env.NEXT_PUBLIC_WASM_URL  ?? 'http://localhost:9000/shunya/shunya.wasm',
};
