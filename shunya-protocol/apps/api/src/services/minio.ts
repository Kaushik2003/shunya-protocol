import { createHash, createHmac } from 'crypto';
import { env } from '../env';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function awsDate(now: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = now.getUTCFullYear();
  const mm = pad(now.getUTCMonth() + 1);
  const dd = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const min = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  const dateStamp = `${yyyy}${mm}${dd}`;
  const amzDate = `${dateStamp}T${hh}${min}${ss}Z`;
  return { dateStamp, amzDate };
}

function encodePathSegment(segment: string) {
  return encodeURIComponent(segment).replace(/%2F/g, '/');
}

export async function uploadAuditArtifact(
  sessionId: string,
  data: object
): Promise<string> {
  const key  = `sessions/${sessionId}/proof_artifact.json`;
  const json = JSON.stringify(data);

  const protocol = env.MINIO_USE_SSL ? 'https' : 'http';
  const baseUrl = `${protocol}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`;
  const region = 'us-east-1';
  const service = 's3';

  const now = new Date();
  const { dateStamp, amzDate } = awsDate(now);
  const payloadHash = sha256Hex(json);

  const url = new URL(`${baseUrl}/${encodePathSegment(env.MINIO_BUCKET)}/${encodePathSegment(key)}`);
  const host = url.host;

  const canonicalUri = url.pathname;
  const canonicalQueryString = '';
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest =
    `PUT\n${canonicalUri}\n${canonicalQueryString}\n` +
    `${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmac(`AWS4${env.MINIO_SECRET_KEY}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${env.MINIO_ACCESS_KEY}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authorization,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    },
    body: json,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MinIO upload failed: HTTP ${res.status} ${text}`);
  }

  return key;
}
