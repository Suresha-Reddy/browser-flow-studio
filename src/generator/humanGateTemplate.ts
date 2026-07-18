export const HUMAN_GATE = `import type { HumanInterventionRequest } from "./types.js";
type Result={status:"resolved"|"cancelled";approved?:boolean;value?:string};
export class HumanGate {
  private pending=new Map<string,{request:HumanInterventionRequest;resolve:(result:Result)=>void}>();
  private settled=new Map<string,Result>();
  wait(request:HumanInterventionRequest):Promise<Result>{const prior=this.settled.get(request.resumeToken);if(prior)return Promise.resolve(prior);if(this.pending.has(request.resumeToken))throw new Error("Duplicate resume token "+request.resumeToken);return new Promise(resolve=>this.pending.set(request.resumeToken,{request,resolve}))}
  list():HumanInterventionRequest[]{return [...this.pending.values()].map(x=>x.request)}
  resume(resumeToken:string,result:Omit<Result,"status">={}):boolean{const prior=this.settled.get(resumeToken);if(prior)return prior.status==="resolved";const item=this.pending.get(resumeToken);if(!item)return false;const final={status:"resolved" as const,...result};this.pending.delete(resumeToken);this.settled.set(resumeToken,final);item.resolve(final);return true}
  cancel(resumeToken:string):boolean{const prior=this.settled.get(resumeToken);if(prior)return prior.status==="cancelled";const item=this.pending.get(resumeToken);if(!item)return false;const final={status:"cancelled" as const};this.pending.delete(resumeToken);this.settled.set(resumeToken,final);item.resolve(final);return true}
}
`;
