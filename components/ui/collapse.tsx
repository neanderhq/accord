"use client";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

// Keep values mounted while CSS interpolates the content's natural height.
// Inert and aria-hidden apply immediately, including throughout the exit.
export function Collapse({open,children,className,...props}:ComponentProps<"div">&{open:boolean}) {
 return <div {...props} className={cn("collapse",className)} data-state={open?"open":"closed"} inert={!open} aria-hidden={!open}>
  <div className="collapse-clip">{children}</div>
 </div>;
}
