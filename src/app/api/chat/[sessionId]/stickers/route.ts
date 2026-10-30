import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser,canAccessSession } from '@/lib/api-auth';
import { waManager } from '@/modules/whatsapp/manager';
import { ChatService } from '@/modules/whatsapp/chat.service';
import { readFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
async function access(request:NextRequest,sessionId:string){
 const user=await getAuthenticatedUser(request);if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
 if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso.'},{status:403});
 return await prisma.session.findUnique({where:{sessionId},select:{id:true}})||NextResponse.json({message:'Sessão não encontrada.'},{status:404});
}
function localFile(url:string){if(!/^\/api\/media\/[a-zA-Z0-9_.-]+$/.test(url))return null;return path.join(process.cwd(),'data','media',url.split('/').at(-1)!);}
export async function GET(request:NextRequest,{params}:{params:Promise<{sessionId:string}>}){
 const {sessionId}=await params;const session=await access(request,sessionId);if(session instanceof NextResponse)return session;
 const rows=await prisma.message.findMany({where:{sessionId:session.id,type:'STICKER',mediaUrl:{not:null}},orderBy:{timestamp:'desc'},take:1000,select:{id:true,mediaUrl:true}});
 const seen=new Set<string>();const stickers=[];
 for(const row of rows){const file=localFile(row.mediaUrl!);if(!file)continue;const bytes=await readFile(file).catch(()=>null);if(!bytes)continue;const hash=crypto.createHash('sha256').update(bytes).digest('hex');if(seen.has(hash))continue;seen.add(hash);stickers.push(row);}
 return NextResponse.json({stickers});
}
export async function POST(request:NextRequest,{params}:{params:Promise<{sessionId:string}>}){
 const {sessionId}=await params;const session=await access(request,sessionId);if(session instanceof NextResponse)return session;
 const body=await request.json().catch(()=>null);
 if(typeof body?.id!=='string'||typeof body?.jid!=='string'||!/^[-\d]+@(lid|s\.whatsapp\.net|g\.us)$/.test(body.jid))return NextResponse.json({message:'Figurinha ou conversa inválida.'},{status:400});
 const source=await prisma.message.findFirst({where:{id:body.id,sessionId:session.id,type:'STICKER'},select:{mediaUrl:true}});const file=source?.mediaUrl?localFile(source.mediaUrl):null;
 if(!file)return NextResponse.json({message:'Figurinha não encontrada.'},{status:404});
 const bytes=await readFile(file).catch(()=>null);if(!bytes)return NextResponse.json({message:'Arquivo indisponível.'},{status:404});
 const instance=waManager.getInstance(sessionId);if(!instance?.socket||instance.status!=='CONNECTED')return NextResponse.json({message:'WhatsApp desconectado.'},{status:409});
 try {const result=await ChatService.sendTextMessage(sessionId,body.jid,{sticker:bytes});return NextResponse.json({success:true,message:result.localMessage});}catch{return NextResponse.json({message:'Não foi possível confirmar o envio. Confira no WhatsApp.'},{status:502});}
}
