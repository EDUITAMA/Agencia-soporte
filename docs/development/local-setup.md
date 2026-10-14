# Local setup

## Prerequisites

- Node.js 22.22.3, selected by `.nvmrc`.
- npm 10.

## Install dependencies

```bash
npm install
npm install --prefix apps/backend
npm install --prefix apps/frontend/angular-app
```

Create a local backend configuration from `apps/backend/.env.example` and customize only local non-secret values.

## Commands

```bash
npm run dev
npm run back:dev
npm run front:dev
npm run test:all
npm run build:all
npm run smoke:backend
```

`npm run dev` starts both applications. Use `npm run stop-dev` to end local watchers when required.
