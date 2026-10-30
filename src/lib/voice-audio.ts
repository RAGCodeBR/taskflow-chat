import ffmpeg from 'ffmpeg-static';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
export async function voiceAudio(buffer:Buffer):Promise<Buffer>{
 if(!ffmpeg)throw new Error('Conversor de áudio indisponível.');
 const directory=await mkdtemp(path.join(tmpdir(),'taskflow-voice-'));
 try{
  const input=path.join(directory,'input'),output=path.join(directory,'voice.ogg');
  await writeFile(input,buffer,{mode:0o600});
  await promisify(execFile)(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-i',input,'-t','180','-vn','-map_metadata','-1','-avoid_negative_ts','make_zero','-ac','1','-ar','48000','-c:a','libopus','-b:a','32k','-application','voip','-f','ogg',output],{timeout:30000,maxBuffer:1024*1024});
  return await readFile(output);
 }finally{await rm(directory,{recursive:true,force:true})}
}

// Supply complete voice-note metadata instead of relying on optional codec decoders
// in Baileys. Both the waveform and duration come from the converted Ogg file.
export async function prepareVoiceMessage(input:Buffer){
 const audio=await voiceAudio(input);
 if(!ffmpeg)throw new Error('Conversor de áudio indisponível.');
 const directory=await mkdtemp(path.join(tmpdir(),'taskflow-voice-meta-'));
 try{
  const file=path.join(directory,'voice.ogg');await writeFile(file,audio,{mode:0o600});
  const {stdout:pcm}=await promisify(execFile)(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-i',file,'-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'],{timeout:30000,maxBuffer:4*1024*1024,encoding:'buffer'});
  const samples=Math.floor(pcm.length/2);
  if(samples===0)throw new Error('O áudio gravado está vazio.');
  const energies=Array.from({length:64},(_,i)=>{
   const start=Math.floor(i*samples/64),end=Math.floor((i+1)*samples/64);let sum=0;
   for(let j=start;j<end;j++)sum+=Math.abs(pcm.readInt16LE(j*2));
   return sum/Math.max(1,end-start);
  });
  const peak=Math.max(...energies,1);
  return {audio,mimetype:'audio/ogg; codecs=opus',ptt:true,seconds:Math.max(1,Math.ceil(samples/8000)),waveform:Uint8Array.from(energies,value=>Math.round(100*value/peak))};
 }finally{await rm(directory,{recursive:true,force:true})}
}
