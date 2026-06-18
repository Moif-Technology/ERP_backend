// PM2 process manager — runs one Node worker per CPU core (cluster mode) so the
// API uses the whole machine instead of a single core. PM2 load-balances across
// workers. Start in prod with:  pm2 start ecosystem.config.cjs --env production
module.exports = {
  apps: [
    {
      name: 'moifone-api',
      script: 'src/index.js',
      instances: 'max', // one worker per CPU core
      exec_mode: 'cluster',
      max_memory_restart: '500M',
      kill_timeout: 11_000, // > app shutdown drain (10s) so graceful exit wins
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
