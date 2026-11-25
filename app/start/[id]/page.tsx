import type { Metadata } from "next";
import { PublicSigning } from "@/components/public-signing";
export const metadata:Metadata={title:"Start signing · Accord",robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function Page({params}:{params:Promise<{id:string}>}) {
  return <PublicSigning id={(await params).id}/>;
}
