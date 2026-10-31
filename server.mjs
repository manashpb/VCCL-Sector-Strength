import http from "node:http";
import { sectorRoute } from "./src/routes.mjs";
const port = Number(process.env.SECTOR_PORT || 5006);
const portalPort = Number(process.env.PORTAL_PORT || 5001);
const origin = process.env.PORTAL_ORIGIN || "http://127.0.0.1:5001";
for (const value of [port, portalPort])
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw Error("Invalid Sector Strength/portal port");
if (new URL(origin).origin !== origin)
  throw Error("PORTAL_ORIGIN must be an exact origin without trailing slash");
export const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  const json = (status, error) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error }));
  };
  let verification;
  try {
    verification = await fetch(`http://127.0.0.1:${portalPort}/verify`, {
      headers: { Cookie: req.headers.cookie || "" },
      signal: AbortSignal.timeout(4000),
      redirect: "error",
    });
  } catch {
    return json(503, "Workspace login service unavailable");
  }
  if (verification.status !== 204) {
    await verification.body?.cancel();
    return json(
      verification.status === 401 ? 401 : 503,
      verification.status === 401
        ? "Workspace session expired. Sign in again."
        : "Workspace login service unavailable",
    );
  }
  if (req.url === "/" || req.url === "/sectors") {
    res.writeHead(303, { Location: "/sectors/" });
    return res.end();
  }
  if (!req.url.startsWith("/sectors/")) return json(404, "Not found");
  try {
    await sectorRoute(req, res, origin);
  } catch {
    return json(500, "Unable to serve Sector Strength");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Sector Strength: http://127.0.0.1:${port}/sectors/ (workspace authentication)`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
