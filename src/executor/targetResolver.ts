import type { Frame, Locator, Page } from "playwright";
import type { TargetDefinition } from "../schema/flow.js";

export type ResolvedTarget = {
  locator: Locator;
  strategy: string;
  repairedTarget?: TargetDefinition;
};
export type ResolveTargetOptions = {
  timeoutMs?: number;
  allowInteractive?: boolean;
  interactiveTimeoutMs?: number;
  expectedKind?: TargetKind;
  onRepair?: (target: TargetDefinition) => Promise<void> | void;
};
export type TargetKind =
  "fill" | "select" | "checkbox" | "radio" | "upload" | "click" | "any";
type Scope = { scope: Page | Frame; name: string; frame?: Frame };

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function compatible(
  locator: Locator,
  kind: TargetKind,
): Promise<boolean> {
  if (kind === "any") return true;
  return locator
    .evaluate((element: Element, expected: TargetKind) => {
      const tag = element.tagName.toLowerCase();
      const inputType = (element.getAttribute("type") ?? "text").toLowerCase();
      const role = (element.getAttribute("role") ?? "").toLowerCase();
      if (expected === "fill")
        return (
          tag === "textarea" ||
          element.getAttribute("contenteditable") === "true" ||
          (tag === "input" &&
            ![
              "hidden",
              "button",
              "submit",
              "reset",
              "checkbox",
              "radio",
              "file",
            ].includes(inputType))
        );
      if (expected === "select") return tag === "select" || role === "combobox";
      if (expected === "checkbox")
        return inputType === "checkbox" || role === "checkbox";
      if (expected === "radio")
        return inputType === "radio" || role === "radio";
      if (expected === "upload") return tag === "input" && inputType === "file";
      if (expected === "click")
        return (
          !(
            tag === "input" &&
            !["button", "submit", "reset", "checkbox", "radio"].includes(
              inputType,
            )
          ) &&
          tag !== "textarea" &&
          tag !== "select"
        );
      return true;
    }, kind)
    .catch(() => false);
}

async function uniqueVisible(
  locator: Locator,
  kind: TargetKind = "any",
): Promise<Locator | null> {
  try {
    const visible: Locator[] = [];
    for (let index = 0; index < (await locator.count()); index++) {
      const candidate = locator.nth(index);
      const isFileInputCandidate =
        kind === "upload" &&
        (await candidate
          .evaluate(
            (node: any) =>
              node && node.tagName === "INPUT" && node.type === "file",
          )
          .catch(() => false));
      if (
        ((await candidate.isVisible().catch(() => false)) ||
          isFileInputCandidate) &&
        (await compatible(candidate, kind))
      )
        visible.push(candidate);
      if (visible.length > 1) return null;
    }
    return visible.length === 1 ? visible[0]! : null;
  } catch {
    return null;
  }
}

function availableScopes(page: Page, target: TargetDefinition): Scope[] {
  const pages = page
    .context()
    .pages()
    .filter((candidate) => !candidate.isClosed());
  if (target.frame) {
    return pages.flatMap((candidatePage, pageIndex) =>
      candidatePage
        .frames()
        .filter(
          (frame) =>
            (target.frame?.name && frame.name() === target.frame.name) ||
            (target.frame?.urlContains &&
              frame.url().includes(target.frame.urlContains)),
        )
        .map((frame) => ({
          scope: frame,
          frame,
          name: `page:${pageIndex}/frame:${frame.name() || frame.url()}`,
        })),
    );
  }
  return pages.flatMap((candidatePage, pageIndex) => [
    {
      scope: candidatePage,
      name: candidatePage === page ? "page" : `page:${pageIndex}`,
    },
    ...candidatePage
      .frames()
      .filter((frame) => frame !== candidatePage.mainFrame())
      .map((frame) => ({
        scope: frame,
        frame,
        name: `page:${pageIndex}/frame:${frame.name() || frame.url()}`,
      })),
  ]);
}

function textControlCandidates(
  scope: Page | Frame,
  text: string,
): Array<[string, Locator]> {
  const label = scope.locator("label").filter({ hasText: text });
  return [
    ["text_as_label", scope.getByLabel(text, { exact: false })],
    ["text_as_placeholder", scope.getByPlaceholder(text, { exact: false })],
    ["label_control", label.locator("input, textarea, select")],
    [
      "aria_label",
      scope.locator(
        `input[aria-label*=${JSON.stringify(text)} i], textarea[aria-label*=${JSON.stringify(text)} i], select[aria-label*=${JSON.stringify(text)} i]`,
      ),
    ],
  ];
}

function candidates(
  scope: Page | Frame,
  target: TargetDefinition,
): Array<[string, Locator]> {
  const result: Array<[string, Locator]> = [];
  if (target.testId) result.push(["testId", scope.getByTestId(target.testId)]);
  if (target.nameAttribute && target.placeholder?.length)
    for (const placeholder of target.placeholder)
      result.push([
        "name+placeholder",
        scope.locator(
          `[name=${JSON.stringify(target.nameAttribute)}][placeholder=${JSON.stringify(placeholder)}]`,
        ),
      ]);
  if (target.role)
    result.push([
      "role",
      scope.getByRole(target.role.type as never, { name: target.role.name }),
    ]);
  for (const label of target.labels ?? [])
    result.push(["label", scope.getByLabel(label, { exact: false })]);
  if (target.nameAttribute)
    result.push([
      "name",
      scope.locator(`[name=${JSON.stringify(target.nameAttribute)}]`),
    ]);
  for (const placeholder of target.placeholder ?? [])
    result.push([
      "placeholder",
      scope.getByPlaceholder(placeholder, { exact: false }),
    ]);
  for (const text of target.text ?? []) {
    result.push(...textControlCandidates(scope, text));
    result.push(["text", scope.getByText(text, { exact: false })]);
  }
  for (const css of target.cssFallbacks ?? [])
    result.push(["css", scope.locator(css)]);
  return result;
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function fuzzyControl(
  scope: Page | Frame,
  target: TargetDefinition,
  expectedKind: TargetKind,
): Promise<Locator | null> {
  const desired = [
    ...(target.text ?? []),
    ...(target.labels ?? []),
    ...(target.placeholder ?? []),
    target.nameAttribute ?? "",
    target.role?.name ?? "",
  ]
    .map(normalize)
    .filter(Boolean);
  if (!desired.length) return null;
  const selector =
    expectedKind === "fill"
      ? 'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, [contenteditable="true"]'
      : expectedKind === "select"
        ? 'select, [role="combobox"]'
        : expectedKind === "checkbox"
          ? 'input[type="checkbox"], [role="checkbox"]'
          : expectedKind === "radio"
            ? 'input[type="radio"], [role="radio"]'
            : expectedKind === "upload"
              ? 'input[type="file"]'
              : 'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]';
  const controls = scope.locator(selector);
  const scored: Array<{ locator: Locator; score: number }> = [];
  for (let index = 0; index < (await controls.count()); index++) {
    const control = controls.nth(index);
    if (
      expectedKind !== "upload" &&
      !(await control.isVisible().catch(() => false))
    )
      continue;
    const metadata = normalize(
      await control
        .evaluate((element: Element) => {
          const input = element as HTMLInputElement;
          const labels = Array.from(input.labels ?? []).map(
            (label) => label.textContent ?? "",
          );
          return [
            ...labels,
            element.getAttribute("aria-label") ?? "",
            element.getAttribute("placeholder") ?? "",
            element.getAttribute("name") ?? "",
            element.getAttribute("id") ?? "",
            element.textContent ?? "",
          ].join(" ");
        })
        .catch(() => ""),
    );
    if (!metadata) continue;
    let score = 0;
    for (const phrase of desired) {
      if (metadata.includes(phrase) || phrase.includes(metadata)) {
        score = Math.max(score, 1);
        continue;
      }
      const tokens = phrase.split(" ").filter((token) => token.length > 2);
      if (!tokens.length) continue;
      const overlap = tokens.filter((token) => metadata.includes(token)).length;
      score = Math.max(score, overlap / tokens.length);
    }
    if (score >= 0.6) scored.push({ locator: control, score });
  }
  scored.sort((left, right) => right.score - left.score);
  if (!scored.length || (scored[1] && scored[1].score === scored[0]!.score))
    return null;
  return scored[0]!.locator;
}

async function resolveOnce(
  page: Page,
  target: TargetDefinition,
  expectedKind: TargetKind,
): Promise<{ result?: ResolvedTarget; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  const scopes = availableScopes(page, target);
  if (target.frame && !scopes.length)
    diagnostics.push("target frame not found");
  for (const { scope, name } of scopes) {
    for (const [strategy, locator] of candidates(scope, target)) {
      const resolved = await uniqueVisible(locator, expectedKind);
      if (resolved)
        return {
          result: {
            locator: resolved,
            strategy: name === "page" ? strategy : `${strategy}@${name}`,
          },
          diagnostics,
        };
      const count = await locator.count().catch(() => 0);
      if (count) diagnostics.push(`${strategy}@${name} matched ${count}`);
    }
    const fuzzy = await fuzzyControl(scope, target, expectedKind);
    if (fuzzy)
      return {
        result: {
          locator: fuzzy,
          strategy: name === "page" ? "fuzzy_control" : `fuzzy_control@${name}`,
        },
        diagnostics,
      };
  }
  return { diagnostics };
}

type PickedTarget = {
  selector: string;
  testId?: string;
  labels: string[];
  placeholder?: string;
  nameAttribute?: string;
  role?: string;
  roleName?: string;
};

async function installTargetPicker(frame: Frame): Promise<void> {
  await frame
    .evaluate(() => {
      const state = window as unknown as {
        __flowStudioPickedTarget?: unknown;
        __flowStudioPickerInstalled?: boolean;
        __flowStudioPickerError?: string;
      };
      if (state.__flowStudioPickerInstalled) return;
      state.__flowStudioPickerInstalled = true;
      state.__flowStudioPickedTarget = undefined;
      const blockClick = (event: Event) => {
        if (!state.__flowStudioPickedTarget) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        document.removeEventListener("click", blockClick, true);
      };
      const handler = (event: Event) => {
        if (state.__flowStudioPickedTarget) return;
        try {
          const element = event.target instanceof Element ? event.target : null;
          if (!element) return;
          const input = element as HTMLInputElement;
          const id = element.getAttribute("id");
          const testId = element.getAttribute("data-testid");
          const name = element.getAttribute("name");
          const selector = id
            ? `#${CSS.escape(id)}`
            : testId
              ? `[data-testid=${JSON.stringify(testId)}]`
              : name
                ? `${element.tagName.toLowerCase()}[name=${JSON.stringify(name)}]`
                : element.tagName.toLowerCase();
          state.__flowStudioPickedTarget = {
            selector,
            testId: testId || undefined,
            labels: Array.from(input.labels ?? [])
              .map((label) => (label.textContent ?? "").trim())
              .filter(Boolean),
            placeholder: element.getAttribute("placeholder") || undefined,
            nameAttribute: name || undefined,
            role: element.getAttribute("role") || undefined,
            roleName:
              element.getAttribute("aria-label") ||
              (element.textContent ?? "").trim() ||
              undefined,
          };
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        } catch (error) {
          state.__flowStudioPickerError =
            error instanceof Error ? error.message : String(error);
        }
      };
      document.addEventListener("pointerdown", handler, true);
      document.addEventListener("mousedown", handler, true);
      document.addEventListener("click", blockClick, true);
    })
    .catch(() => {});
}

async function interactiveRepair(
  page: Page,
  timeoutMs: number,
  expectedKind: TargetKind,
): Promise<ResolvedTarget | null> {
  const frames = () =>
    page
      .context()
      .pages()
      .filter((candidate) => !candidate.isClosed())
      .flatMap((candidate) => candidate.frames());
  for (const frame of frames()) await installTargetPicker(frame);
  console.log(
    "\nLocator recovery: click the intended control once in Chrome. Flow Studio will capture and save a stronger target; the click itself will not be submitted.\n",
  );
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const frame of frames()) {
      let picked = await frame
        .evaluate(
          () =>
            (window as unknown as { __flowStudioPickedTarget?: PickedTarget })
              .__flowStudioPickedTarget,
        )
        .catch(() => undefined);
      let directlyFocused: Locator | null = null;
      if (!picked) {
        directlyFocused = await uniqueVisible(
          frame.locator(
            'input:not([type="hidden"]):focus, textarea:focus, select:focus, [contenteditable="true"]:focus',
          ),
          expectedKind,
        );
        if (directlyFocused)
          picked = await directlyFocused
            .evaluate((element: Element) => {
              const id = element.getAttribute("id");
              const testId = element.getAttribute("data-testid");
              const name = element.getAttribute("name");
              const selector = id
                ? `#${CSS.escape(id)}`
                : testId
                  ? `[data-testid=${JSON.stringify(testId)}]`
                  : name
                    ? `${element.tagName.toLowerCase()}[name=${JSON.stringify(name)}]`
                    : element.tagName.toLowerCase();
              const input = element as HTMLInputElement;
              return {
                selector,
                testId: testId || undefined,
                labels: Array.from(input.labels ?? [])
                  .map((label) => (label.textContent ?? "").trim())
                  .filter(Boolean),
                placeholder: element.getAttribute("placeholder") || undefined,
                nameAttribute: name || undefined,
                role: element.getAttribute("role") || undefined,
                roleName: element.getAttribute("aria-label") || undefined,
              } satisfies PickedTarget;
            })
            .catch(() => undefined);
      }
      if (!picked) continue;
      const repairedTarget: TargetDefinition = {
        ...(picked.testId ? { testId: picked.testId } : {}),
        ...(picked.labels.length ? { labels: picked.labels } : {}),
        ...(picked.placeholder ? { placeholder: [picked.placeholder] } : {}),
        ...(picked.nameAttribute
          ? { nameAttribute: picked.nameAttribute }
          : {}),
        cssFallbacks: [picked.selector],
        ...(frame !== frame.page().mainFrame()
          ? {
              frame: {
                ...(frame.name() ? { name: frame.name() } : {}),
                ...(!frame.name() && frame.url()
                  ? { urlContains: frame.url() }
                  : {}),
              },
            }
          : {}),
      };
      const locator = directlyFocused ?? frame.locator(picked.selector);
      const resolved = await uniqueVisible(locator, expectedKind);
      if (!resolved) continue;
      return {
        locator: resolved,
        strategy: "operator_repaired",
        repairedTarget,
      };
    }
    await sleep(100);
  }
  return null;
}

export async function resolveTarget(
  page: Page,
  target: TargetDefinition,
  options: ResolveTargetOptions = {},
): Promise<ResolvedTarget> {
  const expectedKind = options.expectedKind ?? "any";
  const end = Date.now() + (options.timeoutMs ?? 8_000);
  let diagnostics: string[] = [];
  do {
    const attempt = await resolveOnce(page, target, expectedKind);
    diagnostics = attempt.diagnostics;
    if (attempt.result) return attempt.result;
    await sleep(250);
  } while (Date.now() < end);

  if (options.allowInteractive) {
    const repaired = await interactiveRepair(
      page,
      options.interactiveTimeoutMs ?? 120_000,
      expectedKind,
    );
    if (repaired?.repairedTarget) {
      await options.onRepair?.(repaired.repairedTarget);
      return repaired;
    }
  }

  throw new Error(
    `target not uniquely visible after waiting: ${JSON.stringify(target)}${diagnostics.length ? `; ${diagnostics.join(", ")}` : "; no strategy or fuzzy control matched a visible control"}`,
  );
}

export async function highlight(locator: Locator): Promise<void> {
  await locator.evaluate((element: HTMLElement) => {
    const old = element.style.outline;
    element.style.outline = "4px solid #d946ef";
    setTimeout(() => (element.style.outline = old), 1500);
  });
}
