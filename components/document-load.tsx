"use client";
import { createContext,useEffect,useState,type ReactNode } from "react";

// The root stays mounted on client navigation. Only its first document render
// may use the full-screen brand; entering the workspace later uses skeletons.
export const DocumentLoadContext=createContext(true);
export function DocumentLoad({children}:{children:ReactNode}){
 const [initial,setInitial]=useState(true);
 useEffect(()=>setInitial(false),[]);
 return <DocumentLoadContext.Provider value={initial}>{children}</DocumentLoadContext.Provider>;
}
