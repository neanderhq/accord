import type { ReactNode } from "react";
import Link from "next/link";
import { AccordBrand } from "./accord-brand";

export function AuthFrame({children,footerLeading}:{children:ReactNode;footerLeading?:ReactNode}) {
 return <main className="login-page">
  <div className="auth-layout">
   <Link className="brand-link auth-brand" href="/"><AccordBrand size="large"/></Link>
   <div className="auth-content">{children}</div>
   <div className={footerLeading?"auth-footer auth-footer-row":"auth-footer"}>{footerLeading}<span>Private documents. Clear evidence.</span></div>
  </div>
 </main>;
}
