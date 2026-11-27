"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { settingsSections,settingsHref } from "@/app/settings/sections";
import { useWorkspace,useWorkspaceNavigation } from "./workspace-context";
import { SettingsPage } from "./settings";
import { ContentLoader } from "./content-loader";

export function SettingsFrame({children}:{children:ReactNode}){
 const {workspace}=useWorkspace(),path=usePathname(),{pendingHref}=useWorkspaceNavigation(),pending=!!pendingHref?.startsWith("/settings");
 const section=settingsSections.find(item=>(pending?pendingHref:path)===settingsHref(item.id))?.id??"contacts";
 return <SettingsPage section={section} workspace={workspace}><div aria-busy={pending}><div hidden={pending}>{children}</div>{pending&&<ContentLoader/>}</div></SettingsPage>;
}
