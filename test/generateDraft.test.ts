import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { load as parseYaml } from "js-yaml";
import { generateDraft } from "../src/generator/generateDraft.js";

test("draft generation collapses repeated input events and adds safe assertions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flow-studio-draft-"));
  const eventsFile = path.join(directory, "events.jsonl");
  const output = path.join(directory, "flow.yaml");
  const target = {
    tag: "input",
    type: "text",
    name: "uid",
    labels: ["Enter Aadhaar Number"],
    placeholder: "000000000000",
  };
  const events = [
    {
      type: "navigation",
      url: "https://example.test/download",
      title: "Download Aadhaar",
    },
    ...Array.from({ length: 4 }, () => ({
      type: "fill",
      url: "https://example.test/download",
      target,
      value: { hasValue: true },
    })),
    ...Array.from({ length: 3 }, () => ({
      type: "fill",
      url: "https://example.test/download",
      target: {
        tag: "input",
        type: "text",
        name: "captcha",
        labels: ["Enter Captcha"],
      },
      value: { hasValue: true },
    })),
  ];
  await writeFile(
    eventsFile,
    events.map((event) => JSON.stringify(event)).join("\n"),
  );
  await generateDraft(eventsFile, output, "aadhaar_download");
  const definition = parseYaml(await readFile(output, "utf8")) as any;
  const steps = Object.values(definition.flow.states)
    .flatMap((state: any) => state.steps ?? [])
    .filter((step: any) => step.type === "fill");
  assert.equal(
    steps.filter((step: any) => step.field === "enter_aadhaar_number").length,
    1,
  );
  const humanSteps = Object.values(definition.flow.states)
    .flatMap((state: any) => state.steps ?? [])
    .filter((step: any) => step.type === "human_input");
  assert.equal(
    humanSteps.filter((step: any) => step.reason === "captcha").length,
    1,
  );
  const aadhaar = steps.find(
    (step: any) => step.field === "enter_aadhaar_number",
  );
  assert.equal(aadhaar.success[0].type, "field_value_equals");
  const captcha = humanSteps.find((step: any) => step.reason === "captcha");
  assert.equal(captcha.inputMode, "operator_in_browser");
  assert.deepEqual(captcha.target.labels, ["Enter Captcha"]);
  assert.equal(captcha.target.nameAttribute, "captcha");
});
