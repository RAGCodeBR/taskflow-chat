import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, canAccessSession } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getGroupPeople } from '@/lib/group-people';
export async function GET(request: NextRequest,{params}:{params:Promise<{sessionId:string;jid:string}>}) {
    const user=await getAuthenticatedUser(request);
    if(!user)return NextResponse.json({message:'Não autenticado'},{status:401});
    const {sessionId,jid}=await params;
    if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso'},{status:403});
    if(!jid.endsWith('@g.us'))return NextResponse.json({people:[]});
    const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});
    if(!session)return NextResponse.json({message:'Sessão não encontrada'},{status:404});
    try {return NextResponse.json({people:await getGroupPeople(session.id,jid)});}
    catch {return NextResponse.json({message:'Não foi possível carregar os participantes'},{status:500});}
}
