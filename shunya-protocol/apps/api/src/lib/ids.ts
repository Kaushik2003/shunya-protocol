import { randomBytes } from 'crypto';

/**
 * Generate an URL-safe opaque identifier with a prefix.
 * Example: randomId('ses_') -> "ses_q1w2e3r4t5y6u7i8o9p0ab"
 */
export function randomId(prefix: string, bytes: number = 16): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}

