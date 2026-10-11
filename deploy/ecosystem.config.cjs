// pm2 config for running Shlink Dashboard without docker. See deploy/deploy.sh
const path = require('node:path');

const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'shlink-dashboard',
      // Symlink to the active release in releases/, switched by deploy.sh
      cwd: path.join(root, 'current'),
      script: 'server.js',
      node_args: `--env-file=${path.join(root, '.env')}`,
      env: { NODE_ENV: 'production' },
    },
  ],
};
