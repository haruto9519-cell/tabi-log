# Phase 1 share-link API setup

This change prepares the first server-backed feature for Tabi Log: a user explicitly creates an unlisted share link for a trip. It does **not** turn on account registration or the full social feed.

## Data and privacy

- Only the trip fields explicitly sent to `POST /api/shares` are stored.
- Private local records are not uploaded automatically.
- Share URLs are unlisted bearer links: anyone with the URL can view the shared trip.
- The response includes a one-time `revokeKey`. Keep it in the same browser/device to revoke the link later. Do not share this key.
- Links expire after 365 days.
- The API caps the JSON payload at 20 KB and applies an 8-create-per-10-minute limit per hashed client IP.
- The raw client IP is not stored; only a salted SHA-256 hash is kept for the rate-limit window.
- Photos/videos are not uploaded by this first share API. R2 media upload is a later step.

## Cloudflare setup

1. Create a D1 database named `tabi-log-db`.
2. Copy its database ID into `worker/wrangler.toml` in place of `REPLACE_WITH_D1_DATABASE_ID`.
3. Run the migration:
   ```sh
   npx wrangler d1 migrations apply tabi-log-db --remote
   ```
   If using the SQL file directly instead:
   ```sh
   npx wrangler d1 execute tabi-log-db --remote --file=worker/migrations/0002_share_links.sql
   ```
4. From the `worker` directory, deploy:
   ```sh
   npx wrangler deploy
   ```
5. Set the Pages frontend's API base URL to the deployed Worker URL. The UI must not enable share creation until `GET /api/health` succeeds and D1 is connected.

## API

- `POST /api/shares`: body `{"trip":{...}}`; returns `url`, one-time `revokeKey`, and `expiresAt`.
- `GET /api/shares/:token`: returns the explicitly shared trip.
- `DELETE /api/shares/:token`: body `{"revokeKey":"..."}`; revokes the link.

The share endpoint does not require login because the current prototype has no authentication provider. It therefore must only be used after a clear user action. Do not add automatic uploads of private trips. Before broader public launch, add authentication and abuse monitoring.
