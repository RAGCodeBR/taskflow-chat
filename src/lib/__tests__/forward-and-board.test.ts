import {test} from 'node:test';
import assert from 'node:assert/strict';
import {forwardMediaFile,forwardPayload,validForwardTargets,FORWARDED_CONTEXT} from '../forward-message';
import {edgeScrollSpeed} from '../board-autoscroll';

test('board scrolls only near the edges, faster closer to them',()=>{
 assert.equal(edgeScrollSpeed(500,0,1000),0);
 assert.ok(edgeScrollSpeed(990,0,1000)>edgeScrollSpeed(920,0,1000));
 assert.ok(edgeScrollSpeed(920,0,1000)>0);
 assert.ok(edgeScrollSpeed(10,0,1000)<0);
 assert.equal(edgeScrollSpeed(2000,0,1000),28);
 assert.equal(edgeScrollSpeed(-50,0,1000),-28);
 assert.equal(edgeScrollSpeed(5,0,0),0);
});

test('forwarded media must be a file of this account',()=>{
 assert.deepEqual(forwardMediaFile('/api/media/marketing-1-ABC123.jpg','marketing-1'),{fileName:'marketing-1-ABC123.jpg',ext:'jpg'});
 assert.equal(forwardMediaFile('/api/media/outra-ABC.jpg','marketing-1'),null);
 assert.equal(forwardMediaFile('/api/media/../marketing-1-x.jpg','marketing-1'),null);
 assert.equal(forwardMediaFile('https://evil/marketing-1-x.jpg','marketing-1'),null);
 assert.equal(forwardMediaFile(null,'marketing-1'),null);
});

test('payload keeps content and marks it as forwarded',()=>{
 const buffer=Buffer.from('x');
 assert.deepEqual(forwardPayload({type:'TEXT',content:' oi '},null),{text:'oi',contextInfo:FORWARDED_CONTEXT});
 assert.equal(forwardPayload({type:'TEXT',content:''},null),null);
 assert.deepEqual(forwardPayload({type:'IMAGE',content:'foto'},{buffer,ext:'jpg'}),{image:buffer,mimetype:'image/jpeg',caption:'foto',contextInfo:FORWARDED_CONTEXT});
 assert.equal((forwardPayload({type:'AUDIO',content:null},{buffer,ext:'ogg'}) as any).ptt,true);
 assert.equal((forwardPayload({type:'AUDIO',content:null},{buffer,ext:'mp3'}) as any).ptt,false);
 assert.equal((forwardPayload({type:'DOCUMENT',content:'contrato.pdf'},{buffer,ext:'pdf'}) as any).fileName,'contrato.pdf');
 assert.equal(forwardPayload({type:'IMAGE',content:'foto'},null),null);
 assert.equal(forwardPayload({type:'LOCATION',content:'x'},{buffer,ext:'bin'}),null);
});

test('targets: unique, not the source, 1 to 5',()=>{
 assert.deepEqual(validForwardTargets(['a','a','b','src'],'src'),['a','b']);
 assert.equal(validForwardTargets([],'src'),null);
 assert.equal(validForwardTargets(['src'],'src'),null);
 assert.equal(validForwardTargets(['1','2','3','4','5','6'],'src'),null);
 assert.equal(validForwardTargets('a','src'),null);
});

import {contactDestinations,matchesDestination} from '../forward-destinations';
const contact=(o:any)=>({lid:null,remoteJidAlt:null,name:null,notify:null,customName:null,...o});
test('contacts without a conversation become destinations, one per person',()=>{
 const list=contactDestinations([
  contact({jid:'5513991034609@s.whatsapp.net',lid:'249@lid',name:'Eu dos Santos',customName:'Reinan Pessoal'}),
  contact({jid:'249@lid',notify:'Reinan'}),
  contact({jid:'5511@s.whatsapp.net',name:'Já conversa'}),
  contact({jid:'1@g.us',name:'Grupo'}),
  contact({jid:'777@lid'}),
 ],['5511@s.whatsapp.net']);
 assert.deepEqual(list.map(d=>[d.jid,d.name,d.phone]),[['5513991034609@s.whatsapp.net','Reinan Pessoal','5513991034609']]);
});
test('search ignores accents and case, and finds by phone digits',()=>{
 const d={jid:'5513991034609@s.whatsapp.net',name:'Reinan Pessoal',notify:'Reinan',phone:'5513991034609'};
 assert.ok(matchesDestination(d,'reinan pessoal'));
 assert.ok(matchesDestination({...d,name:'João'},'joao'));
 assert.ok(matchesDestination(d,'99103'));
 assert.ok(matchesDestination(d,'(13) 99103-4609'.replace(/\D/g,'').slice(2)));
 assert.ok(!matchesDestination(d,'maria'));
});
