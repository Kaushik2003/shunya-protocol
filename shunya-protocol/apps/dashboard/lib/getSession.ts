import { cookies } from 'next/headers';
import { cache } from 'react';
import { lucia } from './auth';

export const getSession = cache(async () => {
  const sessionId = cookies().get('shunya_auth_session')?.value ?? null;
  if (!sessionId) return { user: null, session: null };

  const result = await lucia.validateSession(sessionId);

  // Slide the session cookie
  if (result.session?.fresh) {
    const newCookie = lucia.createSessionCookie(result.session.id);
    cookies().set(newCookie.name, newCookie.value, newCookie.attributes);
  }
  if (!result.session) {
    const blank = lucia.createBlankSessionCookie();
    cookies().set(blank.name, blank.value, blank.attributes);
  }

  return result;
});
