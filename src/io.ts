import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { load as parseYaml, dump as stringifyYaml } from "js-yaml";
import { FlowDefinitionSchema, type FlowDefinition } from "./schema/flow.js";

export async function loadStructured(file: string): Promise<unknown> {
  const raw = await readFile(file, "utf8");
  return file.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
}
export async function loadFlow(file: string): Promise<FlowDefinition> {
  return FlowDefinitionSchema.parse(await loadStructured(file));
}
export async function saveStructured(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const raw = file.endsWith(".json") ? JSON.stringify(value, null, 2) : stringifyYaml(value, { indent: 2, lineWidth: 120, noRefs: true });
  await writeFile(file, raw, "utf8");
}
