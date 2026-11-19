import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

const server = Fastify({ logger: true });

server.get("/api/health", async () => ({ status: "ok" }));

const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/dist");
if (existsSync(webDist)) {
  await server.register(fastifyStatic, { root: webDist });
}

server.listen({ host: "127.0.0.1", port: 3000 }).catch((err: unknown) => {
  server.log.error(err);
  process.exitCode = 1;
});
