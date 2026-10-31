import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SectorStore } from "./store.mjs";
const store = new SectorStore(
  process.env.SECTOR_DATA_DIR ||
    fileURLToPath(new URL("../data/", import.meta.url)),
);
// Retain a rejected readiness promise for the route's error response, without an unhandled rejection at startup.
store.ready.catch(() => {});
const assets = new Map([
  ["", "index.html"],
  ["app.mjs", "app.mjs"],
  ["analytics.mjs", "analytics.mjs"],
  ["style.css", "style.css"],
  ["plotly.min.js", "plotly.min.js"],
]);
export async function sectorRoute(req, res, origin) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
  const route = new URL(req.url, origin).pathname.slice("/sectors/".length);
  const json = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    await store.ready;
    if (route === "api/update" && req.method === "POST") {
      if (
        req.headers.origin !== origin ||
        req.headers["x-vccl-request"] !== "sector-update"
      )
        return json(403, { error: "Invalid request origin" });
      const started = store.start();
      return json(202, { started, status: store.state });
    }
    if (req.method !== "GET") return json(405, { error: "Method not allowed" });
    if (route === "api/data") return json(200, store.snapshot());
    if (route === "api/status") return json(200, store.state);
    const asset = assets.get(route);
    if (!asset) return json(404, { error: "Not found" });
    res.setHeader(
      "Content-Type",
      asset.endsWith(".css")
        ? "text/css"
        : asset.endsWith(".mjs") || asset.endsWith(".js")
          ? "text/javascript"
          : "text/html; charset=utf-8",
    );
    res.end(await readFile(new URL("../public/" + asset, import.meta.url)));
  } catch (e) {
    console.error("Sector Strength:", e.message);
    return json(500, {
      error: "Unable to load sector history. Check the server data directory.",
    });
  }
}
