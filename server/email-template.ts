// One layout for every transactional email: product header, clear heading, short details,
// a prominent action button, a small footer, and a matching plain-text fallback.
export const PRODUCT_NAME = "Accord";

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const copy: Record<string, { heading: string; action: string }> = {
  signing_request: { heading: "Signature requested", action: "Review and sign" },
  link_reissue: { heading: "Your new signing link", action: "Review and sign" },
  reminder: { heading: "Reminder: your signature is still needed", action: "Review and sign" },
  external_completion_copy: { heading: "Signed PDFs are ready", action: "Download PDFs" },
  completion_copy: { heading: "Your signed documents are ready", action: "Download documents" },
  sender_notification: { heading: "Envelope update", action: "View envelope" },
  staff_invite: { heading: "You're invited to a workspace", action: "Accept invitation" },
  password_reset: { heading: "Reset your password", action: "Choose a new password" },
};

export function renderEmail(v: { kind: string; subject: string; text: string; company?: string; brandColor?: string | null; logo?: string | null }) {
  const url = v.text.match(/https?:\/\/\S+/)?.[0] ?? null;
  // The text ends with "<call to action>: <url>". The button carries the call to action, so drop that
  // trailing clause when a full sentence precedes it; otherwise just drop the colon.
  const raw = (url ? v.text.replace(url, "") : v.text).trim();
  const sentences = raw.split(/(?<=[.!?])\s+/);
  const body = (raw.endsWith(":") && sentences.length > 1 ? sentences.slice(0, -1).join(" ") : raw).replace(/[\s:]+$/, "").trim();
  // Detail line: the document title from the subject, shown only when the body does not already name it.
  const title = v.subject.replace(/^(Reminder: )?(Signature requested|Completed documents|Envelope \w+): /, "");
  const detail = title !== v.subject && !body.includes(title) ? title : "";
  const c = copy[v.kind] ?? { heading: v.subject, action: "Open" };
  const company = v.company?.trim() || PRODUCT_NAME;
  const color = /^#[0-9a-fA-F]{6}$/.test(v.brandColor ?? "") ? v.brandColor! : "#2563eb";
  const logo = v.logo && /^(https:|data:image\/(png|jpeg|webp);base64,)/.test(v.logo) ? `<img src="${escapeHtml(v.logo)}" alt="${escapeHtml(company)}" height="32" style="display:block;height:32px;margin:0 0 16px"/>` : "";
  const footer = `Sent by ${PRODUCT_NAME} on behalf of ${company}. This link is personal: please do not forward this email. If you were not expecting it, you can ignore it.`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(v.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border-top:4px solid ${color}">
<tr><td style="padding:28px 32px 8px">${logo}<div style="font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${color}">${PRODUCT_NAME}</div></td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827">${escapeHtml(c.heading)}</h1>
${detail ? `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;font-weight:600;color:#111827">${escapeHtml(detail)}</p>` : ""}
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">${escapeHtml(body)}</p></td></tr>
${url ? `<tr><td style="padding:0 32px 28px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${escapeHtml(c.action)}</a>
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#6b7280">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;color:#374151">${escapeHtml(url)}</span></p></td></tr>` : ""}
<tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [PRODUCT_NAME, "", c.heading, "", detail, body, "", url ? `${c.action}: ${url}` : "", "", "--", footer].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
  return { html, text };
}
