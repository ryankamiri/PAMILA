export interface ApiConfig {
  databaseUrl: string;
  geocoderUrl: string;
  host: string;
  localToken: string;
  openAiApiKey: string | null;
  openAiModel: string;
  otpUrl: string;
  port: number;
  webOrigin: string;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.PAMILA_API_PORT ?? "7410");

  return {
    databaseUrl: env.PAMILA_DATABASE_URL ?? "file:data/pamila.sqlite",
    geocoderUrl: env.PAMILA_GEOCODER_URL ?? "https://nominatim.openstreetmap.org/search",
    host: env.PAMILA_API_HOST ?? "127.0.0.1",
    localToken: env.PAMILA_LOCAL_TOKEN ?? "dev-local-token",
    openAiApiKey: env.OPENAI_API_KEY?.trim() || null,
    openAiModel: env.PAMILA_OPENAI_MODEL ?? "gpt-5",
    otpUrl: env.PAMILA_OTP_URL ?? "http://127.0.0.1:8080/otp/gtfs/v1",
    port: Number.isFinite(port) ? port : 7410,
    webOrigin: env.PAMILA_WEB_ORIGIN ?? "http://localhost:5173"
  };
}
