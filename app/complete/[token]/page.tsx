import { Completion } from "@/components/signing";
export default async function Page({params}:{params:Promise<{token:string}>}){return <Completion token={(await params).token}/>;}
