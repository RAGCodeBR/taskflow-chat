import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {getAuthenticatedUser,canAccessSession} from '@/lib/api-auth';
import {prisma} from '@/lib/prisma';
import {chatIdentities} from '@/lib/chat-identities';
import {waManager} from '@/modules/whatsapp/manager';
import {ChatService} from '@/modules/whatsapp/chat.service';
const schema=z.object({jid:z.string().regex(/^[-\d]+@(s\.whatsapp\.net|lid|g\.us)$/),text:z.string().min(1).max(65536).refine(t=>!!t.trim()),quotedMessageId:z.string().min(1).max(200).optional(),mentions:z.array(z.string().regex(/^\d+@(s\.whatsapp\.net|lid)$/)).max(50).optional()});
export async function POST(request:NextRequest,{params}:{params:Promise<{sessionId:string}>}){
 const {sessionId}=await params;
 const user=await getAuthenticatedUser(request);if(!user)return NextResponse.json({message:'Entre novamente para enviar.'},{status:401});
 if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso a esta conta.'},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({message:'Mensagem ou conversa inválida.'},{status:400});
 const {jid,text,quotedMessageId,mentions}=parsed.data;
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});if(!session)return NextResponse.json({message:'Conta não encontrada.'},{status:404});
 if(quotedMessageId){
  const contacts=await prisma.contact.findMany({where:{sessionId:session.id},select:{jid:true,lid:true,remoteJidAlt:true}});
  const aliases=chatIdentities(contacts).aliases(jid);
  const quote=await prisma.message.findFirst({where:{sessionId:session.id,keyId:quotedMessageId,remoteJid:{in:aliases}},select:{id:true}});
  if(!quote)return NextResponse.json({message:'A mensagem selecionada não pertence a esta conversa. Selecione-a novamente.'},{status:400});
 }
 const instance=waManager.getInstance(sessionId);if(!instance?.socket||instance.status!=='CONNECTED')return NextResponse.json({message:'WhatsApp desconectado. Aguarde a conexão antes de enviar.'},{status:409});
 try{const result=await ChatService.sendTextMessage(sessionId,jid,{text},mentions,quotedMessageId);return NextResponse.json({success:true,message:result.localMessage});}
 catch(error){console.error('Chat text send failed',error);return NextResponse.json({message:'Não foi possível confirmar o envio. Confira a conversa no WhatsApp antes de tentar novamente.'},{status:502});}
}
