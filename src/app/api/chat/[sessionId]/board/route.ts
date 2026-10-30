import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { chatIdentities } from "@/lib/chat-identities";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { CHAT_STAGES, resolveKanbanColumns } from "@/lib/chat-stages";
import { z } from "zod";

type Context = { params: Promise<{ sessionId: string }> };
async function authorizedSession(request: NextRequest, context: Context) {
    const { sessionId } = await context.params;
    const user = await getAuthenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Não autenticado" }, { status: 401 });
    if (!await canAccessSession(user.id, user.role, sessionId)) {
        return NextResponse.json({ message: "Sem acesso à sessão" }, { status: 403 });
    }
    const session = await prisma.session.findUnique({ where: { sessionId }, select: { id: true, sessionId: true } });
    return session || NextResponse.json({ message: "Sessão não encontrada" }, { status: 404 });
}

export async function GET(request: NextRequest, context: Context) {
    try {
        const session = await authorizedSession(request, context);
        if (session instanceof NextResponse) return session;
        const [chats, labels, assignments, stages, savedColumns, contacts] = await Promise.all([
            ChatService.getChatsList(session.id, null, undefined, undefined, "all", undefined, true),
            prisma.label.findMany({ where: { sessionId: session.sessionId }, select: { id: true, name: true, colorHex: true }, orderBy: { name: "asc" } }),
            prisma.chatLabel.findMany({ where: { label: { sessionId: session.sessionId } }, select: { chatJid: true, labelId: true } }),
            prisma.chatStage.findMany({ where: { sessionId: session.id }, select: { chatJid: true, stage: true }, orderBy: { updatedAt: "desc" } }),
            prisma.kanbanColumn.findMany({ where: { sessionId: session.id } }),
            prisma.contact.findMany({ where: { sessionId: session.id }, select: { jid: true, lid: true, remoteJidAlt: true } }),
        ]);
        const identities = chatIdentities(contacts);
        assignments.forEach(a => { a.chatJid = identities.canonical(a.chatJid); });
        const canonicalStages = [...new Map([...stages].reverse().map(s => [identities.canonical(s.chatJid), { ...s, chatJid: identities.canonical(s.chatJid) }])).values()];
        const columns = resolveKanbanColumns(savedColumns, labels).map(c => ({...c, cardOrder: c.cardOrder?.map(jid => identities.canonical(jid)), pinnedJids: c.pinnedJids?.map(jid => identities.canonical(jid))}));
        return NextResponse.json({ chats, labels, assignments, stages: canonicalStages, columns }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("Chat board load failed", error);
        return NextResponse.json({ message: "Não foi possível carregar as conversas" }, { status: 500 });
    }
}

const moveSchema = z.object({ jid: z.string().min(1).max(150), stage: z.string().min(1).max(100) });
export async function PUT(request: NextRequest, context: Context) {
    try {
        const session = await authorizedSession(request, context);
        if (session instanceof NextResponse) return session;
        const body = moveSchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return NextResponse.json({ message: "Conversa ou etapa inválida" }, { status: 400 });
        const { jid, stage } = body.data;
        if (!CHAT_STAGES.some(s => s.id === stage) && !await prisma.kanbanColumn.findUnique({where:{sessionId_stage:{sessionId:session.id,stage}}})) return NextResponse.json({message:'Coluna não encontrada'},{status:400});
        const contacts = await prisma.contact.findMany({ where: { sessionId: session.id }, select: { jid: true, lid: true, remoteJidAlt: true } });
        const exists = await prisma.message.findFirst({ where: { sessionId: session.id, remoteJid: { in: chatIdentities(contacts).aliases(jid) } }, select: { id: true } });
        if (!exists) return NextResponse.json({ message: "Conversa não encontrada nesta sessão" }, { status: 404 });
        await prisma.chatStage.upsert({
            where: { sessionId_chatJid: { sessionId: session.id, chatJid: jid } },
            create: { sessionId: session.id, chatJid: jid, stage }, update: { stage },
        });
        return NextResponse.json({ jid, stage });
    } catch (error) {
        console.error("Chat board move failed", error);
        return NextResponse.json({ message: "Não foi possível salvar a etapa" }, { status: 500 });
    }
}

const columnSchema = z.object({
    stage: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(60),
    labelIds: z.array(z.string().min(1).max(100)).max(50),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export async function PATCH(request: NextRequest, context: Context) {
    try {
        const session = await authorizedSession(request, context);
        if (session instanceof NextResponse) return session;
        const parsed = columnSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ message: "Informe um nome de até 60 caracteres e etiquetas válidas" }, { status: 400 });
        const { stage, name } = parsed.data;
        if (!CHAT_STAGES.some(s => s.id === stage) && !await prisma.kanbanColumn.findUnique({where:{sessionId_stage:{sessionId:session.id,stage}}})) return NextResponse.json({message:'Coluna não encontrada'},{status:400});
        const labelIds = [...new Set(parsed.data.labelIds)];
        const labels = await prisma.label.findMany({ where: { sessionId: session.sessionId, id: { in: labelIds } }, select: { id: true } });
        if (labels.length !== labelIds.length) return NextResponse.json({ message: "Uma das etiquetas não pertence a esta sessão. Atualize o quadro." }, { status: 400 });
        const saved = await prisma.kanbanColumn.upsert({
            where: { sessionId_stage: { sessionId: session.id, stage } },
            create: { sessionId: session.id, stage, name, labelIds, color: parsed.data.color || CHAT_STAGES.find(s => s.id === stage)?.color || "#8b5cf6" }, update: { name, labelIds, ...(parsed.data.color ? { color: parsed.data.color } : {}) },
        });
        return NextResponse.json({ column: { id: stage, color: saved.color, name, labelIds, pinnedJids: saved.pinnedJids || [], cardOrder: saved.cardOrder || [], orderedAt: saved.orderedAt?.toISOString() || null } });
    } catch (error) {
        console.error("Kanban column save failed", error);
        return NextResponse.json({ message: "Não foi possível salvar a coluna" }, { status: 500 });
    }
}

const orderSchema = z.object({
    stage: z.string().min(1).max(100),
    order: z.array(z.string().min(1).max(150)).min(1).max(5000).refine(items => new Set(items).size === items.length),
});
export async function POST(request: NextRequest, context: Context) {
    try {
        const session = await authorizedSession(request, context);
        if (session instanceof NextResponse) return session;
        const body = await request.json().catch(() => null);
        if (body?.action === 'reorderPins') {
            // The order of pinnedJids is the order pinned conversations show in the column.
            const parsed = z.object({stage:z.string().min(1).max(100),order:z.array(z.string().min(1).max(150)).max(500)}).safeParse(body);
            if (!parsed.success) return NextResponse.json({message:'Ordem inválida.'},{status:400});
            const {stage,order} = parsed.data;
            const contacts = await prisma.contact.findMany({where:{sessionId:session.id},select:{jid:true,lid:true,remoteJidAlt:true}});
            const identities = chatIdentities(contacts);
            const saved = await prisma.$transaction(async tx => {
                const row = await tx.kanbanColumn.findUnique({where:{sessionId_stage:{sessionId:session.id,stage}}});
                if (!row) return null;
                await tx.$queryRaw`SELECT "id" FROM "KanbanColumn" WHERE "id" = ${row.id} FOR UPDATE`;
                const latest = await tx.kanbanColumn.findUniqueOrThrow({where:{id:row.id}});
                const current = (Array.isArray(latest.pinnedJids) ? latest.pinnedJids : []).filter((id): id is string=>typeof id==='string').map(id=>identities.canonical(id));
                // Only conversations that are already pinned can be reordered; pins missing from the request keep their place at the end.
                const ordered = [...new Set(order.map(id=>identities.canonical(id)))].filter(id=>current.includes(id));
                const next = [...ordered, ...current.filter(id=>!ordered.includes(id))];
                return tx.kanbanColumn.update({where:{id:row.id},data:{pinnedJids:next}});
            });
            if (!saved) return NextResponse.json({message:'Coluna não encontrada.'},{status:404});
            return NextResponse.json({column:{id:stage,name:saved.name,color:saved.color,labelIds:saved.labelIds,pinnedJids:saved.pinnedJids,cardOrder:saved.cardOrder||[],orderedAt:saved.orderedAt?.toISOString()||null}});
        }
        if (body?.action === 'pinCard') {
            const parsed = z.object({stage:z.string().min(1).max(100),jid:z.string().min(1).max(150),pinned:z.boolean()}).safeParse(body);
            if (!parsed.success) return NextResponse.json({message:'Conversa ou coluna inválida.'},{status:400});
            const {stage,jid,pinned} = parsed.data;
            const chats = await ChatService.getChatsList(session.id,null,undefined,undefined,'all');
            if (!chats.some(chat=>chat.jid===jid)) return NextResponse.json({message:'Conversa não encontrada nesta conta.'},{status:400});
            const existing = await prisma.kanbanColumn.findUnique({where:{sessionId_stage:{sessionId:session.id,stage}}});
            const defaults = CHAT_STAGES.find(s=>s.id===stage) || (existing ? {name:existing.name,color:existing.color} : null);
            if (!defaults) return NextResponse.json({message:'Coluna não encontrada.'},{status:400});
            const saved = await prisma.$transaction(async tx => {
                const row = await tx.kanbanColumn.upsert({where:{sessionId_stage:{sessionId:session.id,stage}},create:{sessionId:session.id,stage,name:defaults.name,color:defaults.color,labelIds:[]},update:{}});
                await tx.$queryRaw`SELECT "id" FROM "KanbanColumn" WHERE "id" = ${row.id} FOR UPDATE`;
                const latest = await tx.kanbanColumn.findUniqueOrThrow({where:{id:row.id}});
                const pins = new Set(Array.isArray(latest.pinnedJids) ? latest.pinnedJids.filter((id): id is string=>typeof id==='string') : []);
                if(pinned) pins.add(jid); else pins.delete(jid);
                return tx.kanbanColumn.update({where:{id:row.id},data:{pinnedJids:[...pins]}});
            });
            return NextResponse.json({column:{id:stage,name:saved.name,color:saved.color,labelIds:saved.labelIds,pinnedJids:saved.pinnedJids,cardOrder:saved.cardOrder||[],orderedAt:saved.orderedAt?.toISOString()||null}});
        }
        if (body?.action === 'createColumn') {
            const name = typeof body.name === 'string' ? body.name.trim() : '';
            if (!name || name.length > 60) return NextResponse.json({message:'Informe um nome de até 60 caracteres.'},{status:400});
            const count = await prisma.kanbanColumn.count({where:{sessionId:session.id}});
            if (count >= 50) return NextResponse.json({message:'Limite de 50 colunas por sessão.'},{status:400});
            const last = await prisma.kanbanColumn.aggregate({where:{sessionId:session.id},_max:{position:true}});
            const saved = await prisma.kanbanColumn.create({data:{sessionId:session.id,stage:'column-'+crypto.randomUUID(),name,labelIds:[],position:Math.max(4,(last._max.position || 3)+1)}});
            return NextResponse.json({column:{id:saved.stage,name:saved.name,color:saved.color,labelIds:[],cardOrder:[],orderedAt:null}});
        }
        if (body?.action === 'reorderColumns') {
            const saved = await prisma.kanbanColumn.findMany({where:{sessionId:session.id}});
            const columns = resolveKanbanColumns(saved,[]);
            const order = body.order;
            if (!Array.isArray(order) || order.length !== columns.length || new Set(order).size !== order.length || order.some(id => !columns.some(c => c.id === id))) return NextResponse.json({message:'Ordem de colunas inválida.'},{status:400});
            await prisma.$transaction(order.map((id:string,index:number) => {
                const column = columns.find(c => c.id === id)!;
                return prisma.kanbanColumn.upsert({where:{sessionId_stage:{sessionId:session.id,stage:id}},create:{sessionId:session.id,stage:id,name:column.name,color:column.color,labelIds:[],position:index},update:{position:index}});
            }));
            return NextResponse.json({success:true});
        }
        const parsed = orderSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ message: "Ordem de cartões inválida" }, { status: 400 });
        const { stage, order } = parsed.data;
        const chats = await ChatService.getChatsList(session.id, null, undefined, undefined, "all");
        const allowed = new Set(chats.map(c => c.jid));
        if (order.some(jid => !allowed.has(jid))) return NextResponse.json({ message: "Conversa não encontrada nesta sessão" }, { status: 400 });
        const existing = await prisma.kanbanColumn.findUnique({where:{sessionId_stage:{sessionId:session.id,stage}}});
        const defaults = CHAT_STAGES.find(s => s.id === stage) || (existing ? {id:stage,name:existing.name,color:existing.color} : null);
        if (!defaults) return NextResponse.json({message:'Coluna não encontrada.'},{status:400});
        const saved = await prisma.kanbanColumn.upsert({
            where: { sessionId_stage: { sessionId: session.id, stage } },
            create: { sessionId: session.id, stage, name: defaults.name, color: defaults.color, labelIds: [], cardOrder: order, orderedAt: new Date() },
            update: { cardOrder: order, orderedAt: new Date() },
        });
        return NextResponse.json({ column: { ...defaults, color: saved.color, name: saved.name, labelIds: saved.labelIds, pinnedJids: saved.pinnedJids || [], cardOrder: saved.cardOrder, orderedAt: saved.orderedAt?.toISOString() } });
    } catch (error) {
        console.error("Kanban card order failed", error);
        return NextResponse.json({ message: "Não foi possível salvar a ordem" }, { status: 500 });
    }
}
