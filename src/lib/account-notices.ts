import {isConversationJid} from './conversation-jid';
export interface AccountNotice {sessionId:string;accountName:string;keyId:string;jid:string;name:string;timestamp:string}
export const accountNoticeRoom=(sessionId:string)=>`account-notices:${sessionId}`;
export function otherAccountNotices(notices:AccountNotice[],activeSessionId:string,seen:Set<string>) {
 return notices.filter(notice=>{
  if(!notice.sessionId||notice.sessionId===activeSessionId||!notice.keyId||!isConversationJid(notice.jid))return false;
  const key=`${notice.sessionId}:${notice.keyId}`;if(seen.has(key))return false;
  seen.add(key);if(seen.size>2000)seen.delete(seen.values().next().value!);return true;
 });
}
