import Image from "next/image";
import { cn } from "@/lib/utils";

export function AccordBrand({size="default",name="Accord",className}:{size?:"default"|"large";name?:string;className?:string}) {
 return <span className={cn("brand accord-brand",size==="large"&&"accord-brand-large",className)}>
  <Image className="accord-brand-mark" src="/accord.png" alt="" width={846} height={938} sizes={size==="large"?"44px":"32px"} loading="eager"/>
  <span>{name}</span>
 </span>;
}
