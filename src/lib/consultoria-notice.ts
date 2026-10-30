import {matchesKanbanColumn,type KanbanColumnConfig} from './chat-stages';
export const CONSULTORIA_NOTICE_TEXT='Oi, pessoal! Amanhã estarei ausente por conta de uma endoscopia. Meu retorno à tarde vai depender de como me sentirei após a anestesia, então posso demorar para responder durante o dia. Assim que estiver bem, retomo as mensagens e os atendimentos. Obrigado pela compreensão!';
export function consultingRecipients<T extends {jid:string;aliases?:string[]}>(chats:T[],columns:KanbanColumnConfig[],assignments:{chatJid:string;labelId:string}[],stages:{chatJid:string;stage:string}[]){
 const column=columns.find(c=>c.name.trim().toLocaleLowerCase('pt-BR')==='consultoria');
 if(!column)return{column:null,recipients:[] as T[]};
 const seen=new Set<string>();
 const recipients=chats.filter(chat=>{
  if(!/^[-\d]+@(s\.whatsapp\.net|lid|g\.us)$/.test(chat.jid)||!matchesKanbanColumn(chat.jid,column.id,columns,assignments,stages))return false;
  const aliases=[chat.jid,...chat.aliases||[]];if(aliases.some(jid=>seen.has(jid)))return false;aliases.forEach(jid=>seen.add(jid));return true;
 });
 return{column,recipients};
}
export function noticeDay(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
