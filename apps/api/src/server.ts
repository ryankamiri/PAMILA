import { buildApp } from "./app.js";
import { loadApiConfig } from "./config.js";

const app = buildApp();
const config = loadApiConfig();

try {
  await app.listen({
    host: config.host,
    port: config.port
  });

  app.log.info(`PAMILA API listening on http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
