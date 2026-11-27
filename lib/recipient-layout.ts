export function recipientDisplay({name,email}:{name?:string|null;email?:string|null}) {
 const trimmedName=name?.trim()??"",trimmedEmail=email?.trim()??"";
 return {label:trimmedName||trimmedEmail||"Recipient",identity:trimmedEmail||trimmedName||undefined,avatarName:trimmedName||trimmedEmail||undefined};
}

export type RecipientFit={visibleCount:number;hiddenCount:number;firstRowCount:number};

// Widths come from non-interactive copies of the actual pills, including each +N.
// Keep a prefix in reading order and reserve room for its exact remaining count.
export function packRecipientRows(widths:readonly number[],width:number,gap:number,overflowWidth:(hidden:number)=>number):RecipientFit {
 const total=widths.length;
 let best:RecipientFit={visibleCount:0,hiddenCount:total,firstRowCount:0};
 if(width<=0||!total)return best;
 let row=1,used=0,firstRowCount=0;
 for(let count=0;count<=total;count++) {
  if(count===total)return {visibleCount:total,hiddenCount:0,firstRowCount:row===1?total:firstRowCount};
  const moreWidth=Math.min(width,overflowWidth(total-count));
  if(row===1||used+gap+moreWidth<=width)best={visibleCount:count,hiddenCount:total-count,firstRowCount:row===1?count:firstRowCount};
  const nextWidth=Math.min(width,Math.max(0,widths[count]));
  if(count>0&&used+gap+nextWidth>width) {
   row++;used=nextWidth;
   if(row===2)firstRowCount=count;
  } else used=count>0?used+gap+nextWidth:nextWidth;
  if(row>2)break;
 }
 return best;
}
