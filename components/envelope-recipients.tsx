"use client";
import { useLayoutEffect,useRef,useState,type ReactElement,type ReactNode } from "react";
import type { RecipientView } from "@/lib/ui-types";
import { packRecipientRows,recipientDisplay,type RecipientFit } from "@/lib/recipient-layout";
import { InitialsAvatar } from "./initials-avatar";
import { Tooltip,TooltipContent,TooltipProvider,TooltipTrigger } from "./ui/tooltip";
import { Popover,PopoverContent,PopoverTrigger } from "./ui/popover";

function RecipientDisclosure({trigger,children,label}:{trigger:ReactElement;children:ReactNode;label:string}) {
 const [open,setOpen]=useState(false),[hovered,setHovered]=useState(false);
 return <Popover open={open} onOpenChange={value=>{setOpen(value);setHovered(false);}}>
  <Tooltip open={!open&&hovered} onOpenChange={setHovered}>
   <PopoverTrigger asChild><TooltipTrigger asChild>{trigger}</TooltipTrigger></PopoverTrigger>
   <TooltipContent className="recipient-disclosure" sideOffset={6}>{children}</TooltipContent>
  </Tooltip>
  <PopoverContent className="recipient-disclosure" aria-label={label} tabIndex={0} onOpenAutoFocus={event=>event.preventDefault()}>{children}</PopoverContent>
 </Popover>;
}

export function RecipientPill({recipient,truncated=false}:{recipient:RecipientView;truncated?:boolean}) {
 const {label,identity,avatarName}=recipientDisplay(recipient);
 const contents=<><InitialsAvatar id={identity} name={avatarName} size="tiny"/><span className="recipient-label">{label}</span></>;
 if(!truncated)return <span className="recipient-pill">{contents}</span>;
 return <RecipientDisclosure label="Recipient" trigger={<button type="button" className="recipient-pill recipient-trigger" aria-label={label}>{contents}</button>}>{label}</RecipientDisclosure>;
}

export function RecipientOverflowList({recipients}:{recipients:RecipientView[]}) {
 return <ul className="recipient-disclosure-list">{recipients.map((recipient,index)=>{
  const {label,identity,avatarName}=recipientDisplay(recipient);
  return <li key={index}><InitialsAvatar id={identity} name={avatarName} size="tiny"/><span>{label}</span></li>;
 })}</ul>;
}

export function EnvelopeRecipients({recipients}:{recipients:RecipientView[]}) {
 const container=useRef<HTMLDivElement>(null),measurements=useRef<HTMLDivElement>(null);
 const contentKey=JSON.stringify(recipients.map(recipient=>recipientDisplay(recipient)));
 const [layout,setLayout]=useState<RecipientFit&{key:string;truncated:boolean[]}>({key:"",visibleCount:0,hiddenCount:0,firstRowCount:0,truncated:[]});
 const fit=layout.key===contentKey?layout:{visibleCount:0,hiddenCount:recipients.length,firstRowCount:0,truncated:[]};
 useLayoutEffect(()=>{
  const element=container.current,measure=measurements.current;
  if(!element||!measure)return;
  let frame=0,disposed=false;
  const update=()=>{
   const pills=Array.from(measure.querySelectorAll<HTMLElement>("[data-recipient-measure]"));
   const counters=Array.from(measure.querySelectorAll<HTMLElement>("[data-overflow-measure]"));
   const width=element.getBoundingClientRect().width;
   const gap=parseFloat(getComputedStyle(element).getPropertyValue("--recipient-gap"))||0;
   const next=packRecipientRows(pills.map(pill=>pill.getBoundingClientRect().width),width,gap,count=>counters[count-1].getBoundingClientRect().width);
   const truncated=pills.map(pill=>{const label=pill.querySelector<HTMLElement>(".recipient-label")!;return label.scrollWidth>label.clientWidth;});
   setLayout(previous=>previous.key===contentKey&&previous.visibleCount===next.visibleCount&&previous.firstRowCount===next.firstRowCount&&previous.truncated.every((value,index)=>value===truncated[index])?previous:{...next,key:contentKey,truncated});
  };
  // Batch observer notifications outside their delivery cycle; only changed fits render.
  const schedule=()=>{if(!disposed&&!frame)frame=requestAnimationFrame(()=>{frame=0;update();});};
  update();
  const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(schedule):null;
  for(const target of [element,...measure.children])observer?.observe(target);
  window.addEventListener("resize",schedule);
  document.fonts.ready.then(schedule);
  document.fonts.addEventListener("loadingdone",schedule);
  return ()=>{disposed=true;cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener("resize",schedule);document.fonts.removeEventListener("loadingdone",schedule);};
 },[contentKey]);
 if(!recipients.length)return <div className="recipient-cell"><span className="text-muted-foreground">Not added</span></div>;
 const pill=(recipient:RecipientView,index:number)=><RecipientPill key={index} recipient={recipient} truncated={fit.truncated[index]}/>;
 return <TooltipProvider delayDuration={200}><div className="recipient-cell" ref={container}>
  {fit.firstRowCount>0&&<div className="recipient-row">{recipients.slice(0,fit.firstRowCount).map(pill)}</div>}
  {(fit.visibleCount>fit.firstRowCount||fit.hiddenCount>0)&&<div className="recipient-row">
   {recipients.slice(fit.firstRowCount,fit.visibleCount).map((recipient,index)=>pill(recipient,index+fit.firstRowCount))}
   {fit.hiddenCount>0&&<RecipientDisclosure label="Additional recipients" trigger={<button type="button" className="recipient-pill recipient-more recipient-trigger" aria-label={`Show ${fit.hiddenCount} more recipient${fit.hiddenCount===1?"":"s"}`}>+{fit.hiddenCount}</button>}><RecipientOverflowList recipients={recipients.slice(fit.visibleCount)}/></RecipientDisclosure>}
  </div>}
  <div className="recipient-measurements" ref={measurements} aria-hidden="true" inert>
   {recipients.map((recipient,index)=><span className="recipient-pill" data-recipient-measure key={index}><InitialsAvatar id={recipientDisplay(recipient).identity} name={recipientDisplay(recipient).avatarName} size="tiny"/><span className="recipient-label">{recipientDisplay(recipient).label}</span></span>)}
   {recipients.map((_,index)=><span className="recipient-pill recipient-more" data-overflow-measure key={`more-${index}`}>+{index+1}</span>)}
  </div>
 </div></TooltipProvider>;
}
