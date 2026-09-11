import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const app = buildApp({ config, db });

app
  .listen({ port: config.port, host: '127.0.0.1' })
  .then(() => {
    app.log.info(`Wallet API listening on http://127.0.0.1:${config.port} (mode=${config.wallet.mode})`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
