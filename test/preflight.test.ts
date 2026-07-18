import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateDefinition } from "../src/validator/validate.js";
import { runFlow } from "../src/executor/run.js";

const emptyFlow = {
  schemaVersion: 1,
  application: {
    key: "empty_application",
    name: "Empty Application",
    portal: "test_portal",
    version: 1,
    entryUrl: "https://example.com",
  },
  fields: [],
  documents: [],
  flow: {
    initialState: "start",
    entryStates: ["start"],
    terminalStates: ["completed", "cancelled", "submission_unknown"],
    states: {
      start: {
        detect: { urlContains: ["/"] },
        resumable: true,
        replayPolicy: "detect_and_continue",
        steps: [],
        transitions: { success: "completed" },
      },
    },
  },
};

test("validation blocks an empty entry state before Chrome starts", () => {
  const result = validateDefinition(emptyFlow);
  assert.equal(result.valid, false);
  assert.match(
    result.errors.join("\n"),
    /entry state 'start' has no executable steps/,
  );
  assert.match(result.errors.join("\n"), /flow has no executable steps/);
});

test("runner rejects an empty flow before launching a browser", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "flow-studio-empty-"));
  const flowFile = path.join(directory, "empty.json");
  await writeFile(flowFile, JSON.stringify(emptyFlow));
  await assert.rejects(
    runFlow({
      flowFile,
      mode: "verify",
      allowFinalSubmit: false,
      stepByStep: false,
      headless: true,
    }),
    /none of the entry states contain executable steps/,
  );
});
