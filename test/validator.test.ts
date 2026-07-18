import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { load as parseYaml } from "js-yaml";
import { validateDefinition } from "../src/validator/validate.js";
test("sample flow is valid",async()=>{const d=parseYaml(await readFile("flows/drafts/mock_application.v1.yaml","utf8"));const r=validateDefinition(d);assert.equal(r.valid,true,r.errors.join("\n"));assert.equal(r.summary.states,5);});
test("missing transition target fails",async()=>{const d=parseYaml(await readFile("flows/drafts/mock_application.v1.yaml","utf8"));d.flow.states.registration.transitions.success="missing";const r=validateDefinition(d);assert.equal(r.valid,false);});
