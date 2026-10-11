// pm2 config for running Shlink Dashboard without docker. See deploy/deploy.sh
const path = require('node:path');

const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'shlink-dashboard',
      cwd: path.join(root, 'build'),
      script: 'server.js',
      node_args: `--env-file=${path.join(root, '.env')}`,
      env: { NODE_ENV: 'production' },
    },
  ],
};
