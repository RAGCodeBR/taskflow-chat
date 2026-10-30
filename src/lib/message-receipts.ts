import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
export type Receipt={userJid:string;deliveredAt?:number;readAt?:number;playedAt?:number};
export function effectiveDirectMessageStatus(status:string,receipts:Receipt[]){
 if(receipts.some(receipt=>receipt.readAt||receipt.playedAt))return 'READ';
 if(status!=='READ'&&receipts.some(receipt=>receipt.deliveredAt))return 'DELIVERED';
 return status;
}
export function mergeReceipt(current:Receipt[],incoming:Receipt):Receipt[]{
 const byUser=new Map(current.map(value=>[value.userJid,value]));
 const previous=byUser.get(incoming.userJid);
 byUser.set(incoming.userJid,{userJid:incoming.userJid,...Object.fromEntries(['deliveredAt','readAt','playedAt'].flatMap(key=>{const value=Math.max(Number(previous?.[key as keyof Receipt])||0,Number(incoming[key as keyof Receipt])||0);return value>0?[[key,value]]:[]}))});
 return [...byUser.values()];
}
const pending=new Map<string,Promise<void>>();
function receiptPath(session:string,key:string){return path.join(process.cwd(),'.local','message-receipts',createHash('sha256').update(session+'\0'+key).digest('hex')+'.json')}
export async function readMessageReceipts(session:string,key:string):Promise<Receipt[]>{
 try{return JSON.parse(await readFile(receiptPath(session,key),'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error}
}
export async function saveMessageReceipt(session:string,key:string,receipt:Receipt){
 const file=receiptPath(session,key);
 const task=(pending.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const values=mergeReceipt(await readMessageReceipts(session,key),receipt),temp=file+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify(values),{mode:0o600});await rename(temp,file);
 });
 pending.set(file,task);try{await task}finally{if(pending.get(file)===task)pending.delete(file)}
}
