import type { ReactNode } from "react";
import { WorkspaceFrame } from "@/components/workspace-frame";
export default function Layout({children}:{children:ReactNode}){return <WorkspaceFrame>{children}</WorkspaceFrame>;}
