import { avatarColor,avatarInitials } from "@/lib/avatar";

export function InitialsAvatar({id,name,fallback="?",size="default"}:{id?:string|null;name?:string|null;fallback?:string;size?:"default"|"small"}) {
 const {background,foreground}=avatarColor(id,name,fallback);
 return <span className={size==="small"?"avatar avatar-small":"avatar"} aria-hidden="true" style={{backgroundColor:background,color:foreground}}>{avatarInitials(name,fallback)}</span>;
}
