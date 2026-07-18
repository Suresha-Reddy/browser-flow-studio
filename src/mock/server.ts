import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
export async function startMock(port=4173):Promise<void>{const base=path.resolve("mock-portal");const server=createServer(async(req,res)=>{let p=(req.url??"/").split("?")[0]!;if(p==="/")p="/registration.html";const file=path.join(base,path.basename(p));try{const body=await readFile(file);res.setHeader("content-type",file.endsWith(".html")?"text/html":"application/octet-stream");res.end(body);}catch{res.statusCode=404;res.end("Not found");}});server.listen(port,"127.0.0.1",()=>console.log(`Mock portal: http://127.0.0.1:${port}`));await new Promise(()=>{});}
