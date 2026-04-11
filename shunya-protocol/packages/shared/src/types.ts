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

export interface ShunyaPublicSignals {
  pubkeyHash:    string;
  isOver18:      string;
  genderBit:     string;
  nameHash:      string;
  uidCommitment: string;
}

export interface Groth16Proof {
  pi_a:     [string, string, string];
  pi_b:     [[string, string], [string, string], [string, string]];
  pi_c:     [string, string, string];
  protocol: 'groth16';
  curve:    'bn128';
}

export interface ZkVerifyReceipt {
  domainId:      number;
  aggregationId: number;
  leaf:          string;
  merkleProof:   string[];
  root:          string;
  leafIndex:     number;
}

export interface WebhookEvent {
  sessionId:       string;
  userRef:         string;
  status:          'verified' | 'failed';
  attestationUid?: string;
  walletAddress?:  string;
  claims?: {
    isOver18: boolean;
    gender?:  'M' | 'F';
  };
  chain?:      string;
  failReason?: string;
  verifiedAt?: string;
}
