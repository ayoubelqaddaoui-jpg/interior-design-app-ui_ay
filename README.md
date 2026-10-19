# Dwira — AI interior design (Android · iOS · Web)

One Expo codebase (SDK 57, Expo Router, TypeScript, NativeWind, Zustand, i18next, Reanimated).
Hybrid app: content repositories retain their existing mock/local implementation. User sessions, credits, image spaces, requests, spam monitoring and returning-user experiments use the persistent backend in `server/`.

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

## Deploy on Vercel
The web build is a static single-page export. Vercel serves the UI only; it does NOT start `server/index.js` or provide persistent SQLite. For sessions/spam tracking, use the full-stack hosting instructions below or proxy `/api` to a persistent backend. Do not deploy the SQLite/JSON backend as an ephemeral Vercel function.
1. Import the repo in Vercel (framework preset: **Other**). `vercel.json` already sets everything:
   install `npm ci`, build `npm run build:web`, output `dist`, SPA rewrite (`/admin`, `/explore`… -> `index.html`) and long-term caching for hashed assets.
2. Or from the CLI: `npx vercel --prod`.
3. Node 20+ is required (`engines` in `package.json`).

Why `scripts/postexport.js`? Vercel never serves paths containing a `node_modules` segment, but `expo export` writes package fonts/images
(icon font, router icons) to `dist/assets/node_modules/...`. The script moves them to `dist/assets/vendor/...` and rewrites all references, and fails the build if any are left.

## Admin: interface options
- **Dashboard**: 7/30/90-day KPIs with trend vs the previous period, activity chart, search (requests, users, tools, styles, rooms), best features, recent activity, quick actions.
- **Interface & menus** (`/admin/interface`): choose the user bottom bar (Classic / Floating / Minimal) and the admin menu (icon rail / collapsible drawer / grouped horizontal menu). Stored in `settings.userNavStyle` / `settings.adminNavMode`.
- **Home tabs** (`/admin/tabs`): switch "show all tools by default" (`settings.homeShowAll`). When on, Home opens on an "All" pill and tabs are an optional filter.
- **Theme** (`/admin/theme`): 20 presets in 6 categories + custom (5 colours, the rest derived with contrast checks).
- The AI model is chosen by the admin per tool (default model fallback); end users never see a model picker.

## Full-stack hosting and the two “connect server” errors

Both errors occur when only `dist/` is hosted and/or `EXPO_PUBLIC_API_URL` was missing. Web now defaults to `/api` on the same host. It does **not** manufacture local users, reset free counters or expose spam data to bypass a missing backend. `/api` must reach the real backend, not the SPA fallback. `/api/health` returns JSON with `ok`, `runtime`, and `adminConfigured`; HTML means routing is wrong.

### No Node.js server: Bun 1.3.14+ (supported alternative)

Bun executes the existing backend JavaScript with native `bun:sqlite`. All existing tables, phone spaces, hashes, admin credentials, session cookies and notification jobs are reused. Node.js is still required by Expo to **build** the frontend, but is not needed to **run** the backend or serve the built site. A JavaScript runtime is still necessary; Bun is not a PHP backend.

1. Build the UI on your workstation or CI: `npm ci && npm run build:web`. Do not set `EXPO_PUBLIC_API_URL` for same-origin hosting. To intentionally run the old UI-only demo, build with `EXPO_PUBLIC_BACKEND_MODE=demo` (no real user login/spam tracking).
2. Install Bun on a server/container that supports long-running processes. Put `dist/` and `server/` alongside each other. In `server/`, run `bun install --frozen-lockfile` (Bun supports the existing npm lockfile).
3. Configure the server environment using `server/.env.example` as a template; do not put secrets in Expo public variables or in `dist/`. Bun automatically reads `server/.env` when started from `server/`.
4. Generate an admin password hash: `ADMIN_PASSWORD='choose-a-long-unique-password' bun server/password.js` from the project root. Put only the returned salted hash in `ADMIN_PASSWORD_HASH`. Use your own `ADMIN_EMAIL`; the frontend demo credentials do not authorize real API access.
5. Run from `server/`: `bun index.js` (or `bun run start:bun`). This serves **both** the API and `../dist` on port 8080. Use a process supervisor/container restart policy in production. Persist `server/data/` (or the absolute `DATA_FILE` / `CLIENT_DB` paths) on a private durable volume; never serve this directory publicly. Run only one replica with the existing JSON store. Back up both the JSON file and SQLite with a consistent stopped-server backup before switching runtimes.
6. Put HTTPS in front of port 8080. Keep `COOKIE_SECURE=true` in production. The proxy must preserve `Host`; if using IP-based spam signals, strip incoming `X-Real-IP`, set it to the actual client IP, and set `TRUSTED_PROXY_IPS` to only the immediate proxy addresses. Without that setup, requests safely use the socket IP, but all visitors behind the proxy may be flagged as related; leave blocking OFF until configured.
7. Check `https://your-domain/api/health`, log in again at `/admin` using the server credentials, and open `/admin/spam`. First use shows 0/0, an empty-table message and the OFF switch, not a configuration-only page.

For an Apache frontend, configure a virtual-host reverse proxy **before** the SPA rewrite (requires server/hosting-provider access):

```apache
ProxyPreserveHost On
ProxyPass /api/ http://127.0.0.1:8080/api/
ProxyPassReverse /api/ http://127.0.0.1:8080/api/
```

The shipped `.htaccess` intentionally returns 503 for unproxied API routes instead of returning HTML with status 200. A static-only shared hosting plan cannot run this backend, whether Node or Bun. Use a VPS/container service with a persistent volume, or upgrade the plan; uploading JavaScript and changing `.htaccess` alone will not start it.

For a separately hosted API, set `EXPO_PUBLIC_API_URL=https://api-host/api` **before building** (required for Android/iOS). Set `APP_ORIGINS` on the backend to the frontend HTTPS origin(s). Prefer a same-origin reverse proxy on web: the current secure SameSite=Strict cookies are intentionally not weakened for unrelated cross-site domains.

### Checks

```bash
npm run typecheck
npm run lint
node --test scripts/check-backend-config.js scripts/check-push-server.js scripts/check-client-server.js scripts/check-returning-server.js
bun test ./scripts/check-push-server.js ./scripts/check-client-server.js ./scripts/check-returning-server.js
```

A/B “purchases” remain existing demo Pro confirmations, not verified payments. Phone-only login also remains the existing behavior (no OTP verification); do not treat knowledge of a phone number as production-grade proof of identity.
