import { z } from 'zod';

// POST /v1/sessions
export const CreateSessionSchema = z.object({
  userRef:        z.string().min(1).max(255),
  requiredClaims: z.object({
    isOver18: z.boolean().optional(),
    gender:   z.enum(['M', 'F', 'any']).optional(),
  }),
  returnUrl:  z.string().url(),
  webhookUrl: z.string().url().optional(),
});

// POST /internal/sessions/:id/otp/request
export const OtpRequestSchema = z.object({
  phone: z.string().regex(/^\+91[0-9]{10}$/, 'Must be +91 followed by 10 digits'),
});

// POST /internal/sessions/:id/otp/verify
export const OtpVerifySchema = z.object({
  phone: z.string(),
  otp:   z.string().length(6),
});

// POST /internal/sessions/:id/nullifier/check
export const NullifierCheckSchema = z.object({
  uidCommitment: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'Must be a hex field element'),
});

// POST /internal/sessions/:id/proof
export const SubmitProofSchema = z.object({
  proof: z.object({
    pi_a:     z.tuple([z.string(), z.string(), z.string()]),
    pi_b:     z.tuple([
                z.tuple([z.string(), z.string()]),
                z.tuple([z.string(), z.string()]),
                z.tuple([z.string(), z.string()]),
              ]),
    pi_c:     z.tuple([z.string(), z.string(), z.string()]),
    protocol: z.literal('groth16'),
    curve:    z.literal('bn128'),
  }),
  publicSignals: z.array(z.string()).length(5),
  // publicSignals order: [pubkeyHash, isOver18, genderBit, nameHash, uidCommitment]
  uidCommitment: z.string(),
});
