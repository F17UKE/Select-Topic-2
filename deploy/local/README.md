# Local PostgreSQL

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
