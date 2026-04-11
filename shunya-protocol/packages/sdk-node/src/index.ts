import { createHmac, timingSafeEqual } from 'crypto';
import type {
  ShunyaConfig,
  CreateSessionOptions,
  Session,
  SessionStatus,
  Attestation,
  WebhookEvent,
} from './types';

export type { ShunyaConfig, CreateSessionOptions, Session, SessionStatus, Attestation, WebhookEvent };

const DEFAULT_API_URL = 'https://api.shunya.app';

export class ShunyaError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'ShunyaError';
  }
}

export class Shunya {
  private readonly secretKey: string;
  private readonly apiUrl:    string;

  public readonly sessions:     SessionsClient;
  public readonly attestations: AttestationsClient;
  public readonly webhooks:     WebhooksClient;

  constructor(config: ShunyaConfig) {
    if (!config.secretKey.startsWith('sk_')) {
      throw new Error('[Shunya] secretKey must start with sk_');
    }
    this.secretKey    = config.secretKey;
    this.apiUrl       = config.apiUrl ?? DEFAULT_API_URL;
    this.sessions     = new SessionsClient(this);
    this.attestations = new AttestationsClient(this);
    this.webhooks     = new WebhooksClient();
  }

  /** @internal */
  async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.secretKey}`,
        'Content-Type':  'application/json',
        ...(init?.headers ?? {}),
      },
    });

    const body = await res.json();

    if (!res.ok) {
      throw new ShunyaError(body?.error ?? 'Request failed', res.status);
    }

    return body as T;
  }
}

class SessionsClient {
  constructor(private readonly shunya: Shunya) {}

  /** Mint a new verification session. Call from your server backend. */
  async create(options: CreateSessionOptions): Promise<Session> {
    return this.shunya.fetch<Session>('/v1/sessions', {
      method: 'POST',
      body:   JSON.stringify(options),
    });
  }

  /** Retrieve the current status of a session by ID. */
  async retrieve(sessionId: string): Promise<SessionStatus> {
    return this.shunya.fetch<SessionStatus>(`/v1/sessions/${sessionId}`);
  }
}

class AttestationsClient {
  constructor(private readonly shunya: Shunya) {}

  /** Retrieve an attestation by its EAS UID (0x...). */
  async retrieve(uid: string): Promise<Attestation> {
    return this.shunya.fetch<Attestation>(`/v1/attestations/${uid}`);
  }
}

class WebhooksClient {
  /**
   * Verify an incoming webhook from Shunya.
   *
   * @param rawBody    The raw request body string
   * @param signature  The X-Shunya-Signature header value (sha256=...)
   * @param secret     Your webhook signing secret
   * @param timestamp  The X-Shunya-Timestamp header value (Unix seconds, as number)
   * @returns          The parsed WebhookEvent if valid; throws ShunyaError if invalid
   */
  verifyWebhook(
    rawBody:   string,
    signature: string,
    secret:    string,
    timestamp: number
  ): WebhookEvent {
    // Replay protection: reject events older than 5 minutes
    const age = Math.abs(Date.now() / 1000 - timestamp);
    if (age > 300) {
      throw new ShunyaError('Webhook timestamp is too old (replay attack?)', 400);
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const receivedHex = signature.replace(/^sha256=/, '').trim();
    if (!/^[0-9a-f]{64}$/i.test(receivedHex)) {
      throw new ShunyaError('Invalid webhook signature', 400);
    }

    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(receivedHex, 'hex');

    if (
      expectedBuf.length !== receivedBuf.length ||
      !timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      throw new ShunyaError('Invalid webhook signature', 400);
    }

    return JSON.parse(rawBody) as WebhookEvent;
  }
}
