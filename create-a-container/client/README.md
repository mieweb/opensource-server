# Manager Client

Vite + React 19 + TypeScript SPA for the Create-a-Container manager. Styles via Tailwind 4 and `@mieweb/ui` (BlueHive brand).

## Develop

```bash
npm install
npm run dev          # http://localhost:5173 (proxies /api, /login, /logout, /nginx-conf, /dnsmasq to Express)
```

Express must be running on `http://localhost:3000` (or set `VITE_API_TARGET`).

## Build

```bash
npm run build        # outputs to dist/, served by Express in production
```

## Layout

- `src/app/` — router, layouts, shell
- `src/styles/` — Tailwind + `@mieweb/ui` brand entry
