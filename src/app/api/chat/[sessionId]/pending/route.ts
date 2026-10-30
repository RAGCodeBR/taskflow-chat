import {NextRequest,NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {getAuthenticatedUser,canAccessSession} from '@/lib/api-auth';
import {listPending} from '@/lib/follow-ups-server';
type Context={params:Promise<{sessionId:string}>};

// GET: messages marked "Ver depois" and conversation reminders of this account.
export async function GET(request:NextRequest,context:Context){
 const {sessionId}=await context.params;const user=await getAuthenticatedUser(request);
 if(!user)return NextResponse.json({message:'Entre novamente.'},{status:401});
 if(!await canAccessSession(user.id,user.role,sessionId))return NextResponse.json({message:'Sem acesso.'},{status:403});
 const session=await prisma.session.findUnique({where:{sessionId},select:{id:true}});if(!session)return NextResponse.json({message:'Conta não encontrada.'},{status:404});
 try{return NextResponse.json(await listPending(session.id),{headers:{'Cache-Control':'no-store'}});}
 catch(error){console.error('Pending list failed',error);return NextResponse.json({message:'Não foi possível carregar as pendências.'},{status:500});}
}
