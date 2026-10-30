import {createHash} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {getAuthenticatedUser,canAccessSession} from '@/lib/api-auth';
import {prisma} from '@/lib/prisma';
import {ChatService} from '@/modules/whatsapp/chat.service';
import {waManager} from '@/modules/whatsapp/manager';
import {chatIdentities} from '@/lib/chat-identities';
import {resolveKanbanColumns} from '@/lib/chat-stages';
import {consultingRecipients,CONSULTORIA_NOTICE_TEXT,noticeDay} from '@/lib/consultoria-notice';
type Context={params:Promise<{sessionId:string}>};
async function authorize(request:NextRequest,context:Context){
 const user=await getAuthenticatedUser(request);if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
 const {sessionId}=await context.params;
 if(user.id!=='cmvfh8x96000013ju1cmn8vna'||user.role!=='SUPERADMIN'||sessionId!=='zap-rei'||!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Este aviso está reservado ao acesso privado da Consultoria.'},{status:403});
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true,sessionId:true,userId:true,name:true}});
 if(!session||session.userId!==user.id)return NextResponse.json({message:'Conta não encontrada.'},{status:404});return session;
}
async function scope(session:{id:string;sessionId:string}){
 const [chats,labels,assignments,stages,saved,contacts]=await Promise.all([
  ChatService.getChatsList(session.id,null,undefined,undefined,'all'),prisma.label.findMany({where:{sessionId:session.sessionId},select:{id:true}}),
  prisma.chatLabel.findMany({where:{label:{sessionId:session.sessionId}},select:{chatJid:true,labelId:true}}),
  prisma.chatStage.findMany({where:{sessionId:session.id},select:{chatJid:true,stage:true},orderBy:{updatedAt:'desc'}}),
  prisma.kanbanColumn.findMany({where:{sessionId:session.id}}),prisma.contact.findMany({where:{sessionId:session.id},select:{jid:true,lid:true,remoteJidAlt:true}})
 ]);
 const identities=chatIdentities(contacts);const canonicalStages=[...new Map([...stages].reverse().map(s=>[identities.canonical(s.chatJid),{...s,chatJid:identities.canonical(s.chatJid)}])).values()];
 return consultingRecipients(chats.map(chat=>({...chat,jid:identities.canonical(chat.jid),aliases:identities.aliases(chat.jid)})),resolveKanbanColumns(saved,labels),assignments.map(a=>({...a,chatJid:identities.canonical(a.chatJid)})),canonicalStages);
}
function confirmation(log:{id:string;message:string;recipients:{jid:string}[]}){return createHash('sha256').update(JSON.stringify([log.id,log.message,log.recipients.map(r=>r.jid).sort()])).digest('hex')}
async function view(session:{id:string;sessionId:string;name:string|null},id?:string){
 const current=await scope(session);
 const log=id?await prisma.broadcastLog.findFirst({where:{id,sessionId:session.sessionId,status:{startsWith:'column-'}},include:{recipients:{orderBy:{id:'asc'}}}}):await prisma.broadcastLog.findFirst({where:{sessionId:session.sessionId,status:{startsWith:'column-'}},orderBy:{startedAt:'desc'},include:{recipients:{orderBy:{id:'asc'}}}});
 const recipients=current.recipients.map(chat=>({jid:chat.jid,name:chat.name||chat.notify||chat.jid.split('@')[0],group:chat.jid.endsWith('@g.us')}));
 return{column:current.column?.name||null,sessionName:session.name,recipients,defaultMessage:CONSULTORIA_NOTICE_TEXT,log:log?{...log,confirmation:confirmation(log)}:null};
}
export async function GET(request:NextRequest,context:Context){try{const session=await authorize(request,context);if(session instanceof NextResponse)return session;return NextResponse.json(await view(session,request.nextUrl.searchParams.get('id')||undefined),{headers:{'Cache-Control':'no-store'}})}catch(error){console.error('Notice preview failed',error);return NextResponse.json({message:'Não foi possível carregar o aviso.'},{status:500})}}
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('draft'),message:z.string().trim().min(1).max(4096).optional(),jids:z.array(z.string()).min(1).max(500).optional()}),
 z.object({action:z.literal('next'),id:z.string().min(1),confirmation:z.string().length(64)}),
 z.object({action:z.literal('pause'),id:z.string().min(1)})
]);
export async function POST(request:NextRequest,context:Context){
 try{
  const session=await authorize(request,context);if(session instanceof NextResponse)return session;
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({message:'Revise o aviso e os destinatários.'},{status:400});const body=parsed.data;
  if(body.action==='draft'){
   const current=await scope(session);if(!current.column)return NextResponse.json({message:'A coluna Consultoria não foi encontrada.'},{status:404});
   const available=new Set(current.recipients.map(chat=>chat.jid));const jids=body.jids?[...new Set(body.jids)]:[...available];
   if(!jids.length||jids.some(jid=>!available.has(jid)))return NextResponse.json({message:'Selecione somente conversas da coluna Consultoria desta conta.'},{status:400});
   const log=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id"=${session.id} FOR UPDATE`;
    const existing=await tx.broadcastLog.findFirst({where:{sessionId:session.sessionId,status:'column-draft'},orderBy:{startedAt:'desc'}});
    if(existing&&noticeDay(existing.startedAt)===noticeDay()){
     // Reopening leaves an existing draft intact; editing is an explicit save.
     if(!body.message&&!body.jids)return existing;
     await tx.broadcastRecipient.deleteMany({where:{broadcastLogId:existing.id,status:'pending'}});
     return tx.broadcastLog.update({where:{id:existing.id},data:{message:body.message||existing.message,total:jids.length,recipients:{create:jids.map(jid=>({jid,status:'pending'}))}}});
    }
    return tx.broadcastLog.create({data:{sessionId:session.sessionId,message:body.message||CONSULTORIA_NOTICE_TEXT,total:jids.length,delay:5000,status:'column-draft',recipients:{create:jids.map(jid=>({jid,status:'pending'}))}}});
   });return NextResponse.json(await view(session,log.id));
  }
  const log=await prisma.broadcastLog.findFirst({where:{id:body.id,sessionId:session.sessionId,status:{startsWith:'column-'}},include:{recipients:true}});
  if(!log)return NextResponse.json({message:'Aviso não encontrado nesta conta.'},{status:404});
  if(body.action==='pause'){await prisma.broadcastLog.update({where:{id:log.id},data:{status:'column-paused'}});return NextResponse.json(await view(session,log.id))}
  if(body.confirmation!==confirmation(log))return NextResponse.json({message:'O aviso mudou. Revise novamente antes de enviar.'},{status:409});
  if(noticeDay(log.startedAt)!==noticeDay())return NextResponse.json({message:'Este aviso é de outro dia. Prepare um novo para não enviar “amanhã” com a data incorreta.'},{status:409});
  const instance=waManager.getInstance(session.sessionId);if(!instance?.socket||instance.status!=='CONNECTED')return NextResponse.json({message:'WhatsApp desconectado. O envio foi pausado.'},{status:409});
  const current=await scope(session),available=new Set(current.recipients.map(chat=>chat.jid));
  const reservation=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "BroadcastLog" WHERE "id"=${log.id} FOR UPDATE`;
   const active=await tx.broadcastRecipient.findFirst({where:{broadcastLogId:log.id,status:'sending'}});
   if(active)return{busy:true as const};
   const next=await tx.broadcastRecipient.findFirst({where:{broadcastLogId:log.id,status:'pending'},orderBy:{id:'asc'}});
   if(!next){await tx.broadcastLog.update({where:{id:log.id},data:{status:'column-completed',completedAt:new Date()}});return{done:true as const}}
   const recent=await tx.broadcastRecipient.findFirst({where:{broadcastLogId:log.id,sentAt:{not:null}},orderBy:{sentAt:'desc'}});
   if(recent?.sentAt&&Date.now()-recent.sentAt.getTime()<5000)return{wait:true as const};
   await tx.broadcastLog.update({where:{id:log.id},data:{status:'column-active'}});
   await tx.broadcastRecipient.update({where:{id:next.id},data:{status:available.has(next.jid)?'sending':'excluded',sentAt:new Date(),error:available.has(next.jid)?null:'A conversa saiu da coluna Consultoria.'}});
   return{recipient:next,excluded:!available.has(next.jid)};
  });
  if('busy'in reservation)return NextResponse.json({message:'Existe um envio sem confirmação. Confira no WhatsApp antes de continuar; ele não será repetido automaticamente.'},{status:409});
  if('wait'in reservation)return NextResponse.json({message:'Aguarde o intervalo entre os envios.'},{status:429});
  const recipient='recipient' in reservation?reservation.recipient:undefined;
  if(recipient&&!reservation.excluded){
   try{
    const result=await ChatService.sendTextMessage(session.sessionId,recipient.jid,{text:log.message});
    await prisma.$transaction([prisma.broadcastRecipient.update({where:{id:recipient.id},data:{status:'sent',sentAt:new Date()}}),prisma.broadcastLog.update({where:{id:log.id},data:{sent:{increment:1}}})]);
    return NextResponse.json({...await view(session,log.id),message:result.localMessage});
   }catch{
    await prisma.$transaction([prisma.broadcastRecipient.update({where:{id:recipient.id},data:{status:'uncertain',error:'Envio sem confirmação. Confira no WhatsApp antes de repetir.'}}),prisma.broadcastLog.update({where:{id:log.id},data:{status:'column-paused',failed:{increment:1}}})]);
    return NextResponse.json({message:'Não foi possível confirmar o envio. A fila foi pausada para evitar duplicidade.'},{status:502});
   }
  }
  return NextResponse.json(await view(session,log.id));
 }catch(error){console.error('Consultoria notice failed',error);return NextResponse.json({message:'Não foi possível preparar ou atualizar o aviso. Confira o histórico antes de repetir.'},{status:500})}
}
