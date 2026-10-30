import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {getAuthenticatedUser,canAccessSession} from '@/lib/api-auth';
import {conversationIdentity} from '@/lib/follow-ups-server';
type Context={params:Promise<{sessionId:string;jid:string;messageId:string}>};

// POST { later: boolean }: mark a message of this conversation to see later, or mark it as seen.
// Kept only in this system; nothing is sent to WhatsApp.
export async function POST(request:NextRequest,context:Context){
 const {sessionId,jid,messageId}=await context.params;const user=await getAuthenticatedUser(request);
 if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
 if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso.'},{status:403});
 const body=await request.json().catch(()=>null);const later=body?.later!==false;
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});if(!session)return NextResponse.json({message:'Conta não encontrada.'},{status:404});
 const target=await prisma.message.findUnique({where:{sessionId_keyId:{sessionId:session.id,keyId:messageId}},select:{keyId:true,remoteJid:true}});
 if(!target||!(await conversationIdentity(session.id,jid)).aliases.includes(target.remoteJid))return NextResponse.json({message:'Mensagem não encontrada nesta conversa.'},{status:404});
 if(later)await prisma.followUpMessage.upsert({where:{sessionId_keyId:{sessionId:session.id,keyId:target.keyId}},create:{sessionId:session.id,remoteJid:target.remoteJid,keyId:target.keyId},update:{}});
 else await prisma.followUpMessage.deleteMany({where:{sessionId:session.id,keyId:target.keyId}});
 return NextResponse.json({success:true,later});
}
