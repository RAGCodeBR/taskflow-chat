import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pinKeyFor,parsePinEvent,activePins,matchesStarQuery,pinResultFromError} from '../message-marks';
import {sortKanbanCards,reorderPinned} from '../chat-stages';

test('pin key carries the sender only for group messages from others',()=>{
 assert.deepEqual(pinKeyFor({remoteJid:'1@g.us',keyId:'K',fromMe:false,senderJid:'5@s.whatsapp.net'}),{remoteJid:'1@g.us',id:'K',fromMe:false,participant:'5@s.whatsapp.net'});
 assert.deepEqual(pinKeyFor({remoteJid:'1@g.us',keyId:'K',fromMe:true,senderJid:'me@s.whatsapp.net'}),{remoteJid:'1@g.us',id:'K',fromMe:true});
 assert.deepEqual(pinKeyFor({remoteJid:'5@s.whatsapp.net',keyId:'K',fromMe:false,senderJid:'5@s.whatsapp.net'}),{remoteJid:'5@s.whatsapp.net',id:'K',fromMe:false});
});

test('pin events: pin with duration, unpin, and unrelated messages',()=>{
 const base={key:{remoteJid:'1@g.us',participant:'9@s.whatsapp.net'}};
 assert.deepEqual(parsePinEvent({...base,message:{pinInChatMessage:{key:{id:'T'},type:1},messageContextInfo:{messageAddOnDurationInSecs:86400}}} as any),{remoteJid:'1@g.us',keyId:'T',pin:true,seconds:86400,by:'9@s.whatsapp.net'});
 assert.equal(parsePinEvent({...base,message:{pinInChatMessage:{key:{id:'T'},type:1}}} as any)?.seconds,604800);
 assert.equal(parsePinEvent({...base,message:{pinInChatMessage:{key:{id:'T'},type:2}}} as any)?.pin,false);
 assert.equal(parsePinEvent({...base,message:{conversation:'oi'}} as any),null);
});

test('expired pins are dropped, open-ended ones kept',()=>{
 const now=new Date('2026-10-22T12:00:00Z');
 const rows=[{id:'a',expiresAt:new Date('2026-10-22T11:00:00Z')},{id:'b',expiresAt:null},{id:'c',expiresAt:new Date('2026-10-23T00:00:00Z')}];
 assert.deepEqual(activePins(rows,now).map(r=>r.id),['b','c']);
});

test('favorite search ignores case and accents across text, chat and sender',()=>{
 const row={content:'Reunião às 10',chatName:'Diretoria',senderName:'Ana'};
 assert.equal(matchesStarQuery(row,'reuniao'),true);
 assert.equal(matchesStarQuery(row,'ANA'),true);
 assert.equal(matchesStarQuery(row,'diretória'),true);
 assert.equal(matchesStarQuery(row,'xyz'),false);
 assert.equal(matchesStarQuery({...row,content:null},'reuniao'),false);
});

test('a WhatsApp pin failure becomes a pin only for the owner',()=>{
 assert.deepEqual(pinResultFromError(new Error('forbidden')),{scope:'local',warning:'O WhatsApp não aceitou a fixação. Ela ficou fixada só para você.'});
});

test('pinned conversations follow the saved pin order before anything else',()=>{
 const cards=[{jid:'a',lastMessage:{timestamp:'2026-10-22T12:00:00Z'}},{jid:'b',lastMessage:{timestamp:'2026-10-20T12:00:00Z'}},{jid:'c',lastMessage:{timestamp:'2026-10-22T13:00:00Z'}}];
 const column={id:'s',name:'S',color:'#000',labelIds:[],pinnedJids:['b','a'],cardOrder:['c'],orderedAt:'2026-10-21T00:00:00Z'} as any;
 assert.deepEqual(sortKanbanCards(cards,column).map(c=>c.jid),['b','a','c']);
});

test('reordering pins only moves pinned conversations',()=>{
 assert.deepEqual(reorderPinned(['a','b','c'],'c','a','before'),['c','a','b']);
 assert.deepEqual(reorderPinned(['a','b','c'],'a','c','after'),['b','c','a']);
 assert.deepEqual(reorderPinned(['a','b'],'x','a','before'),['a','b']);
});

import {archiveChanges,archivedSet} from '../archived-chats';
test('archived chats match whatever jid form the list uses',()=>{
 const canonical=(jid:string)=>jid==='123@lid'?'5513@s.whatsapp.net':jid;
 const set=archivedSet(['123@lid','9@g.us'],canonical);
 assert.equal(set.has('5513@s.whatsapp.net'),true);
 assert.equal(set.has('9@g.us'),true);
 assert.equal(set.has('123@lid'),false);
});
test('phone archive/unarchive updates become changes; unrelated updates are ignored',()=>{
 assert.deepEqual(archiveChanges([{id:'1@g.us',archived:true},{id:'2@s.whatsapp.net',archived:false},{id:'3@g.us',unreadCount:2},{archived:true}] as any),[{jid:'1@g.us',archived:true},{jid:'2@s.whatsapp.net',archived:false}]);
});
