"use client";
import Link,{useLinkStatus} from "next/link";
import { useEffect,useRef,type ComponentProps } from "react";
import { useWorkspaceNavigation } from "./workspace-context";

function NavigationPending({href}:{href:string}){
 const {pending}=useLinkStatus(),{report}=useWorkspaceNavigation(),id=useRef(Symbol());
 useEffect(()=>{const key=id.current;report(key,href,pending);return()=>report(key,href,false);},[href,pending,report]);
 return null;
}
export default function WorkspaceLink({children,href,...props}:ComponentProps<typeof Link>){
 return <Link href={href} {...props}>{children}<NavigationPending href={typeof href==="string"?href:href.pathname??""}/></Link>;
}
