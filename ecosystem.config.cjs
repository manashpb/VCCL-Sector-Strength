const path = require("node:path");
module.exports = {
  apps: [
    {
      name: "sector-strength",
      cwd: __dirname,
      script: path.join(__dirname, "server.mjs"),
      node_args: ["--env-file-if-exists=.env"],
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      env: { NODE_ENV: "production", SECTOR_PORT: "5006", PORTAL_PORT: "5001" },
    },
  ],
};
