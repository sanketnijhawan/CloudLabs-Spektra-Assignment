import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  db,
  seed,
  getDashboard,
  getEnvironment,
  reprovision,
  simulateTick,
} from "./db.mjs";
import { getInsights } from "./insights.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function respond(res, status, payload) {
  const value = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(value);
}
async function body(req) {
  let count = 0;
  for await (const chunk of req) {
    count += chunk.length;
    if (count > 16_384)
      throw Object.assign(new Error("Body too large"), { status: 413 });
  }
}
async function staticFile(res, pathname) {
  const target = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC, `.${target}`);
  if (!filePath.startsWith(PUBLIC + path.sep))
    return respond(res, 403, { error: "Forbidden" });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return respond(res, 404, { error: "Not found" });
    res.writeHead(200, {
      "Content-Type":
        MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(await readFile(filePath));
  } catch {
    respond(res, 404, { error: "Not found" });
  }
}

seed();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const route = url.pathname;
    if (req.method === "GET" && route === "/api/health")
      return respond(res, 200, {
        ok: true,
        server_time: new Date().toISOString(),
        simulation: "running",
      });
    if (req.method === "GET" && route === "/api/dashboard") {
      const params = Object.fromEntries(url.searchParams.entries());
      return respond(res, 200, getDashboard(params));
    }
    if (
      req.method === "GET" &&
      /^\/api\/environments\/LAB-\d{3}$/.test(route)
    ) {
      const env = getEnvironment(route.split("/").at(-1));
      return respond(
        res,
        env ? 200 : 404,
        env || { error: "Environment not found" },
      );
    }
    if (
      req.method === "POST" &&
      /^\/api\/environments\/LAB-\d{3}\/reprovision$/.test(route)
    ) {
      await body(req);
      const result = reprovision(route.split("/")[3]);
      return respond(
        res,
        result.status,
        result.ok ? result.environment : { error: result.error },
      );
    }
    if (req.method === "POST" && route === "/api/insights") {
      await body(req);
      return respond(res, 200, await getInsights());
    }
    if (route.startsWith("/api/"))
      return respond(res, 404, { error: "No such API endpoint" });
    if (req.method !== "GET")
      return respond(res, 405, { error: "Method not allowed" });
    return staticFile(res, route);
  } catch (err) {
    console.error("[cloudlabs]", err);
    return respond(res, err.status || 500, {
      error: err.status ? err.message : "Internal server error",
    });
  }
});
const drift = setInterval(() => {
  try {
    simulateTick();
  } catch (e) {
    console.error("[simulation]", e);
  }
}, 12000);
drift.unref();
server.listen(PORT, () =>
  console.log(
    `\nCloudLabs Workshop Operations → http://localhost:${PORT}\n120 seeded labs · SQLite · polling · server-side simulation\n`,
  ),
);
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(drift);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
