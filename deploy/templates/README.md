# Deployment templates

Before enabling publish or deploy, a responsible person must provide:

1. `TODO_DEPLOY_URL`: approved destination URL.
2. `TODO_DEPLOY_TOKEN`: protected CI/CD secret with deployment authorization.
3. `TODO_DEPLOY_CERTIFICATE`: approved certificate material or mounted certificate path.
4. `TODO_BACKEND_START_COMMAND`: the exact command used by the target host.

Copy the example files outside version control, replace every placeholder, and update the manual CI jobs with the approved host-specific transport commands. The provided pipeline deliberately does not contact any host.
