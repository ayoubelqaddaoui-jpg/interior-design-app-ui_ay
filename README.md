# Dwira — AI interior design (Android · iOS · Web)

One Expo codebase (SDK 57, Expo Router, TypeScript, NativeWind, Zustand, i18next, Reanimated).
Hybrid app: content repositories retain their existing mock/local implementation. User sessions, credits, image spaces, requests and admin notifications use the Postgres-backed API in `server/` (served on Vercel through `api/index.js`).

## Run
```bash
npm install
npx expo start        # then press a (Android) / i (iOS) / w (web)
npm run web           # web only (responsive: centred layout, desktop top nav)
npm run typecheck
npm run build:web     # static export to dist/ (+ Vercel-safe asset post-processing)
npm run serve:web     # serve dist/ locally with the same SPA fallback as Vercel
npm run check:themes  # WCAG contrast report for the 20 theme presets
```
- User app: `/` · Admin panel: `/admin`. Default login everywhere (real and demo mode): user `admin` / password `admin`. Custom server credentials (`ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH`) also work in addition.
- Languages: Moroccan Darija (default, RTL), Arabic (RTL), French — Settings → Language.
- Admin edits write to the same Zustand store the user app reads, so they apply instantly.

## Architecture
```
src/
  app/            Expo Router routes ((tabs), tool, render, lead, result, explore, chat, settings, pro, admin/*)
  components/     ui/ (Card, MediaView, StepHeader, GridSelector, Sheet…), wizard/, result/, admin/ (CrudTable, FormModal…)
  admin/entities  ONE config per CRUD entity -> one generic CrudScreen
  data/types.ts   domain model (LText = {dar, ar, fr})
  data/repositories/{types,index}.ts   interfaces + composition root (the ONLY file to change for a backend)
  data/mock/      in-memory + AsyncStorage implementations, seed data, mock services
  store/ theme/ i18n/ hooks/ lib/
```

## Mock repositories to replace later (`src/data/repositories/index.ts`)
Collections (`CollectionRepo<T>`): `tabs`, `tools`, `roomTypes`, `styles`, `palettes`, `sections`, `categories`, `inspirations`, `models`, `users`, `requests`, `history`, `conversations`.
Documents (`DocRepo<T>`): `branding`, `theme`, `assistant`, `settings`.
Services (`Services`): `render` (AI image generation), `chat` (assistant LLM), `auth` (admin login), `upload` (file storage), `whatsapp` (send design).

## Deploy on Vercel (UI + API)
`vercel.json` builds the static web export **and** exposes the backend as a Vercel Function (`api/index.js` -> `server/index.js`). The backend needs a Postgres database; without one every `/api/*` call answers `503 DATABASE_NOT_CONFIGURED` and `/lead` shows "service temporairement indisponible".
1. Import the repo in Vercel (framework preset: **Other**); install/build/output are set in `vercel.json`.
2. **Project -> Storage -> Create Database -> Neon (Postgres)** and connect it to the project (Production + Preview). Vercel injects `DATABASE_URL` / `POSTGRES_URL`; tables are created automatically on first request.
3. Redeploy, then open `https://<your-domain>/api/health`: it must return `{"ok":true,"database":"pg",...}`. Then test `/lead`.
4. Admin login at `/admin`: `admin` / `admin` by default. For real credentials set `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (`ADMIN_PASSWORD='...' node server/password.js`) and then `DISABLE_DEFAULT_ADMIN=true`.
5. Optional environment variables: `CRON_SECRET` (protects `/api/push/pump`), `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (otherwise generated and stored in the database), `FCM_SERVICE_ACCOUNT_JSON` (native Android app). See `server/.env.example`.
6. Node 22.13+ is required (`engines` in `package.json`).

### "Notifications des nouvelles demandes" (admin)
Open `/admin` and tap **Activer les notifications**, then **Envoyer un test**. Works on desktop Chrome/Edge/Firefox/Safari, Android Chrome, and the Android app. On iPhone/iPad, first use Safari **Share -> Add to Home Screen**, open Dwira from that icon, then enable notifications (Apple only allows web push for installed web apps). New requests are pushed from `POST /api/requests`; failed pushes are retried by the daily cron (`/api/push/pump`, Vercel Hobby allows daily crons only).

Why `scripts/postexport.js`? Vercel never serves paths containing a `node_modules` segment, but `expo export` writes package fonts/images
(icon font, router icons) to `dist/assets/node_modules/...`. The script moves them to `dist/assets/vendor/...` and rewrites all references, injects the web app manifest/iOS meta tags, and fails the build if any are left.

## Admin: interface options
- **Dashboard**: 7/30/90-day KPIs with trend vs the previous period, activity chart, search (requests, users, tools, styles, rooms), best features, recent activity, quick actions.
- **Interface & menus** (`/admin/interface`): choose the user bottom bar (Classic / Floating / Minimal) and the admin menu (icon rail / collapsible drawer / grouped horizontal menu). Stored in `settings.userNavStyle` / `settings.adminNavMode`.
- **Home tabs** (`/admin/tabs`): switch "show all tools by default" (`settings.homeShowAll`). When on, Home opens on an "All" pill and tabs are an optional filter.
- **Theme** (`/admin/theme`): 20 presets in 6 categories + custom (5 colours, the rest derived with contrast checks).
- The AI model is chosen by the admin per tool (default model fallback); end users never see a model picker.

## Local full stack
```bash
npm run build:web
PGLITE_DIR=:memory: COOKIE_SECURE=false npm run start:server   # API + dist on http://localhost:8080 (in-process Postgres, no install)
```
Without `PGLITE_DIR`, data is stored in `server/data/pglite`. Set `DATABASE_URL` to use a real Postgres instead. `/api/health` returns JSON with `ok`, `runtime`, `database` and `adminConfigured`; HTML means `/api` routing is wrong. For a separately hosted API, set `EXPO_PUBLIC_API_URL=https://api-host/api` **before building** (required for Android/iOS) and `APP_ORIGINS` on the backend. To intentionally run the UI-only demo, build with `EXPO_PUBLIC_BACKEND_MODE=demo`.

### Checks
```bash
npm run typecheck
npm run lint
npm run test:server        # backend (in-memory Postgres), push, config
# with the local full stack running (use API_RATE_LIMIT=5000):
node scripts/check-client-browser.js   # lead flow, sessions, admin menu
node scripts/check-push-browser.js     # notification button desktop/mobile/iOS hint
```
Phone-only login is the existing behavior (no OTP verification); do not treat knowledge of a phone number as production-grade proof of identity. Real push delivery to Google/Apple and physical devices remain manual checks.
