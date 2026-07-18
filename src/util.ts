import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,80) || "step";
export async function ask(prompt: string): Promise<string> { const rl=createInterface({input:stdin,output:stdout}); try { return (await rl.question(prompt)).trim(); } finally { rl.close(); } }
export function resolveTemplate(value: string, data: Record<string, unknown>): string {
  return value.replace(/\{\{fields\.([\w.-]+)\}\}/g, (_, key) => String(data[key] ?? ""));
}
export function redact(value: unknown): unknown { return typeof value === "string" && value.length ? "[REDACTED]" : value; }
