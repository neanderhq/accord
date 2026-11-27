"use client";
import { useLayoutEffect,useRef } from "react";
import type { EnvelopeGuard } from "@/lib/envelope-wizard";

// Drawers own their existing discard dialog. Standalone editors also need to
// protect client links and history traversal, which never fire beforeunload.
export function useStandaloneNavigationGuard(guard:EnvelopeGuard,enabled:boolean){
 const latest=useRef(guard);
 useLayoutEffect(()=>{latest.current=guard;},[guard.dirty,guard.busy]);
 useLayoutEffect(()=>{
  const allow=()=>!latest.current.busy&&(!latest.current.dirty||window.confirm("Discard unsaved changes? Your saved draft and uploaded documents will remain."));
  const click=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const anchor=(event.target as Element).closest?.("a[href]");
   if(!(anchor instanceof HTMLAnchorElement)||anchor.hasAttribute("download")||(anchor.target&&anchor.target!=="_self"))return;
   const url=new URL(anchor.href);if(url.href===location.href||url.origin!==location.origin)return;
   if(!allow()){event.preventDefault();event.stopImmediatePropagation();}
  };
  // Navigation API cancellation runs before the App Router's popstate handler.
  const navigation=(window as Window&{navigation?:EventTarget}).navigation;
  const traverse=(event:Event)=>{if((event as Event&{navigationType?:string}).navigationType==="traverse"&&event.cancelable&&!allow())event.preventDefault();};
  let currentUrl=location.href,currentState=history.state;
  const remember=()=>{currentUrl=location.href;currentState=history.state;};
  const pop=(event:PopStateEvent)=>{
   if(!allow()){event.stopImmediatePropagation();history.pushState(currentState,"",currentUrl);}else remember();
  };
  if(enabled)document.addEventListener("click",click,true);
  if(navigation)navigation.addEventListener("navigate",traverse);
  else window.addEventListener("popstate",pop,true);
  return()=>{document.removeEventListener("click",click,true);navigation?.removeEventListener("navigate",traverse);window.removeEventListener("popstate",pop,true);};
 },[enabled]);
}
