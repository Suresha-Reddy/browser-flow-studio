import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { loadFlow, saveStructured } from "../io.js";
import type { FlowDefinition, FlowStep } from "../schema/flow.js";
import { resolveTarget, highlight } from "./targetResolver.js";
import { assertAll, assertAny, evaluateAssertion } from "./assertions.js";
import { detectState, resolveEntryState } from "./state.js";
import { ask, resolveTemplate } from "../util.js";

export type RunMode = "inspect" | "verify" | "submit";
export type RunOptions = {
  flowFile: string;
  dataFile?: string;
  mode: RunMode;
  allowFinalSubmit: boolean;
  stepByStep: boolean;
  headless?: boolean;
};
type Event = {
  state: string;
  step: string;
  type: string;
  status: string;
  attempt: number;
  durationMs: number;
  targetStrategy?: string;
  message?: string;
};
const runtimeHumanField = (field?: string) =>
  /\b(otp|one[_ -]?time|captcha|verification[_ -]?code)\b/i.test(field ?? "");
const recordedActionIdentity = (step: FlowStep) => {
  if (
    !["fill", "date", "select", "checkbox", "radio", "upload"].includes(
      step.type,
    )
  )
    return null;
  const value = step as FlowStep & {
    field?: string;
    document?: string;
    target?: unknown;
  };
  return {
    baseId: step.id.replace(/_\d+$/, ""),
    signature: JSON.stringify({
      type: step.type,
      field: value.field,
      document: value.document,
      target: value.target,
    }),
  };
};
const latestActivePage = (context: BrowserContext, current: Page) => {
  const pages = context.pages().filter((candidate) => !candidate.isClosed());
  return (
    [...pages]
      .reverse()
      .find(
        (candidate) => candidate.url() && candidate.url() !== "about:blank",
      ) ?? current
  );
};
const isFinalActionClick = (step: FlowStep) =>
  step.type === "click" &&
  /\b(verify\s*(?:&|and)?\s*download|submit|final\s*submit|pay\s*now|confirm\s*application)\b/i.test(
    JSON.stringify(step.target),
  );
const normalizedTargetText = (step: FlowStep) => {
  if (step.type !== "click") return "";
  const target = step.target;
  return String(target.role?.name ?? target.text?.[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

export async function runFlow(
  opts: RunOptions,
): Promise<{ status: string; runId: string; events: Event[] }> {
  const d = await loadFlow(opts.flowFile);
  const entryStates = d.flow.entryStates?.length
      ? d.flow.entryStates
      : [d.flow.initialState],
    executableEntryStates = entryStates.filter(
      (key) =>
        !d.flow.terminalStates.includes(key) &&
        Boolean(d.flow.states[key]?.steps.length),
    );
  if (!executableEntryStates.length)
    throw new Error(
      `Browser verification was not started because none of the entry states contain executable steps. Entry states: ${entryStates.join(", ")}. Open Steps, add or regenerate the recorded actions, save, and run validation again.`,
    );
  const data = opts.dataFile
    ? JSON.parse(await readFile(opts.dataFile, "utf8"))
    : {};
  const runId = `${d.application.key}-${Date.now()}`;
  const dir = path.resolve("artifacts", runId);
  await mkdir(dir, { recursive: true });
  const chromePath = process.env.FLOW_STUDIO_CHROME_PATH;
  const context = await chromium.launchPersistentContext(
    path.resolve(".profiles", "flow-runner"),
    {
      headless: opts.headless ?? false,
      ...(chromePath
        ? { executablePath: chromePath }
        : { channel: opts.headless ? undefined : "chrome" }),
      acceptDownloads: true,
    },
  );
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  let page = context.pages()[0] ?? (await context.newPage());
  const events: Event[] = [];
  const extracted: Record<string, string> = {};
  let approved = false;
  let stateKey = d.flow.initialState;
  let status = "running";
  try {
    await page.goto(d.application.entryUrl, { waitUntil: "domcontentloaded" });
    stateKey = await resolveEntryState(page, d);
    while (!d.flow.terminalStates.includes(stateKey)) {
      page = latestActivePage(context, page);
      const state = d.flow.states[stateKey];
      if (!state) throw new Error(`missing state '${stateKey}'`);
      if (!state.steps.length)
        throw new Error(
          `State '${stateKey}' has no executable steps. Flow Studio stopped instead of silently completing the run.`,
        );
      await detectState(page, d, stateKey);
      let branchNext: string | undefined;
      let verificationBoundary = false;
      const recordedActions = new Map<string, string>();
      const recordedClicks = new Map<string, string>();
      const fieldStepKeys = new Set(
        state.steps
          .filter((candidate) =>
            ["fill", "date", "select", "radio"].includes(candidate.type),
          )
          .map((candidate) =>
            "field" in candidate ? String(candidate.field) : "",
          ),
      );
      for (const step of state.steps) {
        page = latestActivePage(context, page);
        if (step.type === "click") {
          const baseId = step.id.replace(/^click_/, "").replace(/_\d+$/, ""),
            textKey = normalizedTargetText(step);
          if (fieldStepKeys.has(baseId) || fieldStepKeys.has(textKey)) {
            events.push({
              state: stateKey,
              step: step.id,
              type: step.type,
              status: "removed_recorded_field_focus_click",
              attempt: 0,
              durationMs: 0,
            });
            continue;
          }
          const clickBase = step.id.replace(/_\d+$/, "");
          if (textKey && recordedClicks.get(textKey) === clickBase) {
            events.push({
              state: stateKey,
              step: step.id,
              type: step.type,
              status: "deduplicated_recording_event",
              attempt: 0,
              durationMs: 0,
            });
            continue;
          }
          if (textKey) recordedClicks.set(textKey, clickBase);
        }
        const identity = recordedActionIdentity(step);
        if (
          identity &&
          recordedActions.get(identity.signature) === identity.baseId
        ) {
          events.push({
            state: stateKey,
            step: step.id,
            type: step.type,
            status: "deduplicated_recording_event",
            attempt: 0,
            durationMs: 0,
          });
          continue;
        }
        if (identity) recordedActions.set(identity.signature, identity.baseId);
        if (
          (step.type === "submit" || isFinalActionClick(step)) &&
          opts.mode !== "submit"
        ) {
          events.push({
            state: stateKey,
            step: step.id,
            type: step.type,
            status: "blocked_by_safety_boundary",
            attempt: 0,
            durationMs: 0,
          });
          verificationBoundary = true;
          break;
        }
        if (opts.stepByStep) {
          const ans = await ask(
            `\n${stateKey}/${step.id} (${step.type}) [Enter=run,s=skip,q=quit]: `,
          );
          if (ans === "s") continue;
          if (ans === "q") throw new Error("cancelled by operator");
        }
        const start = Date.now();
        let attempt = 0;
        const max = step.retry?.maximumAttempts ?? 1;
        while (true) {
          attempt++;
          try {
            await page.screenshot({
              path: path.join(
                dir,
                `${String(events.length + 1).padStart(3, "0")}-${step.id}-before.png`,
              ),
              fullPage: true,
            });
            await assertAll(page, step.preconditions, data, extracted);
            const result = await executeStep(
              page,
              context,
              d,
              step,
              data,
              extracted,
              opts,
              dir,
              approved,
            );
            if (step.type === "human_approval")
              approved = result.approved ?? false;
            if (step.type === "branch") branchNext = result.next;
            if (opts.mode !== "inspect") {
              if (!(await assertAny(page, step.successAny, data, extracted)))
                throw new Error("no success_any assertion passed");
              await assertAll(page, step.success, data, extracted);
            }
            await page.screenshot({
              path: path.join(
                dir,
                `${String(events.length + 1).padStart(3, "0")}-${step.id}-after.png`,
              ),
              fullPage: true,
            });
            events.push({
              state: stateKey,
              step: step.id,
              type: step.type,
              status: "passed",
              attempt,
              durationMs: Date.now() - start,
              targetStrategy: result.strategy,
            });
            break;
          } catch (err) {
            if (attempt >= max) {
              events.push({
                state: stateKey,
                step: step.id,
                type: step.type,
                status: "failed",
                attempt,
                durationMs: Date.now() - start,
                message: err instanceof Error ? err.message : String(err),
              });
              throw err;
            }
          }
        }
      }
      if (verificationBoundary) {
        status = "verification_complete";
        break;
      }
      if (opts.mode === "inspect") {
        status = "inspected";
        break;
      }
      stateKey = branchNext ?? state.transitions.success ?? "completed";
    }
    if (status === "running") status = stateKey;
    if (!events.length)
      throw new Error(
        "Browser verification produced zero step events. The flow definition is empty or its entry state is misconfigured.",
      );
  } catch (err) {
    status = "failed";
    await writeFile(
      path.join(dir, "error.txt"),
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    throw err;
  } finally {
    await context.tracing
      .stop({ path: path.join(dir, "trace.zip") })
      .catch(() => {});
    await writeFile(
      path.join(dir, "report.json"),
      JSON.stringify(
        {
          runId,
          flow: d.application,
          mode: opts.mode,
          status,
          events,
          extractedKeys: Object.keys(extracted),
        },
        null,
        2,
      ),
    );
    await context.close();
  }
  return { status, runId, events };
}

async function executeStep(
  page: Page,
  context: BrowserContext,
  d: FlowDefinition,
  step: FlowStep,
  data: Record<string, unknown>,
  extracted: Record<string, string>,
  opts: RunOptions,
  dir: string,
  approved: boolean,
): Promise<{ strategy?: string; next?: string; approved?: boolean }> {
  if (step.type === "navigate") {
    await page.goto(step.url, { waitUntil: "domcontentloaded" });
    return {};
  }
  if (step.type === "assert_page") return {};
  if (step.type === "wait_for") {
    await page.waitForTimeout(250);
    const end = Date.now() + step.timeoutMs;
    while (Date.now() < end) {
      if (await evaluateAssertion(page, step.assertion, data, extracted))
        return {};
      await page.waitForTimeout(250);
    }
    throw new Error("wait_for timeout");
  }
  if (step.type === "branch")
    return {
      next:
        step.cases[
          String(data[step.basedOn] ?? extracted[step.basedOn] ?? "")
        ] ?? step.cases.default,
    };
  if (step.type === "repeat")
    throw new Error(
      "repeat is declarative only in v1; expand its named steps before publishing",
    );
  if (step.type === "capture_evidence") {
    await page.screenshot({
      path: path.join(dir, `${step.evidence}.png`),
      fullPage: step.fullPage,
    });
    return {};
  }
  if (step.type === "human_input") {
    if (opts.headless)
      throw new Error(`human input '${step.reason}' unavailable headless`);
    const answer = await ask(
      `${step.prompt}\nChoose one option:\n1. Enter it directly in Chrome, then continue with this response empty.\n2. Enter it in Flow Studio, then continue so the agent fills Chrome.\nResponse (optional): `,
    );
    if (answer.trim()) {
      const inferredTarget = step.target ?? {
        labels: [step.reason === "captcha" ? "Enter Captcha" : "Enter OTP"],
        nameAttribute: step.reason === "captcha" ? "captcha" : "otp",
      };
      const resolved = await resolveTarget(page, inferredTarget, {
        timeoutMs: 30_000,
        allowInteractive: true,
        expectedKind: "fill",
        onRepair: async (repairedTarget) => {
          step.target = repairedTarget;
          if (opts.flowFile.split(path.sep).includes("drafts"))
            await saveStructured(opts.flowFile, d);
        },
      });
      await resolved.locator.fill(answer.trim());
      return { strategy: resolved.strategy };
    }
    return { strategy: "human_entered_in_chrome" };
  }
  if (step.type === "human_approval") {
    if (opts.mode === "inspect") return { approved: false };
    const answer = (
      await ask(`${step.prompt}\nType APPROVE to continue: `)
    ).toUpperCase();
    return { approved: answer === "APPROVE" };
  }
  if (step.type === "payment") {
    if (opts.headless) throw new Error("payment requires visible browser");
    await ask(
      `${step.prompt}\nComplete payment manually, then press Enter... `,
    );
    return {};
  }
  if (
    opts.mode !== "inspect" &&
    (step.type === "fill" || step.type === "date") &&
    /captcha/i.test(step.field)
  ) {
    if (opts.headless)
      throw new Error("CAPTCHA requires a visible browser and human operator");
    const answer = await ask(
      `CAPTCHA required. Enter it directly in Chrome and continue with an empty response, or enter it in Flow Studio so the agent fills Chrome.\nResponse (optional): `,
    );
    if (!answer.trim()) return { strategy: "human_captcha_in_browser" };
    const resolved = await resolveTarget(page, step.target, {
      timeoutMs: 30_000,
      allowInteractive: true,
      expectedKind: "fill",
    });
    await resolved.locator.fill(answer.trim());
    return { strategy: "human_captcha_from_flow_studio" };
  }
  const targeted = step as Extract<FlowStep, { target: unknown }>;
  const expectedKind =
    step.type === "fill" || step.type === "date"
      ? "fill"
      : step.type === "select"
        ? "select"
        : step.type === "checkbox"
          ? "checkbox"
          : step.type === "radio"
            ? "radio"
            : step.type === "upload"
              ? "upload"
              : "click";
  const { locator, strategy } = await resolveTarget(page, targeted.target, {
    timeoutMs: 10_000,
    allowInteractive: !opts.headless,
    interactiveTimeoutMs: 120_000,
    expectedKind,
    onRepair: async (repairedTarget) => {
      targeted.target = repairedTarget;
      const isDraft = opts.flowFile
        .split(path.sep)
        .some((segment) => segment === "drafts");
      if (isDraft) {
        await saveStructured(opts.flowFile, d);
        console.log(
          `Locator repaired and saved permanently for step '${step.id}'.`,
        );
      } else {
        console.log(
          `Locator repaired for this run. Published versions remain immutable; duplicate this version as a draft to save the repair.`,
        );
      }
    },
  });
  if (opts.mode === "inspect") {
    await highlight(locator);
    return { strategy };
  }
  if (step.type === "fill" || step.type === "date") {
    const current = await locator.inputValue();
    let incoming = String(data[step.field] ?? "");
    const isCaptcha = false;
    if (runtimeHumanField(step.field)) {
      if (opts.headless)
        throw new Error(
          `runtime human value '${step.field}' requires a visible browser`,
        );
      const answer = await ask(
        isCaptcha
          ? `Complete ${step.field} in Chrome, then press Enter to continue: `
          : `Enter ${step.field} from the authorized operator, then press Enter: `,
      );
      if (answer.trim()) incoming = answer.trim();
      else if (!isCaptcha)
        throw new Error(`A value is required for '${step.field}'`);
    }
    if (step.mode === "preserve") return { strategy };
    if (step.mode === "fill_if_empty" && current.trim()) {
      if (
        step.existingValuePolicy === "require_match" &&
        current.trim() !== incoming.trim()
      )
        throw new Error(`existing value mismatch for '${step.field}'`);
      if (
        step.existingValuePolicy === "manual_review_on_mismatch" &&
        current.trim() !== incoming.trim()
      ) {
        if (opts.headless)
          throw new Error(
            `manual review required for existing '${step.field}'`,
          );
        await ask(
          `Existing ${step.field} differs from expected input. Review the applicant, then press Enter to preserve it... `,
        );
      }
      return { strategy };
    }
    if (incoming || !isCaptcha)
      await locator.fill(
        step.type === "fill" && step.mode === "append"
          ? current + incoming
          : incoming,
      );
    return { strategy };
  }
  if (step.type === "select") {
    const current = await locator.inputValue(),
      incoming = String(data[step.field] ?? "");
    if (step.mode === "preserve") return { strategy };
    if (step.mode === "fill_if_empty" && current) {
      if (step.existingValuePolicy === "require_match" && current !== incoming)
        throw new Error(`existing selection mismatch for '${step.field}'`);
      if (
        step.existingValuePolicy === "manual_review_on_mismatch" &&
        current !== incoming
      ) {
        if (opts.headless)
          throw new Error(
            `manual review required for existing '${step.field}'`,
          );
        await ask(
          `Existing ${step.field} selection differs. Review it, then press Enter to preserve... `,
        );
      }
      return { strategy };
    }
    await locator.selectOption(incoming);
    return { strategy };
  }
  if (step.type === "checkbox") {
    step.checked ? await locator.check() : await locator.uncheck();
    return { strategy };
  }
  if (step.type === "radio") {
    await locator.check();
    return { strategy };
  }
  if (step.type === "click") {
    await locator.click();
    return { strategy };
  }
  if (step.type === "upload") {
    const value = data[`document.${step.document}`] ?? data[step.document];
    if (!value) throw new Error(`missing document path '${step.document}'`);
    const incoming = (Array.isArray(value) ? value : [value]).map(String);
    const isFileInput = await locator
      .evaluate((n: any) => n && n.tagName === "INPUT" && n.type === "file")
      .catch(() => false);
    if (!isFileInput) {
      // Styled button / label that opens the OS file chooser instead of a
      // directly-settable <input type=file>.
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        locator.click(),
      ]);
      await chooser.setFiles(incoming);
      return { strategy };
    }
    const count = await locator.evaluate((n: any) => n.files?.length ?? 0);
    if (step.uploadMode === "preserve_if_present" && count > 0)
      return { strategy };
    if (step.uploadMode === "append" && count > 0) {
      const existing = await locator.evaluate(async (n: any) =>
        Promise.all(
          Array.from(n.files ?? []).map(async (f: any) => ({
            name: f.name,
            mimeType: f.type || "application/octet-stream",
            bytes: Array.from(new Uint8Array(await f.arrayBuffer())),
          })),
        ),
      );
      const payloads = (existing as any[]).map((x) => ({
        name: x.name,
        mimeType: x.mimeType,
        buffer: Buffer.from(x.bytes),
      }));
      for (const file of incoming)
        payloads.push({
          name: path.basename(file),
          mimeType: file.toLowerCase().endsWith(".pdf")
            ? "application/pdf"
            : file.toLowerCase().match(/\.jpe?g$/)
              ? "image/jpeg"
              : file.toLowerCase().endsWith(".png")
                ? "image/png"
                : "application/octet-stream",
          buffer: await readFile(file),
        });
      await locator.setInputFiles(payloads);
    } else {
      await locator.setInputFiles([]);
      await locator.setInputFiles(incoming);
    }
    return { strategy };
  }
  if (step.type === "extract") {
    const value = (await locator.innerText()).trim();
    if (step.required && !value)
      throw new Error(`required extraction '${step.key}' empty`);
    if (step.regex && !new RegExp(step.regex).test(value))
      throw new Error(`extraction '${step.key}' failed regex`);
    extracted[step.key] = value;
    return { strategy };
  }
  if (step.type === "download") {
    const ctx = page.context();
    // Handle both same-page downloads and downloads that open in a popup/new
    // tab, with a timeout and real failure detection so a missed download
    // never hangs the run.
    const wait = Promise.race([
      page.waitForEvent("download", { timeout: 60_000 }).catch(() => undefined),
      ctx
        .waitForEvent("page", { timeout: 60_000 })
        .then((p) => p.waitForEvent("download", { timeout: 60_000 }))
        .catch(() => undefined),
    ]);
    await locator.click();
    const download = await wait;
    if (!download)
      throw new Error(`no download started for '${step.artifact}'`);
    const failure = await download.failure();
    if (failure)
      throw new Error(`download failed for '${step.artifact}': ${failure}`);
    const out = path.join(
      dir,
      download.suggestedFilename() || step.artifact,
    );
    await download.saveAs(out);
    extracted[step.artifact] = out;
    return { strategy };
  }
  if (step.type === "submit") {
    if (opts.mode !== "submit")
      throw new Error("final submission blocked outside submit mode");
    if (!opts.allowFinalSubmit)
      throw new Error("final submission requires --allow-final-submit");
    if (!approved)
      throw new Error("final submission requires an approval step in this run");
    const answer = await ask(
      `IRREVERSIBLE ACTION. Type ${d.application.key} to submit: `,
    );
    if (answer !== d.application.key)
      throw new Error("final submission cancelled");
    await locator.click();
    return { strategy };
  }
  throw new Error(`unsupported step ${(step as { type: string }).type}`);
}
