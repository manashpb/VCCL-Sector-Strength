# Sector Strength

Independent VCCL application in `E:\TRADING\VCCL\Sector-Strength`, served at
`/sectors/` through the shared workspace launcher and authenticated loopback
proxy. Code lives in `server.mjs`, `src/` and `public/`. NSE history is in
`data/history.json`. It uses Node.js built-in modules and vendored Plotly.

## Run and connect

Requires Node.js 22.9 or newer. Copy `.env.example` to `.env` and set
`PORTAL_ORIGIN` to the same exact browser origin configured in the workspace.
No journal password or trading credentials are needed by this service.

Run `npm start` in this folder alongside the workspace portal. The service
binds to 127.0.0.1:5006 (SECTOR_PORT override), and always verifies shared
session cookies against 127.0.0.1:5001/verify (PORTAL_PORT override). The
workspace forwards /sectors/ to port 5006 (SECTOR_BACKEND_PORT override).
The existing Nginx portal catch-all already handles the public route; no new
public port or Nginx location is needed. The service protects assets and APIs
independently, and refuses access if the login service is unavailable.

For PM2, after setting this app's own .env, use
`pm2 start ecosystem.config.cjs` from this folder. Restart the workspace
after applying its launcher/proxy source change. Local source integration
does not deploy or restart production.

## Use

Open Sector Strength from the workspace and click **Update data**. The first
update checks the last calendar year, newest first. It takes roughly 10–15
minutes, depending on NSE latency. Later updates fetch only missing daily
reports. Progress is polled without holding a long HTTP request open. Cached
history remains usable while the job runs; leaving the page does not cancel it.
Restarting Sector Strength stops the active job; clicking Update data resumes from
the durable cache. Run one Sector Strength worker, as specified in its PM2 configuration.

Choose any index present in the NSE reports as benchmark (default Nifty 50),
then select a reference date. Weekends/holidays resolve to the next available
benchmark session and the page explicitly reports the effective date. Returns
use the reference close and benchmark's latest close date. A sector without a
close on either common endpoint is N/A, rather than rebased to another date.
Missing intermediate sector sessions appear as gaps. Green/red in the sector
table means above/below the benchmark, including when both returns are negative.
The benchmark return itself is colored by its sign. Equal returns are neutral.

The comparison legend is sorted by latest cumulative return, including the
benchmark, with every available sector visible initially. Click to hide/show,
double-click to isolate, drag/scroll to zoom, and double-click the plot to reset.
**Show all sectors** restores hidden series. Benchmark candles have a dotted
reference marker. Where NSE supplies only a closing value, close markers are
shown and explicitly labeled; OHLC is never synthesized. Returns are price
returns, not total returns or a relative-strength ratio.

## Official data sources investigated

Primary: `https://archives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv`.
A live check of 30 October 2026 returned all 162 index rows. Some newer sectors
have `-` for open/high/low, while still providing usable closes. Some records
contain inconsistent OHLC; their closes are retained and their candles omitted.
The sector list follows the official NSE Indices sectoral classification,
including newer sectors and MidSmall sector variants; other index categories
remain selectable benchmarks.

Official alternatives checked on 31 October 2026:

- https://www.niftyindices.com/reports/historical-data
- Its own frontend uses POST `/BackPage/getHistoricaldatatabletoString` with a
  `cinfo` string containing `name`, `indexName`, `startDate`, `endDate`. A live
  Nifty 50 request for October 2026 returned valid historical OHLC, unlike the
  blocked NSE India historical API described in the request. This is a viable
  bulk-per-index alternative, but requires separate requests/index name mappings
  for the full benchmark universe. The app uses daily CSV snapshots to keep
  every index aligned, and daily updates typically need just one request.
- https://www.niftyindices.com/indices/equity/sectoral-indices
- https://www.nseindia.com/all-reports

## Cache, limits and operations

Data lives in `data/history.json` (Git ignored). Override the directory
with `SECTOR_DATA_DIR`, using an absolute path for deployment. Keep this folder
persistent and writable only by the service user. Writes use a temporary file
and atomic rename. The rolling view retains one calendar year; successful
updates prune older records. Failed updates preserve previously written days.
The UI shows last available data date, last completed check (IST), cached
session count and remaining unchecked dates. Today's report may be unavailable
until NSE publishes it; **last data date** is the authoritative freshness value.

Requests are sequential with at least 1.5 seconds between dates. Temporary
429/5xx responses get bounded retries with backoff and numeric Retry-After
support. Repeated blocking stops the update; it never creates empty reports.
404s are retried after one hour for the last seven calendar dates. Older
unavailable dates stay cached, avoiding repeated holiday/weekend requests. All calendar dates are checked, including weekends, so special trading
sessions are included. A filesystem lock prevents concurrent portal/CLI updates;
a dead process's lock is recovered on the next attempt. The updater reloads
the on-disk cache after acquiring the lock to preserve other completed updates.

Optional offline cache population: `npm run data:update`. Stop Sector Strength
before using this command against its data directory, then restart it afterward.
Normal users should use the authenticated Update data button instead. No network
calls happen merely by viewing the page. Updates require an authenticated
session, matching Origin and the app's custom request header. NSE addresses and
cache paths are fixed by the server; users cannot supply upstream URLs.

Plotly 4.2.0 is vendored under `public/` with its MIT license, avoiding
runtime CDN access. Check the first line of `plotly.min.js` for the exact bundled
version if updating it.

## Verification

`npm run check` and `npm test` cover service authorization/origin checks, the
update API, cache resumption and locks, NSE schema/date validation, close-only
records, aligned returns, ranking, missing histories and zero/negative returns.
A local headless Chrome check also exercised benchmark changes, the reference
marker/date adjustment, legend toggles and restore, and desktop/mobile layout.


See [deployment record](deploy/DEPLOYED.md) for the VCCL installation and transferred cache.
