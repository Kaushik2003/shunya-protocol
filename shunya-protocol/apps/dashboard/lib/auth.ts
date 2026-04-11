import { Lucia } from 'lucia';
import { DrizzlePostgreSQLAdapter } from '@lucia-auth/adapter-drizzle';
import { db } from '@shunya/db';
import { authSessions, users } from '@shunya/db';

const adapter = new DrizzlePostgreSQLAdapter(db, authSessions, users);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    name: 'shunya_auth_session',
    attributes: {
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  },
  getUserAttributes: (attributes: any) => ({
    email: attributes.email,
    orgId: attributes.org_id,
    role:  attributes.role,
  }),
});

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      email:  string;
      org_id: string;
      role:   string;
    };
  }
}
