import { readFile } from "node:fs/promises";
import { saveStructured, loadStructured } from "../io.js";
import { slug } from "../util.js";
type Raw = {
  type: string;
  url?: string;
  title?: string;
  target?: {
    tag?: string;
    type?: string;
    id?: string | null;
    testId?: string | null;
    name?: string | null;
    role?: string | null;
    labels?: string[];
    placeholder?: string | null;
    text?: string;
  };
  value?: { hasValue?: boolean };
  suggestedFilename?: string;
};
type Group = { url: string; title?: string; events: Raw[] };
const unique = (base: string, used: Set<string>) => {
  let x = base || "step",
    n = 2;
  while (used.has(x)) x = `${base}_${n++}`;
  used.add(x);
  return x;
};
const controlKey = (e: Raw) =>
  e.target?.testId ||
  e.target?.id ||
  e.target?.name ||
  e.target?.labels?.[0] ||
  `${e.target?.tag}:${e.target?.type}:${e.target?.placeholder}`;
const actionType = (e: Raw) =>
  e.type !== "field_snapshot"
    ? e.type
    : e.target?.tag === "select"
      ? "select"
      : e.target?.type === "file"
        ? "upload"
        : e.target?.type === "checkbox"
          ? "checkbox"
          : e.target?.type === "radio"
            ? "radio"
            : "fill";
const runtimeHumanField = (value: string) =>
  /\b(otp|one[_ -]?time|captcha|verification[_ -]?code)\b/i.test(value);
export async function generateDraft(
  eventsFile: string,
  output: string,
  key = "recorded_application",
): Promise<void> {
  const events = (await readFile(eventsFile, "utf8"))
    .split(/\n/)
    .filter(Boolean)
    .map((x) => JSON.parse(x) as Raw);
  if (!events.length) throw new Error("recording contains no events");
  const entry = events.find((e) => e.url)?.url ?? "http://localhost";
  let existing: any;
  try {
    existing = await loadStructured(output);
  } catch {}
  const groups: Group[] = [];
  let current: Group | undefined;
  for (const e of events) {
    if (e.type === "navigation" && e.url) {
      if (!current || current.url !== e.url) {
        current = { url: e.url, title: e.title, events: [] };
        groups.push(current);
      }
      continue;
    }
    if (e.url && (!current || current.url !== e.url)) {
      current = { url: e.url, title: e.title, events: [] };
      groups.push(current);
    }
    if (current) current.events.push(e);
  }
  if (!groups.length) groups.push({ url: entry, events });
  const fields: any[] = [...(existing?.fields ?? [])],
    documents: any[] = [...(existing?.documents ?? [])],
    states: Record<string, any> = {},
    stateKeys: string[] = [],
    usedStates = new Set<string>(),
    usedSteps = new Set<string>();
  for (const [index, g] of groups.entries()) {
    const u = new URL(g.url),
      stateKey = unique(
        slug(
          g.title ||
            u.pathname.split("/").filter(Boolean).at(-1) ||
            `page_${index + 1}`,
        ),
        usedStates,
      );
    stateKeys.push(stateKey);
    const steps: any[] = [],
      emittedControls = new Set<string>(),
      changed = new Set(
        g.events
          .filter((e) =>
            ["fill", "select", "checkbox", "radio", "upload"].includes(e.type),
          )
          .map(controlKey),
      );
    for (const e of g.events) {
      const type = actionType(e);
      if (
        ![
          "fill",
          "select",
          "checkbox",
          "radio",
          "click",
          "upload",
          "download",
        ].includes(type)
      )
        continue;
      if (e.type === "field_snapshot" && changed.has(controlKey(e))) continue;
      if (
        type === "click" &&
        ["input", "select", "textarea"].includes(e.target?.tag || "")
      )
        continue;
      if (["fill", "select", "checkbox", "radio", "upload"].includes(type)) {
        const semanticControl = `${type}:${controlKey(e)}`;
        if (emittedControls.has(semanticControl)) continue;
        emittedControls.add(semanticControl);
      }
      const label =
          e.target?.labels?.[0] ??
          e.target?.text ??
          e.target?.placeholder ??
          e.target?.name ??
          `${type}_${steps.length + 1}`,
        id = unique(slug(`${type}_${label}`), usedSteps),
        target: any = {},
        roles = new Set([
          "button",
          "textbox",
          "combobox",
          "checkbox",
          "radio",
          "link",
          "heading",
        ]);
      if (e.target?.testId) target.testId = e.target.testId;
      if (e.target?.labels?.length) target.labels = e.target.labels;
      else if (
        ["fill", "select", "radio", "checkbox", "upload"].includes(type) &&
        e.target?.text
      )
        target.labels = [e.target.text];
      if (e.target?.role && roles.has(e.target.role))
        target.role = { type: e.target.role, name: e.target.text || undefined };
      else if (type === "click" && e.target?.tag === "button")
        target.role = { type: "button", name: e.target.text || undefined };
      else if (type === "click" && e.target?.tag === "a")
        target.role = { type: "link", name: e.target.text || undefined };
      if (e.target?.name) target.nameAttribute = e.target.name;
      if (e.target?.placeholder) target.placeholder = [e.target.placeholder];
      if (e.target?.text && type === "click") target.text = [e.target.text];
      if (e.target?.id)
        target.cssFallbacks = [`[id=${JSON.stringify(e.target.id)}]`];
      if (!Object.keys(target).length && e.target?.tag)
        target.cssFallbacks = [
          `${e.target.tag}${e.target.type ? `[type=${JSON.stringify(e.target.type)}]` : ""}`,
        ];
      if (type === "click") {
        const previous = steps.at(-1),
          clickText = String(target.role?.name ?? target.text?.[0] ?? label),
          previousText = String(
            previous?.target?.role?.name ?? previous?.target?.text?.[0] ?? "",
          );
        if (clickText.length > 120 && !target.role) continue;
        if (
          previous?.type === "click" &&
          slug(previousText) === slug(clickText)
        )
          continue;
      }
      if (type === "download") {
        steps.push({
          id,
          type: "download",
          artifact: slug(e.suggestedFilename || "download"),
          target: { text: ["Download"] },
        });
        continue;
      }
      if (["fill", "select", "radio"].includes(type)) {
        const field = slug(label);
        const stepType =
          type === "fill" && e.target?.type === "date" ? "date" : type;
        if (!fields.some((f) => f.key === field))
          fields.push({
            key: field,
            label,
            type:
              type === "select"
                ? "select"
                : e.target?.type === "date"
                  ? "date"
                  : "text",
            required: true,
            sensitive: true,
          });
        if (runtimeHumanField(`${field} ${label}`)) {
          const captcha = /captcha/i.test(`${field} ${label}`);
          steps.push({
            id,
            type: "human_input",
            reason: captcha ? "captcha" : "otp",
            prompt: captcha
              ? "Enter the CAPTCHA in Chrome, or enter it in Flow Studio so the agent fills Chrome."
              : "Enter the OTP in Chrome, or enter it in Flow Studio so the agent fills Chrome.",
            inputMode: captcha ? "operator_in_browser" : "callback_value",
            target,
            maximumAttempts: 3,
          });
        } else
          steps.push({
            id,
            type: stepType,
            field,
            ...(type !== "radio"
              ? {
                  mode: "fill_if_empty",
                  existingValuePolicy: "manual_review_on_mismatch",
                }
              : {}),
            target,
            retry: { maximumAttempts: 2, strategy: "resolve_target" },
            ...(stepType !== "radio"
              ? {
                  success: [
                    {
                      type:
                        stepType === "select"
                          ? "selected_value_equals"
                          : "field_value_equals",
                      expected: `{{fields.${field}}}`,
                      target,
                    },
                  ],
                }
              : {}),
          });
      } else if (type === "upload") {
        const document = slug(label);
        if (!documents.some((d) => d.key === document))
          documents.push({
            key: document,
            required: true,
            multiple: false,
            acceptedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
            acceptedExtensions: [".pdf", ".jpg", ".jpeg", ".png"],
            maxBytes: 10485760,
          });
        steps.push({
          id,
          type: "upload",
          document,
          uploadMode: "replace",
          target,
          success: [
            { type: "visible_text", expected: "replace_me_upload_success" },
          ],
        });
      } else if (type === "checkbox")
        steps.push({ id, type: "checkbox", checked: true, target });
      else steps.push({ id, type: "click", target });
    }
    const generatedFieldKeys = new Set(
        steps
          .filter((step) =>
            ["fill", "date", "select", "radio"].includes(step.type),
          )
          .map((step) => step.field),
      ),
      generatedFieldLabels = new Set(
        fields
          .filter((field) => generatedFieldKeys.has(field.key))
          .flatMap((field) => [slug(field.key), slug(field.label)]),
      ),
      cleanedSteps = steps.filter((step) => {
        if (step.type !== "click") return true;
        const idKey = step.id.replace(/^click_/, "").replace(/_\d+$/, ""),
          textKey = slug(
            step.target?.role?.name ?? step.target?.text?.[0] ?? "",
          );
        return (
          !generatedFieldKeys.has(idKey) && !generatedFieldLabels.has(textKey)
        );
      });
    states[stateKey] = {
      description: g.title || `Recorded page ${index + 1}`,
      detect: { urlContains: [u.pathname || "/"] },
      resumable: true,
      replayPolicy: "detect_and_continue",
      steps: cleanedSteps,
      transitions: {
        success: index < groups.length - 1 ? "__NEXT__" : "completed",
        unknown: "manual_review",
      },
    };
  }
  stateKeys.forEach((k, i) => {
    if (states[k].transitions.success === "__NEXT__")
      states[k].transitions.success = stateKeys[i + 1];
  });
  states.manual_review = {
    description: "Unexpected page or portal drift",
    detect: { visibleText: ["replace_me"] },
    resumable: false,
    replayPolicy: "manual_only",
    steps: [
      {
        id: unique("manual_review", usedSteps),
        type: "human_input",
        reason: "other",
        prompt: "Resolve the unexpected page in Chrome, then continue.",
      },
    ],
    transitions: { success: stateKeys[0] },
  };
  const retained = (existing?.flow?.entryStates ?? []).filter((x: string) =>
    Boolean(states[x]),
  );
  const definition = {
    schemaVersion: 1,
    application: existing?.application ?? {
      key,
      name: key.replaceAll("_", " "),
      portal: "replace_me",
      version: 1,
      entryUrl: entry,
    },
    fields,
    documents,
    flow: {
      initialState: stateKeys[0],
      entryStates: retained.length ? retained : [stateKeys[0]],
      terminalStates: ["completed", "cancelled", "submission_unknown"],
      states,
    },
  };
  await saveStructured(output, definition);
  console.log(
    `Draft written: ${output}\nText fields use fill_if_empty. Configure flow.entryStates for logged-in and logged-out landing states.`,
  );
}
