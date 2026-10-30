"use client";
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Send,Pause,Loader2} from 'lucide-react';
import type {ChatMessageUpdate} from '@/lib/chat-message-updates';
import {publishConfirmedChatMessage} from '@/lib/chat-message-updates';
type Recipient={jid:string;name:string;group:boolean};
type Log={id:string;message:string;status:string;total:number;sent:number;failed:number;confirmation:string;recipients:{id:string;jid:string;status:string;error:string|null}[]};
type Preview={sessionName:string;column:string;recipients:Recipient[];defaultMessage:string;log:Log|null};
export function ConsultoriaNotice({sessionId,onClose}:{sessionId:string;onClose:()=>void}){
 const [preview,setPreview]=useState<Preview|null>(null),[text,setText]=useState(''),[selected,setSelected]=useState<string[]>([]),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[running,setRunning]=useState(false),[error,setError]=useState('');
 const stop=useRef(false),mounted=useRef(true),logRef=useRef<Log|null>(null);
 const url=`/api/chat/${encodeURIComponent(sessionId)}/consultoria-notice`;
 const apply=(data:Preview)=>{setPreview(data);logRef.current=data.log;if(data.log){setText(data.log.message);setSelected(data.log.recipients.map(r=>r.jid))}else{setText(data.defaultMessage);setSelected(data.recipients.map(r=>r.jid))}};
 useEffect(()=>{mounted.current=true;const controller=new AbortController();fetch(url,{signal:controller.signal,cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.message);apply(data)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>{mounted.current=false;stop.current=true;controller.abort()}},[url]);
 async function post(body:object){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.message),{status:response.status});return data}
 async function save(){setBusy(true);setError('');try{apply(await post({action:'draft',message:text,jids:selected}));setConfirmed(false)}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.')}finally{setBusy(false)}}
 async function pause(){stop.current=true;setRunning(false);const log=logRef.current;if(log)try{const data=await post({action:'pause',id:log.id});if(mounted.current)apply(data)}catch{}}
 async function start(){
  const initial=preview?.log;if(!initial||!confirmed||running)return;
  stop.current=false;setRunning(true);setError('');
  try{
   while(!stop.current){
    let data:Preview & {message?:ChatMessageUpdate};
    try{data=await post({action:'next',id:initial.id,confirmation:initial.confirmation})}catch(e){if((e as {status?:number}).status===429){await new Promise(resolve=>setTimeout(resolve,1000));continue}throw e}
    if(data.message)publishConfirmedChatMessage(sessionId,data.message);
    if(mounted.current)apply(data);
    if(data.log?.status==='column-completed')break;
    await new Promise(resolve=>setTimeout(resolve,5100));
   }
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'A fila foi pausada.');await pause()}finally{if(mounted.current){setRunning(false);setConfirmed(false)}}
 }
 const log=preview?.log;const editable=!log||log.status==='column-draft';
 const dirty=!log||text!==log.message||JSON.stringify([...selected].sort())!==JSON.stringify(log.recipients.map(r=>r.jid).sort());
 const recipients=preview?.recipients||[],groups=recipients.filter(r=>selected.includes(r.jid)&&r.group).length;
 const close=()=>{if(running)void pause();onClose()};
 return <Dialog open onOpenChange={value=>{if(!value)close()}}><DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl"><DialogTitle>Aviso para a Consultoria</DialogTitle><DialogDescription>{preview?.sessionName||'Carregando a conta…'} · Somente conversas da coluna Consultoria. Fechar esta janela pausa os próximos envios.</DialogDescription>
 {error&&<p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm">{error}</p>}
 {!preview?<p className="py-8 text-center text-sm">Carregando destinatários…</p>:<>
 <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
 <label className="block text-sm font-medium">Mensagem<textarea aria-label="Mensagem do aviso" value={text} onChange={e=>{setText(e.target.value);setConfirmed(false)}} disabled={!editable||busy} rows={5} maxLength={4096} className="mt-2 w-full resize-y rounded-lg border bg-background p-3 text-sm font-normal"/></label>
 <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{selected.length} destinatários · {groups} grupos · {selected.length-groups} individuais</p>{editable&&<button type="button" disabled={busy} onClick={()=>{setSelected(selected.length===recipients.length?[]:recipients.map(r=>r.jid));setConfirmed(false)}} className="text-xs underline">{selected.length===recipients.length?'Desmarcar todos':'Selecionar todos'}</button>}</div>
 <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">
 {recipients.map(recipient=>{const result=log?.recipients.find(r=>r.jid===recipient.jid);return <label key={recipient.jid} className="flex items-center gap-3 px-3 py-2 text-sm"><input type="checkbox" disabled={!editable||busy} checked={selected.includes(recipient.jid)} onChange={e=>{setSelected(current=>e.target.checked?[...current,recipient.jid]:current.filter(jid=>jid!==recipient.jid));setConfirmed(false)}}/><span className="min-w-0 flex-1"><span className="block truncate">{recipient.name}</span><span className="text-xs text-muted-foreground">{recipient.group?'Grupo':recipient.jid.split('@')[0]}</span></span>{result&&result.status!=='pending'&&<span title={result.error||undefined} className="text-xs">{({sent:'Enviado',sending:'Confirmando…',uncertain:'Conferir no WhatsApp',excluded:'Fora da coluna'} as Record<string,string>)[result.status]||result.status}</span>}</label>})}
 </div>
 {log&&<p role="status" className="text-sm">{log.sent} enviados · {log.failed} sem confirmação · {log.recipients.filter(r=>r.status==='pending').length} pendentes{running?' · Enviando…':log.status==='column-completed'?' · Finalizado':''}</p>}
 <p className="text-xs text-muted-foreground">Há um intervalo de pelo menos 5 segundos entre os envios. Destinatários que saírem da coluna serão excluídos. Envios sem confirmação não serão repetidos automaticamente.</p>
 </div>
 <div className="shrink-0 space-y-3 border-t pt-3">
 {dirty&&editable?<button type="button" disabled={busy||!selected.length||!text.trim()} onClick={()=>void save()} className="rounded-lg border px-4 py-2 text-sm">{busy?'Salvando…':'Salvar e revisar aviso'}</button>:log?.status!=='column-completed'&&<>
 <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={running} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-1"/>Revisei o texto e autorizo o envio aos {selected.length} destinatários selecionados da Consultoria.</label>
 <div className="flex gap-2">{running?<button type="button" onClick={()=>void pause()} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"><Pause className="h-4 w-4"/>Pausar próximos envios</button>:<button type="button" disabled={!confirmed||busy||!selected.length||!!log?.recipients.some(r=>r.status==='sending')} onClick={()=>void start()} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4"/>{log?.sent?'Continuar envio confirmado':'Confirmar e enviar aviso'}</button>}{running&&<Loader2 className="h-5 w-5 animate-spin self-center"/>}</div>
 </>}
 </div></>}
 </DialogContent></Dialog>;
}
