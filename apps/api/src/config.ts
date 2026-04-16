export interface ApiConfig {
  databaseUrl: string;
  host: string;
  localToken: string;
  port: number;
  webOrigin: string;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.PAMILA_API_PORT ?? "7410");

  return {
    databaseUrl: env.PAMILA_DATABASE_URL ?? "file:data/pamila.sqlite",
    host: env.PAMILA_API_HOST ?? "127.0.0.1",
    localToken: env.PAMILA_LOCAL_TOKEN ?? "dev-local-token",
    port: Number.isFinite(port) ? port : 7410,
    webOrigin: env.PAMILA_WEB_ORIGIN ?? "http://localhost:5173"
  };
}
