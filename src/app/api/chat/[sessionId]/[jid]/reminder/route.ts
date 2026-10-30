import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {getAuthenticatedUser,canAccessSession} from '@/lib/api-auth';
import {conversationIdentity} from '@/lib/follow-ups-server';
import {reminderNote,REMINDER_MAX} from '@/lib/follow-ups';
type Context={params:Promise<{sessionId:string;jid:string}>};
async function access(request:NextRequest,context:Context){
 const {sessionId,jid}=await context.params;const user=await getAuthenticatedUser(request);
 if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
 if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso.'},{status:403});
 if(!/^[-\d]+@(s\.whatsapp\.net|c\.us|lid|g\.us)$/.test(jid))return NextResponse.json({message:'Conversa inválida.'},{status:400});
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});if(!session)return NextResponse.json({message:'Conta não encontrada.'},{status:404});
 const {canonical,aliases}=await conversationIdentity(session.id,jid);
 return {dbSessionId:session.id,canonical,aliases};
}
// PUT { note }: create or replace the reminder of this conversation (one per conversation).
export async function PUT(request:NextRequest,context:Context){
 const result=await access(request,context);if(result instanceof NextResponse)return result;
 const note=reminderNote((await request.json().catch(()=>null))?.note);
 if(!note)return NextResponse.json({message:`Escreva o lembrete com até ${REMINDER_MAX} caracteres.`},{status:400});
 // A reminder saved earlier under another identity of the same person is replaced, not duplicated.
 await prisma.$transaction([
  prisma.chatReminder.deleteMany({where:{sessionId:result.dbSessionId,chatJid:{in:result.aliases.filter(a=>a!==result.canonical)}}}),
  prisma.chatReminder.upsert({where:{sessionId_chatJid:{sessionId:result.dbSessionId,chatJid:result.canonical}},create:{sessionId:result.dbSessionId,chatJid:result.canonical,note},update:{note}}),
 ]);
 return NextResponse.json({success:true,chatJid:result.canonical,note});
}
// DELETE: the reminder is done.
export async function DELETE(request:NextRequest,context:Context){
 const result=await access(request,context);if(result instanceof NextResponse)return result;
 await prisma.chatReminder.deleteMany({where:{sessionId:result.dbSessionId,chatJid:{in:result.aliases}}});
 return NextResponse.json({success:true});
}
