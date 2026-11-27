import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";
import "./style.css";
import type { ReactNode } from "react";
import { DocumentLoad } from "@/components/document-load";
export const metadata = { title: "Accord", referrer: "no-referrer", icons: { icon: "/accord.png" } };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><DocumentLoad>{children}</DocumentLoad></body></html>;
}
