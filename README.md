# Dwira — AI interior design (Android · iOS · Web)

One Expo codebase (SDK 57, Expo Router, TypeScript, NativeWind, Zustand, i18next, Reanimated).
No backend: every screen talks to typed repository interfaces backed by mock implementations.

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
- User app: `/` · Admin panel: `/admin` (demo login `admin@dwira.app` / `admin123`).
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
The web build is a static single-page export, so it runs on Vercel with no server.
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
