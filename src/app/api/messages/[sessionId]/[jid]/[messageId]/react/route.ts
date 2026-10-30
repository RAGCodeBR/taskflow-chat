import { NextResponse, NextRequest } from 'next/server';
import { waManager } from '@/modules/whatsapp/manager';
import { getAuthenticatedUser, canAccessSession } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { chatIdentities } from '@/lib/chat-identities';
import { mergeReaction } from '@/lib/reactions';
export async function POST(request: NextRequest,{params}:{params:Promise<{sessionId:string;jid:string;messageId:string}>}) {
    try {
        const user=await getAuthenticatedUser(request);
        if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
        const {sessionId,jid,messageId}=await params;
        if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso.'},{status:403});
        const body=await request.json().catch(()=>null);
        if(typeof body?.emoji!=='string'||body.emoji.length>32)return NextResponse.json({message:'Reação inválida.'},{status:400});
        const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});
        if(!session)return NextResponse.json({message:'Sessão não encontrada.'},{status:404});
        const target=await prisma.message.findUnique({where:{sessionId_keyId:{sessionId:session.id,keyId:messageId}}});
        const contacts=await prisma.contact.findMany({where:{sessionId:session.id},select:{jid:true,lid:true,remoteJidAlt:true}});
        if(!target||!chatIdentities(contacts).aliases(jid).includes(target.remoteJid))return NextResponse.json({message:'Mensagem não encontrada nesta conversa.'},{status:404});
        const instance=waManager.getInstance(sessionId);
        if(!instance?.socket||instance.status!=='CONNECTED')return NextResponse.json({message:'WhatsApp desconectado.'},{status:409});
        const rawSelf=instance.socket.user?.id;
        const self=rawSelf?.replace(/:\d+@/,'@');
        await instance.socket.sendMessage(target.remoteJid,{react:{text:body.emoji,key:{remoteJid:target.remoteJid,id:target.keyId,fromMe:target.fromMe,...(target.remoteJid.endsWith('@g.us')?{participant:target.fromMe?self:target.senderJid||undefined}:{})}}});
        const fresh=await prisma.message.findUniqueOrThrow({where:{id:target.id},select:{reactions:true}});
        const reactions=mergeReaction(fresh.reactions,'@me',body.emoji,true);
        await prisma.message.update({where:{id:target.id},data:{reactions:reactions as any}});
        return NextResponse.json({success:true,reactions});
    }catch(error){console.error('Reaction failed',error);return NextResponse.json({message:'Não foi possível confirmar a reação. Confira no WhatsApp.'},{status:502});}
}
