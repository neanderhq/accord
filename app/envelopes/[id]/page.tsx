import { Composer } from "@/components/composer";
export default async function Page({params}:{params:Promise<{id:string}>}){return <Composer id={(await params).id}/>;}
