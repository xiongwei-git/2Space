import { buildApp } from "./app.js";
const trustedProxies = process.env.TRUSTED_PROXIES?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const app = await buildApp({ trustedProxies });
const port = Number(process.env.PORT ?? 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid TCP port");
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
console.log(`2Space listening on port ${port}`);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
