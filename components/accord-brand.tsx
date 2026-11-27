import Image from "next/image";
import { cn } from "@/lib/utils";

export function AccordBrand({size="default",name="Accord",className,markOnly=false}:{size?:"default"|"large";name?:string;className?:string;markOnly?:boolean}) {
 return <span aria-hidden={markOnly||undefined} className={cn("brand accord-brand",size==="large"&&"accord-brand-large",className)}>
  <Image className="accord-brand-mark" src="/accord.png" alt="" width={846} height={938} sizes={size==="large"?"44px":"32px"} loading="eager"/>
  {!markOnly&&<span className="accord-brand-name">{name}</span>}
 </span>;
}

export function WorkspaceLoader() {
 return <div className="workspace-loading" role="status">
  <Image className="workspace-loading-mark" src="/accord.png" alt="" aria-hidden="true" width={846} height={938} sizes="48px" loading="eager"/>
  <span className="sr-only">Loading your workspace</span>
 </div>;
}
