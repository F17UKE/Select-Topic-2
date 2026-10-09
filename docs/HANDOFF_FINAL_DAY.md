# Final Day Handoff

Updated: 2026-10-09 (Asia/Bangkok)

## Repository and database

- Current application revision is pushed to `origin/main`.
- Production migrations `001` through `008` are complete with no pending migration.
- Production credentials and runtime encryption keys are stored outside Git.
- No production secret is recorded in this document.

## Public deployment

- Frontend production service is deployed and enabled under systemd.
- Public URL: `https://food.nprz4k.com/`
- Nginx configuration and HTTPS certificate validation pass.
- HTTP redirects to HTTPS, and the frontend health endpoint responds successfully.
- Backend is not active at the time of this handoff.
- Latest backend blocker: configure private slip storage at `/var/lib/select-topic-2/slips` and regain VPS SSH access. The storage path must remain outside every Nginx-served directory and be writable only by `select-topic-2`.

## LINE

- LIFF Endpoint URL: `https://food.nprz4k.com/`
- Messaging API Webhook URL: `https://food.nprz4k.com/api/webhooks/line`
- LINE production credentials are present in the protected production environment file.
- LINE webhook and login cannot complete until the backend service is active.

## Payment provider

- EasySlip production configuration is present in the protected production environment.
- Real EasySlip slip verification still has the previously identified provider compatibility issue.
- Do not bypass verification, manually mark a payment paid, or weaken upload validation.

## Next owner action

1. Restore SSH access through the ReadyIDC console if key authentication remains unavailable.
2. Configure the existing `local` slip-storage adapter with `SLIP_STORAGE_DIR=/var/lib/select-topic-2/slips`.
3. Create that directory with owner/group `select-topic-2` and restrictive permissions; never expose it through Nginx.
4. Add the storage directory to the backend systemd unit's writable paths, restart the backend, and verify local and public `/api/health` endpoints.
5. Verify the LINE webhook only after the public API health check returns HTTP 200.
