import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { loadFlow } from "../io.js";
import { sha256 } from "../util.js";
import { TYPES } from "./typesTemplate.js";
import { RUNTIME } from "./runtimeTemplate.js";
import { HUMAN_GATE } from "./humanGateTemplate.js";

const README=(key:string,version:number)=>`# Generated flow: ${key} v${version}

This package exposes both contracts:

- \`runApplicationFlow()\` + \`HumanGate\` for a live, uninterrupted Node process.
- \`runApplicationFlowUntilPause()\` for Temporal, multi-worker and crash-recovery integrations.

## Durable activity call

\`\`\`ts
const result = await runApplicationFlowUntilPause({
  page, input, documents,
  checkpoint,
  interventionResponse,
  browserSessionId,
  allowSubmit: false,
  callbacks: { onCheckpoint: persistCheckpoint }
});
\`\`\`

Persist every returned checkpoint. A paused result returns immediately; wait for an authenticated signal outside the activity, reconnect to the owning browser session, then call again with the checkpoint and response.

Documents accept a path, path array, Playwright payload or payload array. The runner validates multiplicity, MIME type, extension and size. Upload steps require post-upload success assertions.

Resume tokens are 256-bit random, single-use, run/checksum/state/step-bound through the checkpoint, expiring and secret-free. OTP values and applicant data are never stored in checkpoints.

Final submit is never replayed. If a worker dies after submit intent is persisted but before a portal result is proven, the runner returns \`SUBMIT_OUTCOME_UNKNOWN\` rather than clicking again.
`;

export async function generatePortablePackage(flowFile:string,outDir?:string):Promise<string>{
 const d=await loadFlow(flowFile),raw=await readFile(flowFile,"utf8"),checksum=`sha256:${sha256(raw)}`;
 const output=path.resolve(outDir??path.join("exports",`${d.application.key}-v${d.application.version}`));
 await mkdir(path.join(output,"src"),{recursive:true});await mkdir(path.join(output,"flow"),{recursive:true});
 await writeFile(path.join(output,"flow","definition.json"),JSON.stringify(d,null,2));await writeFile(path.join(output,"flow","definition.sha256"),checksum+"\n");
 await writeFile(path.join(output,"src","types.ts"),TYPES);await writeFile(path.join(output,"src","human-gate.ts"),HUMAN_GATE);await writeFile(path.join(output,"src","index.ts"),RUNTIME);await writeFile(path.join(output,"README.md"),README(d.application.key,d.application.version));
 await writeFile(path.join(output,"package.json"),JSON.stringify({name:`@local-flows/${d.application.key}`,version:`${d.application.version}.0.0`,private:true,type:"module",scripts:{build:"tsc",typecheck:"tsc --noEmit"},dependencies:{playwright:"^1.55.0"},peerDependencies:{"@browserbasehq/stagehand":">=2.0.0"},peerDependenciesMeta:{"@browserbasehq/stagehand":{optional:true}},devDependencies:{typescript:"^5.8.0","@types/node":"^22.0.0"}},null,2));
 await writeFile(path.join(output,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",moduleResolution:"NodeNext",strict:true,resolveJsonModule:true,outDir:"dist",declaration:true,skipLibCheck:true,lib:["ESNext","DOM"],types:["node"]},include:["src/**/*.ts","flow/**/*.json","manifest.json"]},null,2));
 await writeFile(path.join(output,"manifest.json"),JSON.stringify({flowKey:d.application.key,flowVersion:String(d.application.version),schemaVersion:d.schemaVersion,flowChecksum:checksum,generatorVersion:"2.0.0",generatedAt:new Date().toISOString(),capabilities:{durableCheckpoint:true,runUntilPause:true,documentArrays:true,uploadModes:true,humanGateLegacy:true}},null,2));
 console.log(`Generated durable portable package: ${output}`);return output;
}
