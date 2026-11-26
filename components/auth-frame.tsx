import type { ReactNode } from "react";
import Link from "next/link";
import { AccordBrand } from "./accord-brand";

export function AuthFrame({children}:{children:ReactNode}) {
 return <main className="login-page">
  <div className="auth-layout">
   <Link className="brand-link auth-brand" href="/"><AccordBrand size="large"/></Link>
   <div className="auth-content">{children}</div>
   <p className="auth-footer">Private documents. Clear evidence.</p>
  </div>
 </main>;
}
