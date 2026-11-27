export const settingsSections=[
 {id:"contacts",title:"Contacts",description:"Manage saved recipients and import your contacts.",adminOnly:false},
 {id:"branding",title:"Branding",description:"Set your workspace brand and document retention period.",adminOnly:true},
 {id:"email-jobs",title:"Email & jobs",description:"Check delivery setup, scheduler status and recent job runs.",adminOnly:true},
 {id:"delivery-log",title:"Delivery log",description:"Review mail and webhook deliveries and retry eligible attempts.",adminOnly:true},
 {id:"webhook",title:"Webhook endpoint",description:"Send workspace events to your HTTPS endpoint.",adminOnly:true},
 {id:"templates",title:"Reusable templates",description:"Reuse document templates, share them and manage template sending.",adminOnly:false},
] as const;
export type SettingsSectionId=typeof settingsSections[number]["id"];
export function settingsHref(section:SettingsSectionId){return `/settings/${section}`;}
export function canAccessSettingsSection(section:SettingsSectionId,role:string){
 return ["admin","sender","read-only"].includes(role)&&(!settingsSections.find(item=>item.id===section)!.adminOnly||role==="admin");
}
export type StoredSettings={brand_name:string;brand_color:string;logo:string|null;retention_days:number;webhook_url:string|null};
export type BrandingSettings={brandName:string;brandColor:string;logo:string|null;retentionDays:number};
export function brandingSettingsPayload(current:StoredSettings,branding:BrandingSettings){
 // The API replaces all five settings together. Keep the other page's values.
 return {...branding,webhookUrl:current.webhook_url};
}
export function webhookSettingsPayload(current:StoredSettings,webhook:{url:string;secret:string}){
 return {brandName:current.brand_name,brandColor:current.brand_color,logo:current.logo,retentionDays:current.retention_days,webhookUrl:webhook.url||null,...(webhook.secret?{webhookSecret:webhook.secret}:{})};
}
