import {NextRequest,NextResponse} from 'next/server';
import {readFile} from 'fs/promises';
import path from 'path';
import {prisma} from '@/lib/prisma';
import {getAuthenticatedUser,canAccessSession} from '@/lib/api-auth';
import {chatIdentities} from '@/lib/chat-identities';
import {forwardMediaFile,forwardPayload,validForwardTargets,MAX_FORWARD_TARGETS} from '@/lib/forward-message';
import {ChatService} from '@/modules/whatsapp/chat.service';
import {loadDestinations} from '@/lib/forward-destinations-server';
import {waManager} from '@/modules/whatsapp/manager';
type Context={params:Promise<{sessionId:string;jid:string}>};
const MEDIA_DIR=path.join(process.cwd(),'data','media');

// POST { keyId, toJids }: sends a copy of one message of this conversation, marked as forwarded.
export async function POST(request:NextRequest,context:Context){
 const {sessionId,jid}=await context.params;const user=await getAuthenticatedUser(request);
 if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
 if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso.'},{status:403});
 const body=await request.json().catch(()=>null);
 const toJids=validForwardTargets(body?.toJids,jid);
 if(typeof body?.keyId!=='string'||!toJids)return NextResponse.json({message:`Escolha de 1 a ${MAX_FORWARD_TARGETS} conversas de destino.`},{status:400});
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});if(!session)return NextResponse.json({message:'Conta não encontrada.'},{status:404});
 const contacts=await prisma.contact.findMany({where:{sessionId:session.id},select:{jid:true,lid:true,remoteJidAlt:true}});
 const original=await prisma.message.findFirst({where:{sessionId:session.id,keyId:body.keyId,remoteJid:{in:chatIdentities(contacts).aliases(jid)}},select:{type:true,content:true,mediaUrl:true}});
 if(!original)return NextResponse.json({message:'A mensagem não pertence a esta conversa.'},{status:404});
 const file=forwardMediaFile(original.mediaUrl,sessionId);
 const buffer=file?await readFile(path.join(MEDIA_DIR,file.fileName)).catch(()=>null):null;
 const payload=forwardPayload(original,file&&buffer?{buffer,ext:file.ext}:null);
 if(!payload)return NextResponse.json({message:original.mediaUrl||original.type==='TEXT'?'O conteúdo desta mensagem não está disponível para encaminhar.':'Este tipo de mensagem ainda não pode ser encaminhado.'},{status:422});
 const destinations=await loadDestinations(session.id);
 if(!toJids.every(to=>[...destinations.chats,...destinations.contacts].some(d=>d.jid===to)))return NextResponse.json({message:'Destino não encontrado nesta conta.'},{status:400});
 const instance=waManager.getInstance(sessionId);if(!instance?.socket||instance.status!=='CONNECTED')return NextResponse.json({message:'WhatsApp desconectado.'},{status:409});
 // Sequential, so a failure reports exactly which destinations already received it.
 const messages=[],sent:string[]=[];
 for(const to of toJids){
  try{const result=await ChatService.sendTextMessage(sessionId,to,payload);sent.push(to);if(result.localMessage)messages.push(result.localMessage);}
  catch(error){console.error('Forward failed',error);return NextResponse.json({message:sent.length?`Encaminhada para ${sent.length} de ${toJids.length} conversas. Confira as demais antes de repetir.`:'Não foi possível confirmar o envio. Confira o destino no WhatsApp antes de repetir.',sent,messages},{status:502});}
 }
 return NextResponse.json({success:true,sent,messages});
}
