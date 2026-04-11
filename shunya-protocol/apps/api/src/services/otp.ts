import { createHash, randomInt } from 'crypto';
import { redis } from './redis';
import { env } from '../env';

const OTP_TTL_SEC = 300; // 5 minutes
const OTP_MAX_ATTEMPTS = 3;

function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

function otpKey(phone: string): string {
  return `otp:${createHash('sha256').update(phone).digest('hex')}`;
}

function rateLimitKey(phone: string): string {
  return `otp_rate:${createHash('sha256').update(phone).digest('hex')}`;
}

export async function generateAndSendOtp(phone: string): Promise<void> {
  // Rate limit: 3 OTP requests per phone per 15 min
  const rl = rateLimitKey(phone);
  const count = await redis.incr(rl);
  if (count === 1) await redis.expire(rl, 900); // 15 min window
  if (count > OTP_MAX_ATTEMPTS) throw new Error('Too many OTP requests. Try again later.');

  const otp = String(randomInt(100000, 999999));
  const hash = hashOtp(otp);
  await redis.set(otpKey(phone), hash, 'EX', OTP_TTL_SEC);

  // Send via MSG91 (primary) or Twilio (fallback)
  if (env.MSG91_AUTH_KEY) {
    await sendViaMSG91(phone, otp);
  } else if (env.TWILIO_ACCOUNT_SID) {
    await sendViaTwilio(phone, otp);
  } else {
    // Dev mode: log OTP
    console.log(`[DEV OTP] ${phone}: ${otp}`);
  }
}

export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const stored = await redis.get(otpKey(phone));
  if (!stored) return false;
  const match = stored === hashOtp(otp);
  if (match) await redis.del(otpKey(phone)); // single-use
  return match;
}

async function sendViaMSG91(phone: string, otp: string): Promise<void> {
  const url = 'https://api.msg91.com/api/v5/otp';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authkey': env.MSG91_AUTH_KEY!,
    },
    body: JSON.stringify({
      template_id: process.env.MSG91_TEMPLATE_ID ?? '',
      mobile:      phone.replace('+', ''),
      otp,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MSG91 error: ${text}`);
  }
}

async function sendViaTwilio(phone: string, otp: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const body = new URLSearchParams({
    To:   phone,
    From: env.TWILIO_FROM_NUMBER!,
    Body: `Your Shunya verification code is: ${otp}. Valid for 5 minutes.`,
  });
  const creds = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio error: ${text}`);
  }
}
