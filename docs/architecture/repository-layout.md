# Repository layout

| Path | Purpose |
|---|---|
| `apps/backend` | Node.js and TypeScript API; persistence adapters can be added here later. |
| `apps/backend/src` | API composition, routes, configuration, and future infrastructure boundaries. |
| `apps/backend/test` | Isolated backend tests. |
| `apps/frontend/angular-app` | Angular client application. |
| `deploy/bootstrap` | Reserved for generated bootstrap artifacts; generated files are ignored. |
| `deploy/scripts` | Approved host-specific deployment scripts when available. |
| `deploy/gitlab` | GitLab support files and future reusable CI snippets. |
| `deploy/templates` | Safe configuration examples with explicit placeholders. |
| `docs` | Architecture, deployment, and local-development guidance. |
| `local-fixtures` | Developer-only fixtures, ignored except its README. |
| `scripts` | Cross-project validation, smoke testing, and development utilities. |
