# Deploying without docker

The production server runs the dashboard from `/srv/shlink-dashboard` as the `shlink-dashboard` user, with pm2.

## Updates

New commits pushed to the branch the server tracks are deployed automatically. A cron job runs
`deploy/auto-update.sh` every 5 minutes, and logs to `/home/shlink-dashboard/deploy.log`.

To deploy right away, or to retry a failed deploy, run this on the server:

```bash
shlink-dashboard-deploy
```

## Layout

- `.env`: configuration (see `.env.example`).
- `releases/<commit>-<timestamp>`: the 3 most recent builds.
- `current`: symlink to the release pm2 runs. A new release only replaces it once it built successfully.

## Useful commands

```bash
tail -f /home/shlink-dashboard/deploy.log                  # deploy history
sudo -u shlink-dashboard -H pm2 logs shlink-dashboard      # app logs
sudo -u shlink-dashboard -H pm2 status
```

Roll back to a previous release:

```bash
cd /srv/shlink-dashboard
sudo -u shlink-dashboard ln -sfn releases/<release> current
sudo -u shlink-dashboard -H pm2 reload shlink-dashboard
```
