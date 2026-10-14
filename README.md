# Nuevo Proyecto

Base independiente y genérica para futuros productos web.

## Requisitos

- Node.js 22.22.3
- npm 10

## Instalación

```bash
npm install
npm install --prefix apps/backend
npm install --prefix apps/frontend/angular-app
copy apps\backend\.env.example apps\backend\.env
```

## Desarrollo

```bash
npm run dev
```

El backend se expone en `http://localhost:3000`; el frontend usa `http://localhost:4200` y redirige `/api` al backend durante el desarrollo.

## Verificación

```bash
npm run validate
npm run test:all
npm run build:all
npm run smoke:backend
```

## Estructura

- `apps/backend`: API Node.js y TypeScript sin persistencia inicial.
- `apps/frontend/angular-app`: aplicación Angular inicial.
- `deploy`: plantillas y puntos de extensión de entrega.
- `docs`: documentación de arquitectura, configuración y desarrollo.
- `local-fixtures`: datos locales no versionados.

Consulta `docs/architecture/repository-layout.md` para el detalle completo.
