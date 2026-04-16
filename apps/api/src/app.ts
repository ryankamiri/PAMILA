import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({
    logger: false
  });

  app.get("/health", async () => ({
    service: "pamila-api",
    status: "ok"
  }));

  return app;
}
