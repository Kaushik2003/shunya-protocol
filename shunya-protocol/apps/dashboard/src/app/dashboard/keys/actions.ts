'use server';
import { revalidatePath } from 'next/cache';
import { nanoid } from 'nanoid';
import argon2 from 'argon2';
import { db } from '@shunya/db';
import { apiKeys } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { getSession } from '../../../../lib/getSession';

export interface CreateKeyState {
  key?:   string;
  error?: string;
}

export async function createApiKeyAction(
  _prevState: CreateKeyState,
  formData: FormData
): Promise<CreateKeyState> {
  const { user } = await getSession();
  if (!user) return { error: 'Not authenticated' };

  const kind = formData.get('kind') as 'publishable' | 'secret';
  if (!['publishable', 'secret'].includes(kind)) return { error: 'Invalid key kind' };

  const prefix  = kind === 'secret' ? 'sk_live' : 'pk_live';
  const rawKey  = `${prefix}_${nanoid(32)}`;
  const keyHash = await argon2.hash(rawKey, { memoryCost: 65536 });
  const keyId   = `key_${nanoid(21)}`;

  await db.insert(apiKeys).values({
    id:        keyId,
    orgId:     user.orgId,
    kind,
    keyPrefix: rawKey.slice(0, 12),
    keyHash,
    scopes:    [],
  });

  revalidatePath('/dashboard/keys');
  return { key: rawKey };
}

export async function revokeApiKeyAction(keyId: string): Promise<void> {
  const { user } = await getSession();
  if (!user) return;

  await db.update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, keyId));

  revalidatePath('/dashboard/keys');
}
