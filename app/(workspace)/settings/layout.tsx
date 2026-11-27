import type { ReactNode } from "react";
import { SettingsFrame } from "@/components/settings-frame";
export default function Layout({children}:{children:ReactNode}){return <SettingsFrame>{children}</SettingsFrame>;}
