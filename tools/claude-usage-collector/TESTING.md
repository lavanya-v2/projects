# Claude Usage Collector — clean-slate test runbook

A start-to-finish way to test onboarding the way a pilot user experiences it, and to
reset between runs. Local example uses `http://localhost:3000`; a real deploy uses
your Lens HTTPS origin.

---

## A. Admin: one-time setup

```bash
cd backend
npm run build
npx sequelize-cli db:migrate     # creates the new tables (pricing, pilot, monitored_org, …)
npm start                        # (restart if already running, so it serves the new routes)
```

Then in Lens:
1. **Admin → User Management** → turn on **Claude Usage pilot** for the test user (superusers already have access).
2. Leave **Admin → Monitored Orgs** open — the customer org appears here as **Pending** after the first push (step B), then you enable it.

## B. Pilot user: onboard (the whole thing)

1. Open **My Claude Report → How it works & consent** → tick consent → **Enable collection**.
   Copy the **one-line command** shown (token + URL already baked in).
2. Paste it into **Terminal** (macOS/Linux) or **PowerShell** (Windows) and press Enter:
   ```bash
   curl -fsSL http://localhost:3000/api/collector/install.sh | bash -s -- --token clct_xxx --url http://localhost:3000
   ```
   No download, no "cannot verify malware" prompt, no admin. It installs, pushes once, and
   sets up auto-run (after each Claude session).
3. First push is **rejected on purpose** with "organization not enabled yet" — that's the
   allowlist working. It also makes the org show up for the admin.
4. **Admin → Monitored Orgs** → flip the customer org from **Pending** to **on**.
5. Re-run once to send immediately (or just wait for the next Claude session):
   ```bash
   node ~/claude-usage-collector/collector.js
   ```
6. Refresh **My Claude Report** — data is there.

## C. Reset to test again from scratch

On the machine:
```bash
node ~/claude-usage-collector/collector.js   # (optional) see current state first
node ~/claude-usage-collector/setup.js --reset   # wipes config, outbox, throttle, and the hook
```
In Lens (optional, to clear server state too):
- **My Claude Report → How it works & consent → Delete my collected data**, then **Disable & revoke my token**.
- **Admin → Monitored Orgs**: toggle the org off if you want to re-test the pending→enable flow.

Then start again at **B.1** (generate a fresh token, paste the one-liner).

---

### Why the one-liner has no Gatekeeper prompt
macOS quarantines files **downloaded by a browser** and blocks double-clicking them. The
one-line installer is *streamed* through `curl … | bash` — nothing is written by the
browser/Finder, and `node` run from Terminal isn't gated — so the alert never appears and
there's no `xattr` to run. The `.zip` path still exists as a fallback for locked-down
machines (clear quarantine with `xattr -cr .`).
