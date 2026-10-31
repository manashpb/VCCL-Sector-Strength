# Deployment — 31 October 2026

- Public repository: https://github.com/manashpb/VCCL-Sector-Strength
- Server checkout: `/home/manash/VCCL/Sector-Strength`.
- PM2 service: `sector-strength`, one worker, loopback port 5006.
- Shared workspace launcher and authenticated proxy: `/sectors/`.
- Workspace integration commit: `f3c5e96` in VCCL-Workspace.
- Runtime configuration is in the application's ignored `.env`; its origin
  matches the portal. No journal password or trading credential is stored here.
- The local `data/history.json` was transferred directly by SCP, not committed
  or downloaded again. SHA-256 matched before and after service startup.
- Transferred history: 247 trading-day reports, 31 October 2025 through
  30 October 2026; 34 sector series are recognized.
- Data directory is mode 700 and history file mode 600. Keep it persistent.
- Application and workspace syntax checks/tests passed locally and on VCCL.
- Live checks passed for anonymous access restrictions, login, launcher,
  frontend assets/CSP, data, independent backend authentication, mutation Origin
  checks, private cache path protection, and logout.
- Only Sector Strength was started and the shared portal restarted. Other
  trading services were not restarted. No Nginx or sudo changes were required.
- PM2 state was saved after verification.

Future updates: pull this repository, run `npm run check` and `npm test`, then
restart only `sector-strength`. Preserve `.env` and `data/`. Use **Update data**
for incremental NSE reports. Do not run the offline updater alongside the live
service against the same cache.

Rollback: stop/delete the `sector-strength` PM2 process and restore the workspace
portal to its previous revision (`eb4a6fc` was the pre-integration revision),
then restart only the portal and save PM2 state. Preserve the history file.
