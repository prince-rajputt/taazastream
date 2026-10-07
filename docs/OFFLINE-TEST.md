# Offline acceptance test

Goal: with the router's **internet disconnected** but the **local Wi-Fi up**, every core feature
works on phones and laptops.

## Automated coverage

| Check                                   | How it is verified                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No internet needed by the web app       | Every Playwright test (`pnpm test:e2e`) aborts all requests that are not to the local server and fails if any was attempted. Covers home, search, details, player, Continue Watching, series, admin, mobile and TV layouts. |
| Production build is self-contained      | Fonts (Inter, Outfit), icons and scripts are bundled; CSP is `default-src 'self'`.                                                                                                                                          |
| Supabase unreachable                    | E2E and `apps/server/tests/offline.test.ts` point `SUPABASE_URL` at an unroutable address (TEST-NET-1). Health reports `local-only`; catalog, search, streaming, progress and admin keep working; sync fails softly.        |
| Video starts / seeks / pauses / resumes | E2E player test plays, seeks ±10 s, pauses, resumes, toggles subtitles, leaves, and resumes from Continue Watching.                                                                                                         |
| Range streaming, HLS, path safety       | `apps/server/tests/streaming.test.ts`                                                                                                                                                                                       |

## Manual test at home (recommended once)

1. Start TaazaStream on the server PC and confirm the dashboard shows the LAN URL.
2. Connect a phone and a laptop to the same Wi-Fi and open the URL (or scan the QR code).
3. **Unplug the internet cable from the router (or disable WAN)**, leaving Wi-Fi on.
4. On both devices verify:
   - [ ] Home page loads with artwork
   - [ ] Search finds a title
   - [ ] Movie details open
   - [ ] Video starts within a few seconds
   - [ ] Seeking forward/back works
   - [ ] Pause and resume work
   - [ ] Leaving and coming back shows it in Continue Watching
   - [ ] Admin dashboard loads and shows both devices
5. Admin → Backup & cloud shows `local-only` / _offline_ for Supabase — this is expected.

This physical check was **not** performed by the automated build (it requires your router); the
automated suites above simulate it by blocking all non-local traffic.
