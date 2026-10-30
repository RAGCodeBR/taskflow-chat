export interface QuotedPreview {
    keyId:string; content:string|null; fromMe:boolean; senderJid?:string|null; pushName?:string|null;
    type?:string; mediaUrl?:string|null;
}
interface ConversationMessage {
    keyId:string; content:string|null; fromMe:boolean; timestamp:string;
    senderJid?:string|null; pushName?:string|null; type:string; mediaUrl?:string|null;
    quoteId?:string|null; quoted?:QuotedPreview|null;
}
// Socket confirmations can omit the embedded quote. Resolve it from this
// conversation, preserving a previously loaded preview when the original is older.
export function mergeConversationMessages<T extends ConversationMessage>(current:T[],incoming:T[]):T[]{
 const byKey=new Map<string,T>();
 for(const message of [...current,...incoming]){
  const previous=byKey.get(message.keyId);
  byKey.set(message.keyId,{...previous,...message,quoted:message.quoted || (previous?.quoteId===message.quoteId?previous?.quoted:null) || null});
 }
 return [...byKey.values()].map(message=>{
  if(!message.quoteId)return message;
  const original=byKey.get(message.quoteId);
  if(!original)return message;
  return {...message,quoted:{keyId:original.keyId,content:original.content,fromMe:original.fromMe,senderJid:original.senderJid,pushName:original.pushName,type:original.type,mediaUrl:original.mediaUrl}};
 }).sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime());
}
export function quotePreviewText(quote:QuotedPreview):string {
 return quote.content?.trim() || ({IMAGE:'Imagem',VIDEO:'Vídeo',AUDIO:'Áudio',STICKER:'Figurinha',DOCUMENT:'Documento',CONTACT:'Contato',LOCATION:'Localização'}[quote.type||''] || 'Mensagem');
}
