import "dotenv/config";
import path from "path";
import { createApp } from "./server/app";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
// Собранный бандл (dist-server/) всегда работает как production
const isProd = process.env.NODE_ENV === "production" || import.meta.url.includes("/dist-server/");
if (isProd) process.env.NODE_ENV = "production";

async function main() {
  const { server, close } = await createApp({
    vite: !isProd,
    staticDir: isProd ? path.resolve(process.env.STATIC_DIR || "dist") : undefined,
  });

  if (!process.env.ADMIN_TOKEN) {
    console.warn("[nexus] ADMIN_TOKEN не задан: настройки ИИ может менять любой посетитель. Для публичного сервера задайте ADMIN_TOKEN.");
  }

  server.listen(PORT, HOST, () => console.log(`[nexus] сервер запущен: http://localhost:${PORT} (${isProd ? "production" : "development"})`));

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[nexus] ${signal}: завершаем работу...`);
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    await close().catch(e => console.error(e));
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", e => console.error("[nexus] unhandledRejection", e));
}

main().catch(e => {
  console.error("[nexus] не удалось запустить сервер", e);
  process.exit(1);
});
