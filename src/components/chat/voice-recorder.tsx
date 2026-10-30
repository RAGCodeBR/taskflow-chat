"use client";
import {useEffect,useRef,useState} from 'react';
import {Mic,Square,Send,Trash2,Loader2,X} from 'lucide-react';
import {toast} from 'sonner';

export function VoiceRecorder({onSend}:{onSend:(file:File)=>Promise<boolean>}) {
 const [open,setOpen]=useState(false),[recording,setRecording]=useState(false),[seconds,setSeconds]=useState(0),[sending,setSending]=useState(false),[starting,setStarting]=useState(false),[level,setLevel]=useState(0),[error,setError]=useState('');
 const [clip,setClip]=useState<{file:File;url:string}|null>(null);
 const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),discard=useRef(false),mounted=useRef(true),startedAt=useRef(0),context=useRef<AudioContext|null>(null),analyser=useRef<AnalyserNode|null>(null);
 function release(){stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;void context.current?.close().catch(()=>{});context.current=null;analyser.current=null;}
 function stop(){if(recorder.current?.state==='recording')recorder.current.stop()}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;discard.current=true;stop();release()}},[]);
 useEffect(()=>()=>{if(clip)URL.revokeObjectURL(clip.url)},[clip]);
 useEffect(()=>{
  if(!recording)return;
  const values=new Uint8Array(256);
  const timer=setInterval(()=>{
   const elapsed=Math.floor((Date.now()-startedAt.current)/1000);setSeconds(elapsed);
   if(analyser.current){analyser.current.getByteTimeDomainData(values);let energy=0;for(const value of values)energy+=(value-128)**2;setLevel(Math.min(100,Math.round(Math.sqrt(energy/values.length)*6)))}
   if(elapsed>=180)stop();
  },100);
  return()=>clearInterval(timer);
 },[recording]);
 function cancel(){discard.current=true;stop();release();setRecording(false);setClip(null);setSeconds(0);setLevel(0);setError('')}
 async function start(){
  if(starting||recording)return;
  setError('');setOpen(true);
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('Este navegador não permite gravar áudio aqui. Abra o Taskfloww no Chrome com HTTPS.');return}
  setStarting(true);discard.current=false;
  try{
   const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
   if(!mounted.current||discard.current){media.getTracks().forEach(track=>track.stop());return}
   stream.current=media;
   const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
   const active=new MediaRecorder(media,mime?{mimeType:mime}:undefined);recorder.current=active;
   const chunks:BlobPart[]=[];
   active.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
   active.onstop=()=>{
    release();if(!mounted.current||discard.current)return;
    setRecording(false);setLevel(0);
    const blob=new Blob(chunks,{type:active.mimeType});
    if(!blob.size){setError('Nenhum áudio foi capturado. Tente gravar novamente.');return}
    const file=new File([blob],'mensagem-de-voz.'+(blob.type.includes('mp4')?'m4a':blob.type.includes('ogg')?'ogg':'webm'),{type:blob.type});
    setClip({file,url:URL.createObjectURL(blob)});
   };
   active.onerror=()=>{cancel();setError('A gravação foi interrompida. Tente novamente.')};
   // The meter is optional: a suspended/unavailable AudioContext must not prevent recording.
   try{const audio=new AudioContext();context.current=audio;const meter=audio.createAnalyser();meter.fftSize=256;audio.createMediaStreamSource(media).connect(meter);analyser.current=meter;void audio.resume().catch(()=>{})}catch{}
   setClip(null);setSeconds(0);startedAt.current=Date.now();active.start(250);setRecording(true);
  }catch(cause){
   release();
   if(!mounted.current||discard.current)return;
   const name=cause instanceof DOMException?cause.name:'';
   setError(name==='NotFoundError'?'Nenhum microfone foi encontrado. Conecte ou selecione um microfone no Chrome.':name==='NotReadableError'?'O Chrome não conseguiu abrir o microfone. Confira a permissão do Chrome nos Ajustes do Mac e se outro aplicativo está usando o dispositivo.':name==='NotAllowedError'?'O acesso ao microfone foi negado. Confira a permissão do site e a permissão do Chrome nos Ajustes do Mac.':`Não foi possível iniciar a gravação${name?' ('+name+')':''}. Tente novamente.`);
  }finally{if(mounted.current)setStarting(false)}
 }
 return <div className="relative shrink-0"><button type="button" aria-label="Gravar áudio" aria-expanded={open} title="Gravar áudio" onClick={()=>{if(sending)return;if(open){cancel();setOpen(false)}else setOpen(true)}} className="rounded-full p-2 text-muted-foreground hover:bg-muted"><Mic className="h-5 w-5"/></button>
 {open&&<section aria-label="Gravador de mensagem de voz" className="absolute bottom-full left-0 z-50 mb-3 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl space-y-3">
  <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">Mensagem de voz</p><button type="button" disabled={sending} aria-label="Fechar gravador" onClick={()=>{cancel();setOpen(false)}} className="rounded p-1 hover:bg-muted"><X className="h-4 w-4"/></button></div>
  <p className="text-xs text-muted-foreground">Grave até 3 minutos. Depois, pare para ouvir antes de enviar.</p>
  {error&&<p role="alert" className="rounded-lg bg-destructive/10 p-2 text-xs">{error}</p>}
  {!recording&&!clip&&<button type="button" disabled={starting} onClick={()=>void start()} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{starting?<Loader2 className="h-4 w-4 animate-spin"/>:<Mic className="h-4 w-4"/>}{starting?'Abrindo microfone…':'Começar gravação'}</button>}
  {recording&&<><div className="flex items-center justify-between gap-2"><span role="status" className="text-sm font-medium text-red-600">● Gravando {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span><button type="button" onClick={stop} className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"><Square className="h-4 w-4"/>Parar</button></div><div role="meter" aria-label="Volume do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-100" style={{width:`${level}%`}}/></div><p className="text-[11px] text-muted-foreground">Fale para ver o indicador de volume se mover.</p></>}
  {clip&&<><p className="text-xs text-muted-foreground">Gravação pronta. Ouça abaixo antes de enviar.</p><audio controls src={clip.url} className="w-full"/><button type="button" disabled={sending} onClick={async()=>{setSending(true);try{if(await onSend(clip.file)){setClip(null);setOpen(false)}}catch{toast.error('Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente.')}finally{setSending(false)}}} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{sending?<Loader2 className="h-4 w-4 animate-spin"/>:<Send className="h-4 w-4"/>}{sending?'Enviando…':'Enviar áudio'}</button></>}
  {(recording||clip)&&<button type="button" disabled={sending} onClick={cancel} className="flex items-center gap-1 text-xs text-muted-foreground"><Trash2 className="h-3 w-3"/>Descartar gravação</button>}
 </section>}</div>;
}
