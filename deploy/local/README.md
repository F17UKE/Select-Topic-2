# Local PostgreSQL

## Existing Windows portable database

Preferred management commands from the repository root:

```powershell
npm run start-db
npm run status-db
npm run stop-db
```

These use `scripts/local-db.ps1` and read host/port/database directly from ignored
`backend/.env`, without printing credentials. Start and stop are idempotent. Start verifies
PG_VERSION and the existing binaries, refuses occupied/unexpected ports, launches pg_ctl
hidden, and probes PostgreSQL readiness. Stop uses `pg_ctl -m fast` (graceful transaction
rollback/shutdown), never forced process killing. A named mutex serializes management calls.
No script initializes a cluster, deletes a PID/data file, installs a service, or changes firewall.
Successful operations are recorded in `%LOCALAPPDATA%\select-topic-2\db-management.jsonl`.
Startup stdout/stderr are beside the existing `postgresql-v3.log`; inspect those if startup fails.
Run these commands from a normal Windows terminal for independent lifetime from an IDE runner.
Abrupt parent/terminal job termination remains an operational possibility, not a confirmed cause
of the previous exits. Use `stop-db` before closing/restarting the machine.

Use ignored `backend/.env` as the source of truth. Do not overwrite it with the Docker
example: this workspace uses `127.0.0.1:5432`, database `select_topic_2_local`.
The existing valid PostgreSQL installation and data directory on this machine are:

```text
%LOCALAPPDATA%\select-topic-2\postgresql-16.15-tar\pgsql\bin\pg_ctl.exe
%LOCALAPPDATA%\select-topic-2\pgdata-v3
```

The similarly named `postgresql-16.15` extraction is incomplete (missing timezone
support files); use `postgresql-16.15-tar`. No installation or initdb is required.

From repository root, PowerShell (reads port/host without printing credentials):

```powershell
$localDb = node -e "require('./backend/src/env.cjs'); console.log(JSON.stringify({host:process.env.DB_HOST,port:process.env.DB_PORT,database:process.env.DB_NAME}))" | ConvertFrom-Json
if ($localDb.host -ne '127.0.0.1' -or $localDb.database -ne 'select_topic_2_local') { throw 'Expected this loopback development database' }
$localRoot = Join-Path $env:LOCALAPPDATA 'select-topic-2'
$pgCtl = Join-Path $localRoot 'postgresql-16.15-tar\pgsql\bin\pg_ctl.exe'
$pgData = Join-Path $localRoot 'pgdata-v3'
& $pgCtl status -D $pgData
# Only if stopped:
& $pgCtl start -D $pgData -l (Join-Path $localRoot 'postgresql-v3.log') -o "-h $($localDb.host) -p $($localDb.port)" -w
Test-NetConnection $localDb.host -Port $localDb.port
npm run db:status --workspace backend
npm run db:verify-local --workspace backend
```

`pg_ctl` exits after starting PostgreSQL; no DB terminal must stay open. Keep separate
terminals running `npm run dev:backend` and `npm run dev:frontend` while viewing the UI.
Stop those with Ctrl+C. Then stop PostgreSQL cleanly, preserving all data:

```powershell
& $pgCtl stop -D $pgData -m fast -w
```

## Docker alternative

This setup is for local development only. It runs PostgreSQL 16 on loopback port
`55432`; it does not publish PostgreSQL on any external interface.

```bash
cp deploy/local/.env.example deploy/local/.env
cp backend/.env.local.example backend/.env
npm run db:local:up
npm run db:migrate --workspace backend
npm run db:seed --workspace backend
npm run db:verify-local --workspace backend
```

`deploy/local/.env` and `backend/.env` are ignored by Git. The example credential is
a known local-only value; change both copies together if desired and never reuse it on
Cloud or with real data.

Stop the container without deleting its volume:

```bash
npm run db:local:down
```

The seed refuses to run unless the database is named `select_topic_2_local` and the
host is loopback. It is idempotent and contains no orders, payments or messages.

If Docker cannot run, use an existing PostgreSQL 16 local process bound to loopback,
set the same backend environment variables, and run the migration/seed/verify commands
above. Do not enable WSL, virtualization, Windows services or firewall rules merely to
run the schema verification without the machine owner's approval.
