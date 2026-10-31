# Sector Strength

Independent Node.js application in the VCCL umbrella, served at /sectors/ on loopback port 5006. It always verifies shared trading_session cookies against the workspace /verify endpoint, including assets and APIs. Never bypass this check or expose the data folder as static files. Update POST also requires exact PORTAL_ORIGIN and X-VCCL-Request: sector-update.

Code: server.mjs, src/, public/. Local NSE history: data/history.json (SECTOR_DATA_DIR override). Preserve one-year retention, sequential request pacing, backoff, atomic writes, lock protection, close-only indices and alignment on common reference/latest dates. Never synthesize OHLC or rebase sectors with missing reference values. data/ remains untracked.

Run npm run check and npm test. npm run data:update is an optional offline updater; normal updates use the authenticated webpage. The shared workspace owns its launcher and loopback proxy (SECTOR_BACKEND_PORT, default 5006). Source integration does not authorize production deployment.
