export interface ApiConfig {
  host: string;
  port: number;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.PAMILA_API_PORT ?? "7410");

  return {
    host: env.PAMILA_API_HOST ?? "127.0.0.1",
    port: Number.isFinite(port) ? port : 7410
  };
}
