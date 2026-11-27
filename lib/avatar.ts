export const AVATAR_PALETTE = [
 {background:"#e3edf9",foreground:"#34577f"},
 {background:"#e7e5f5",foreground:"#5b4a82"},
 {background:"#f4e3eb",foreground:"#83445f"},
 {background:"#f7e6db",foreground:"#884b2f"},
 {background:"#f4ecd3",foreground:"#79601e"},
 {background:"#e7eddc",foreground:"#506537"},
 {background:"#dfeee7",foreground:"#356650"},
 {background:"#dfeef0",foreground:"#35636c"},
] as const;

const segmenter=new Intl.Segmenter("en",{granularity:"grapheme"});
const normalize=(value?:string|null)=>(value??"").normalize("NFC").trim().replace(/\s+/gu," ");
const graphemes=(value:string)=>Array.from(segmenter.segment(value),part=>part.segment);

export function avatarInitials(name?:string|null,fallback="?") {
 const words=normalize(name).split(" ").filter(Boolean);
 if(!words.length)return graphemes(normalize(fallback).replace(/\s/gu,"").toUpperCase()).slice(0,2).join("")||"?";
 const first=graphemes(words[0].toUpperCase())[0];
 return words.length>1?first+graphemes(words[words.length-1].toUpperCase())[0]:first;
}

export function identityHash(value:string) {
 const seed=normalize(value).toLowerCase();
 // Fixed integer hashing keeps identity colors identical in every render environment.
 let hash=2166136261;
 for(const character of seed)hash=Math.imul(hash^character.codePointAt(0)!,16777619);
 return hash>>>0;
}

export function avatarColor(id?:string|null,name?:string|null,fallback="?") {
 return AVATAR_PALETTE[identityHash(normalize(id)||normalize(name)||normalize(fallback)||"?")%AVATAR_PALETTE.length];
}
