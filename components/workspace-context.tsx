"use client";
import { createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { api,ApiError,workspaceAccessEvent } from "@/lib/client-api";
import type { WorkspaceView } from "@/lib/ui-types";

export const emptyWorkspace:WorkspaceView={company:{id:"",name:"Team workspace"},role:"",userId:"",envelopes:[],verificationOnly:true,developmentLinks:false};
const initialState={workspace:emptyWorkspace,loading:true,refreshing:false,error:null as ApiError|null,refreshError:null as ApiError|null};
const WorkspaceContext=createContext({...initialState,refresh:async()=>{},retry:async()=>{},demo:false});
export function useWorkspace(){return useContext(WorkspaceContext);}
const NavigationContext=createContext({pendingHref:null as string|null,report:(_id:symbol,_href:string,_pending:boolean)=>{}});
export function useWorkspaceNavigation(){return useContext(NavigationContext);}

export function WorkspaceProvider({children}:{children:ReactNode}){
 const [state,setState]=useState(initialState),path=usePathname(),lastPath=useRef(path);
 const [navigation,setNavigation]=useState<{id:symbol;href:string}|null>(null);
 const report=useCallback((id:symbol,href:string,isPending:boolean)=>setNavigation(previous=>isPending?{id,href}:previous?.id===id?null:previous),[]);
 const active=useRef(false),revoked=useRef(false),generation=useRef(0),pending=useRef<Promise<void>|null>(null),controller=useRef<AbortController|null>(null),queued=useRef(false);
 const revalidate=useCallback((afterMutation=false):Promise<void>=>{
  if(!active.current||revoked.current)return Promise.resolve();
  if(pending.current){if(afterMutation)queued.current=true;return pending.current;}
  const current=generation.current;
  const work=async()=>{
   do{
    queued.current=false;controller.current=new AbortController();setState(previous=>({...previous,refreshing:true}));
    try{
     const workspace=await api<WorkspaceView>("/api/workspace",{cache:"no-store",signal:controller.current.signal});
     if(!active.current||current!==generation.current)return;
     setState({workspace,loading:false,refreshing:false,error:null,refreshError:null});
    }catch(error){
     if(!active.current||current!==generation.current)return;
     setState(previous=>({...previous,loading:false,refreshing:false,...(previous.workspace.company.id?{refreshError:error as ApiError}:{error:error as ApiError})}));
    }
   }while(queued.current&&active.current&&current===generation.current);
  };
  const promise=work().finally(()=>{if(pending.current===promise)pending.current=null;});pending.current=promise;return promise;
 },[]);
 const refresh=useCallback(()=>revalidate(true),[revalidate]);
 const retry=useCallback(()=>{revoked.current=false;return revalidate();},[revalidate]);
 useEffect(()=>{
  active.current=true;
  const invalidate=(event:Event)=>{
   // Revocation wins over every outstanding response, including editor loads.
   revoked.current=true;generation.current++;controller.current?.abort();pending.current=null;queued.current=false;
   setState({...initialState,loading:false,error:(event as CustomEvent<ApiError>).detail});
  };
  const focus=()=>{if(document.visibilityState==="visible")void revalidate();};
  window.addEventListener(workspaceAccessEvent,invalidate);window.addEventListener("focus",focus);document.addEventListener("visibilitychange",focus);
  void revalidate();
  return()=>{active.current=false;generation.current++;controller.current?.abort();pending.current=null;queued.current=false;window.removeEventListener(workspaceAccessEvent,invalidate);window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",focus);};
 },[revalidate]);
 useEffect(()=>{if(lastPath.current===path)return;lastPath.current=path;void revalidate();},[path,revalidate]);
 // Changing identity, company or permissions discards all page-owned records
 // and unsaved editor state from the previous access scope.
 const scope=`${state.workspace.company.id}:${state.workspace.userId}:${state.workspace.role}`;
 return <NavigationContext.Provider value={{pendingHref:navigation?.href??null,report}}><WorkspaceContext.Provider value={{...state,refresh,retry,demo:false}}><div key={scope} className="workspace-scope">{children}</div></WorkspaceContext.Provider></NavigationContext.Provider>;
}
