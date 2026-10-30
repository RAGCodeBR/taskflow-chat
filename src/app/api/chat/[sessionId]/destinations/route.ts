import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {getAuthenticatedUser,canAccessSession} from '@/lib/api-auth';
import {loadDestinations} from '@/lib/forward-destinations-server';
type Context={params:Promise<{sessionId:string}>};

// GET: conversations and saved contacts of this account, for forwarding or sharing a contact card.
export async function GET(request:NextRequest,context:Context){
 const {sessionId}=await context.params;const user=await getAuthenticatedUser(request);
 if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
 if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso.'},{status:403});
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});if(!session)return NextResponse.json({message:'Conta não encontrada.'},{status:404});
 try{return NextResponse.json(await loadDestinations(session.id),{headers:{'Cache-Control':'no-store'}});}
 catch(error){console.error('Destinations load failed',error);return NextResponse.json({message:'Não foi possível carregar as conversas.'},{status:500});}
}
