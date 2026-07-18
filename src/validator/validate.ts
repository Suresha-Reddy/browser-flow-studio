import { FlowDefinitionSchema } from "../schema/flow.js";
import { loadStructured } from "../io.js";
export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: Record<string, unknown>;
};
const transitionKeys = [
  "success",
  "validationError",
  "otp",
  "captcha",
  "approved",
  "rejected",
  "sessionExpired",
  "ambiguous",
  "unknown",
] as const;
const runtimeHumanField = (value: string) =>
  /\b(otp|one[_ -]?time|captcha|verification[_ -]?code)\b/i.test(value);
export function validateDefinition(input: unknown): ValidationResult {
  const parsed = FlowDefinitionSchema.safeParse(input),
    errors: string[] = [],
    warnings: string[] = [];
  if (!parsed.success)
    return {
      valid: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
      warnings,
      summary: {},
    };
  const d = parsed.data,
    states = d.flow.states,
    fieldKeys = new Set(d.fields.map((f) => f.key)),
    fieldLabels = new Map(d.fields.map((f) => [f.key, f.label])),
    docKeys = new Set(d.documents.map((x) => x.key)),
    ids = new Set<string>();
  if (!states[d.flow.initialState])
    errors.push(`initial state '${d.flow.initialState}' does not exist`);
  const entryStates = d.flow.entryStates ?? [d.flow.initialState];
  for (const key of entryStates) {
    if (!states[key]) errors.push(`entry state '${key}' does not exist`);
    else if (d.flow.terminalStates.includes(key))
      errors.push(`entry state '${key}' cannot be terminal`);
    else if (!states[key]!.steps.length)
      errors.push(
        `entry state '${key}' has no executable steps; record or add steps before browser verification`,
      );
  }
  const totalDefinedSteps = Object.values(states).reduce(
    (count, state) => count + state.steps.length,
    0,
  );
  if (!totalDefinedSteps)
    errors.push(
      "flow has no executable steps; generate a draft from a recording or add a manual step",
    );
  if (new Set(d.flow.terminalStates).size !== d.flow.terminalStates.length)
    errors.push("terminal states must be unique");
  if (d.application.portal.includes("replace_me"))
    warnings.push("portal key is still a placeholder");
  for (const doc of d.documents)
    if (doc.acceptedTypes?.length && !doc.acceptedMimeTypes?.length)
      warnings.push(
        `${doc.key} uses legacy acceptedTypes; migrate to acceptedMimeTypes`,
      );
  for (const [stateKey, state] of Object.entries(states)) {
    const recordedActions = new Map<string, string>(),
      duplicateRecorded: string[] = [];
    if (d.flow.terminalStates.includes(stateKey))
      errors.push(`state '${stateKey}' also appears as a terminal state`);
    if (JSON.stringify(state.detect).includes("replace_me"))
      warnings.push(`${stateKey} has placeholder state detection`);
    if (state.replayPolicy === "restart_state" && !state.restartState)
      errors.push(`${stateKey} uses restart_state without restartState`);
    if (state.restartState && !states[state.restartState])
      errors.push(
        `${stateKey}.restartState points to missing state '${state.restartState}'`,
      );
    if (state.resumable && state.replayPolicy === "manual_only")
      warnings.push(
        `${stateKey} is resumable but uses manual_only replay policy`,
      );
    const referenced = new Map(state.steps.map((x) => [x.id, x]));
    for (const key of transitionKeys) {
      const next = state.transitions[key];
      if (next && !states[next] && !d.flow.terminalStates.includes(next))
        errors.push(
          `${stateKey}.transitions.${key} points to missing state '${next}'`,
        );
    }
    if (
      !Object.values(state.transitions).some(Boolean) &&
      !state.steps.some((x) => x.type === "branch")
    )
      errors.push(`${stateKey} has no outgoing transition`);
    for (const step of state.steps) {
      if (ids.has(step.id)) errors.push(`duplicate step id '${step.id}'`);
      ids.add(step.id);
      if ("field" in step && step.field && !fieldKeys.has(step.field))
        errors.push(`${step.id} references missing field '${step.field}'`);
      if (
        ["fill", "date", "select", "checkbox", "radio", "upload"].includes(
          step.type,
        )
      ) {
        const signature = JSON.stringify({
            type: step.type,
            field: "field" in step ? step.field : undefined,
            document: "document" in step ? step.document : undefined,
            target: "target" in step ? step.target : undefined,
          }),
          base = step.id.replace(/_\d+$/, "");
        if (recordedActions.get(signature) === base)
          duplicateRecorded.push(step.id);
        else recordedActions.set(signature, base);
      }
      if (step.type === "upload") {
        if (!docKeys.has(step.document))
          errors.push(
            `${step.id} references missing document '${step.document}'`,
          );
        if (!(step.success?.length || step.successAny?.length))
          errors.push(`${step.id} requires a post-upload success assertion`);
        else if (
          JSON.stringify([step.success, step.successAny]).includes("replace_me")
        )
          warnings.push(
            `${step.id} has placeholder post-upload success assertion`,
          );
      } else if (
        ["fill", "date", "select", "checkbox", "radio", "click"].includes(
          step.type,
        ) &&
        !(step.success?.length || step.successAny?.length) &&
        !(
          "field" in step &&
          runtimeHumanField(
            `${String(step.field ?? "")} ${fieldLabels.get(String(step.field ?? "")) ?? ""}`,
          )
        )
      )
        warnings.push(`${step.id} has no success assertion`);
      if (step.type === "submit") {
        if (!(step.success?.length || step.successAny?.length))
          errors.push(`${step.id} requires strong success assertions`);
        if (step.replayPolicy !== "never_replay")
          errors.push(`${step.id} must use never_replay`);
        if (state.replayPolicy !== "never_replay")
          errors.push(`${stateKey} contains submit and must use never_replay`);
      }
      if (
        step.type === "human_input" &&
        step.inputMode === "callback_value" &&
        !step.target
      )
        errors.push(`${step.id} callback_value requires a target`);
      if (
        step.type === "extract" &&
        step.sensitive &&
        step.checkpointPolicy === "persist"
      )
        errors.push(
          `${step.id} cannot persist a sensitive extraction in a durable checkpoint`,
        );
      if (step.type === "branch")
        for (const [name, next] of Object.entries(step.cases))
          if (name !== "default" && !next)
            errors.push(`${step.id} has an empty branch target`);
          else if (
            next &&
            !states[next] &&
            !d.flow.terminalStates.includes(next)
          )
            errors.push(`${step.id} branch points to missing state '${next}'`);
      if (step.type === "repeat") {
        for (const id of step.steps) {
          const child = referenced.get(id);
          if (!child) errors.push(`${step.id} repeats missing step '${id}'`);
          else if (["repeat", "branch", "submit"].includes(child.type))
            errors.push(`${step.id} has non-resumable repeat child '${id}'`);
        }
        if (step.steps.includes(step.id))
          errors.push(`${step.id} cannot repeat itself`);
      }
    }
    if (duplicateRecorded.length)
      warnings.push(
        `${stateKey} has ${duplicateRecorded.length} duplicate recorded field action(s); desktop validation can repair them automatically`,
      );
  }
  const reached = new Set<string>(),
    stack = [...entryStates];
  while (stack.length) {
    const k = stack.pop()!;
    if (reached.has(k) || !states[k]) continue;
    reached.add(k);
    const st = states[k]!;
    for (const x of transitionKeys) {
      const n = st.transitions[x];
      if (n && states[n]) stack.push(n);
    }
    for (const step of st.steps)
      if (step.type === "branch")
        for (const n of Object.values(step.cases)) if (states[n]) stack.push(n);
  }
  for (const k of Object.keys(states))
    if (!reached.has(k)) warnings.push(`state '${k}' is unreachable`);
  const hasApproval = Object.values(states).some((s) =>
    s.steps.some((x) => x.type === "human_approval"),
  );
  for (const s of Object.values(states))
    for (const step of s.steps)
      if (step.type === "submit" && !hasApproval)
        errors.push(`${step.id} requires a human approval step in the flow`);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      application: d.application.key,
      version: d.application.version,
      states: Object.keys(states).length,
      steps: ids.size,
      reachableStates: reached.size,
      fields: d.fields.length,
      documents: d.documents.length,
      durableCheckpoint: true,
      readyToFinalize: errors.length === 0 && warnings.length === 0,
    },
  };
}
export async function validateFile(file: string): Promise<ValidationResult> {
  return validateDefinition(await loadStructured(file));
}
export function printValidation(r: ValidationResult): void {
  console.log(JSON.stringify(r.summary, null, 2));
  for (const x of r.warnings) console.log(`WARN  ${x}`);
  for (const x of r.errors) console.error(`ERROR ${x}`);
  console.log(r.valid ? "VALID" : "INVALID");
}
