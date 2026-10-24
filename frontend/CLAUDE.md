# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Angular 22 SPA for the "Notas da Turma" grade viewer (see the root `README.md`). It talks to the Go
API in `../backend` through `/api` (dev: `proxy.conf.json` → `localhost:8080`; prod: nginx in
`nginx.conf` → `backend:8080`). SSR was removed on purpose: the app is auth-only and served as static
files by nginx.

The reference input `docs/Notas 3° Bim João Briene 2026.xlsx` contains real minors' names — keep it
out of git, fixtures, logs, screenshots and anything published. Use synthetic names in tests.

## Commands

```bash
npm start        # ng serve at http://localhost:4200 (needs the backend on :8080)
npm run build    # production build to dist/brunog-notas/browser
npm test         # Vitest (jsdom) via @angular/build:unit-test
npx prettier --write .
```

## Architecture

- Standalone components, signals, SCSS, lazy routes (`app.routes.ts`). Component prefix `app`.
- `core/`: `api.service.ts` (all HTTP calls + `apiError`), `auth.service.ts` (session in
  localStorage, interceptor, guard), `term.service.ts` (selected bimester shared across pages),
  `ui.service.ts` (theme, TV mode, short names, passing grade), `stats.ts` (pure stats and
  `cellView`, the single source of how a grade is classified/displayed), `models.ts`.
- `shared/`: `ChartComponent` (Chart.js wrapper taking a config *factory* so colors re-read CSS
  variables on theme change), `GradeCellComponent`, `BreakdownComponent` ("why is the grade X"),
  pipes `studentName` / `score`.
- `pages/`: login, shell (top bar), overview, class-board (ranking / grade-table / class-stats /
  board-editor), student, import, account.
- Totals and ranks come from the backend (`Board`); per-class statistics and filters are computed
  client-side from the board.
- Colors are CSS tokens in `src/styles.scss` (dark default, `[data-theme=light]`). Grade tones
  (`.tone-full`, `.tone-absent`, …) always pair color with an icon and a label.

## Conventions

- Prettier: `printWidth: 100`, single quotes. 2-space indent.
- Strict TypeScript and strict templates.
- Budgets: initial 900 kB warn / 1.5 MB error; component styles 12 kB warn / 20 kB error.
- UI text is Brazilian Portuguese.
