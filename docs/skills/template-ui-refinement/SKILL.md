---
name: template-ui-refinement
description: Build new screens and apply consistent, restrained visual and interaction polish across existing application templates. Use for template-aligned screen composition and cross-surface spacing, navigation, settings, avatars, forms, drawers, previews, motion and loading refinements while preserving the target app’s brand, functionality, accessibility and security.
---

# Template UI refinement

Apply these instructions, rather than merely summarizing feedback. Produce coherent new screens and refinements within the existing application, not a generic redesign. This file is self-contained and portable; placing it in a repository does not prove automatic installation or discovery by an agent.

## When to use

Use when asked to build a new screen within a template, polish a template, apply recurring visual feedback, improve consistency across screens, or refine navigation, record editors, previews, settings or loading behavior. New screens should extend the template’s established shared patterns, not introduce a parallel design system. Apply only relevant patterns: do not invent missing product features to satisfy this skill. Mark irrelevant patterns N/A. Ask only when ambiguity materially affects scope, safety or product behavior.

Follow newer explicit user instructions and supplied references over these defaults, subject to repository and safety requirements. Determine whether a reference shows a desired result or a problem. A grey iconless unsaved banner and large bordered document/page dropdown toolbar are **negative before-examples**, not designs to reproduce. The latest drawer default is approximately **90%**, not 80%, of desktop viewport width. Full-screen logo loading belongs to initial/full document loads, not every navigation.

## Workflow

1. **Establish boundaries.** Read repository guidance, setup/check documentation and current changes. Identify the authorized environment and preserve unrelated or unfinished work. Do not reset files, seed/reset data, commit, push, update PRs or publish without separate permission. Do not automatically add dependencies, migrate frameworks, change backend contracts or weaken authentication/authorization.
2. **Inspect before designing.** Review supplied screenshots, then the actual rendered desktop and mobile UI before editing. Inspect representative populated, empty, loading, error and editor states. Read existing components, tokens, styles, navigation, state ownership and tests. Follow callers/imports through saves, uploads, routing, previews and permissions; do not infer behavior from a single component or screenshot. If the app cannot run safely, report the limitation and separate source inspection from observed behavior.
3. **Map shared fixes.** Inventory relevant surfaces: authentication, shell/topbar/sidebar, dashboard metrics, lists, settings, forms, drawers/dialogs and preview menus. Map each issue to existing primitives/tokens and affected callers. Prefer shared variants and scoped tokens over page-specific overrides; include portalled surfaces, which may sit outside page ancestors. Plan minimal changes and targeted regressions.
4. **Implement in focused batches.** Reuse the app’s design system, brand, semantics and state-management conventions. Preserve business logic, security, routes, deep links, permissions, validation, save semantics and signing protections. Never hard-code another application’s company, product copy, routes, logo asset, palette or framework.
5. **Independently re-review.** After implementation, reload the actual app and compare fresh screenshots against the baseline and request. Review layout without relying on implementation claims, then operate controls by pointer, keyboard and touch where available. Batch corrections and repeat affected checks. Do not call CSS declarations or a successful page load proof of interaction quality.
6. **Verify and report.** Run repository-prescribed checks, including relevant tests and build, plus focused browser regressions. Use fictional isolated fixtures; block unexpected writes when intercepting APIs. Never use live customer records, seed/reset customer data, expose secrets or capture private documents, tokens or signing evidence. Report observed results, automated results, not-run checks and real limitations separately.

### New-screen workflow

1. **Find the nearest analogues.** Inspect existing screens with similar layout and interaction needs, including their routes and parent layouts. Identify the shared shell/navigation, `PageHeading` or equivalent, UI primitives, tokens, field layouts, feedback/loading components and dialogs they use.
2. **Map ownership before composing.** Determine which parent already supplies the shell, navigation, page spacing and headings. Compose the new screen within those boundaries using existing components and supported variants; do not duplicate shells, copy shared markup or add one-off style overrides to imitate an existing pattern.
3. **Fill only genuine gaps.** When existing APIs cannot express a necessary reusable pattern, add the smallest reusable variant at the owning shared component or token layer. Inspect existing callers before changing defaults and check them afterward. Keep domain-specific business workflows separate from reusable presentation patterns: recipient management, signing and other Accord-specific features are not requirements for unrelated templates.
4. **Review against the analogues.** Compare the new screen’s layout, field rhythm, feedback, loading and dialogs with its closest existing screens. Verify applicable states, responsive behavior and keyboard operation, plus regressions in existing callers of any changed shared code.

### Shared-pattern governance

This guidance alone does not enforce styling. Shared components and tokens govern the implementation; use their actual APIs rather than treating this document as a substitute for them. Future agents must preserve documented common patterns. When a shared pattern intentionally changes, update its owning implementation, review affected callers and update the relevant guidance together so later screens do not recreate obsolete patterns.

### Optional Accord-specific companion references

These are Accord companion examples, **not portable normative requirements**. Do not copy their domain behavior, routes or branding into other templates. Verify current file paths, exports, ownership and callers in the checkout before using this map; basename-only entries below are lookup references, not assertions about their directory.

| Reference | Ownership/reference use |
| --- | --- |
| `components/app-kit.tsx` | Inspect shared application-level composition and `PageHeading`, where exported; reuse the existing API rather than recreating page headings or wrappers. |
| `components/ui/` | Inspect reusable UI primitives and supported variants, including controls, fields and dialogs. |
| `app/globals.css`, `app/style.css` | Inspect shared tokens, global rules and their import order; determine which layer owns a style before extending it. |
| `workspace-frame`, `settings-frame` | Locate the actual component files and route/layout callers; inspect ownership of workspace shell/navigation and settings framing to avoid nesting duplicate shells. |
| `content-loader` | Locate the component and inspect its content-loading contract before adding another loading treatment. |
| `initials-avatar` | Locate the component and inspect shared identity, fallback and color behavior before adding another avatar implementation. |
| `envelope-recipients` | Locate the component for Accord’s recipient presentation; distinguish reusable pill/overflow behavior from envelope-specific business logic. |

## Design rules

### Visual foundation and responsive rhythm

- Aim for modern, restrained, shadcn New York-inspired polish using existing primitives—not a requirement to install shadcn or replace the stack. Keep the target brand recognizable. Preserve existing login branding unless requested otherwise; reuse the actual supplied logo consistently, including the favicon. Never invent a substitute mark.
- Default authenticated canvas, cards, drawers, dialogs and portalled surfaces to white. Scope this to authenticated UI. Use muted grey intentionally for form panels, recipient pills, secondary controls and contextual areas, not as a blanket canvas. Prefer soft neutral borders, restrained accents and charcoal primary actions when compatible with the brand. Avoid noisy bordered cards around every section and remove redundant shells.
- Establish comfortable spacing, equal comparable panel/widget padding, aligned icons/labels/controls and a coherent typography hierarchy. Keep secondary text readable; avoid tiny 10px operational text and text shadows. Use subtle light authentication background/noise only when suitable and requested, never at the expense of legibility.
- Match responsive grids to actual item counts; avoid accidental orphan metric cards. Prevent bottom widgets, sharing controls and reusable-template sections from overlapping. Test populated and long-content cases, not just empty panels.
- Keep short field labels on one line by moving qualifiers, limits, “optional” and “already set” into associated helper copy. At narrow widths, stack fields instead of clipping meaning or forcing horizontal scrolling. Do not globally apply no-wrap or force arbitrary unbroken text. Let long user-generated titles wrap or truncate accessibly with the full value discoverable.

### Headers, authentication and truthful status

- Use one compact drawer/dialog header. Replace generic “details” headings/descriptions with the real record title and useful version, document or recipient metadata. Place status beside the title or metadata, never stranded after action buttons. Keep Save and Close adjacent; make preview a restrained muted ghost button. Retain accessible dialog titles/descriptions, visually hidden when necessary.
- Remove redundant eyebrows, technical icons and explanatory clutter from sign-in/signed-out screens. Preserve useful diagnostics and recovery paths for genuine non-authentication errors.
- Remove unexplained technical “verification mode/workspace” badges from the main header/sidebar, but do not conceal restrictions. Where relevant, explain email-disabled/test-mode limitations in a concise muted contextual banner with an icon and actionable setup link. Respect setup permissions and retain meaningful role/account status.
- Render status labels in sentence case, such as “Part signed,” through display formatting only. Preserve stored enum values, filters, exports and behavior.

### Navigation and settings

- Refine a compact topbar and obvious active navigation states, including settings descendants. Present workspace identity as a static muted rounded tag/card: rounded-square building icon and workspace name only. No fake dropdown, misleading chevron, repeated “admin workspace” copy or unnecessary dividers. Show dropdown affordances only for real choices. Person/role information can remain in the footer.
- On desktop, support a fully labeled sidebar and an icon-only rail. Provide a visible collapse control in expanded mode. In collapsed mode, crossfade the **top logo mark** to an expand icon on hover **and keyboard focus**. Expand only on activation by click, Enter or Space—not hover. Keep focus stable and expose expanded state and an accessible control name.
- Synchronize sidebar width, main-content offset and text fading with a smooth reversible transition; prevent snapping, clipping and hidden focusable links. Keep icon-only items named, selected states clear, and hover/focus tooltips available. Remember only the non-sensitive presentation preference using app-appropriate storage, with a hydration-safe initial render and no visible preference flash. Handle unavailable storage gracefully.
- Keep mobile navigation fully labeled regardless of desktop preference. Preserve usable touch targets, Escape dismissal, focus containment/restoration and closing on navigation. Do not let hidden tooltips consume the only Escape intended to close the mobile menu.
- Replace long unrelated settings-card walls with secondary navigation and individually addressable sections/pages where useful. Choose categories from the product’s actual functions; contacts, branding, email/jobs, delivery logs, webhook endpoints and reusable templates are examples, not mandatory categories. Preserve existing controls, permissions, deep links, drafts and save semantics. Remove duplicate section headings/card shells rather than duplicating settings.

### People, recipients and document decoration

- Make all person avatars circular with deterministic identity-based muted backgrounds and contrasting colored initials/text. Prefer stable email/ID identity, otherwise name, with a sensible fallback. Keep the same identity’s colors consistent across surfaces. A workspace building icon is not a person avatar.
- Represent recipient-like data with compact borderless muted pills: avatar plus **one** best available label, name otherwise email. Avoid stacked duplicate full-name/email lists. Wrap inline to at most **two measured rows**, reserving room for an exact `+N` overflow count. Measure rendered widths and recompute on resize/content/font changes; never guess a fixed visible item count.
- Keep long labels contained. Expose truncated values and hidden entries through accessible tooltips/popovers usable by hover, keyboard focus and touch; do not rely solely on native title attributes. Provide a readable hidden-entry list in logical order.
- Where suitable, use decorative colored document-cover illustrations instead of repeated plain document icons. Make them deterministic per document, clearly decorative rather than fake actual previews. Do not fetch document content solely for decoration.

### Forms and feedback

- Soften default search/input/select/outline strokes; strengthen them on hover while preserving unmistakable focus, validation error, disabled and read-only states. Do not remove boundaries that communicate operability.
- Make **Choose files** prominent. Hide the browser’s awkward inline “no file chosen” presentation, not the genuinely labeled, operable file input. Put filenames, selection status and help below the button if needed. Preserve keyboard/touch activation, busy/error feedback, file types, limits and validation.
- Show dirty state as a subtle **blue** information notice with an info icon on the **left**, concise “Unsaved changes” copy and accessible live status. Distinguish it from successful save feedback and errors; do not style every notice as unsaved.

### Drawers and editor continuity

- Where useful, open common record create/detail actions in a wide right drawer rather than disrupting context with a route change. Default to approximately **90% viewport width on desktop**, full width on mobile; adapt to content rather than forcing drawers everywhere. Preserve standalone URLs, deep links, open-in-new-tab and modifier-click semantics.
- Keep a multi-step form in the same mounted drawer. Preserve drafts, uploads, Back/Next, validation and scroll continuity. Retain dirty/busy close guards and explicit confirmation for sensitive final actions. Test Close, Escape, outside click and nested confirmations; exiting animation must not release guards or focus prematurely.
- Use a consistent grey borderless left form surface and white preview where this editor pattern applies. Maintain intentional spacing and equal padding across all widgets.
- Place horizontal **Details** (or meaningful **Inputs**) and **Activity** tabs below the real title metadata. Move activity out of the long form’s bottom; do not duplicate it. Preserve edits, preview mode, selected document/page and appropriate per-tab scroll position. Keep the header, tabs and scrolling workable on narrow and short screens.

### Compact preview selectors

- Place a text-only document selector over the preview’s top-left chrome and a page selector top-right. Put each chevron immediately after the selected text with an exact **4px text-to-chevron gap**. Remove input-like borders, filled boxes, excessive padding and the extra toolbar card.
- Reserve preview chrome space so the overlay never obscures actual document content or signing fields. Preserve the readable white PDF. On narrow screens, prevent selectors colliding with each other or escaping their surface.
- Retain accessible names, visible focus and keyboard/click/touch menus. Invisible hit areas may exceed the visual text bounds for practical touch operation without visible bulk. Truncate long filenames accessibly and expose full names in the menu.
- Preserve document/page changes, busy and disabled behavior. Reset or clamp the page safely when switching documents or when page counts change; never display an invalid page. Keep selections intact across tabs where appropriate.

### Motion, navigation and loading

- Give filters, dialogs/drawers, menus, selects, popovers/tooltips, sidebar and labels coherent eased entry **and exit**. Adapt defaults of roughly 180–240ms for popups, 280–350ms for panels and 400–450ms for sidebar resizing. Reverse rapid toggles from the current position; animate exit before unmount. Avoid jumps, disappearing focus and stale interactive exit content.
- Honor reduced-motion preferences: remove decorative motion, shimmer and spinning while retaining static loading/status feedback and immediate usable transitions.
- Use existing client-side navigation for ordinary in-app links and content-only, softly shimmering skeletons shaped like the loading content. Keep sidebar, header and relevant settings navigation stable. Distinguish true document reloads from shell remounts/full-screen loader flashes by observing navigation and retained UI, not guessing from appearance.
- Reserve the existing spinning logo for initial/full document load or hard refresh. Do not show it on soft routes or resource waits, and never impose artificial loader delays. Keep intentional downloads, external links and authentication-boundary full navigations.
- Refresh data/counts accurately in the background without overwriting dirty editor work. Protect drafts during client links and browser Back/Forward as well as unload. On session expiry, access revocation or identity/permission-scope changes, promptly remove stale private content; late responses must not restore it. Never retain private data merely to keep the shell visually stable.

## Acceptance checklist

Mark each applicable item **verified**, **failed**, or **not run**, and irrelevant items **N/A**. Record actual interactions and viewport/state coverage, not just style claims.

- [ ] **New-screen composition:** Confirm reuse of the existing parent layout, shell/navigation, heading, primitives, tokens, field layouts, feedback/loading and dialogs where applicable; no duplicate shell, copied shared implementation or one-off style override. Compare with the nearest analogous screens. Any necessary shared variant is minimal, and existing callers have been checked for regressions.
- [ ] **New-screen behavior:** Verify applicable populated, empty, loading, error, validation, disabled, read-only, dirty and success states. Exercise desktop, mobile and short-screen layouts, keyboard order, visible focus, accessible names and dialog dismissal/focus restoration. Preserve routes, permissions and product behavior; do not add unrelated domain workflows.
- [ ] **Baseline and coverage:** Inspect fresh before/after desktop, mobile and short-screen views of auth, shell, dashboard/list, settings, forms, drawers/dialogs and portalled menus. Check populated, empty, loading, error and long-content states where relevant.
- [ ] **Layout and brand:** Confirm white authenticated surfaces, intentional grey regions, consistent padding/typography, readable contrast, balanced metric grids, correct actual logo/favicon and unchanged auth branding. Scroll through bottom widgets; no overlap or clipped short labels.
- [ ] **Navigation:** Collapse/expand repeatedly and rapidly; verify synchronized content motion, no clipping, logo hover/focus crossfade without hover activation, Enter/Space activation, active descendants, icon names/tooltips and remembered preference after refresh without flash. Exercise the labeled mobile menu, touch, Escape and restored focus.
- [ ] **Settings and status:** Follow section deep links and Back/Forward; confirm permissions, drafts/save behavior, no duplicate controls, truthful setup restrictions and sentence-case display labels without changed filters/exports.
- [ ] **Lists and people:** Resize recipient lists with long names and varying counts; verify two measured rows, exact overflow, consistent circular avatars and discoverable full/hidden labels by keyboard and touch.
- [ ] **Forms and editors:** Operate upload selection/cancel/error/busy states, helpers and focus/error/read-only states. Make an edit; confirm blue left-icon live unsaved feedback, successful save distinction and failure recovery. Verify one real-title header, adjacent Save/Close and ghost preview.
- [ ] **Drawer and preview:** Exercise create/detail, standalone and modified links; Back/Next, tabs, uploads, draft retention, scroll, dirty/busy dismissal and sensitive final confirmation. Select multiple documents/pages, including long filenames and fewer-page documents; verify 4px chevrons, full-name menus, no obscured PDF/fields and safe page reset/clamp.
- [ ] **Motion and loading:** Observe entry/exit, rapid reversal and focus restoration. Under slow responses, navigate ordinary links and history: shell stays stable, only content skeletons load, and no document reload/logo flash occurs. Hard refresh uses only the appropriate initial loader. Reduced motion is static; no artificial waits.
- [ ] **Safety and regression:** Test relevant roles, session expiry/access denial and late responses using isolated fictional fixtures. Confirm no stale private content or lost dirty work, unchanged business/signing behavior, no unexpected requests/writes, and successful repository tests/build—or document exact failures and skipped prerequisites.

## Completion response

Respond concisely with **what changed**, **what was verified**, and **what remains unresolved/not run**, including meaningful N/A decisions and environment limits. Distinguish browser observation from automated assertions; do not claim universal accessibility, physical-device coverage, deployment, installation or publication without evidence. Mention relevant changed paths without dumping code or sensitive evidence.

## Copyable invocation

> Apply `template-ui-refinement` to build the requested new screens and/or refine this template’s relevant surfaces. Inspect the repo, nearest analogous screens and live desktop/mobile UI first. Reuse its brand, shared shell/navigation, page headings, primitives, tokens, field layouts, feedback/loading and dialogs; avoid duplicate shells and one-off style overrides. Preserve functionality/security and unrelated work. Extend shared variants only when necessary and check existing callers; do not import another template’s domain workflows. Verify rendered results, applicable states, responsive/keyboard behavior and shared-caller regressions, run the repo checks within the authorized scope, and report changes, verified results and remaining limits. Follow my newer references/instructions over defaults; do not commit or publish without permission.
