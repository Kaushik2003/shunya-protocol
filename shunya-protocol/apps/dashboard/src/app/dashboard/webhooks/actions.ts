'use server';
import { revalidatePath } from 'next/cache';
import { nanoid } from 'nanoid';
import { db } from '@shunya/db';
import { webhookEndpoints } from '@shunya/db';
import { eq } from 'drizzle-orm';
import { getSession } from '../../../../lib/getSession';

export interface CreateWebhookState {
  secret?: string;
  error?:  string;
}

export async function createWebhookAction(
  _prevState: CreateWebhookState,
  formData: FormData
): Promise<CreateWebhookState> {
  const { user } = await getSession();
  if (!user) return { error: 'Not authenticated' };

  const url = formData.get('url') as string;
  if (!url || !url.startsWith('https://')) {
    return { error: 'URL must start with https://' };
  }

  const secret = `whsec_${nanoid(32)}`;

  await db.insert(webhookEndpoints).values({
    id:     `wh_${nanoid(21)}`,
    orgId:  user.orgId,
    url,
    secret,
    events: ['session.verified', 'session.failed'],
    active: true,
  });

  revalidatePath('/dashboard/webhooks');
  return { secret };
}

export async function deleteWebhookAction(endpointId: string) {
  const { user } = await getSession();
  if (!user) return;

  await db.update(webhookEndpoints)
    .set({ active: false })
    .where(eq(webhookEndpoints.id, endpointId));

  revalidatePath('/dashboard/webhooks');
}
