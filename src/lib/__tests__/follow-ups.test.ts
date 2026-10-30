import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reminderNote,remindersByChat,REMINDER_MAX} from '../follow-ups';

test('reminder note is trimmed and limited',()=>{
 assert.equal(reminderNote('  chamar   a Juliana \r\n sobre o pagamento  '),'chamar a Juliana \n sobre o pagamento');
 assert.equal(reminderNote('a\n\n\n\nb'),'a\n\nb');
 assert.equal(reminderNote('   '),null);
 assert.equal(reminderNote(42),null);
 assert.equal(reminderNote('x'.repeat(REMINDER_MAX)),'x'.repeat(REMINDER_MAX));
 assert.equal(reminderNote('x'.repeat(REMINDER_MAX+1)),null);
});
test('reminders match the conversation under its canonical jid',()=>{
 const map=remindersByChat([{chatJid:'249@lid',chatName:'Juliana',note:'pagamento',updatedAt:''}],jid=>jid==='249@lid'?'5511@s.whatsapp.net':jid);
 assert.equal(map.get('5511@s.whatsapp.net')?.note,'pagamento');
 assert.equal(map.get('249@lid'),undefined);
});
