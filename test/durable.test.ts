import test from "node:test";
import assert from "node:assert/strict";
import { FlowCheckpointSchema } from "../src/schema/checkpoint.js";
import { validateDefinition } from "../src/validator/validate.js";

const checkpoint={schemaVersion:1,flowKey:"flow",flowVersion:"1",flowChecksum:"sha256:"+"a".repeat(64),runId:"run-1",stateKey:"start",nextStepId:"otp",completedStepIds:[],extracted:{reference:"ABC"},branchDecisions:{},repeatCounters:{},repeatPositions:{},retryCounters:{},assertionResults:{},manualOverrideStepIds:[],consumedInterventionTokens:[],submit:{approved:false,attempted:false},updatedAt:new Date().toISOString()};
test("durable checkpoint is strict and JSON serializable",()=>{const parsed=FlowCheckpointSchema.parse(JSON.parse(JSON.stringify(checkpoint)));assert.equal(parsed.flowChecksum,checkpoint.flowChecksum);assert.throws(()=>FlowCheckpointSchema.parse({...checkpoint,secret:"otp"}))});

test("upload requires post-upload assertion",()=>{const flow={schemaVersion:1,application:{key:"x",name:"X",portal:"x",version:1,entryUrl:"https://example.test"},fields:[],documents:[{key:"identity",required:true,multiple:false,acceptedMimeTypes:["application/pdf"],acceptedExtensions:[".pdf"],maxBytes:1000}],flow:{initialState:"start",entryStates:["start"],terminalStates:["completed"],states:{start:{detect:{urlContains:["/"]},resumable:true,replayPolicy:"detect_and_continue",steps:[{id:"upload",type:"upload",document:"identity",uploadMode:"replace",target:{labels:["File"]}}],transitions:{success:"completed"}}}}};const result=validateDefinition(flow);assert.equal(result.valid,false);assert.ok(result.errors.some(x=>x.includes("post-upload success")))});
