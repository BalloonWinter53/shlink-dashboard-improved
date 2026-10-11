import { createRequestHandler } from '@react-router/express';
import express from 'express';

const {
  NODE_ENV,
  SHLINK_DASHBOARD_PORT = '3005',
  // Proxies trusted to set X-Forwarded-* headers, in Express' "trust proxy" format: comma-separated IPs, subnets or
  // keywords like loopback or uniquelocal. Behind a TLS-terminating proxy, the original protocol is needed for the
  // origin check done on form submissions to pass.
  SHLINK_DASHBOARD_TRUSTED_PROXIES = 'loopback',
} = process.env;
const isProd = NODE_ENV === 'production';

const viteDevServer = isProd
  ? null
  : await import('vite').then((vite) =>
      vite.createServer({
        server: { middlewareMode: true },
      }),
    );

const app = express();
app.set('trust proxy', SHLINK_DASHBOARD_TRUSTED_PROXIES);
app.use(viteDevServer ? viteDevServer.middlewares : express.static('client'));

const build = viteDevServer
  ? () => viteDevServer.ssrLoadModule('virtual:react-router/server-build')
  : // @ts-expect-error This code branch is used only when that file is built
    await import('./server/index.js');

app.all('*splat', createRequestHandler({ build }));

const port = Number(SHLINK_DASHBOARD_PORT);
app.listen(port, () => console.log(`App listening on http://localhost:${port}`));
