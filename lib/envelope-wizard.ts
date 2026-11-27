import { fieldInside } from "./model";
import type { EnvelopeView, WorkspaceView } from "./ui-types";

export const envelopeSteps = ["Title", "Documents & details", "Recipients & routing", "Signing fields", "Review"] as const;
export type EnvelopeStep = 0|1|2|3|4;
export type EnvelopeGuard = { dirty:boolean; busy:boolean };

export function envelopeDraftPayload(envelope:EnvelopeView) {
  return {version:envelope.version,title:envelope.title,routing:envelope.routing,folder:envelope.folder,tags:envelope.tags.map(tag=>tag.trim()).filter(Boolean),fields:envelope.fields,recipients:envelope.recipients.map(recipient=>({id:recipient.id,name:recipient.name,email:recipient.email,order:recipient.routing_order,...(recipient.accessCode?{accessCode:recipient.accessCode}:{})}))};
}

// Revisiting an earlier step must not submit unfinished inputs from a later step.
export function envelopeForStep(current:EnvelopeView,saved:EnvelopeView,step:EnvelopeStep):EnvelopeView {
  return {...current,...(step<1?{folder:saved.folder,tags:saved.tags}:{}),...(step<2?{routing:saved.routing,recipients:saved.recipients}:{}),...(step<3?{fields:step<2?saved.fields:saved.fields.filter(field=>current.recipients.some(recipient=>recipient.id===field.recipientId)&&current.fields.some(local=>local.id===field.id))}: {})};
}

export function mergeSavedEnvelopeStep(current:EnvelopeView,saved:EnvelopeView,step:EnvelopeStep):EnvelopeView {
  return {...saved,...(step<1?{folder:current.folder,tags:current.tags}:{}),...(step<2?{routing:current.routing,recipients:current.recipients}:{}),...(step<3?{fields:current.fields}:{})};
}

export function envelopePermissions(workspace:WorkspaceView,envelope:EnvelopeView|null) {
  const canManage=!!envelope&&(workspace.role==="admin"||(workspace.role==="sender"&&envelope.owner_id===workspace.userId));
  return {canManage,editable:canManage&&envelope?.state==="draft"};
}

// Server validation remains authoritative. These checks explain missing steps before saving.
export function envelopeStepError(envelope:EnvelopeView,step:EnvelopeStep):string|null {
  if(!envelope.title.trim())return "Enter an envelope title.";
  if(step>=1&&!envelope.documents.length)return "Add at least one PDF or DOCX before continuing.";
  if(step>=2&&!envelope.recipients.length)return "Add at least one recipient before continuing.";
  if(step>=3) {
    if(envelope.fields.some(field=>{
      const page=envelope.documents.find(document=>document.id===field.documentId)?.geometry[field.page];
      return !page||!envelope.recipients.some(recipient=>recipient.id===field.recipientId)||!fieldInside(field,page);
    }))return "Every field must fit its PDF page and belong to a recipient in this envelope.";
    if(envelope.recipients.some(recipient=>!envelope.fields.some(field=>field.recipientId===recipient.id&&field.required&&field.type==="signature"))||envelope.documents.some(document=>!envelope.fields.some(field=>field.documentId===document.id)))return "Place a required signature for every recipient and at least one field on every document.";
  }
  return null;
}

export function opensEnvelopeDrawer(event:{button:number;metaKey:boolean;ctrlKey:boolean;shiftKey:boolean;altKey:boolean;defaultPrevented:boolean}) {
  return !event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey;
}
