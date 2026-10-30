"use client";
import {useEffect,useMemo,useState} from 'react';
import {Check,Search,Users} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {ChatAvatar} from './chat-avatar';
import {formatContactPhone} from '@/lib/contact-card';
import {matchesDestination,type Destination} from '@/lib/forward-destinations';
import {toast} from 'sonner';
const label=(d:Destination)=>d.name||d.notify||(d.phone?formatContactPhone(d.phone):d.jid.split('@')[0]);
const individual=(jid:string)=>/^\d+@(s\.whatsapp\.net|c\.us|lid)$/.test(jid);
// Searchable list of this account's conversations and saved contacts, used to forward a message or pick a contact to share.
export function ChatPickerDialog({sessionId,open,onOpenChange,title,description,confirmLabel,max=1,exclude,onlyContacts=false,onConfirm}:{sessionId:string;open:boolean;onOpenChange:(open:boolean)=>void;title:string;description:string;confirmLabel:(count:number)=>string;max?:number;exclude?:string;onlyContacts?:boolean;onConfirm:(jids:string[])=>Promise<boolean>}){
 const [data,setData]=useState<{chats:Destination[];contacts:Destination[]}>({chats:[],contacts:[]}),[loading,setLoading]=useState(false),[query,setQuery]=useState(''),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!open)return;setQuery('');setSelected([]);const controller=new AbortController();setLoading(true);fetch(`/api/chat/${encodeURIComponent(sessionId)}/destinations`,{signal:controller.signal}).then(r=>r.ok?r.json():Promise.reject()).then(d=>setData({chats:d.chats||[],contacts:d.contacts||[]})).catch(()=>{if(!controller.signal.aborted)toast.error('Não foi possível carregar as conversas')}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[open,sessionId]);
 const sections=useMemo(()=>{
  const keep=(d:Destination)=>d.jid!==exclude&&!d.jid.endsWith('@broadcast')&&!d.jid.endsWith('@newsletter')&&(!onlyContacts||individual(d.jid))&&matchesDestination(d,query);
  return [{title:'Conversas',items:data.chats.filter(keep).slice(0,150)},{title:'Outros contatos',items:data.contacts.filter(keep).slice(0,150)}].filter(s=>s.items.length);
 },[data,query,exclude,onlyContacts]);
 const toggle=(jid:string)=>setSelected(list=>list.includes(jid)?list.filter(j=>j!==jid):max===1?[jid]:list.length<max?[...list,jid]:(toast.info(`Escolha no máximo ${max} conversas.`),list));
 const confirm=async()=>{setBusy(true);try{if(await onConfirm(selected))onOpenChange(false)}finally{setBusy(false)}};
 return <Dialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value)}}><DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-md">
  <DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription>
  <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><input autoFocus aria-label="Buscar conversa ou contato" value={query} onChange={e=>setQuery(e.target.value)} placeholder={onlyContacts?'Buscar contato ou número…':'Buscar pessoa, grupo ou número…'} className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"/></div>
  <div role="listbox" aria-multiselectable={max>1} aria-label="Conversas e contatos" className="min-h-40 flex-1 overflow-y-auto rounded-lg border">
   {loading?<p className="p-4 text-sm text-muted-foreground">Carregando…</p>:!sections.length?<p className="p-4 text-sm text-muted-foreground">Nenhuma conversa ou contato encontrado.</p>:sections.map(section=><div key={section.title} role="group" aria-label={section.title}>
    <p className="sticky top-0 z-10 bg-background/95 px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{section.title}</p>
    {section.items.map(d=>{const on=selected.includes(d.jid);return <button key={d.jid} type="button" role="option" aria-selected={on} disabled={busy} onClick={()=>toggle(d.jid)} className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted ${on?'bg-primary/10':''}`}>
     <ChatAvatar sessionId={sessionId} jid={d.jid} name={label(d)} profilePic={d.profilePic??null}/>
     <span className="min-w-0 flex-1"><span className="block truncate">{label(d)}</span>{d.phone&&label(d)!==formatContactPhone(d.phone)&&<span className="block truncate text-xs text-muted-foreground">{formatContactPhone(d.phone)}</span>}</span>
     {d.jid.endsWith('@g.us')&&<Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Grupo"/>}
     <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${on?'border-primary bg-primary text-primary-foreground':''}`}>{on&&<Check className="h-3 w-3"/>}</span>
    </button>})}
   </div>)}
  </div>
  <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{max>1?`${selected.length} de até ${max}`:''}</span><button type="button" disabled={!selected.length||busy} onClick={confirm} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40">{busy?'Enviando…':confirmLabel(selected.length)}</button></div>
 </DialogContent></Dialog>;
}
