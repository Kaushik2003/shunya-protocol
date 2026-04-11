import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Sign a webhook payload.
 * Formula: hex(hmac_sha256(secret, timestamp + "." + rawBody))
 */
export function signWebhook(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

/**
 * Verify an incoming webhook signature. Returns false if timestamp is >5 min old.
 */
export function verifyWebhook(
  secret: string,
  timestamp: number,
  rawBody: string,
  signature: string
): boolean {
  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > 300) return false; // 5-minute replay window

  const expected = signWebhook(secret, timestamp, rawBody);
  const receivedHex = signature.replace(/^sha256=/, '').trim();
  if (!/^[0-9a-f]{64}$/i.test(receivedHex)) return false;

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
