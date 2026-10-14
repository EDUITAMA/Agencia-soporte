# aXet Flows mock host — projects proxy

This is **part of the aXet Flows mock host**, not part of the application built
with this template. It exists only so the local mock (`data-mock.js`) can
reproduce the host's "select a project" screen during development.

## Why this server exists

The real aXet Flows shell talks to aXet Core (`AXET_CORE_URL`) server-to-server.
aXet Core does **not** send CORS headers, so a browser served from
`http://localhost:4200` cannot call it directly — the request is blocked by the
same-origin policy. This tiny Node process runs outside the browser and performs
those calls on the mock's behalf, exactly like the real host would.

It is a **mock artifact**: once shipped in the template it is immutable for the
developments built on top of it, the same way `index.html`, `data-mock.js` and
the host asset folders are.

## What it does

Exposes a single endpoint on `http://localhost:4300`:

```
GET /mock-api/projects
Headers: Authorization: Bearer <access_token>
```

`<access_token>` is the Okta access token found inside
`getUserInfo().jwt` → payload `access_token`. With it, the proxy:

1. Decodes the token to read the Okta id (`uid` / `okta_id` / `sub`).
2. `GET  {AXET_CORE_URL}/users/:oktaId` → reads the `projects` id array.
3. `POST {AXET_CORE_URL}/projects/search` with those ids → reads
   `data[].{id,displayName}`.
4. Returns `[{ id, displayName }, ...]` (empty array if the user has none).

`AXET_CORE_URL` is read from `backend/.env` (falls back to
`https://axet.nttdata.com/api/core/v1`). TLS verification is disabled because
aXet Core uses a corporate certificate that may not be in the local trust store
(same as the `mysql-connection` skill).

## Excluded from build & deploy

This folder lives next to the Angular app but is **never** part of the frontend
build or the `frontend.zip`. The zip is created only from
`frontend/dist/browser` (Angular's output). Nothing here is compiled, bundled,
linted or shipped to the host.

## Run

Started automatically by `npm run front:dev` (via `concurrently`). Standalone:

```bash
node frontend/mock-server/projects-proxy.mjs
```
