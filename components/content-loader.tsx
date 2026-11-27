import { Skeleton } from "./ui/skeleton";

export function ContentLoader({label="Loading page content",compact=false}:{label?:string;compact?:boolean}){
 return <div className={compact?"content-loading content-loading-compact":"content-loading"} role="status" aria-busy="true">
  <span className="sr-only">{label}</span><div aria-hidden="true" className="content-loading-shapes"><Skeleton className="h-5 w-48"/><Skeleton className="h-4 w-3/4"/>{!compact&&<><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></>}</div>
 </div>;
}
