import type { Field,Geometry } from "./model";
export type RecipientView={id:string;name:string;email:string;routing_order:number;status:string;has_access_code?:boolean;accessCode?:string;signed_at?:string;consent_at?:string};
export type DocumentView={id:string;name:string;sha256:string;size:number;geometry:Geometry[];converted?:boolean;converter?:string};
export type OutputView={id:string;name:string;kind:string;sha256:string;size:number};
export type EventView={id:string;actor:string;event:string;created_at:string;ip?:string;ua?:string;data:Record<string,unknown>};
export type EnvelopeView={id:string;owner_id?:string;title:string;state:string;version:number;routing:"parallel"|"sequential";folder:string;tags:string[];fields:Field[];created_at:string;expires_at?:string;owner_name?:string;document_count?:number;documents:DocumentView[];recipients:RecipientView[];events:EventView[];outputs:OutputView[];deliveries:{id:string;kind:string;status:string;last_error?:string}[];archived_at?:string|null;deleted_at?:string|null;lifecycle?:{archived_at?:string|null;deleted_at?:string|null;retention_at?:string|null}|null};
export type WorkspaceView={company:{id:string;name:string};role:string;userId:string;envelopes:EnvelopeView[];verificationOnly:boolean;developmentLinks:boolean};
