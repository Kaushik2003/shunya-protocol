'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { db } from '@shunya/db';
import { users, organizations } from '@shunya/db';
import { lucia } from '../../../lib/auth';

export async function registerAction(formData: FormData) {
  const orgName  = formData.get('orgName')  as string;
  const email    = formData.get('email')    as string;
  const password = formData.get('password') as string;

  if (!orgName || !email || !password) return { error: 'All fields required' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters' };

  const slug         = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const orgId        = `org_${nanoid(21)}`;
  const userId       = `usr_${nanoid(21)}`;
  const passwordHash = await argon2.hash(password, { memoryCost: 65536 });

  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: orgId, name: orgName, slug });
    await tx.insert(users).values({ id: userId, orgId, email, passwordHash, role: 'owner' });
  });

  const session       = await lucia.createSession(userId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

  redirect('/dashboard');
}
