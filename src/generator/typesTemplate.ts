export const TYPES = `import type { Page } from "playwright";
export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type HumanReason="otp"|"captcha"|"login"|"payment"|"approval"|"document_review"|"visual_verification"|"other";
export type FilePayload={name:string;mimeType:string;buffer:Buffer};
export type RuntimeDocument=string|string[]|FilePayload|FilePayload[];
export interface ResolvedDocument {key:string;originalFileName:string;mimeType:string;size:number;sha256:string;storageReference:string;temporaryPath?:string}
export interface FlowIntervention {token:string;reason:HumanReason;stateKey:string;stepId:string;parentStepId?:string;createdAt:string;expiresAt?:string;responseAttempts:number}
export interface FlowCheckpoint {schemaVersion:1;flowKey:string;flowVersion:string;flowChecksum:string;runId:string;stateKey:string;nextStepId:string|null;completedStepIds:string[];extracted:Record<string,JsonValue>;branchDecisions:Record<string,string>;repeatCounters:Record<string,number>;repeatPositions:Record<string,number>;retryCounters:Record<string,number>;assertionResults:Record<string,boolean>;manualOverrideStepIds:string[];consumedInterventionTokens:string[];intervention?:FlowIntervention;browserSessionId?:string;pageUrl?:string;submit:{approved:boolean;attempted:boolean;idempotencyKey?:string;resultReference?:string};terminalStatus?:"completed"|"failed"|"cancelled"|"manual_fallback";updatedAt:string}
export interface HumanInterventionRequest extends FlowIntervention {resumeToken:string;runId:string;flowChecksum:string;prompt:string;pageUrl:string}
export interface InterventionResponse {token:string;action:"resume"|"cancel";value?:string;approved?:boolean;operatorId?:string}
export interface SerializableFlowError {name:string;code:string;message:string;stateKey:string;stepId?:string;recoverable:boolean}
export type FlowRunResult={status:"paused";checkpoint:FlowCheckpoint;intervention:HumanInterventionRequest}|{status:"completed";checkpoint:FlowCheckpoint;finalState:string;extracted:Record<string,JsonValue>}|{status:"failed";checkpoint:FlowCheckpoint;error:SerializableFlowError};
export interface FlowCallbacks {onCheckpoint?(event:{state:string;step:string;status:string;checkpoint:FlowCheckpoint}):Promise<void>;onHumanIntervention?(request:HumanInterventionRequest):Promise<{status:"resolved"|"cancelled";approved?:boolean;value?:string}>;onHumanState?(event:{status:"paused"|"resumed"|"cancelled";request:HumanInterventionRequest}):Promise<void>;onEvidence?(artifact:{name:string;path:string;state:string;step:string}):Promise<void>;onDocumentResolved?(document:Omit<ResolvedDocument,"storageReference">):Promise<void>;onLog?(event:{level:"info"|"warn"|"error";message:string;metadata?:Record<string,unknown>}):void}
export interface StagehandLike {page:{observe(input:{instruction:string}):Promise<Array<{selector?:string}>>}}
export interface DurableRunOptions {page:Page;input:Record<string,unknown>;documents?:Record<string,RuntimeDocument>;resolvedDocuments?:Record<string,ResolvedDocument|ResolvedDocument[]>;stagehand?:StagehandLike;callbacks?:FlowCallbacks;artifactDirectory?:string;allowSubmit?:boolean;runId?:string;browserSessionId?:string;checkpoint?:FlowCheckpoint;interventionResponse?:InterventionResponse}
export type RunOptions=DurableRunOptions;
export interface RunResult {status:string;state:string;extracted:Record<string,JsonValue>;checkpoint:FlowCheckpoint}
`;
