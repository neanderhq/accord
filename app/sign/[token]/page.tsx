import { Signing } from "@/components/signing";
export default async function Page({params}:{params:Promise<{token:string}>}){return <Signing token={(await params).token}/>;}
