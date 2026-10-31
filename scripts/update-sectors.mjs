import { SectorStore } from "../src/store.mjs";
import { fileURLToPath } from "node:url";
const store = new SectorStore(
  process.env.SECTOR_DATA_DIR ||
    fileURLToPath(new URL("../data/", import.meta.url)),
);
await store.ready;
store.start();
const timer = setInterval(
  () => console.log(JSON.stringify(store.state)),
  30000,
);
await store.job;
clearInterval(timer);
console.log(JSON.stringify(store.state));
if (store.state.error) process.exitCode = 1;
