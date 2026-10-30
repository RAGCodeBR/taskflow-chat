import {NextRequest,NextResponse} from 'next/server';
import {getAuthenticatedUser,canAccessSession} from '@/lib/api-auth';
import {prisma} from '@/lib/prisma';
import {chatIdentities} from '@/lib/chat-identities';
import {getGroupPeople} from '@/lib/group-people';
import {effectiveDirectMessageStatus,readMessageReceipts} from '@/lib/message-receipts';
export async function GET(request:NextRequest,{params}:{params:Promise<{sessionId:string;jid:string;messageId:string}>}){
 const user=await getAuthenticatedUser(request);if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
 const {sessionId,jid,messageId}=await params;
 if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso.'},{status:403});
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});
 if(!session)return NextResponse.json({message:'Sessão não encontrada.'},{status:404});
 const message=await prisma.message.findUnique({where:{sessionId_keyId:{sessionId:session.id,keyId:messageId}}});
 const contacts=await prisma.contact.findMany({where:{sessionId:session.id},select:{jid:true,lid:true,remoteJidAlt:true,name:true,customName:true,notify:true}});
 const identities=chatIdentities(contacts);
 if(!message||!message.fromMe||!identities.aliases(jid).includes(message.remoteJid))return NextResponse.json({message:'Selecione uma mensagem enviada nesta conversa.'},{status:404});
 try{
  const people=jid.endsWith('@g.us')?await getGroupPeople(session.id,jid):[];
  const receipts=await readMessageReceipts(session.id,messageId);
  const status = jid.endsWith('@g.us') ? message.status : effectiveDirectMessageStatus(message.status,receipts);
  return NextResponse.json({status,receipts:receipts.map(receipt=>({...receipt,name:people.find(person=>person.jid===receipt.userJid||person.aliases?.includes(receipt.userJid))?.name||contacts.find(contact=>identities.canonical(contact.jid)===identities.canonical(receipt.userJid))?.customName||contacts.find(contact=>identities.canonical(contact.jid)===identities.canonical(receipt.userJid))?.name||receipt.userJid.split('@')[0]}))},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({message:'Não foi possível consultar as confirmações.'},{status:500})}
}
