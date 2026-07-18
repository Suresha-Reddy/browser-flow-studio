import test from "node:test";
import assert from "node:assert/strict";
import { launchTestBrowser } from "./browser.js";

const desktopUrl = new URL("../desktop/app/index.html", import.meta.url).href;

test("canvas separates state steps and supports manual step editing", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto(desktopUrl);

    await page.getByRole("button", { name: "State graph" }).click();
    const stateCount = await page.locator(".state-column").count();
    assert.equal(stateCount, 4);
    assert.equal(
      await page
        .locator(".state-column")
        .nth(0)
        .locator(".canvas-step")
        .count(),
      3,
    );
    assert.equal(
      await page
        .locator(".state-column")
        .nth(1)
        .locator(".canvas-step")
        .count(),
      1,
    );

    await page.getByRole("button", { name: "Steps" }).click();
    await page.getByRole("button", { name: /Add manual step/ }).click();
    await page.locator("#step-json").fill(
      JSON.stringify(
        {
          id: "manual_portal_review",
          type: "human_input",
          reason: "other",
          prompt: "Review the portal manually, then continue.",
          inputMode: "operator_in_browser",
        },
        null,
        2,
      ),
    );
    await page.locator("#save-step-btn").click();
    await page
      .locator(".step-item")
      .filter({ hasText: "manual portal review" })
      .click();
    await page.getByRole("button", { name: "Edit step" }).click();
    const updated = {
      id: "manual_portal_review",
      type: "human_input",
      reason: "other",
      prompt: "Updated manual review instruction.",
      inputMode: "operator_in_browser",
    };
    await page.locator("#step-json").fill(JSON.stringify(updated, null, 2));
    await page.locator("#save-step-btn").click();
    await page
      .locator(".step-item")
      .filter({ hasText: "manual portal review" })
      .click();
    assert.match(
      await page.locator("#step-inspector").innerText(),
      /Updated manual review instruction/,
    );
  } finally {
    await browser.close();
  }
});

test("test form omits OTP and CAPTCHA until the browser reaches them", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(desktopUrl);
    await page.evaluate(() => {
      const source = document.querySelector("#definition-source");
      const value = JSON.parse(source.value);
      value.fields.push(
        {
          key: "captcha",
          label: "Enter Captcha",
          type: "text",
          required: true,
          sensitive: false,
        },
        {
          key: "otp",
          label: "Enter OTP",
          type: "text",
          required: true,
          sensitive: true,
        },
      );
      source.value = JSON.stringify(value, null, 2);
      document.querySelector("#save-btn").click();
    });
    await page.getByRole("button", { name: "Verify" }).click();
    assert.equal(await page.locator('[data-field="captcha"]').count(), 0);
    assert.equal(await page.locator('[data-field="otp"]').count(), 0);
  } finally {
    await browser.close();
  }
});

test("validation repairs duplicate recorded fills and missing field assertions", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(desktopUrl);
    await page.evaluate(() => {
      const source = document.querySelector(
        "#definition-source",
      ) as HTMLTextAreaElement;
      const value = JSON.parse(source.value);
      const original = value.flow.states.registration.steps[0];
      original.success = [];
      value.flow.states.registration.steps.splice(1, 0, {
        ...structuredClone(original),
        id: `${original.id}_2`,
        success: [],
      });
      source.value = JSON.stringify(value, null, 2);
    });
    await page.getByRole("button", { name: "Verify" }).click();
    await page.getByRole("button", { name: "Run checks" }).click();
    const repaired = JSON.parse(
      await page.locator("#definition-source").inputValue(),
    );
    const fills = repaired.flow.states.registration.steps.filter(
      (step: { field?: string }) => step.field === "surname",
    );
    assert.equal(fills.length, 1);
    assert.equal(fills[0].success[0].type, "field_value_equals");
    assert.match(
      await page.locator("#validation-results").innerText(),
      /Recorded flow repaired/,
    );
  } finally {
    await browser.close();
  }
});

test("validation converts CAPTCHA and OTP to human pauses and removes recorder clicks", async () => {
  const browser = await launchTestBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(desktopUrl);
    await page.evaluate(() => {
      const source = document.querySelector(
        "#definition-source",
      ) as HTMLTextAreaElement;
      const value = JSON.parse(source.value);
      value.fields.push(
        {
          key: "enter_captcha",
          label: "Enter Captcha",
          type: "text",
          required: true,
          sensitive: true,
        },
        {
          key: "enter_otp",
          label: "Enter OTP",
          type: "text",
          required: true,
          sensitive: true,
        },
      );
      value.flow.states.registration.steps.push(
        {
          id: "fill_enter_captcha",
          type: "fill",
          field: "enter_captcha",
          mode: "fill_if_empty",
          existingValuePolicy: "manual_review_on_mismatch",
          target: { labels: ["Enter Captcha"] },
        },
        { id: "click_send_otp", type: "click", target: { text: ["Send OTP"] } },
        {
          id: "click_send_otp_2",
          type: "click",
          target: {
            role: { type: "button", name: "Send OTP" },
            text: ["Send OTP"],
          },
        },
        {
          id: "click_enter_otp",
          type: "click",
          target: { text: ["Enter OTP"] },
        },
        {
          id: "fill_enter_otp",
          type: "fill",
          field: "enter_otp",
          mode: "fill_if_empty",
          existingValuePolicy: "manual_review_on_mismatch",
          target: { labels: ["Enter OTP"], nameAttribute: "otp" },
        },
        {
          id: "click_instruction",
          type: "click",
          target: {
            text: [
              "This is a very long informational paragraph that was accidentally captured as a click and must never become an executable browser action because it is not a control.",
            ],
          },
        },
      );
      source.value = JSON.stringify(value, null, 2);
    });
    await page.getByRole("button", { name: "Verify" }).click();
    await page.getByRole("button", { name: "Run checks" }).click();
    const repaired = JSON.parse(
      await page.locator("#definition-source").inputValue(),
    );
    const steps = repaired.flow.states.registration.steps;
    assert.equal(
      steps.some((step: { id: string }) => step.id === "click_send_otp_2"),
      false,
    );
    assert.equal(
      steps.some((step: { id: string }) => step.id === "click_enter_otp"),
      false,
    );
    assert.equal(
      steps.some((step: { id: string }) => step.id === "click_instruction"),
      false,
    );
    const captcha = steps.find(
      (step: { id: string }) => step.id === "fill_enter_captcha",
    );
    const otp = steps.find(
      (step: { id: string }) => step.id === "fill_enter_otp",
    );
    assert.equal(captcha.type, "human_input");
    assert.equal(captcha.inputMode, "operator_in_browser");
    assert.deepEqual(captcha.target.labels, ["Enter Captcha"]);
    assert.equal(otp.type, "human_input");
    assert.equal(otp.inputMode, "callback_value");
    assert.match(
      await page.locator("#test-response").getAttribute("placeholder"),
      /leave empty if entered in Chrome/,
    );
    assert.equal(
      (await page.locator("#send-test-response").innerText()).trim(),
      "Continue flow",
    );
  } finally {
    await browser.close();
  }
});
