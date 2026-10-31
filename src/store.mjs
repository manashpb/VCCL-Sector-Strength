import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
export const sectorNames = [
  "Nifty Auto",
  "Nifty Bank",
  "Nifty Capital Goods",
  "Nifty Cement",
  "Nifty Chemicals",
  "Nifty Commercial & Transport Services",
  "Nifty Construction",
  "Nifty Consumer Durables",
  "Nifty Consumer Services",
  "Nifty Financial Services",
  "Nifty Financial Services 25/50",
  "Nifty Financial Services Ex-Bank",
  "Nifty FMCG",
  "Nifty Healthcare Index",
  "Nifty Hospitals",
  "Nifty Housing Finance",
  "Nifty Insurance",
  "Nifty IT",
  "Nifty Media",
  "Nifty Metal",
  "Nifty NBFC",
  "Nifty Oil & Gas",
  "Nifty Pharma",
  "Nifty Power",
  "Nifty Private Bank",
  "Nifty PSU Bank",
  "Nifty Realty",
  "Nifty REITs & Realty",
  "Nifty Retail",
  "Nifty Telecommunications",
  "Nifty500 Healthcare",
  "Nifty MidSmall Financial Services",
  "Nifty MidSmall Healthcare",
  "Nifty MidSmall IT & Telecom",
];
export const key = (name) => name.trim().toUpperCase().replace(/\s+/g, " ");
export const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function datesThrough(today) {
  const end = new Date(today + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const result = [];
  for (let d = new Date(end); d >= start; d.setUTCDate(d.getUTCDate() - 1))
    result.push(d.toISOString().slice(0, 10));
  return result;
}
function csvRows(text) {
  const rows = [];
  let row = [],
    field = "",
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quote = !quote;
    } else if (!quote && (c === "," || c === "\n")) {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else field += c;
  }
  if (quote) throw Error("Malformed CSV");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
export function parseDaily(text, date) {
  const rows = csvRows(text.replace(/^\uFEFF/, ""));
  const header = rows.shift()?.map((x) => x.trim());
  const columns = [
    "Index Name",
    "Index Date",
    "Open Index Value",
    "High Index Value",
    "Low Index Value",
    "Closing Index Value",
  ].map((x) => header?.indexOf(x));
  if (columns.some((x) => x < 0 || x === undefined))
    throw Error("Unexpected NSE CSV format");
  const result = {};
  for (const row of rows) {
    if (row.every((x) => !x.trim())) continue;
    const [name, day, o, h, l, c] = columns.map((i) => row[i]?.trim());
    const expected =
      date.slice(8) + "-" + date.slice(5, 7) + "-" + date.slice(0, 4);
    if (day !== expected) throw Error("NSE report date mismatch");
    const nums = [o, h, l, c].map((x) =>
      x && x !== "-" ? Number(x.replaceAll(",", "")) : NaN,
    );
    if (!name || !Number.isFinite(nums[3]) || nums[3] <= 0) continue;
    const [open, high, low, close] = nums;
    const validOHLC =
      nums.every((x) => Number.isFinite(x) && x > 0) &&
      high >= Math.max(open, low, close) &&
      low <= Math.min(open, high, close);
    result[key(name)] = {
      name,
      open: validOHLC ? open : null,
      high: validOHLC ? high : null,
      low: validOHLC ? low : null,
      close,
    };
  }
  if (!result["NIFTY 50"] || Object.keys(result).length < 10)
    throw Error("Incomplete NSE daily report");
  return result;
}
export class SectorStore {
  constructor(
    dir,
    {
      fetcher = fetch,
      interval = 1500,
      clock = todayIST,
      sleeper = delay,
    } = {},
  ) {
    this.dir = dir;
    this.fetcher = fetcher;
    this.interval = interval;
    this.sleep = sleeper;
    this.clock = clock;
    this.cache = { days: {}, unavailable: {}, lastChecked: null };
    this.state = {
      running: false,
      completed: 0,
      total: 0,
      downloaded: 0,
      error: null,
    };
    this.ready = this.load();
  }
  async load() {
    try {
      this.cache = JSON.parse(
        await readFile(path.join(this.dir, "history.json"), "utf8"),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  async save() {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, "history.json");
    await writeFile(file + ".tmp", JSON.stringify(this.cache));
    await rename(file + ".tmp", file);
  }
  snapshot() {
    const allowed = new Set(datesThrough(this.clock()));
    const dates = Object.keys(this.cache.days)
      .filter((d) => allowed.has(d))
      .sort();
    const indices = {};
    for (const d of dates)
      for (const [id, v] of Object.entries(this.cache.days[d])) {
        indices[id] ??= {
          name: v.name,
          sector: sectorNames.some((s) => key(s) === id),
          points: [],
        };
        indices[id].points.push({ date: d, ...v });
      }
    return {
      indices,
      lastDataDate: dates.at(-1) || null,
      lastChecked: this.cache.lastChecked,
      firstDataDate: dates[0] || null,
      status: { ...this.state },
      reportCount: dates.length,
      uncheckedDates: datesThrough(this.clock()).filter(
        (d) => !this.cache.days[d] && !this.cache.unavailable[d],
      ).length,
      source: "NSE India daily index archives",
    };
  }
  start() {
    if (this.state.running) return false;
    this.state = {
      running: true,
      completed: 0,
      total: 0,
      downloaded: 0,
      error: null,
    };
    this.job = this.update()
      .catch((e) => {
        this.state.error = e.message;
      })
      .finally(() => {
        this.state.running = false;
      });
    return true;
  }
  async update() {
    await this.ready;
    await mkdir(this.dir, { recursive: true });
    const lockFile = path.join(this.dir, "update.lock");
    let lock;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        lock = await open(lockFile, "wx");
        await lock.writeFile(String(process.pid));
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        let pid;
        try {
          pid = Number(await readFile(lockFile, "utf8"));
        } catch {
          throw Error("Another sector updater is starting. Try again shortly.");
        }
        if (!Number.isInteger(pid) || pid <= 0)
          throw Error("Another sector updater is starting. Try again shortly.");
        try {
          process.kill(pid, 0);
          throw Error(
            "Another sector updater is running. Wait for it to finish.",
          );
        } catch (err) {
          if (err.code !== "ESRCH") throw err;
        }
        await unlink(lockFile);
      }
    }
    if (!lock) throw Error("Unable to acquire sector update lock");
    try {
      await this.load();
      await this.performUpdate();
    } finally {
      await lock.close();
      await unlink(lockFile);
    }
  }
  async performUpdate() {
    const today = this.clock(),
      now = Date.now();
    const wanted = datesThrough(today);
    const pending = wanted.filter(
      (d) =>
        !this.cache.days[d] &&
        (!this.cache.unavailable[d] ||
          (d >= wanted[6] && now - this.cache.unavailable[d] > 3600000)),
    );
    this.state.total = pending.length;
    for (const date of pending) {
      if (this.state.completed) await this.sleep(this.interval);
      this.state.currentDate = date;
      const compact = date.slice(8) + date.slice(5, 7) + date.slice(0, 4);
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await this.fetcher(
          "https://archives.nseindia.com/content/indices/ind_close_all_" +
            compact +
            ".csv",
          {
            signal: AbortSignal.timeout(20000),
            headers: {
              "User-Agent": "VCCL-SectorStrength/1.0",
              Accept: "text/csv",
            },
          },
        );
        if (response.status === 404) break;
        if (response.ok) break;
        if (
          ![429, 500, 502, 503, 504].includes(response.status) ||
          attempt === 2
        )
          throw Error(
            "NSE returned HTTP " +
              response.status +
              ". Cached history is preserved; try Update data later.",
          );
        const retry = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        await this.sleep(
          Math.max(
            (attempt + 1) * 5000,
            Math.min(Number.isFinite(retry) ? retry * 1000 : 0, 60000),
          ),
        );
      }
      if (response.status === 404) {
        this.cache.unavailable[date] = Date.now();
        await response.body?.cancel();
      } else {
        this.cache.days[date] = parseDaily(await response.text(), date);
        delete this.cache.unavailable[date];
        this.state.downloaded++;
      }
      this.state.completed++;
      await this.save();
    }
    const keep = new Set(wanted);
    for (const group of [this.cache.days, this.cache.unavailable])
      for (const d of Object.keys(group)) if (!keep.has(d)) delete group[d];
    this.cache.lastChecked = new Date().toISOString();
    await this.save();
  }
}
