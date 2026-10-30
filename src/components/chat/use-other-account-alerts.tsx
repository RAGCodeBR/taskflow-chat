"use client";
import {useEffect,useRef} from 'react';
import {toast} from 'sonner';
import {Bell,X} from 'lucide-react';
import {useSocket} from './socket-context';
import {otherAccountNotices,type AccountNotice} from '@/lib/account-notices';
export function useOtherAccountAlerts(activeSessionId:string){
 const {getSocket}=useSocket();const seen=useRef(new Set<string>());
 useEffect(()=>{
  const socket=getSocket();if(!socket)return;
  const ids=new Set<string|number>();
  const connect=()=>socket.emit('watch-account-alerts');
  const handler=(batch:AccountNotice[])=>{
   const notices=otherAccountNotices(batch,activeSessionId,seen.current);if(!notices.length)return;
   const notice=notices[notices.length-1];
   const id=`other-account:${notice.sessionId}`;ids.add(id);
   toast.custom(()=> <div role="status" className="flex w-[min(360px,calc(100vw-2rem))] items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-foreground shadow-md">
    <Bell className="h-4 w-4 shrink-0 text-muted-foreground"/>
    <div className="min-w-0 flex-1"><p className="truncate text-[11px] text-muted-foreground">{notice.accountName} · outra conta</p><p className="truncate text-xs">{notices.length>1?`${notices.length} novas mensagens`:'Nova mensagem'} de <strong>{notice.name}</strong></p></div>
    <button type="button" aria-label="Fechar aviso da outra conta" onClick={()=>toast.dismiss(id)} className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5"/></button>
   </div>,{id,duration:4500});
  };
  if(socket.connected)connect();socket.on('connect',connect);socket.on('account.notice',handler);
  return()=>{socket.emit('unwatch-account-alerts');socket.off('connect',connect);socket.off('account.notice',handler);ids.forEach(id=>toast.dismiss(id));};
 },[activeSessionId,getSocket]);
}
