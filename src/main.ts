import 'reflect-metadata';
import { createApp } from './bootstrap';
import { loadConfig } from './common/config/config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
