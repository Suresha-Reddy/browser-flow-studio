import { z } from "zod";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)
])) as z.ZodType<JsonValue>;

export const InterventionReasonSchema = z.enum([
  "otp", "captcha", "login", "payment", "approval", "document_review", "visual_verification", "other"
]);

export const FlowCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  flowKey: z.string().min(1),
  flowVersion: z.string().min(1),
  flowChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runId: z.string().min(1),
  stateKey: z.string().min(1),
  nextStepId: z.string().nullable(),
  completedStepIds: z.array(z.string()).default([]),
  extracted: z.record(z.string(), JsonValueSchema).default({}),
  branchDecisions: z.record(z.string(), z.string()).default({}),
  repeatCounters: z.record(z.string(), z.number().int().min(0)).default({}),
  repeatPositions: z.record(z.string(), z.number().int().min(0)).default({}),
  retryCounters: z.record(z.string(), z.number().int().min(0)).default({}),
  assertionResults: z.record(z.string(), z.boolean()).default({}),
  manualOverrideStepIds: z.array(z.string()).default([]),
  consumedInterventionTokens: z.array(z.string()).default([]),
  intervention: z.object({
    token: z.string().min(22),
    reason: InterventionReasonSchema,
    stateKey: z.string().min(1),
    stepId: z.string().min(1),
    parentStepId: z.string().optional(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    responseAttempts: z.number().int().min(0).default(0)
  }).optional(),
  browserSessionId: z.string().optional(),
  pageUrl: z.string().optional(),
  submit: z.object({
    approved: z.boolean(),
    attempted: z.boolean(),
    idempotencyKey: z.string().optional(),
    resultReference: z.string().optional()
  }).default({ approved: false, attempted: false }),
  terminalStatus: z.enum(["completed", "failed", "cancelled", "manual_fallback"]).optional(),
  updatedAt: z.string().datetime()
}).strict();

export type FlowCheckpoint = z.infer<typeof FlowCheckpointSchema>;

/** Parses a checkpoint and rejects non-JSON runtime objects, unknown fields, and incompatible versions. */
export function parseFlowCheckpoint(value: unknown): FlowCheckpoint {
  return FlowCheckpointSchema.parse(value);
}
