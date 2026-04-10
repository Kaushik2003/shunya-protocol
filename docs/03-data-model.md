# 03 — Data Model

All tables live in NeonDB, managed by Drizzle. Nothing on this list is
PII. Every column is either: an ID, a timestamp, an opaque hash, a wallet
address, a chain receipt, or a boolean claim.

## Schema overview

```
organizations ──┬── users (dashboard humans)
                ├── api_keys
                └── webhook_endpoints
                       └── webhook_deliveries

sessions (ephemeral per-verification)
   │
   └── attestations ──── verified_users (one per real human)
```

## Tables

### `organizations`
One row per B2B tenant.

```ts
organizations {
  id:          text (uuid, pk)
  name:        text
  slug:        text unique
  plan:        text default 'free'
  quota_month: int  default 1000   -- sessions/month
  created_at:  timestamptz
}
```

### `users`
Dashboard users — humans who log in to manage the org. Not end-users.

```ts
users {
  id:            text pk
  org_id:        text fk → organizations.id
  email:         text unique
  password_hash: text
  role:          text   -- 'owner' | 'admin' | 'viewer'
  created_at:    timestamptz
  last_login_at: timestamptz
}
```

### `api_keys`
Secret + publishable keys per org.

```ts
api_keys {
  id:          text pk
  org_id:      text fk
  kind:        text   -- 'publishable' (pk_...) | 'secret' (sk_...)
  key_prefix:  text   -- first 8 chars, for display
  key_hash:    text   -- argon2id hash of the full key
  scopes:      text[] -- e.g. ['sessions.create', 'attestations.read']
  last_used_at:timestamptz
  revoked_at:  timestamptz nullable
  created_at:  timestamptz
}
```

Full key is shown **once** at creation time. After that only the prefix
is ever displayed. `key_hash` uses Argon2id so brute-forcing is infeasible.

### `webhook_endpoints`
```ts
webhook_endpoints {
  id:         text pk
  org_id:     text fk
  url:        text
  secret:     text   -- HMAC signing secret, shown once
  events:     text[] -- subscribed event types
  active:     boolean
  created_at: timestamptz
}
```

### `sessions`
Ephemeral — one row per verification attempt.

```ts
sessions {
  id:              text pk   -- ses_...
  org_id:          text fk
  user_ref:        text       -- echoed from client, opaque to us
  required_claims: jsonb      -- { isOver18: true, gender: 'any' }
  return_url:      text
  webhook_url:     text       -- override of org default
  status:          text       -- 'pending' | 'phone_verified' | 'proof_submitted'
                               -- | 'verified' | 'failed' | 'expired'
  stage:           text       -- fine-grained worker progress
  nullifier:       text nullable   -- set after proof/fast-path
  attestation_id:  text nullable fk → attestations.id
  fail_reason:     text nullable
  created_at:      timestamptz
  completed_at:    timestamptz nullable
  expires_at:      timestamptz   -- default now() + 15min
}
```

Indexes:
- `(org_id, created_at desc)` — dashboard listing
- `(status) where status in ('pending','phone_verified','proof_submitted')` — worker scans
- `expires_at` — janitor sweeps expired rows

### `verified_users`
**The moat table.** One row per real human who has ever verified with
Shunya, across all orgs.

```ts
verified_users {
  id:                      text pk  -- vu_...
  nullifier:               text unique   -- poseidon(uidCommitment, SALT)
  smart_account_address:   text unique
  name_hash:               text          -- poseidon(name), used for debug only
  gender:                  text          -- 'M' | 'F' (from gender bit)
  is_over_18:              boolean       -- true (we only create rows for verified adults)
  first_verified_at:       timestamptz
  last_verified_at:        timestamptz
}
```

Notes:
- `nullifier` is the **primary business key**. All lookups go through it.
- `name_hash` is stored only so we can detect nullifier collisions during
  debugging. It has no business use.
- We intentionally do **not** store date of birth. "isOver18" is a
  frozen boolean; a 17yo who verifies later gets a new nullifier (new
  computation would still fail the circuit). Age ladders (21+, etc.)
  would need a circuit change.

### `attestations`
One row per (verified_user × org) pair — each B2B client gets its own
on-chain receipt pointing at the same wallet + claims.

```ts
attestations {
  id:               text pk  -- att_...
  verified_user_id: text fk → verified_users.id
  org_id:           text fk
  session_id:       text fk → sessions.id
  attestation_uid:  text unique   -- EAS UID on Base Sepolia
  tx_hash:          text
  chain:            text    -- 'base-sepolia' (later 'base-mainnet')
  zkverify_receipt: jsonb
  created_at:       timestamptz
}
```

Indexes:
- `(org_id, created_at desc)` — billing/analytics
- `verified_user_id` — "show all attestations for this human"
- `attestation_uid` (unique)

### `webhook_deliveries`
```ts
webhook_deliveries {
  id:            text pk
  endpoint_id:   text fk → webhook_endpoints.id
  session_id:    text fk → sessions.id
  event:         text
  payload:       jsonb
  status:        text   -- 'pending' | 'delivered' | 'failed' | 'dead'
  attempt:       int
  next_retry_at: timestamptz nullable
  response_code: int nullable
  response_body: text nullable
  created_at:    timestamptz
  delivered_at:  timestamptz nullable
}
```

## Things we deliberately do NOT store

| Data | Why not |
|---|---|
| Raw Aadhaar QR bytes | PII, legal liability |
| Aadhaar UID (even hashed unsalted) | With known salt or small keyspace could be brute-forced — we only ever store `poseidon(uidCommitment, SALT)` |
| Name (plaintext) | PII |
| DOB | PII; we only store the derived boolean |
| Address / state / pincode | PII; out of scope for MVP |
| Phone number (plaintext) | PII; only hashed for OTP rate-limiting, TTL'd in Redis |
| Email of end user | We don't ask for one |
| IP address | Legal minefield, not needed for the product |

## Migration strategy (Neon → self-hosted Supabase)

- Drizzle migrations are stored in `packages/db/migrations/`.
- Both Neon and Supabase speak vanilla Postgres 15+.
- When we migrate:
  1. Stand up self-hosted Supabase in our infra.
  2. `pg_dump` from Neon → `pg_restore` to Supabase.
  3. Cut over connection string via env var.
  4. Neon becomes a read-only snapshot for 30 days, then deleted.
- Drizzle schema is the source of truth. No Supabase-specific features
  (RLS, Realtime, Edge Functions) are used in MVP to keep the migration
  lossless.
