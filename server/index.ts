import { buildApp } from './app.ts';
import { type AppConfig, ConfigError, loadConfig } from './config.ts';
import { type Database, openDatabase } from './db/database.ts';

function fail(message: string): never {
  console.error(`\n[server] ${message}\n`);
  process.exit(1);
}

let config: AppConfig;
try {
  config = loadConfig();
} catch (err) {
  fail(err instanceof ConfigError ? err.message : `Could not load configuration: ${String(err)}`);
}

let db: Database;
try {
  db = openDatabase(config.databasePath);
} catch (err) {
  fail(`Could not open database at "${config.databasePath}": ${err instanceof Error ? err.message : String(err)}`);
}

const app = buildApp({ config, db });

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  db.close();
  fail(`Could not start server on ${config.host}:${config.port}: ${err instanceof Error ? err.message : String(err)}`);
}
