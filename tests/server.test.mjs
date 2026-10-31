import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { datesThrough, todayIST } from "../src/store.mjs";
test("independent server protects assets, verifies shared session, checks Origin and updates cached data", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vccl-sector-http-"));
  let active = true;
  let verificationStatus = 204;
  const verifier = createServer((req, res) => {
    res.writeHead(
      req.url === "/verify" &&
        req.headers.cookie === "trading_session=test" &&
        active
        ? verificationStatus
        : 401,
    );
    res.end();
  });
  await new Promise((r) => verifier.listen(0, "127.0.0.1", r));
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  await writeFile(
    path.join(dir, "history.json"),
    JSON.stringify({
      days: {},
      unavailable: Object.fromEntries(
        datesThrough(todayIST()).map((d) => [d, Date.now()]),
      ),
      lastChecked: null,
    }),
  );
  const origin = `http://127.0.0.1:${port}`;
  const proc = spawn(
    process.execPath,
    [fileURLToPath(new URL("../server.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        SECTOR_PORT: String(port),
        PORTAL_PORT: String(verifier.address().port),
        PORTAL_ORIGIN: origin,
        SECTOR_DATA_DIR: dir,
      },
    },
  );
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(origin);
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    assert.ok(ready);
    for (const route of ["/sectors/", "/sectors/app.mjs", "/sectors/api/data"])
      assert.equal((await fetch(origin + route)).status, 401);
    const headers = { Cookie: "trading_session=test" };
    const page = await fetch(origin + "/sectors/", { headers });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Cumulative returns comparison/);
    assert.match(
      page.headers.get("content-security-policy"),
      /script-src 'self'/,
    );
    assert.equal(
      (await fetch(origin + "/sectors/app.mjs", { headers })).status,
      200,
    );
    assert.equal(
      (await fetch(origin + "/data/history.json", { headers })).status,
      404,
    );
    assert.equal(
      (
        await fetch(origin + "/sectors/api/update", {
          method: "POST",
          headers: {
            ...headers,
            Origin: "https://evil.example",
            "X-VCCL-Request": "sector-update",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + "/sectors/api/update", {
          method: "POST",
          headers: { ...headers, Origin: origin },
        })
      ).status,
      403,
    );
    const update = await fetch(origin + "/sectors/api/update", {
      method: "POST",
      headers: {
        ...headers,
        Origin: origin,
        "X-VCCL-Request": "sector-update",
      },
    });
    assert.equal(update.status, 202);
    for (let i = 0; i < 100; i++) {
      const s = await (
        await fetch(origin + "/sectors/api/status", { headers })
      ).json();
      if (!s.running) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const data = await (
      await fetch(origin + "/sectors/api/data", { headers })
    ).json();
    assert.ok(data.lastChecked);
    assert.equal(data.status.error, null);
    assert.equal(data.status.downloaded, 0);
    verificationStatus = 500;
    assert.equal(
      (await fetch(origin + "/sectors/api/data", { headers })).status,
      503,
    );
    active = false;
    assert.equal(
      (await fetch(origin + "/sectors/app.mjs", { headers })).status,
      401,
    );
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) {
      const stopped = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await stopped;
    }
    await new Promise((r) => verifier.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
