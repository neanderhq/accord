import type { EnvelopeView,WorkspaceView } from "./ui-types";
// Display fixtures only. Never used by APIs, persistence, authentication, or signing.
const base={version:1,routing:"sequential" as const,folder:"Client agreements",tags:["Synthetic"],fields:[],created_at:"2026-11-15T09:00:00.000Z",owner_name:"Sam Taylor",document_count:2,documents:[],events:[],outputs:[],deliveries:[]};
export const syntheticRows:EnvelopeView[]=[
 {...base,id:"synthetic-services",title:"Studio services agreement",state:"draft",recipients:[{id:"avery",name:"Avery Morgan",email:"avery@client.test",routing_order:1,status:"pending"},{id:"jordan",name:"Jordan Lee",email:"jordan@client.test",routing_order:2,status:"pending"}]},
 {...base,id:"synthetic-onboarding",title:"New collaborator agreement",state:"part-signed",recipients:[{id:"m",name:"Morgan Blake",email:"morgan@studio.test",routing_order:1,status:"signed"},{id:"r",name:"Riley Quinn",email:"riley@studio.test",routing_order:2,status:"pending"}]},
 {...base,id:"synthetic-proposal",title:"Website project proposal",state:"sent",recipients:[{id:"c",name:"Charlie Ellis",email:"charlie@client.test",routing_order:1,status:"pending"}]},
 {...base,id:"synthetic-brand",title:"Brand identity handover",state:"completed",recipients:[{id:"j",name:"Jamie Parker",email:"jamie@client.test",routing_order:1,status:"signed"}]},
 {...base,id:"synthetic-nda",title:"Mutual confidentiality agreement",state:"viewed",recipients:[{id:"t",name:"Taylor Reed",email:"taylor@client.test",routing_order:1,status:"viewed"}]},
];
export const syntheticWorkspace:WorkspaceView={company:{id:"synthetic",name:"Northstar Studio"},role:"sender",userId:"synthetic",envelopes:syntheticRows,verificationOnly:true,developmentLinks:false};
