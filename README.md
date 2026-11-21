# SNAPTRACK — authorized public profile lookup

A Node.js + static frontend implementation using Snap's official Public Profile API. This is not a scraper and does not use private Snapchat endpoints.

## Important API limits

- Snap requires the Public Profile API app to be allowlisted. The official docs say to create OAuth app credentials in Snap Business Manager and request access by emailing `dev-support@snap.com` with the OAuth client ID and a description of intended use. Never send the client secret.
- The public search endpoint is `GET https://businessapi.snapchat.com/public/v1/public_profiles/search`.
- It searches by username or profile display name.
- Snap's documentation currently says public endpoints return only `TIER_PUBLIC_OFFICIAL` profiles. A profile not returned by this API may still exist on Snapchat.
- The endpoint can return public metadata including display name, description, username, logo URLs and subscriber count when present.
- Snapscore, friends lists and last-active status are not provided by this public search endpoint.

Official docs: https://marketingapi.snapchat.com/docs/profile.html

## Requirements

- Node.js 20+
- An approved Snap Public Profile API OAuth app and credentials
- A server with HTTPS in production (GitHub Pages alone cannot run the backend or safely store OAuth secrets)

## Local setup

1. Copy `.env.example` to `.env`.
2. Fill in `SNAP_CLIENT_ID`, `SNAP_CLIENT_SECRET`, and a long random `SESSION_SECRET`.
3. Set `APP_BASE_URL=http://localhost:3000` and `SNAP_REDIRECT_URI=http://localhost:3000/auth/callback`.
4. Register that exact redirect URI in the Snap OAuth app.
5. Run:

   ```bash
   npm install
   npm start
   ```

6. Open http://localhost:3000.
7. Click **Connect approved Snap API**, complete Snap OAuth, then search `antonisssb` or another username.

Without allowlisting and credentials, the app intentionally cannot return live Snapchat results. It shows an explicit setup/authentication message rather than fabricated data.

## Deployment

Deploy the Node app to a Node-compatible host that supports environment variables and HTTPS. Set:
- `APP_BASE_URL` to the deployed HTTPS origin
- `SNAP_REDIRECT_URI` to `https://YOUR-DOMAIN/auth/callback`
- `NODE_ENV=production`
- `SESSION_SECRET`, `SNAP_CLIENT_ID`, and `SNAP_CLIENT_SECRET`

Register the exact production redirect URI in Snap Business Manager. GitHub Pages is static hosting only and cannot run this OAuth backend. You can keep the source in GitHub, but host the Node server separately.

## Security notes

- `.env` is ignored by Git. Do not commit credentials.
- OAuth uses a random `state` value and a server-side session cookie.
- The access and refresh tokens are kept in the server session, not browser JavaScript or localStorage.
- The included Express MemoryStore is suitable only for local testing / a single short-lived instance. For production, configure a persistent, secure session store and HTTPS.
- This app only queries Snap's documented public profile search endpoint and only displays fields actually returned by Snap.
