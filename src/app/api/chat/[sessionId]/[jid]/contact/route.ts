import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {getAuthenticatedUser,canAccessSession} from '@/lib/api-auth';
import {chatIdentities} from '@/lib/chat-identities';
import {phoneFromJid,formatContactPhone,contactVCard} from '@/lib/contact-card';
import {ChatService} from '@/modules/whatsapp/chat.service';
import {waManager} from '@/modules/whatsapp/manager';
import {isDestination} from '@/lib/forward-destinations-server';
type Context={params:Promise<{sessionId:string;jid:string}>};
async function access(request:NextRequest,context:Context){
 const {sessionId,jid}=await context.params;const user=await getAuthenticatedUser(request);
 if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
 if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso.'},{status:403});
 if(!/^\d+@(s\.whatsapp\.net|c\.us|lid)$/.test(jid))return NextResponse.json({message:'Selecione um contato individual.'},{status:400});
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});if(!session)return NextResponse.json({message:'Conta não encontrada.'},{status:404});
 const contacts=await prisma.contact.findMany({where:{sessionId:session.id},select:{jid:true,lid:true,remoteJidAlt:true,name:true,notify:true,customName:true}});
 const identities=chatIdentities(contacts);const canonical=identities.canonical(jid);const aliases=identities.aliases(jid);
 const matches=contacts.filter(c=>identities.canonical(c.jid)===canonical);
 if(!matches.length&&!await prisma.message.findFirst({where:{sessionId:session.id,remoteJid:{in:aliases}},select:{id:true}}))return NextResponse.json({message:'Contato não encontrado nesta conta.'},{status:404});
 const customName=matches.find(c=>c.customName)?.customName || null;
 const name=customName || matches.find(c=>c.name)?.name || matches.find(c=>c.notify)?.notify || canonical.split('@')[0];
 const phone=aliases.map(phoneFromJid).find(Boolean) || null;
 return {sessionId,dbSessionId:session.id,canonical,aliases,contact:{jid:canonical,name,customName,phone,phoneFormatted:phone?formatContactPhone(phone):null}};
}
export async function GET(request:NextRequest,context:Context){const result=await access(request,context);return result instanceof NextResponse?result:NextResponse.json(result.contact);}
export async function PATCH(request:NextRequest,context:Context){
 const result=await access(request,context);if(result instanceof NextResponse)return result;
 const body=await request.json().catch(()=>null);if(typeof body?.name!=='string'||body.name.trim().length>80)return NextResponse.json({message:'Use um nome de até 80 caracteres.'},{status:400});
 const customName=body.name.trim()||null;
 await prisma.$transaction([prisma.contact.updateMany({where:{sessionId:result.dbSessionId,jid:{in:result.aliases}},data:{customName:null}}),prisma.contact.upsert({where:{sessionId_jid:{sessionId:result.dbSessionId,jid:result.canonical}},create:{sessionId:result.dbSessionId,jid:result.canonical,customName},update:{customName}})]);
 const updated=await access(request,context);return updated instanceof NextResponse?updated:NextResponse.json(updated.contact);
}
export async function POST(request:NextRequest,context:Context){
 const result=await access(request,context);if(result instanceof NextResponse)return result;
 const body=await request.json().catch(()=>null);
 if(!result.contact.phone)return NextResponse.json({message:'O número deste contato ainda não foi sincronizado.'},{status:409});
 if(typeof body?.toJid!=='string')return NextResponse.json({message:'Escolha a conversa de destino.'},{status:400});
 if(!await isDestination(result.dbSessionId,body.toJid))return NextResponse.json({message:'Destino não encontrado nesta conta.'},{status:400});
 const instance=waManager.getInstance(result.sessionId);if(!instance?.socket||instance.status!=='CONNECTED')return NextResponse.json({message:'WhatsApp desconectado.'},{status:409});
 try {const sent=await ChatService.sendTextMessage(result.sessionId,body.toJid,{contacts:{displayName:result.contact.name,contacts:[{vcard:contactVCard(result.contact.name,result.contact.phone)}]}});return NextResponse.json({success:true,message:sent.localMessage});}
 catch{return NextResponse.json({message:'Não foi possível confirmar o envio. Confira o destino no WhatsApp antes de repetir.'},{status:502});}
}
