import test from "node:test";import assert from "node:assert/strict";import {resolveTemplate,sha256} from "../src/util.js";
test("resolves field templates",()=>assert.equal(resolveTemplate("{{fields.mobile}}",{mobile:"123"}),"123"));
test("sha256 is stable",()=>assert.equal(sha256("a"),"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"));
