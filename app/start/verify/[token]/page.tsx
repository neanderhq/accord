import type { Metadata } from "next";
import { VerifySigning } from "@/components/public-signing";
export const metadata:Metadata={title:"Confirm your email · Accord",robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function Page({params}:{params:Promise<{token:string}>}) {
  return <VerifySigning token={(await params).token}/>;
}
