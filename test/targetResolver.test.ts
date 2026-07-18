import test from "node:test";
import assert from "node:assert/strict";
import { resolveTarget } from "../src/executor/targetResolver.js";
import { launchTestBrowser } from "./browser.js";

test("resolves a recorded field label that was captured as text", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <h1>Download Aadhaar</h1>
        <label>Enter Aadhaar Number <input name="aadhaar" /></label>
        <p>Enter Aadhaar Number exactly as shown on your card.</p>
      </main>
    `);
    const result = await resolveTarget(page, {
      text: ["Enter Aadhaar Number"],
    });
    assert.equal(result.strategy, "text_as_label");
    assert.equal(await result.locator.getAttribute("name"), "aadhaar");
  } finally {
    await browser.close();
  }
});

test("chooses the only visible control when the portal renders hidden duplicates", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <label style="display:none">Enter Aadhaar Number <input name="uid" placeholder="000000000000" /></label>
      <label>Enter Aadhaar Number <input name="uid" placeholder="000000000000" /></label>
    `);
    const result = await resolveTarget(page, {
      labels: ["Enter Aadhaar Number"],
      placeholder: ["000000000000"],
      nameAttribute: "uid",
    });
    assert.equal(await result.locator.isVisible(), true);
    assert.equal(await result.locator.getAttribute("name"), "uid");
  } finally {
    await browser.close();
  }
});

test("finds a unique control inside an iframe when no frame was recorded", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<iframe srcdoc='<label>Enter Aadhaar Number <input name="uid" placeholder="000000000000"></label>'></iframe>`,
    );
    await page
      .locator("iframe")
      .contentFrame()
      .getByLabel("Enter Aadhaar Number")
      .waitFor();
    const result = await resolveTarget(page, {
      labels: ["Enter Aadhaar Number"],
      placeholder: ["000000000000"],
      nameAttribute: "uid",
    });
    assert.match(result.strategy, /frame:/);
  } finally {
    await browser.close();
  }
});

test("uses recorded text as a placeholder and waits for delayed controls", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`<main id="app"></main>`);
    await page.evaluate(() => {
      setTimeout(() => {
        const input = document.createElement("input");
        input.placeholder = "Enter Aadhaar Number";
        document.querySelector("#app")?.append(input);
      }, 350);
    });
    const result = await resolveTarget(
      page,
      { text: ["Enter Aadhaar Number"] },
      { timeoutMs: 2_000 },
    );
    assert.equal(result.strategy, "text_as_placeholder");
  } finally {
    await browser.close();
  }
});

test("fill resolution never returns a button while waiting for an OTP input", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<button aria-label="Enter OTP">Enter OTP</button><main id="app"></main>`,
    );
    await page.evaluate(() => {
      setTimeout(() => {
        const input = document.createElement("input");
        input.name = "otp";
        input.setAttribute("aria-label", "Enter OTP");
        document.querySelector("#app")?.append(input);
      }, 350);
    });
    const result = await resolveTarget(
      page,
      { labels: ["Enter OTP"], nameAttribute: "otp" },
      { timeoutMs: 2_000, expectedKind: "fill" },
    );
    assert.equal(
      await result.locator.evaluate((element) => element.tagName),
      "INPUT",
    );
    assert.equal(await result.locator.inputValue(), "");
  } finally {
    await browser.close();
  }
});

test("operator click recovery returns a durable replacement target", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`<input id="actual-aadhaar-control" />`);
    const resolution = resolveTarget(
      page,
      { text: ["Legacy text that is not on the portal"] },
      { timeoutMs: 100, allowInteractive: true, interactiveTimeoutMs: 2_000 },
    );
    await page.waitForFunction(
      () =>
        (window as unknown as { __flowStudioPickerInstalled?: boolean })
          .__flowStudioPickerInstalled === true,
    );
    await page.locator("#actual-aadhaar-control").click();
    const result = await resolution;
    assert.equal(result.strategy, "operator_repaired");
    assert.deepEqual(result.repairedTarget?.cssFallbacks, [
      "#actual-aadhaar-control",
    ]);
  } finally {
    await browser.close();
  }
});
