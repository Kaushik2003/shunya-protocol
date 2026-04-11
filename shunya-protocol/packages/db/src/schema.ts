import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── B2B Tenants ────────────────────────────────────────────────────────────

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    plan: text('plan').notNull().default('free'),
    quotaMonth: integer('quota_month').notNull().default(1000),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    orgsSlugIdx: index('orgs_slug_idx').on(t.slug),
  })
);

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('owner'), // 'owner' | 'admin' | 'viewer'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true })
  },
  (t) => ({
    usersOrgIdIdx: index('users_org_id_idx').on(t.orgId),
  })
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'publishable' | 'secret'
    keyPrefix: text('key_prefix').notNull(), // first 8 chars, shown in UI
    keyHash: text('key_hash').notNull(), // argon2id hash of full key
    scopes: text('scopes').array().notNull().default(sql`ARRAY[]::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    apiKeysOrgIdIdx: index('api_keys_org_id_idx').on(t.orgId),
    apiKeysPrefixIdx: index('api_keys_prefix_idx').on(t.keyPrefix),
  })
);

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(), // HMAC signing secret, shown once
    events: text('events').array().notNull().default(sql`ARRAY['session.verified']::text[]`),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    webhookEndpointsOrgIdIdx: index('webhook_endpoints_org_id_idx').on(t.orgId),
  })
);

// ─── Core Verification ───────────────────────────────────────────────────────

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organizations.id),
    userRef: text('user_ref').notNull(),
    requiredClaims: jsonb('required_claims').notNull(),
    returnUrl: text('return_url').notNull(),
    webhookUrl: text('webhook_url'),
    status: text('status').notNull().default('pending'),
    // 'pending' | 'phone_verified' | 'proof_submitted' | 'verified' | 'failed' | 'expired'
    stage: text('stage'),
    // 'queued' | 'zk_verifying' | 'zk_verified' | 'wallet_creating' | 'chain_submitting' | 'complete'
    nullifier: text('nullifier'),
    attestationId: text('attestation_id'),
    failReason: text('fail_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
  },
  (t) => ({
    sessionsOrgCreatedIdx: index('sessions_org_created_idx').on(t.orgId, t.createdAt),
    sessionsStatusIdx: index('sessions_status_idx').on(t.status),
    sessionsExpiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  })
);

export const verifiedUsers = pgTable(
  'verified_users',
  {
    id: text('id').primaryKey(),
    nullifier: text('nullifier').notNull().unique(), // poseidon(uidCommitment, SALT)
    smartAccountAddress: text('smart_account_address').notNull().unique(),
    nameHash: text('name_hash').notNull(), // poseidon(name packed)
    gender: text('gender').notNull(), // 'M' | 'F'
    isOver18: boolean('is_over_18').notNull().default(true),
    firstVerifiedAt: timestamp('first_verified_at', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    verifiedUsersNullifierIdx: index('verified_users_nullifier_idx').on(t.nullifier),
    verifiedUsersWalletIdx: index('verified_users_wallet_idx').on(t.smartAccountAddress),
  })
);

export const attestations = pgTable(
  'attestations',
  {
    id: text('id').primaryKey(),
    verifiedUserId: text('verified_user_id')
      .notNull()
      .references(() => verifiedUsers.id),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    attestationUid: text('attestation_uid').notNull().unique(), // EAS UID on Base
    txHash: text('tx_hash').notNull(),
    chain: text('chain').notNull().default('base-sepolia'),
    zkverifyReceipt: jsonb('zkverify_receipt').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    attestationsOrgCreatedIdx: index('attestations_org_created_idx').on(t.orgId, t.createdAt),
    attestationsVerifiedUserIdx: index('attestations_verified_user_idx').on(t.verifiedUserId),
  })
);

// ─── Lucia Auth Sessions ─────────────────────────────────────────────────────

export const authSessions = pgTable('auth_sessions', {
  id:        text('id').primaryKey(),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// ─── Webhook Deliveries ───────────────────────────────────────────────────────

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    // 'pending' | 'delivered' | 'failed' | 'dead'
    attempt: integer('attempt').notNull().default(0),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    responseCode: integer('response_code'),
    responseBody: text('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true })
  },
  (t) => ({
    webhookDeliveriesEndpointIdx: index('webhook_deliveries_endpoint_idx').on(t.endpointId),
    webhookDeliveriesSessionIdx: index('webhook_deliveries_session_idx').on(t.sessionId),
    webhookDeliveriesRetryIdx: index('webhook_deliveries_retry_idx').on(t.nextRetryAt),
  })
);

