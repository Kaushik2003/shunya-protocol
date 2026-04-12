'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import argon2 from 'argon2';
import { db } from '@shunya/db';
import { users } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { lucia } from '../../../lib/auth';

export async function loginAction(_prevState: any, formData: FormData) {
  const email    = formData.get('email')    as string;
  const password = formData.get('password') as string;

  if (!email || !password) return { error: 'Email and password required' };

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { error: 'Invalid credentials' };

  const valid = await argon2.verify(user.passwordHash, password);
  if (!valid) return { error: 'Invalid credentials' };

  const session       = await lucia.createSession(user.id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

  redirect('/dashboard');
}

export async function logoutAction() {
  const sessionId = cookies().get('shunya_auth_session')?.value;
  if (sessionId) await lucia.invalidateSession(sessionId);
  cookies().delete('shunya_auth_session');
  redirect('/login');
}
