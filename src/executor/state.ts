import type { Page } from "playwright";
import type { FlowDefinition } from "../schema/flow.js";
import { resolveTarget } from "./targetResolver.js";
export async function stateMatches(page:Page,d:FlowDefinition,stateKey:string):Promise<boolean>{try{await detectState(page,d,stateKey);return true}catch{return false}}
export async function resolveEntryState(page:Page,d:FlowDefinition):Promise<string>{const candidates=d.flow.entryStates?.length?d.flow.entryStates:[d.flow.initialState];for(const key of candidates)if(await stateMatches(page,d,key))return key;throw new Error(`none of the entry states matched the current page: ${candidates.join(", ")}`)}
export async function detectState(page:Page,d:FlowDefinition,stateKey:string):Promise<void>{ const s=d.flow.states[stateKey]; if(!s) throw new Error(`missing state ${stateKey}`); const x=s.detect;
  if(x.urlContains&&!x.urlContains.every(v=>page.url().includes(v))) throw new Error(`state ${stateKey}: URL mismatch ${page.url()}`);
  if(x.urlMatches&&!new RegExp(x.urlMatches).test(page.url())) throw new Error(`state ${stateKey}: URL regex mismatch`);
  if(x.titleContains){const title=await page.title(); if(!x.titleContains.every(v=>title.includes(v))) throw new Error(`state ${stateKey}: title mismatch`);}
  for(const text of x.visibleText??[]) if(await page.getByText(text,{exact:false}).count()===0) throw new Error(`state ${stateKey}: text not found '${text}'`);
  for(const target of x.requiredTargets??[]) await resolveTarget(page,target);
}
