"use client";
import {useState} from 'react';
import {Smile} from 'lucide-react';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
const groups = {
 'Rostos': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 🙃 😉 😍 🥰 😘 😎 🤔 🤨 😐 😴 😢 😭 😡 🤯 🥳 😬 🫣 🤗 😇',
 'Gestos': '👍 👎 👏 🙌 🤝 🙏 💪 👌 ✌️ 🤞 👋 🫶 ❤️ 💙 💚 💛 💜 🖤 🤍 💔 🔥 ✨ 🎉 ✅ ❌ ⚠️ 💯 👀',
 'Objetos': '📌 📎 📄 📁 📅 ⏰ 💻 📱 📞 📷 🎤 💼 💰 💳 🏠 🚗 ✈️ ☕ 🍕 🎂 🎁 🌟 🌞 🌙 🌹 🐶 🐱',
};
export function EmojiPicker({onSelect}:{onSelect:(emoji:string)=>void}) {
 const [open,setOpen]=useState(false),[group,setGroup]=useState<keyof typeof groups>('Rostos');
 const [container,setContainer]=useState<HTMLDivElement|null>(null);
 return <div ref={setContainer} className="shrink-0"><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" title="Emojis" aria-label="Escolher emoji" className="rounded-full p-2 text-muted-foreground hover:bg-muted"><Smile className="h-5 w-5"/></button></PopoverTrigger><PopoverContent portalContainer={container} side="top" align="start" className="w-80 max-w-[90vw] p-3"><p className="mb-2 text-sm font-semibold">Emojis</p><div className="mb-2 flex gap-1">{Object.keys(groups).map(key=><button type="button" key={key} onClick={()=>setGroup(key as keyof typeof groups)} aria-pressed={key===group} className="rounded-md px-2 py-1 text-xs hover:bg-muted aria-pressed:bg-muted">{key}</button>)}</div><div className="grid max-h-48 grid-cols-7 gap-1 overflow-y-auto overscroll-contain">{groups[group].split(' ').map(emoji=><button type="button" key={emoji} aria-label={`Inserir ${emoji}`} onClick={()=>{onSelect(emoji);setOpen(false)}} className="rounded-md p-1.5 text-2xl hover:bg-muted">{emoji}</button>)}</div></PopoverContent></Popover></div>;
}
