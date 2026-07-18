import { z } from "zod";

export const TargetSchema = z.object({
  testId: z.string().optional(),
  role: z.object({ type: z.enum(["button","textbox","combobox","checkbox","radio","link","heading"]), name: z.string().optional() }).optional(),
  labels: z.array(z.string()).optional(), text: z.array(z.string()).optional(), placeholder: z.array(z.string()).optional(),
  nameAttribute: z.string().optional(), cssFallbacks: z.array(z.string()).optional(),
  frame: z.object({ name: z.string().optional(), urlContains: z.string().optional() }).optional()
}).refine(v => Object.values(v).some(Boolean), "target requires at least one locator");

export const AssertionSchema = z.object({
  type: z.enum(["url_contains","visible_text","visible_text_any","element_visible","element_hidden","field_value_equals","selected_value_equals","download_exists","extracted_matches"]),
  expected: z.union([z.string(), z.array(z.string()), z.number()]).optional(), target: TargetSchema.optional(), key: z.string().optional(), regex: z.string().optional()
});

const BaseStep = z.object({
  id: z.string().min(1), preconditions: z.array(AssertionSchema).optional(), success: z.array(AssertionSchema).optional(), successAny: z.array(AssertionSchema).optional(), failureAny: z.array(AssertionSchema).optional(),
  retry: z.object({ maximumAttempts: z.number().int().min(1).max(5).default(2), strategy: z.enum(["same_target","resolve_target","manual_intervention"]).default("resolve_target") }).optional(), sensitive: z.boolean().optional()
});
const Targeted = { target: TargetSchema };
const ExistingValue = { existingValuePolicy: z.enum(["trust_existing","require_match","manual_review_on_mismatch"]).default("trust_existing") };
export const FlowStepSchema = z.discriminatedUnion("type", [
  BaseStep.extend({ type: z.literal("navigate"), url: z.string().url() }),
  BaseStep.extend({ type: z.literal("assert_page") }),
  BaseStep.extend({ type: z.literal("fill"), field: z.string(), mode: z.enum(["replace","fill_if_empty","preserve","append"]).default("replace"), ...ExistingValue, ...Targeted }),
  BaseStep.extend({ type: z.literal("date"), field: z.string(), mode: z.enum(["replace","fill_if_empty","preserve"]).default("replace"), ...ExistingValue, ...Targeted }),
  BaseStep.extend({ type: z.literal("select"), field: z.string(), mode: z.enum(["replace","fill_if_empty","preserve"]).default("replace"), ...ExistingValue, ...Targeted }),
  BaseStep.extend({ type: z.literal("checkbox"), field: z.string().optional(), checked: z.boolean().default(true), ...Targeted }),
  BaseStep.extend({ type: z.literal("radio"), field: z.string(), ...Targeted }), BaseStep.extend({ type: z.literal("click"), ...Targeted }),
  BaseStep.extend({ type: z.literal("upload"), document: z.string(), uploadMode: z.enum(["replace","append","preserve_if_present"]).default("replace"), ...Targeted }),
  BaseStep.extend({ type: z.literal("download"), artifact: z.string(), ...Targeted }),
  BaseStep.extend({ type: z.literal("extract"), key: z.string(), required: z.boolean().default(true), regex: z.string().optional(), checkpointPolicy: z.enum(["persist","redact","omit"]).default("persist"), ...Targeted }),
  BaseStep.extend({ type: z.literal("wait_for"), timeoutMs: z.number().int().positive().max(120000).default(10000), assertion: AssertionSchema }),
  BaseStep.extend({ type: z.literal("branch"), basedOn: z.string(), cases: z.record(z.string(), z.string()) }),
  BaseStep.extend({ type: z.literal("repeat"), steps: z.array(z.string()).min(1), until: AssertionSchema, maximumIterations: z.number().int().min(1).max(20) }),
  BaseStep.extend({ type: z.literal("human_input"), reason: z.enum(["otp","captcha","login","human_verification","visual_verification","document_review","other"]), prompt: z.string(), resumeAt: z.string().optional(), inputMode: z.enum(["operator_in_browser","callback_value"]).default("operator_in_browser"), target: TargetSchema.optional(), expiresInSeconds: z.number().int().positive().max(86400).optional(), responsePattern: z.string().optional(), maximumAttempts: z.number().int().min(1).max(10).default(3) }),
  BaseStep.extend({ type: z.literal("human_approval"), reason: z.enum(["final_submission","payment","declaration","document_review","other"]), prompt: z.string(), evidence: z.array(z.string()).optional(), expiresInSeconds: z.number().int().positive().max(604800).optional() }),
  BaseStep.extend({ type: z.literal("payment"), prompt: z.string(), expiresInSeconds: z.number().int().positive().max(86400).optional() }),
  BaseStep.extend({ type: z.literal("submit"), requiresHumanApproval: z.literal(true), replayPolicy: z.literal("never_replay").default("never_replay"), ...Targeted }),
  BaseStep.extend({ type: z.literal("capture_evidence"), evidence: z.string(), fullPage: z.boolean().default(true) })
]);

export const StateDetectionSchema = z.object({ urlContains: z.array(z.string()).optional(), urlMatches: z.string().optional(), titleContains: z.array(z.string()).optional(), visibleText: z.array(z.string()).optional(), requiredTargets: z.array(TargetSchema).optional() }).refine(v => Object.values(v).some(Boolean), "state detection cannot be empty");
export const FieldSchema = z.object({ key: z.string().min(1), label: z.string().min(1), type: z.enum(["text","number","date","email","phone","select","boolean"]), required: z.boolean(), sensitive: z.boolean().optional(), validation: z.string().optional(), options: z.array(z.string()).optional() });
export const DocumentSchema = z.object({
  key: z.string().min(1), required: z.boolean(), multiple: z.boolean().default(false),
  acceptedMimeTypes: z.array(z.string().min(1)).optional(), acceptedExtensions: z.array(z.string().regex(/^\.[A-Za-z0-9]+$/)).optional(),
  acceptedTypes: z.array(z.string().min(1)).optional(), maxBytes: z.number().int().positive().optional()
}).superRefine((v,ctx)=>{if(!(v.acceptedMimeTypes?.length||v.acceptedTypes?.length))ctx.addIssue({code:z.ZodIssueCode.custom,message:"acceptedMimeTypes is required"})});
export const StateSchema = z.object({
  description: z.string().optional(), detect: StateDetectionSchema, resumable: z.boolean().default(false),
  replayPolicy: z.enum(["detect_and_continue","restart_state","manual_only","never_replay"]).default("manual_only"), restartState: z.string().optional(),
  steps: z.array(FlowStepSchema), transitions: z.object({ success: z.string().optional(), validationError: z.string().optional(), otp: z.string().optional(), captcha: z.string().optional(), approved: z.string().optional(), rejected: z.string().optional(), sessionExpired: z.string().optional(), ambiguous: z.string().optional(), unknown: z.string().optional() })
});
export const FlowDefinitionSchema = z.object({
  schemaVersion: z.literal(1), application: z.object({ key: z.string().min(1), name: z.string().min(1), portal: z.string().min(1), version: z.number().int().positive(), applicantType: z.string().optional(), entryUrl: z.string().url() }),
  fields: z.array(FieldSchema), documents: z.array(DocumentSchema).default([]),
  flow: z.object({ initialState: z.string().min(1), entryStates: z.array(z.string().min(1)).optional(), terminalStates: z.array(z.string()).default(["completed","cancelled","submission_unknown"]), states: z.record(z.string(), StateSchema) })
});
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>; export type FlowStep = z.infer<typeof FlowStepSchema>; export type TargetDefinition = z.infer<typeof TargetSchema>; export type Assertion = z.infer<typeof AssertionSchema>;
