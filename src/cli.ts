#!/usr/bin/env node
import { recordFlow } from "./recorder/record.js";
import { generateDraft } from "./generator/generateDraft.js";
import { validateFile, printValidation } from "./validator/validate.js";
import { runFlow } from "./executor/run.js";
import { publishFlow } from "./publisher/publish.js";
import { startMock } from "./mock/server.js";
import { generatePortablePackage } from "./generator/codegen.js";
function value(args:string[],name:string){const i=args.indexOf(name);return i>=0?args[i+1]:undefined}function has(args:string[],name:string){return args.includes(name)}
const [cmd,...args]=process.argv.slice(2);
async function main(){
 if(cmd==="record"){const url=args[0];if(!url)throw new Error("record requires entry URL");return recordFlow(url,{captureValues:has(args,"--capture-values")});}
 if(cmd==="generate"){const input=args[0],out=value(args,"--output")??"flows/drafts/generated.v1.yaml";if(!input)throw new Error("generate requires events.jsonl");return generateDraft(input,out,value(args,"--key"));}
 if(cmd==="validate"){if(!args[0])throw new Error("validate requires flow file");const r=await validateFile(args[0]);printValidation(r);if(!r.valid)process.exitCode=1;return;}
 if(cmd==="run"){if(!args[0])throw new Error("run requires flow file");const mode=(value(args,"--mode")??"verify") as "inspect"|"verify"|"submit";const r=await runFlow({flowFile:args[0],dataFile:value(args,"--data"),mode,allowFinalSubmit:has(args,"--allow-final-submit"),stepByStep:has(args,"--step-by-step"),headless:has(args,"--headless")});console.log(r);return;}
 if(cmd==="export"){if(!args[0])throw new Error("export requires flow file");await generatePortablePackage(args[0],value(args,"--output"));return;}
 if(cmd==="publish"){if(!args[0])throw new Error("publish requires flow file");await publishFlow(args[0]);return;}
 if(cmd==="mock")return startMock(Number(value(args,"--port")??4173));
 console.log(`Flow Studio Local\n\nCommands:\n  record <url> [--capture-values]\n  generate <events.jsonl> [--output file] [--key key]\n  validate <flow.yaml>\n  run <flow.yaml> [--data file] [--mode inspect|verify|submit] [--step-by-step] [--allow-final-submit]\n  publish <flow.yaml>\n  export <flow.yaml> [--output dir]\n  mock [--port 4173]`);
}
main().catch(e=>{console.error(e instanceof Error?e.stack:e);process.exit(1)});
