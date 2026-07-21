require('dotenv').config({ path: './.env', debug: true });
const { name, main } = require('../package.json');

const { SERVICE_NAME, SERVICE_INSTANCE, PM2_NAMESPACE } = process.env;
const suffix = SERVICE_INSTANCE ? `--${SERVICE_INSTANCE}` : '';

module.exports = {
  apps: [{
    name: `${SERVICE_NAME || name}${suffix}`,
    script: main,
    node_args: '--no-node-snapshot',
    // Options reference: https://pm2.keymetrics.io/docs/usage/application-declaration/
    namespace: PM2_NAMESPACE || undefined,
    instances: 1,
    // exec_interpreter: '/root/.nvm/versions/node/v22.17.1/bin/node',
    exec_mode: 'fork', // Fixing ESM Connection
    autorestart: true,
    // restart_delay: 5000,
    exp_backoff_restart_delay: 100,
    watch: false,
    watch_delay: 5000, // Delay between restart
    // watch: ["server", "client"],
    ignore_watch: ['.git', '_misc', '_sql', 'deploy', 'node_modules', 'sql', 'tmp'],
    max_memory_restart: '10G',
    error_file: `/var/log/pm2/${name}.app.log`,
    out_file: `/var/log/pm2/${name}.log`,
    // env_prd: { NODE_ENV: 'production' },
    // env_dev: { NODE_ENV: 'development' },
  }],
};
