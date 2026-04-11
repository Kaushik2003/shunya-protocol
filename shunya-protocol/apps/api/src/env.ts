import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL:              z.string().url(),
  REDIS_URL:                 z.string().url(),
  JWT_SECRET:                z.string().min(32),
  SHUNYA_NULLIFIER_SALT:     z.string().min(32),

  MINIO_ENDPOINT:            z.string(),
  MINIO_PORT:                z.coerce.number().default(9000),
  MINIO_ACCESS_KEY:          z.string(),
  MINIO_SECRET_KEY:          z.string(),
  MINIO_BUCKET:              z.string(),
  MINIO_USE_SSL:             z.string().transform(v => v === 'true').default('false'),

  BASE_SEPOLIA_RPC:          z.string().url(),
  SHUNYA_RESOLVER_ADDRESS:   z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  SHUNYA_SCHEMA_UID:         z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  ZKVERIFY_RPC_URL:          z.string().url(),
  ZKVERIFY_SUBMITTER_SEED:   z.string(),
  ZKVERIFY_VK_HASH:          z.string(),

  CDP_API_KEY_NAME:          z.string(),
  CDP_API_KEY_PRIVATE_KEY:   z.string(),
  DEPLOYER_PRIVATE_KEY:      z.string(),

  POPUP_URL:                 z.string().url().default('http://localhost:3001'),
  API_URL:                   z.string().url().default('http://localhost:3000'),
  DASHBOARD_URL:             z.string().url().default('http://localhost:3002'),

  // OTP — require at least one provider
  MSG91_AUTH_KEY:            z.string().optional(),
  TWILIO_ACCOUNT_SID:        z.string().optional(),
  TWILIO_AUTH_TOKEN:         z.string().optional(),
  TWILIO_FROM_NUMBER:        z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
