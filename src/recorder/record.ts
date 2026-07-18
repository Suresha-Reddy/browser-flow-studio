import { chromium, type Page } from "playwright";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type RecordOptions = { captureValues?: boolean };

export async function recordFlow(
  entryUrl: string,
  options: RecordOptions = {},
): Promise<void> {
  const captureValues = options.captureValues === true;
  const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve("recordings", sessionId),
    events = path.join(dir, "events.jsonl");
  await mkdir(dir, { recursive: true });
  await writeFile(events, "");
  await writeFile(
    path.join(dir, "metadata.json"),
    JSON.stringify(
      {
        sessionId,
        entryUrl,
        status: "recording",
        captureValues,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  let eventCount = 0,
    closed = false,
    writeQueue = Promise.resolve();
  const persist = (event: unknown) => {
    eventCount++;
    writeQueue = writeQueue.then(() =>
      appendFile(events, JSON.stringify(event) + "\n"),
    );
    return writeQueue;
  };
  const chromePath = process.env.FLOW_STUDIO_CHROME_PATH,
    headless = process.env.FLOW_STUDIO_HEADLESS === "1",
    cdpPort = process.env.FLOW_STUDIO_CDP_PORT;
  const context = await chromium.launchPersistentContext(
    path.resolve(".profiles", "flow-author"),
    {
      headless,
      ...(chromePath
        ? { executablePath: chromePath }
        : headless
          ? {}
          : { channel: "chrome" }),
      ...(cdpPort ? { args: [`--remote-debugging-port=${cdpPort}`] } : {}),
      viewport: null,
      acceptDownloads: true,
      recordVideo: { dir: path.join(dir, "video") },
    },
  );
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await context.exposeBinding("__recordFlowEvent", async (_source, event) => {
    await persist(event);
    const e = event as { type?: string; target?: { labels?: string[]; text?: string } };
    console.log(
      `[recorded] ${e.type ?? "event"}`,
      e.target?.labels?.[0] ?? e.target?.text ?? "",
    );
  });
  await context.addInitScript(({ captureValues }) => {
    const w = window as Window & {
      __recordFlowEvent?: (event: unknown) => Promise<void>;
      __flowRecorderInstalled?: boolean;
    };
    // A single document can run this script once; guard against re-entry.
    if (w.__flowRecorderInstalled) return;
    w.__flowRecorderInstalled = true;

    // Buffer events until the Playwright binding is installed, then drain in
    // order. This prevents early events (first paint, iframes, redirects) from
    // being silently dropped before the binding exists.
    const queue: unknown[] = [];
    let draining = false;
    const flush = () => {
      if (draining || typeof w.__recordFlowEvent !== "function" || !queue.length)
        return;
      draining = true;
      void (async () => {
        try {
          while (queue.length) {
            try {
              await w.__recordFlowEvent!(queue[0]);
            } catch {
              break;
            }
            queue.shift();
          }
        } finally {
          draining = false;
        }
      })();
    };
    const emit = (event: unknown) => {
      queue.push(event);
      flush();
    };
    // Keep retrying so a late-installed binding or transient failure still drains.
    w.setInterval(flush, 100);

    type AnyControl =
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement;
    const isControl = (element: unknown): element is AnyControl =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement;
    const isEditable = (element: unknown): element is HTMLElement =>
      element instanceof HTMLElement && element.isContentEditable;

    const labelText = (element: Element): string[] => {
      try {
        return Array.from((element as HTMLInputElement).labels ?? [])
          .map((label) => (label.textContent ?? "").trim())
          .filter(Boolean)
          .slice(0, 5);
      } catch {
        return [];
      }
    };
    const describe = (element: Element) => {
      const control = element as HTMLInputElement;
      const visibleText =
        element.getAttribute("aria-label") ||
        (element instanceof HTMLElement
          ? element.innerText
          : element.textContent) ||
        "";
      return {
        tag: element.tagName.toLowerCase(),
        type: control.type || element.getAttribute("type") || null,
        id: element.id || null,
        testId:
          element.getAttribute("data-testid") ||
          element.getAttribute("data-test-id"),
        name: element.getAttribute("name"),
        role: element.getAttribute("role"),
        labels: labelText(element),
        placeholder: control.placeholder || element.getAttribute("placeholder") || null,
        editable: isEditable(element) || undefined,
        text: visibleText.trim().slice(0, 160),
      };
    };
    // Pierce shadow DOM / retargeting so the real control is captured, not the host.
    const primaryTarget = (event: Event): Element | null => {
      const path = (event.composedPath?.() ?? []) as EventTarget[];
      for (const node of path) if (node instanceof Element) return node;
      return event.target instanceof Element ? event.target : null;
    };
    const valueOf = (element: AnyControl | HTMLElement) => {
      if (!captureValues) return { redacted: true };
      if (
        element instanceof HTMLInputElement &&
        (element.type === "checkbox" || element.type === "radio")
      )
        return { checked: element.checked };
      if (element instanceof HTMLInputElement && element.type === "file")
        return {
          files: Array.from(element.files ?? []).map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          })),
        };
      if (element instanceof HTMLSelectElement && element.multiple)
        return {
          value: Array.from(element.selectedOptions).map((option) => option.value),
        };
      if (isEditable(element)) return { value: (element.innerText || "").slice(0, 5000) };
      return { value: (element as AnyControl).value };
    };
    // Controls whose meaningful value is set atomically emit immediately;
    // free-text controls are debounced and flushed on change/blur/hide.
    const immediate = (element: AnyControl): boolean =>
      element instanceof HTMLSelectElement ||
      (element instanceof HTMLInputElement &&
        [
          "checkbox",
          "radio",
          "file",
          "date",
          "datetime-local",
          "month",
          "week",
          "time",
          "color",
          "range",
        ].includes(element.type));
    const kindOf = (element: AnyControl | HTMLElement): string => {
      if (element instanceof HTMLSelectElement) return "select";
      if (element instanceof HTMLInputElement) {
        if (element.type === "file") return "upload";
        if (element.type === "checkbox") return "checkbox";
        if (element.type === "radio") return "radio";
      }
      return "fill";
    };
    const emitControl = (element: AnyControl | HTMLElement) =>
      emit({
        type: kindOf(element),
        url: location.href,
        title: document.title,
        target: describe(element),
        value: valueOf(element),
        timestamp: new Date().toISOString(),
      });

    const timers = new WeakMap<Element, number>();
    const pending = new Set<Element>();
    const schedule = (element: Element) => {
      const previous = timers.get(element);
      if (previous) clearTimeout(previous);
      pending.add(element);
      timers.set(
        element,
        w.setTimeout(() => {
          timers.delete(element);
          pending.delete(element);
          if (isControl(element) || isEditable(element)) emitControl(element);
        }, 300),
      );
    };
    const flushControl = (element: Element) => {
      const previous = timers.get(element);
      if (previous) clearTimeout(previous);
      timers.delete(element);
      pending.delete(element);
      if (isControl(element) || isEditable(element)) emitControl(element);
    };
    const flushAll = () => {
      for (const element of Array.from(pending)) flushControl(element);
    };

    document.addEventListener(
      "click",
      (event) => {
        const target = primaryTarget(event);
        if (target)
          emit({
            type: "click",
            url: location.href,
            title: document.title,
            target: describe(target),
            timestamp: new Date().toISOString(),
          });
      },
      true,
    );
    document.addEventListener(
      "input",
      (event) => {
        const target = primaryTarget(event);
        if (isControl(target)) {
          if (immediate(target)) emitControl(target);
          else schedule(target);
        } else if (isEditable(target)) schedule(target);
      },
      true,
    );
    document.addEventListener(
      "change",
      (event) => {
        const target = primaryTarget(event);
        if (isControl(target)) flushControl(target);
      },
      true,
    );
    // Text controls that never fire a change (blur without change) are flushed here.
    document.addEventListener(
      "blur",
      (event) => {
        const target = primaryTarget(event);
        if (target && pending.has(target)) flushControl(target);
      },
      true,
    );
    // Pressing Enter often submits a form without a click; capture that intent.
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter") return;
        const target = primaryTarget(event);
        if (isControl(target) && !(target instanceof HTMLTextAreaElement)) {
          if (pending.has(target)) flushControl(target);
          emit({
            type: "click",
            url: location.href,
            title: document.title,
            target: describe(target),
            intent: "submit_via_enter",
            timestamp: new Date().toISOString(),
          });
        }
      },
      true,
    );

    const onHide = () => flushAll();
    w.addEventListener("pagehide", onHide, true);
    w.addEventListener("beforeunload", onHide, true);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") flushAll();
      },
      true,
    );

    // Single-page-app route changes do not trigger a real navigation; hook the
    // History API and hash/pop events so each logical page becomes its own state.
    const emitNavigation = () =>
      emit({
        type: "navigation",
        url: location.href,
        title: document.title,
        spa: true,
        timestamp: new Date().toISOString(),
      });
    try {
      const push = history.pushState.bind(history);
      history.pushState = ((...args: Parameters<History["pushState"]>) => {
        const result = push(...args);
        w.setTimeout(emitNavigation, 0);
        return result;
      }) as History["pushState"];
      const replace = history.replaceState.bind(history);
      history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
        const result = replace(...args);
        w.setTimeout(emitNavigation, 0);
        return result;
      }) as History["replaceState"];
    } catch {
      /* history not writable; popstate/hashchange still cover most SPAs */
    }
    w.addEventListener("popstate", () => w.setTimeout(emitNavigation, 0), true);
    w.addEventListener("hashchange", () => w.setTimeout(emitNavigation, 0), true);

    // Capture values the website pre-populates (server-rendered or JS-filled)
    // so generated steps can preserve them with fill_if_empty.
    const snapshot = () => {
      document.querySelectorAll("input, textarea, select").forEach((element) => {
        if (!isControl(element)) return;
        if (
          element instanceof HTMLInputElement &&
          ["hidden", "password", "file", "button", "submit", "reset"].includes(
            element.type,
          )
        )
          return;
        const populated =
          element instanceof HTMLSelectElement
            ? element.selectedIndex >= 0 && Boolean(element.value)
            : element instanceof HTMLInputElement &&
                (element.type === "checkbox" || element.type === "radio")
              ? element.checked
              : Boolean(element.value);
        if (!populated) return;
        emit({
          type: "field_snapshot",
          url: location.href,
          title: document.title,
          target: describe(element),
          value: valueOf(element),
          snapshot: true,
          timestamp: new Date().toISOString(),
        });
      });
    };
    const scheduleSnapshot = () => w.setTimeout(snapshot, 500);
    if (document.readyState === "complete" || document.readyState === "interactive")
      scheduleSnapshot();
    else
      w.addEventListener("DOMContentLoaded", scheduleSnapshot, { once: true });
    w.addEventListener("load", scheduleSnapshot, { once: true });
  }, { captureValues });
  const attach = (page: Page) => {
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame())
        void persist({
          type: "navigation",
          url: frame.url(),
          title: undefined,
          timestamp: new Date().toISOString(),
        });
    });
    page.on("download", (download) =>
      void persist({
        type: "download",
        suggestedFilename: download.suggestedFilename(),
        url: page.url(),
        timestamp: new Date().toISOString(),
      }),
    );
    // Backup signal: some portals open the OS file chooser from a styled button
    // where the underlying <input type=file> change may not surface cleanly.
    page.on("filechooser", (chooser) =>
      void persist({
        type: "upload_intent",
        url: page.url(),
        multiple: chooser.isMultiple(),
        timestamp: new Date().toISOString(),
      }),
    );
  };
  for (const existing of context.pages()) attach(existing);
  context.on("page", attach);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(entryUrl, { waitUntil: "domcontentloaded" });
  console.log(
    `Recording ${sessionId}. Value capture: ${captureValues ? "LOCAL PLAINTEXT ENABLED" : "redacted"}. Use Chrome manually; stop from Flow Studio or press Ctrl+C.`,
  );
  const close = async () => {
    if (closed) return;
    closed = true;
    await writeQueue;
    await context.tracing
      .stop({ path: path.join(dir, "recording.trace.zip") })
      .catch(() => {});
    await context.close().catch(() => {});
    await writeFile(
      path.join(dir, "metadata.json"),
      JSON.stringify(
        {
          sessionId,
          entryUrl,
          status: "completed",
          captureValues,
          eventCount,
          completedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`Recording completed with ${eventCount} events: ${events}`);
  };
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
  await new Promise<void>((resolve) =>
    (context as unknown as { once: (event: string, handler: () => void) => void }).once(
      "close",
      resolve,
    ),
  );
  await close();
}
