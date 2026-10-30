import type {Server} from 'socket.io';
import {prisma} from '@/lib/prisma';
import {accountNoticeRoom,type AccountNotice} from '@/lib/account-notices';
import {isConversationJid} from '@/lib/conversation-jid';
export async function publishAccountAlerts(io:Server|null,sessionId:string,messages:{keyId:string;remoteJid:string;fromMe:boolean;pushName?:string|null;timestamp:string}[]) {
 const incoming=messages.filter(m=>m.fromMe===false&&isConversationJid(m.remoteJid));if(!io||!incoming.length)return;
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true,name:true}});if(!session)return;
 const jids=[...new Set(incoming.map(m=>m.remoteJid))];
 const [contacts,groups]=await Promise.all([
  prisma.contact.findMany({where:{sessionId:session.id,OR:[{jid:{in:jids}},{lid:{in:jids}},{remoteJidAlt:{in:jids}}]},select:{jid:true,lid:true,remoteJidAlt:true,name:true,customName:true,notify:true}}),
  prisma.group.findMany({where:{sessionId:session.id,jid:{in:jids}},select:{jid:true,subject:true}})
 ]);
 const notices:AccountNotice[]=incoming.map(m=>{
  const matches=contacts.filter(c=>[c.jid,c.lid,c.remoteJidAlt].includes(m.remoteJid));
  const name=groups.find(g=>g.jid===m.remoteJid)?.subject||matches.find(c=>c.customName)?.customName||matches.find(c=>c.name)?.name||matches.find(c=>c.notify)?.notify||m.pushName||m.remoteJid.split('@')[0];
  return {sessionId,accountName:session.name,keyId:m.keyId,jid:m.remoteJid,name,timestamp:m.timestamp};
 });
 io.to(accountNoticeRoom(sessionId)).emit('account.notice',notices);
}
