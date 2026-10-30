# Operating

## Health

`GET /health` answers 200 when the instance can reach its database. The image's health check uses it, and it's what an uptime monitor should poll.

## Data and backups

Everything lives in `DATA_DIR` (`/data` in the container):

- `freundebuch.db`: the SQLite database, with every person, conversation and transcript: the first household's book.
- `households/<id>.db`: the book of every other household, with `FREUNDEBUCH_HOUSEHOLDS=many`. A household's whole book is its one file.
- `instance.db`: which households there are, who signs in to which, and the open invitations. Nothing about the people in a book.
- `secret`: the signing secret, unless `FREUNDEBUCH_SECRET` is set.
- `files/` and, from before 0.4, `screenshots/`: the [shared files](../using/sharing.md), unless `FREUNDEBUCH_STORAGE=s3`.

Back up the whole directory. The database runs in WAL mode, so copy it while the container is stopped (or back up the volume with a tool that snapshots it):

```bash
docker compose stop freundebuch
cp -a ./data ./data.backup   # or wherever the volume lives
docker compose start freundebuch
```

With `FREUNDEBUCH_STORAGE=s3` the shared files are in the bucket instead: a backup is the directory plus the bucket. Switching between `files` and `s3` doesn't move existing files; copy `files/` and `screenshots/` into the bucket (or back) yourself, keeping the key names.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Database migrations run on start. The image tag `main` follows the main branch. Each release is also published under its version (`0.2.0`), its minor version (`0.2`) and `latest`; pin one of those to upgrade only when you choose. The [releases](https://github.com/Marceltov/freundebuch/releases) say what changed, and the same notes go to the [notefeed feed](https://notefeed.me/r/freundebuch).

## Logs

Logs are JSON lines on stdout (pino), at the level `FREUNDEBUCH_LOG_LEVEL` sets. What people said (transcripts, facts, promises), people's names, webhook URLs and tokens are never logged.
