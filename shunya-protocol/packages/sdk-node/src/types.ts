export interface ShunyaConfig {
  secretKey: string;
  /** Override API base URL for dev. Defaults to https://api.shunya.app */
  apiUrl?: string;
}

export interface CreateSessionOptions {
  userRef:        string;
  requiredClaims: { isOver18?: boolean; gender?: 'M' | 'F' | 'any' };
  returnUrl:      string;
  webhookUrl?:    string;
}

export interface Session {
  sessionId:    string;
  sessionToken: string;
  popupUrl:     string;
}

export interface SessionStatus {
  sessionId:     string;
  status:        'pending' | 'phone_verified' | 'proof_submitted' | 'verified' | 'failed' | 'expired';
  stage:         string | null;
  attestationId: string | null;
  createdAt:     string;
  completedAt:   string | null;
  expiresAt:     string;
}

export interface Attestation {
  attestationUid: string;
  txHash:         string;
  chain:          string;
  createdAt:      string;
  claims:         { isOver18: boolean; gender: 'M' | 'F' };
  walletAddress:  string;
}

export interface WebhookEvent {
  sessionId:       string;
  userRef:         string;
  status:          'verified' | 'failed';
  attestationUid?: string;
  walletAddress?:  string;
  claims?: { isOver18: boolean; gender?: 'M' | 'F' };
  chain?:          string;
  failReason?:     string;
  verifiedAt?:     string;
}
