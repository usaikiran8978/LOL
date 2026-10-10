// postinstall: compile packages/shared (zod contracts shared with the admin and mobile apps).
// Skipped when the source or TypeScript is absent, e.g. a production-only install inside the Docker image.
const { existsSync } = require('node:fs');
const { execSync } = require('node:child_process');
if (existsSync('packages/shared/src') && existsSync('node_modules/typescript')) {
  execSync('npm run build -w @amora/shared', { stdio: 'inherit' });
}
