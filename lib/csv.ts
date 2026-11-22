// RFC 4180 quoted fields, including escaped quotes and embedded newlines.
export function parseCsv(input:string):string[][] {
 if(Buffer.byteLength(input)>1024*1024)throw new Error("CSV must be at most 1 MB");
 const rows:string[][]=[];let row:string[]=[],field="",quoted=false,closed=false;
 for(let i=0;i<input.length;i++){const c=input[i];if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
 if(c==='"'){if(field||closed)throw new Error("Unexpected quote");quoted=true;continue;}
 if(c===','||c==='\n'||c==='\r'){row.push(field);field="";closed=false;if(c!==','){if(c==='\r'&&input[i+1]==='\n')i++;rows.push(row);row=[];if(rows.length>1001)throw new Error("Import at most 1000 contacts");}continue;}
 if(closed)throw new Error("Unexpected text after quoted field");field+=c;}
 if(quoted)throw new Error("Unclosed quoted field");if(field||row.length||closed){row.push(field);rows.push(row);}return rows;
}
export const csvCell=(v:unknown)=>'"'+String(v??"").replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
export const csvRow=(values:unknown[])=>values.map(csvCell).join(',');
