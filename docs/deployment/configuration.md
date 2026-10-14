# Deployment configuration

Deployment is intentionally disabled until an approved target environment exists.

## Required values

| Placeholder | Required value | Where to set it |
|---|---|---|
| `TODO_DEPLOY_URL` | Approved destination URL | Protected GitLab CI/CD variable |
| `TODO_DEPLOY_TOKEN` | Protected deployment credential | Protected GitLab CI/CD variable |
| `TODO_DEPLOY_CERTIFICATE` | Approved certificate content or mounted path | Protected GitLab CI/CD variable or runner configuration |
| `TODO_BACKEND_START_COMMAND` | Exact production start command | Protected GitLab CI/CD variable |

## Activation checklist

1. Validate the target endpoint, authentication method, certificate handling, and rollback process.
2. Configure the four protected variables without committing their values.
3. Replace the manual `publish-template` command with the approved artifact publication process.
4. Replace the manual `deploy-template` command with the approved host-specific process.
5. Test the manual jobs from a non-production environment before allowing production use.

Tag pipelines expose manual publish and deploy templates only. They do not contact a host by default.
