// Browser-only harness injected into a fixture-isolated preview context.
import React from "react";
import { createRoot } from "react-dom/client";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "../../components/ui/select";
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger,DropdownMenuSub,DropdownMenuSubTrigger,DropdownMenuSubContent } from "../../components/ui/dropdown-menu";
import { Popover,PopoverContent,PopoverTrigger } from "../../components/ui/popover";
import { Tooltip,TooltipContent,TooltipTrigger,TooltipProvider } from "../../components/ui/tooltip";
import { Dialog,DialogContent,DialogTrigger,DialogTitle,DialogDescription,DialogClose } from "../../components/ui/dialog";
import { AlertDialog,AlertDialogContent,AlertDialogTrigger,AlertDialogTitle,AlertDialogDescription,AlertDialogCancel } from "../../components/ui/alert-dialog";

function MotionPrimitives(){return <section aria-label="Motion fixtures" className="content-area">
 <Select defaultValue="draft"><SelectTrigger aria-label="Fixture select"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="sent">Sent</SelectItem></SelectContent></Select>
 <DropdownMenu><DropdownMenuTrigger>Fixture dropdown</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Fixture item</DropdownMenuItem><DropdownMenuSub><DropdownMenuSubTrigger>More fixture actions</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>Nested fixture item</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub></DropdownMenuContent></DropdownMenu>
 <Popover><PopoverTrigger>Fixture popover</PopoverTrigger><PopoverContent aria-label="Fixture popover content"><button>Popover control</button></PopoverContent></Popover>
 <TooltipProvider><Tooltip><TooltipTrigger>Fixture tooltip</TooltipTrigger><TooltipContent>Fixture help</TooltipContent></Tooltip></TooltipProvider>
 <Dialog><DialogTrigger>Fixture dialog</DialogTrigger><DialogContent><DialogTitle>Fixture dialog title</DialogTitle><DialogDescription>Fictional dialog content.</DialogDescription><DialogClose>Finish fixture dialog</DialogClose></DialogContent></Dialog>
 <AlertDialog><AlertDialogTrigger>Fixture alert</AlertDialogTrigger><AlertDialogContent><AlertDialogTitle>Fixture alert title</AlertDialogTitle><AlertDialogDescription>Fictional confirmation.</AlertDialogDescription><AlertDialogCancel>Cancel fixture alert</AlertDialogCancel></AlertDialogContent></AlertDialog>
 <details><summary>Fixture disclosure</summary><div style={{padding:24}}>Fictional disclosure content</div></details>
</section>;}

const host=document.createElement("div");host.id="motion-fixtures";host.style.marginLeft="280px";document.body.append(host);createRoot(host).render(<MotionPrimitives/>);
