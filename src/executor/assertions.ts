import type { Page } from "playwright";
import type { Assertion } from "../schema/flow.js";
import { resolveTarget } from "./targetResolver.js";
import { resolveTemplate } from "../util.js";

export async function evaluateAssertion(
  page: Page,
  a: Assertion,
  data: Record<string, unknown>,
  extracted: Record<string, string>,
): Promise<boolean> {
  const exp =
    typeof a.expected === "string"
      ? resolveTemplate(a.expected, data)
      : a.expected;
  switch (a.type) {
    case "url_contains":
      return page.url().includes(String(exp ?? ""));
    case "visible_text":
      return (
        (await page.getByText(String(exp ?? ""), { exact: false }).count()) > 0
      );
    case "visible_text_any":
      return (
        Array.isArray(exp) &&
        (
          await Promise.all(
            exp.map((x) => page.getByText(x, { exact: false }).count()),
          )
        ).some((n) => n > 0)
      );
    case "element_visible":
      return (
        !!a.target &&
        (await resolveTarget(page, a.target)
          .then(() => true)
          .catch(() => false))
      );
    case "element_hidden":
      return (
        !!a.target &&
        !(await resolveTarget(page, a.target)
          .then(() => true)
          .catch(() => false))
      );
    case "field_value_equals": {
      if (!a.target) return false;
      const { locator } = await resolveTarget(page, a.target, {
        expectedKind: "fill",
      });
      return (await locator.inputValue()) === String(exp ?? "");
    }
    case "selected_value_equals": {
      if (!a.target) return false;
      const { locator } = await resolveTarget(page, a.target, {
        expectedKind: "select",
      });
      return (await locator.inputValue()) === String(exp ?? "");
    }
    case "download_exists":
      return Boolean(extracted[String(a.key ?? exp ?? "")]);
    case "extracted_matches":
      return new RegExp(a.regex ?? String(exp ?? "")).test(
        extracted[a.key ?? ""] ?? "",
      );
  }
}
export async function assertAll(
  page: Page,
  list: Assertion[] | undefined,
  data: Record<string, unknown>,
  extracted: Record<string, string>,
): Promise<void> {
  for (const a of list ?? [])
    if (!(await evaluateAssertion(page, a, data, extracted)))
      throw new Error(`assertion failed: ${a.type}`);
}
export async function assertAny(
  page: Page,
  list: Assertion[] | undefined,
  data: Record<string, unknown>,
  extracted: Record<string, string>,
): Promise<boolean> {
  if (!list?.length) return true;
  for (const a of list)
    if (await evaluateAssertion(page, a, data, extracted)) return true;
  return false;
}
