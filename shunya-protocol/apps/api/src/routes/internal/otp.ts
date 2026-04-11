import { Hono } from 'hono';
import { db } from '@shunya/db';
import { sessions } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { OtpRequestSchema, OtpVerifySchema } from '@shunya/shared';
import { sessionAuth } from '../../middleware/sessionAuth';
import { generateAndSendOtp, verifyOtp } from '../../services/otp';

export const otpRouter = new Hono();

otpRouter.post('/request', sessionAuth, async (c) => {
  const { sid } = c.get('session');
  const json = await c.req.json().catch(() => null);
  const parsed = OtpRequestSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400);
  const { phone } = parsed.data;

  // Verify session is still pending or phone_verified
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);
  if (!row || !['pending', 'phone_verified'].includes(row.status)) {
    return c.json({ error: 'Session not eligible for OTP' }, 400);
  }

  await generateAndSendOtp(phone);
  return c.json({ sent: true });
});

otpRouter.post('/verify', sessionAuth, async (c) => {
  const { sid } = c.get('session');
  const json = await c.req.json().catch(() => null);
  const parsed = OtpVerifySchema.safeParse(json);
  if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400);
  const { phone, otp } = parsed.data;

  const ok = await verifyOtp(phone, otp);
  if (!ok) return c.json({ error: 'Invalid or expired OTP' }, 400);

  await db.update(sessions)
    .set({ status: 'phone_verified' })
    .where(eq(sessions.id, sid));

  return c.json({ verified: true });
});
