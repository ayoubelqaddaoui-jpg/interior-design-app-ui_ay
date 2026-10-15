# Supabase audit and phased implementation plan

## Audit (2026-10-15)

This is Expo SDK 57 / React Native / web, not a blank app. Preserve the repository interfaces in `src/data/repositories/types.ts`, composition root, Zustand shared state, draft hooks, navigation guards, i18next and all seed/Unsplash URLs.

- Local collections: tabs, tools, roomTypes, styles, palettes, sections, categories, inspirations, models, seed users/requests, guest history/conversations.
- Local documents: branding, theme, assistant and settings (search, fonts, navigation, exhibition layouts, bulk settings, default credits).
- `server/index.js`: authenticated request API, separate HttpOnly admin/user cookies (SecureStore tokens on native), rate limits, durable notification outbox and static hosting.
- `server/clients.js`: SQLite phone profiles, hashed sessions, atomic free/paid claims, streaming image hashes, spam signals and block preference OFF by default. Phone alone restores a profile; device/image/IP only flag suspicious accounts.
- `server/returning.js`: translated popup versions, phone-stable A/B assignment and deduplicated events/results.
- `server/notifications.js`: web push, FCM and other notification delivery with retry queue.
- Offers are hardcoded in `src/app/pro.tsx`; there is NO existing offer CRUD or payment processor. Rendering/chat/WhatsApp services are demos. Do not claim these are real delivery or purchases.
- Admin route guard currently trusts a device-local boolean plus the presence of a seed admin. It is a UI guard, not authorization. Node APIs separately authenticate real sessions. Model `apiKey` is currently a client-visible domain field: never seed real provider secrets to public content.
- Baseline has no Supabase dependencies, project credentials, local PostgreSQL, Docker or Supabase CLI. Live RLS, Auth, Storage and Realtime verification will require an operator's project.

## Decisions and compatibility

### Node, SQLite, push, spam and phone users

Keep the entire existing Node server and SQLite active. No schema migration or data deletion in the legacy server during this work. Supabase first replaces the content/document repository seam; Node continues handling requests, credits, phone users, notifications, spam and returning experiments until a separately verified migration and reconciliation. No dual writes or silent fallback of failed remote saves into local storage.

### Phone authentication (no OTP)

Preserve typed name + canonical phone and the existing independent Node user session. Without OTP, a phone is an **unverified claim**, not proof of ownership: anyone knowing a phone can restore its current space. Do not describe this as secure personal identity or move sensitive data under this model without accepting the privacy risk. A future Supabase replacement should use a dedicated user Supabase Auth client (anonymous device identity) plus an Edge Function to bind a normalized phone entitlement; cross-device restoration requires a separate recovery secret or explicit acceptance of the same impersonation risk. Do not silently change the user's flow, credit identity, or fabricate passwords.

### Admin authentication

Leave existing login unchanged by default. Add a separately stored Supabase Auth admin client and verify membership from a protected `admin_roles` table (not editable user metadata). Enable the Supabase content/admin path only behind an explicit rollout flag after the operator verifies real login, non-admin denial and logout against their project. Admin and phone session storage keys, APIs and ownership never mix. No default password or automatic admin grant. A server-side SQL operation by the project owner provisions membership.

### Edge Functions

Implement a protected content bootstrap endpoint: validated admin JWT + database role, atomic seed/import, rejection of API keys, no client service key. Provider inference, real WhatsApp/payment operations, phone-entitlement claiming, notification/outbox processing and streamed abuse collection need further Edge Function replacements before retiring Node. Provider credentials belong in function secrets/private server storage, never content documents.

## Phase 1 gate

Save this plan, run typecheck, lint, web export, existing UI regression suite and Node server suites. Commit the audit separately and publish a PR. Record failures honestly and stop the next phase until resolved.

## Phase 2: schema, Auth, RLS

Add versioned PostgreSQL migrations for content, documents, admin roles, profiles, relationships, owned requests/history/conversations, entitlements/claims, abuse/rate events, returning experiments, outbox, offers and media metadata. Every table uses default-deny RLS. Published content is public; drafts, model configs, profiles and administrative records are private. Storage policies protect admin uploads. Add two isolated Auth clients and role-checked admin auth functions, without switching the default login. Local automated contract tests are not a substitute for live RLS tests.

## Phase 3: data and storage

Implement typed Supabase repositories matching current interfaces, conditional composition, optimistic version checks and no simulated remote success. Migrate only after explicit bootstrap; never auto-seed from visitors. Preserve Node-backed user data. Centralize storage provider configuration and upload/get/delete/URL behavior, validate JPEG/PNG/WebP magic bytes/MIME and size, optimize existing photo flow, store path/metadata rather than persistent provider URLs, and preserve external demo URLs. Reuse existing submit-only drafts/previews and leave guards.

## Phase 4: sync, monitoring, performance, i18n

Use a single cleanup-aware Realtime connection per active data scope, debounced authoritative refetch, reconnect refresh and optimistic concurrency (duplicate events are invalidations, not mutations). Unsaved drafts remain in existing local hooks. Add translated connection/error UI, bounded read retries, offline signals and explicit failed-write behavior. Preserve existing server-side streaming abuse logic and test it again. Do not cache private admin/user data in public offline caches. Existing assets/fonts remain unchanged.

## Verification / delivery boundary

Each phase must pass web build, lint, typecheck and automated suites before proceeding and get its own commit. Provide setup/env names, migration/bootstrap/deployment/rollback steps and an itemized Done/Partial/Not started matrix. Live Supabase login/RLS/CRUD/upload/multi-device tests are blocked until project configuration is available; default admin must not be cut over beforehand. Test demo browser flows on mobile/desktop in Darija/Arabic/French and themes where feasible. Existing npm audit vulnerabilities must be reported rather than applying unreviewed breaking upgrades.
