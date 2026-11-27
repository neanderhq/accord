"use client";
import { useContext,useEffect,useState,type ReactNode } from "react";
import { DocumentLoadContext } from "./document-load";
import { WorkspaceLoader } from "./accord-brand";
import { WorkspaceProvider,useWorkspace } from "./workspace-context";
import { Shell } from "./app-kit";

function WorkspaceContent({children}:{children:ReactNode}){
 const w=useWorkspace(),documentLoad=useContext(DocumentLoadContext),[initial,setInitial]=useState(documentLoad);
 useEffect(()=>{if(!w.loading)setInitial(false);},[w.loading]);
 if(initial&&w.loading&&!w.error)return <WorkspaceLoader/>;
 return <Shell {...w} refresh={w.retry}>{children}</Shell>;
}
export function WorkspaceFrame({children}:{children:ReactNode}){
 return <WorkspaceProvider><WorkspaceContent>{children}</WorkspaceContent></WorkspaceProvider>;
}
