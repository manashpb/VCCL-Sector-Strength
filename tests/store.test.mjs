import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SectorStore,
  parseDaily,
  datesThrough,
  key,
} from "../src/store.mjs";
import { compare } from "../public/analytics.mjs";
const date = "2026-10-30";
const csv =
  "Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value\n" +
  [
    "Nifty 50",
    "Nifty Bank",
    ...Array.from({ length: 8 }, (_, i) => "Index " + i),
  ]
    .map((n) => `${n},30-10-2026,100,120,90,110`)
    .join("\n");
test("NSE parsing validates dates, schema, OHLC and rejects HTML/block pages", () => {
  assert.equal(parseDaily(csv, date)["NIFTY 50"].close, 110);
  assert.throws(() => parseDaily(csv, "2026-10-29"), /date mismatch/);
  assert.throws(() => parseDaily("<html>blocked</html>", date), /format/);
  assert.equal(
    parseDaily(csv.replace("100,120,90,110", "100,95,90,110"), date)["NIFTY 50"]
      .open,
    null,
  );
  assert.equal(
    parseDaily(csv.replace("100,120,90,110", "-,-,-,110"), date)["NIFTY 50"]
      .close,
    110,
  );
  assert.equal(key(" NIFTY   Bank "), "NIFTY BANK");
  assert.equal(datesThrough("2026-10-31").at(-1), "2025-10-31");
});
test("incremental cache resumes, coalesces updates, retains data on blocking and rolls one year", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vccl-sectors-"));
  try {
    let requests = 0;
    const store = new SectorStore(dir, {
      clock: () => date,
      interval: 0,
      fetcher: async (url) => {
        requests++;
        return url.includes("30102026")
          ? new Response(csv)
          : new Response("", { status: 404 });
      },
    });
    await store.ready;
    assert.equal(store.start(), true);
    assert.equal(store.start(), false);
    await store.job;
    assert.equal(store.state.error, null);
    assert.equal(store.snapshot().lastDataDate, date);
    const count = requests;
    store.start();
    await store.job;
    assert.equal(requests, count);
    const saved = JSON.parse(
      await readFile(path.join(dir, "history.json"), "utf8"),
    );
    assert.equal(Object.keys(saved.days).length, 1);
    const resumed = new SectorStore(dir, {
      clock: () => "2026-10-31",
      interval: 0,
      fetcher: async () => new Response("blocked", { status: 403 }),
    });
    await resumed.ready;
    resumed.start();
    await resumed.job;
    assert.match(resumed.state.error, /403/);
    assert.equal(resumed.snapshot().lastDataDate, date);
    assert.equal(resumed.state.running, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("returns use common closing dates, rank sectors, preserve signs and identify missing history", () => {
  const points = (a, b) => [
    { date: "2026-10-26", close: a },
    { date: "2026-10-30", close: b },
  ];
  const indices = {
    B: { name: "Benchmark", points: points(100, 110) },
    UP: { name: "Up", sector: true, points: points(100, 120) },
    DOWN: { name: "Down", sector: true, points: points(100, 95) },
    LATE: {
      name: "Late",
      sector: true,
      points: [{ date: "2026-10-30", close: 10 }],
    },
    STALE: {
      name: "Stale",
      sector: true,
      points: [{ date: "2026-10-26", close: 10 }],
    },
  };
  const result = compare(indices, "B", "2026-10-25");
  assert.equal(result.baseDate, "2026-10-26");
  assert.ok(Math.abs(result.benchmarkReturn - 10) < 1e-9);
  assert.deepEqual(
    result.rows.map((r) => r.id),
    ["UP", "DOWN", "LATE", "STALE"],
  );
  assert.equal(result.rows[0].points[0].value, 0);
  assert.ok(result.rows[0].excess > 0);
  assert.ok(result.rows[1].value < 0);
  assert.equal(result.rows[2].available, false);
  assert.equal(compare(indices, "B", "2026-10-31"), null);
  assert.equal(compare(indices, "B", "2026-10-30").benchmarkReturn, 0);
});

test("a separate updater cannot overwrite a live updater cache", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vccl-sector-lock-"));
  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "update.lock"), String(process.pid));
    let called = false;
    const store = new SectorStore(dir, {
      fetcher: async () => {
        called = true;
        throw Error("unexpected");
      },
    });
    await store.ready;
    store.start();
    await store.job;
    assert.match(store.state.error, /Another sector updater/);
    assert.equal(called, false);
    assert.equal(
      await readFile(path.join(dir, "update.lock"), "utf8"),
      String(process.pid),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("temporary NSE blocking retries with backoff then stops without damaging history", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vccl-sector-retry-"));
  try {
    let calls = 0;
    const waits = [];
    const store = new SectorStore(dir, {
      clock: () => "2026-10-31",
      sleeper: async (ms) => waits.push(ms),
      fetcher: async () => {
        calls++;
        return new Response("Akamai blocked", { status: 503 });
      },
    });
    await store.ready;
    store.cache.days[date] = parseDaily(csv, date);
    await store.save();
    store.start();
    await store.job;
    assert.equal(calls, 3);
    assert.deepEqual(waits, [5000, 10000]);
    assert.match(store.state.error, /503/);
    assert.equal(store.snapshot().lastDataDate, date);
    assert.equal(store.cache.unavailable["2026-10-31"], undefined);
    assert.equal(store.cache.lastChecked, null);
    assert.equal(
      JSON.parse(await readFile(path.join(dir, "history.json"), "utf8")).days[
        date
      ]["NIFTY 50"].close,
      110,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
