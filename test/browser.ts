import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";

/** Launches a test browser without assuming a Linux-only executable path. */
export async function launchTestBrowser(): Promise<Browser> {
  const explicit = process.env.FLOW_STUDIO_CHROME_PATH;
  const executableCandidates = [
    explicit,
    chromium.executablePath(),
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined,
    process.platform === "darwin"
      ? "/Applications/Chromium.app/Contents/MacOS/Chromium"
      : undefined,
    process.platform === "darwin"
      ? `${process.env.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
      : undefined,
    process.platform === "win32"
      ? `${process.env.PROGRAMFILES ?? ""}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.platform === "win32"
      ? `${process.env["PROGRAMFILES(X86)"] ?? ""}\\Google\\Chrome\\Application\\chrome.exe`
      : undefined,
    process.platform === "linux" ? "/usr/local/bin/chromium" : undefined,
    process.platform === "linux" ? "/usr/bin/chromium" : undefined,
    process.platform === "linux" ? "/usr/bin/google-chrome" : undefined,
  ].filter((value): value is string => Boolean(value));

  const failures: string[] = [];
  for (const executablePath of [...new Set(executableCandidates)]) {
    if (!existsSync(executablePath)) continue;
    try {
      return await chromium.launch({ headless: true, executablePath });
    } catch (error) {
      failures.push(
        `${executablePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({ headless: true, channel });
    } catch (error) {
      failures.push(
        `${channel}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    [
      "No Chromium-compatible browser is available for Flow Studio tests.",
      "Run: npx playwright install chromium",
      "Or set FLOW_STUDIO_CHROME_PATH to your Chrome/Chromium executable.",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"),
  );
}
