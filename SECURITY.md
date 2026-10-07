# Security

TaazaStream is designed for a **private home network**. It is not hardened for exposure to the
public internet and should not be port-forwarded on your router.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Report a
vulnerability) rather than a public issue. Include steps to reproduce and the affected version.

## Security model

| Area             | What TaazaStream does                                                                                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network exposure | Listens on `0.0.0.0` so LAN devices can connect. The Windows firewall script opens the port for the **Private** profile and **local subnet** only.                                                                                                                                                   |
| Admin access     | All `/api/admin/*` endpoints require an authenticated admin session **and** a private/LAN source IP (`ALLOW_PUBLIC_ADMIN=false`).                                                                                                                                                                    |
| First-run setup  | The first admin account can only be created from the server PC itself (loopback), or via `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `.env`.                                                                                                                                                                |
| Passwords        | scrypt (N=2^15, r=8, p=1, 16-byte salt). Plaintext passwords are never stored or logged.                                                                                                                                                                                                             |
| Sessions         | 256-bit random tokens in an `HttpOnly`, `SameSite=Strict` cookie scoped to `/api`; only a SHA-256 hash is stored. `Secure` is set automatically when served over HTTPS.                                                                                                                              |
| CSRF             | State-changing requests must carry the `X-TaazaStream: 1` header, which browsers cannot add cross-site without a CORS preflight (CORS is same-origin by default).                                                                                                                                    |
| Rate limiting    | 900 API requests/min per IP (media endpoints excluded); login/setup/password changes 10 per 15 min.                                                                                                                                                                                                  |
| Input validation | Every route validates params, query and bodies with Zod.                                                                                                                                                                                                                                             |
| Filesystem       | The browser never sends file paths. Videos are opened by database ID only; every path is re-checked to be inside a registered media folder after resolving symlinks. Image, segment, subtitle and backup names are matched against strict patterns. System folders cannot be added as media folders. |
| Headers          | Helmet with a strict Content-Security-Policy (`default-src 'self'`, no external scripts/fonts/images), `X-Content-Type-Options`, `Referrer-Policy: same-origin`, frame protection. HSTS/upgrade-insecure-requests are disabled on purpose because LANs use plain HTTP.                               |
| Secrets          | `.env` is git-ignored. `SUPABASE_SERVICE_ROLE_KEY` is read only by the server and never returned by any API or bundled into the web app. Logs redact passwords, tokens, cookies and keys.                                                                                                            |
| Privacy          | Device tracking keeps only IP address, a coarse device type and browser family, in memory. No analytics are sent anywhere.                                                                                                                                                                           |
| Supabase         | Cloud tables have Row Level Security enabled with no public policies; only the server (service role) can write.                                                                                                                                                                                      |

## Recommendations

- Keep the server PC's network profile set to **Private** and do not forward port 3000 on your router.
- For remote access, use a VPN to your home network (e.g. WireGuard or Tailscale) rather than exposing TaazaStream.
- If you put TaazaStream behind an HTTPS reverse proxy, set `TRUST_PROXY=true`.
- Use a strong admin password and keep Node.js and FFmpeg up to date.
- Forgot the admin password? On the server PC run `pnpm --filter @taazastream/server reset-admin <user> <new-password>`.
