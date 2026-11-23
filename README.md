# El Nido Pickleball Open · Tournament Live

[Open the practice scoreboard](https://masteroil.github.io/pickleball-tournament/)

GitHub Pages serves the mobile scoreboard, staff desk and spectator TV display. The public demo stores practice scores in the current browser profile. Open two tabs on the same origin to try scoring and spectating. Different devices share scores when connected to the MongoDB API.

Select **Staff sign in → referee → Sign in** to score Court 1, or **admin** to manage draws and correct a result. Demo identities work only in practice mode. The eight sample doubles teams are fictional.

## Local demo

Use Node 22.13 or newer. Run `npm ci` and `npm run dev`. The development demo uses a local file and streams updates to browsers connected to the same development server. Keep it on a trusted network. A production build without VITE_API_URL runs the browser-only demo.

## Run a tournament

1. Sign in and select **Create tournament**. Enter the organizer, venue, date, timezone and comma-separated court names.
2. Choose a custom division or the seven-division El Nido preset. Custom defaults to eight teams and two pools. Edit placeholder names and register the actual players. Adjust the pool draw before scheduling.
3. From **Manage**, generate the schedule. Add divisions separately if needed. Under **Referee permissions**, grant the referee account UID access to this tournament. In **Schedule**, assign its UID to a match. Court and referee conflicts are checked across divisions.
4. Referees start a match, award or undo points, start subsequent games and review the winner before confirmation. Public scores and standings update automatically. A flagged forfeit, retirement or withdrawal goes to the desk for adjudication.
5. When every pool result is confirmed, generate playoffs. Resolve statistical ties in Manage by entering the ordered team IDs and reason. Confirming a semifinal advances its winner. The championship card names the champion.
6. Reopen an erroneous result, correct the game scores with a reason and confirm again. Check affected bracket matches and record the desk decision. Use QR codes for tournament or court access. TV mode provides large, dark court cards.

Pool schedules use sixteen half-hour slots per day from 09:00 local venue time, rolling over to 09:00 the next day. Manual slot edits control the day and time. Arrange breaks before broadcasting the schedule.

## El Nido event preset

The division rows govern the draw. They total 20 pools, 132 pool matches and 25 knockout matches, for 157 matches and 139 player slots. The printed guide summary gives inconsistent stage counts. The eight-team practice event is a separate dataset.

| Division | Pools | Qualifiers |
|---|---|---|
| Open Combined Singles | 4, 4, 4, 4, 5 | Five winners and three best runners-up |
| Novice Mixed Doubles | 4, 4, 4 | Three winners and one runner-up |
| Novice Men's, Beginner Mixed, Beginner Men's Doubles | 4, 4, 3 each | Three winners and one runner-up per division |
| Beginner Women's Doubles | 5, 4 | Top two per pool, crossed semifinals |
| Novice Women's Doubles | 5 | Top four |

Three-entry pools in the specified divisions play twice. Local ranking uses win percentage, points won percentage and eligible head-to-head results. Unresolved places require a recorded decision. Pool games and singles quarterfinals go to 15, win by two. Semifinals and finals use best of three to 11, win by two.

## Run the MongoDB API

1. Run `docker compose up -d --wait` to start the local replica set. Use the loopback URI in `api/.env.example`. For Atlas, open the pickleball tournament project, select a cluster, add the API host’s outbound IP to Network Access, and create a database user with readWrite on the pickleball database. Use Connect → Drivers for the URI. Percent-encode special characters in the user name and password.
2. Copy `api/.env.example` to `api/.env`. Set MONGODB_URI, MONGODB_DB, SESSION_SECRET (generate with `openssl rand -hex 32`), CLIENT_ORIGIN (exact frontend origin, without a path), and PORT. Startup creates collection validators and indexes. Run `npm run api`.
3. Provision a user from the backend terminal. Set ACCOUNT_EMAIL and ACCOUNT_PASSWORD in the process environment using your secret manager or a hidden prompt. Run `npm run account -- --organizer` for a tournament creator, or `npm run account` for a referee. Save the returned user ID for staff and match assignment. Clear the provisioning variables after use.
4. Put `VITE_API_URL=http://localhost:4100` in the frontend’s `.env.local`, restart Vite and open `http://localhost:5173`. Sign in with the organizer account to create the first tournament. Every staff member uses their own account.
5. For production, run the API on a persistent HTTPS Node host that supports WebSocket upgrades. Set NODE_ENV=production. For the supplied Pages address, CLIENT_ORIGIN is `https://masteroil.github.io`. Different-site hosting requires CROSS_SITE_COOKIE=true and browsers that allow cross-site cookies. For phones that block these cookies, use a custom Pages domain and an API subdomain under the same registrable domain.
6. Build with the public HTTPS API origin in VITE_API_URL. Publish the contents of dist to the gh-pages branch, keeping .nojekyll at its root. The existing Pages deployment runs the isolated demo. Set database secrets only on the backend host.

## Implementation and verification

The React client and PWA are under src and public. Shared modules validate draws, match actions, scores, rankings and bracket advancement. api contains the Express and Socket.IO server, database initialization and account provisioning. Score writes use a replica-set transaction which serializes changes to a tournament, checks the expected match version, and atomically persists scores, derived standings, bracket positions, an audit and an idempotency receipt. Socket.IO sends a room invalidation after commit. Clients re-fetch their authorized snapshot on notifications, sign-in changes and reconnect.

Run `npm run build`, `npm test`, `npx playwright install chromium` and `npm run e2e`. CHROMIUM_PATH can select an existing Chromium executable. For the API checks, start a disposable loopback replica set and the API with MONGODB_DB=test_tournament, PORT=4100, CLIENT_ORIGIN=http://localhost:5173, and a test SESSION_SECRET. Export the same MONGODB_URI and MONGODB_DB to the test shell and run `node --import tsx tests/mongo-integration.ts`. The test refuses remote databases and creates unique synthetic records.

The local preset implements the event guide. The alternate USA Pickleball preset covers supported scoring formats and ranking criteria. Officials manually adjudicate incidents and service changes. Cross-division entrants must be checked for personal scheduling conflicts. Match histories and tournament-wide transactions target small events.
