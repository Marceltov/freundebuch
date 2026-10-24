# Operating

## Health

`GET /health` answers 200 when the instance can reach its database. The image's health check uses it, and it's what an uptime monitor should poll.

## Data and backups

Everything lives in `DATA_DIR` (`/data` in the container):

- `freundebuch.db`: the SQLite database, with every person, conversation and transcript.
- `secret`: the signing secret, unless `FREUNDEBUCH_SECRET` is set.

Back up the whole directory. The database runs in WAL mode, so copy it while the container is stopped (or back up the volume with a tool that snapshots it):

```bash
docker compose stop freundebuch
cp -a ./data ./data.backup   # or wherever the volume lives
docker compose start freundebuch
```

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Database migrations run on start. The image tag `main` follows the main branch.

## Logs

Logs are JSON lines on stdout (pino), at the level `FREUNDEBUCH_LOG_LEVEL` sets. What people said (transcripts, facts, promises), people's names, webhook URLs and tokens are never logged.
