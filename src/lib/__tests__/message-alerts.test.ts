import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alertPreview,alertToastId} from '../message-alerts';

test('alert preview shows the text, or the kind of media with its caption',()=>{
 assert.equal(alertPreview({type:'TEXT',content:'  oi,\n tudo bem? '}),'oi, tudo bem?');
 assert.equal(alertPreview({type:'IMAGE',content:'olha isso'}),'📷 Foto: olha isso');
 assert.equal(alertPreview({type:'AUDIO',content:null}),'🎤 Áudio');
 assert.equal(alertPreview({type:'STICKER',content:'x'}),'Figurinha');
 assert.equal(alertPreview({type:'TEXT',content:''}),'Nova mensagem');
 const long=alertPreview({type:'TEXT',content:'a'.repeat(300)});
 assert.equal(long.length,120);assert.ok(long.endsWith('…'));
});
test('one alert id per account and conversation',()=>{
 assert.equal(alertToastId('rei','1@s.whatsapp.net'),'incoming:rei:1@s.whatsapp.net');
 assert.notEqual(alertToastId('a','1@s.whatsapp.net'),alertToastId('b','1@s.whatsapp.net'));
});
