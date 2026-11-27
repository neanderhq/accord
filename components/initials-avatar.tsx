import { avatarColor,avatarInitials } from "@/lib/avatar";

export function InitialsAvatar({id,name,fallback="?"}:{id?:string|null;name?:string|null;fallback?:string}) {
 const {background,foreground}=avatarColor(id,name,fallback);
 return <span className="avatar" aria-hidden="true" style={{backgroundColor:background,color:foreground}}>{avatarInitials(name,fallback)}</span>;
}
