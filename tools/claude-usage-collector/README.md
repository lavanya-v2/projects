# Claude Usage Collector (Lens)

A tiny, dependency-free **Node.js** agent that runs on an engineer's machine, reads
Claude Code's local session transcripts, and sends **content-free** usage numbers to
Lens once a day. Lens turns those numbers into a personal prompt-effectiveness report
plus AI coaching.

## The privacy firewall (non-negotiable)

Engineers use the **customer's** Claude license, so **no customer data may ever leave
the machine.** This collector transmits **only integers**:

**Sent:** prompt counts, Good/OK/Poor tallies, category signal tallies (e.g. "no
context", "rework"), token totals per model, session/project **counts**,
skill/MCP/tool usage **counts**, and your Claude **organization id/name** (which
customer license — read from the account file, never your login tokens).

Since v1.5.0 it also sends **efficiency signals**, still as plain counts: how many
times a conversation was compacted (and how many tokens that dropped), how many
sessions fell into each size/duration **bucket**, the peak number of sessions open
at once, how many prompts fell into each **delay bucket**, and a count of prompt
categories per model.

**Never sent:** prompt text, Claude's replies, code, file paths, `cwd`, project/repo
names, git branches, session ids, skill/MCP names, command arguments, your **email**,
or any **auth token**. Cost is computed in Lens, not here.

Note what this means for the efficiency signals: session ids and message timestamps
are **read on your machine** to work out session sizes, overlap and delays, and are
**collapsed to bucket counts before anything is sent**. No id, no timestamp and no
individual session ever reaches Lens — `buildPayload` in `collector.js` is the single
place that decides, and `test-privacy.js` asserts it against a hostile input.

### Nothing is sent while you are on a VPN

Engineers work inside customer networks. A request made from there — including the DNS
lookup that precedes it — is visible to the customer's network monitoring, and an agent
seen reaching out from inside their perimeter is an impression we cannot afford, whatever
the request actually contains.

So before sending anything, the collector checks whether a VPN is connected. If one is,
**nothing goes out at all.** The day's numbers are worked out as usual and queued in
`outbox.json` on your own machine, then sent on the next run that happens off VPN.
Nothing is lost; it arrives late.

Check your own state at any time:

```bash
node vpn.js            # VPN: no (clear)  /  VPN: yes (tunnel)
node vpn.js --explain  # also names the adapter responsible — LOCAL SCREEN ONLY,
                        # never sent anywhere. Use this to diagnose a surprising verdict.
```

**How it decides.** Stage 2 (see git history for the earlier, more elaborate — and
ultimately unreliable — generic approach this replaced): a deliberately simple,
platform-specific check, one fact per platform, verified against real machines rather
than inferred:

- **Windows.** CCM's VPN adds `crosscountrymtg.local` as the DNS suffix on the active
  adapter. `ipconfig`'s plain output is checked for that suffix on any adapter currently
  carrying an IPv4 address — no PowerShell, no process list, no interface-shape
  reasoning. Verified against six real CCM team members' machines (five genuine
  same-machine on/off comparisons among them), zero exceptions, including on machines
  running Hyper-V (whose own virtual adapter never carries this suffix — the exact false
  positive that broke the earlier, more general approach never arises here, because this
  isn't a shape rule).
- **macOS / Linux.** Unchanged from earlier rounds: a real network card has a hardware
  address, a tunnel does not. Has never produced a false positive.
- **A machine-wide proxy** (all platforms), which catches tools that redirect traffic
  instead of tunnelling.
- **The OS's own VPN subsystem** (macOS only) reporting a connection.

Enrollment is handled on the human side — only CCM team members are given this build —
so the tool itself does not need to recognise any other customer's VPN yet. See the plan
file for the parked, later step that would make the expected domain configurable rather
than hardcoded, if that's ever needed.

**If a check cannot be run** — blocked by policy — the collector now sends anyway,
marked `unverified`, instead of staying silent. Earlier versions treated "we could not
look" identically to "on VPN", which meant a machine whose check broke would go quiet
forever with no way for anyone to notice why. A genuine positive detection still blocks
regardless of this — only the "we don't know" case changed. This is visible on the admin
side: the collector declares `vpnGate: allowed-after-failed-check` on what it sends, and
that shows up as `unverified` directly in Lens's ingest Audit Log and as a medium-severity
flag in Data Quality.

**Settings** (all in `config.json`, all optional):

| Key | Default | Effect |
|---|---|---|
| `skipOnVpn` | `true` | The gate itself. Turning it off means reports may leave from inside a customer network. |
| `treatProxyAsVpn` | `true` | Set `false` only if our own network uses a proxy and is suppressing reports everywhere. |
| `vpnAllowInterfaces` | `[]` | macOS/Linux only. Exact interface names to exempt, for a reviewed exception. |

> **Windows status:** confirmed against six real machines, one VPN client (CCM's),
> including five same-machine on/off comparisons. If a machine goes unexpectedly quiet,
> `node vpn.js --explain` shows whether the suffix was found — LOCAL SCREEN ONLY, never
> sent anywhere.
>
> Honestly stated limit: this version only recognises CCM's VPN. It is not
> multi-customer-aware yet — that is a deliberate, parked step (see the plan file), not
> an oversight, and enrollment is controlled on the human side to match.

### Monitoring only the customer license (multi-customer)

The collector reads the **organization** your Claude Code is currently signed into
(from `~/.claude.json` — only `organizationUuid` + `organizationName`, never tokens)
and sends that id so Lens attributes usage to the right customer. Lens only stores
data from **allowlisted** customer orgs (an admin enables each one), so personal or
other-account usage is rejected. **Claude *web* usage is never on disk, so it's
excluded automatically.**

Two optional `config.json` settings:
- `claudeConfigDir` — point at a dedicated Claude config dir (a `CLAUDE_CONFIG_DIR`
  setup) so the customer license is fully isolated from any personal Claude Code account.
- `expectedOrgUuid` — a local guard: only push when the current org matches this uuid.

Limitation: because individual sessions don't record their account, the org reflects
the **current login**. If you use Claude *Code* with the customer license *and* a
personal account in the **same** config dir, use `claudeConfigDir` isolation for clean
separation.

`buildPayload()` in `collector.js` is the single seam where data is shaped for the
wire, and `test-privacy.js` proves a hostile aggregate (full of paths/text) cannot
survive it. Run it anytime:

```bash
node test-privacy.js
```

## Requirements

Just **Node.js** — already present on any machine that runs Claude Code. No `npm install`.

## Onboarding (engineer, ~2 minutes)

1. Log into Lens → **My Claude Report** → **Set up collector** → **consent** → **Generate token**.
2. Unzip this package, then pick **one** of the options below.

### What the installer sets up

Everything writes only inside your own user folder — **no administrator rights required
on either platform**, including the Windows scheduled task.

You get **two independent triggers**, on purpose:

| Trigger | When it runs | Why it exists |
|---|---|---|
| **Daily OS job** (launchd / Task Scheduler) | 13:05 and 18:05 local, **Mon–Fri** | Guarantees you appear in Lens every working day, even if you never open Claude Code |
| **Claude session hook** | after a session ends, throttled to ~12h | Freshness — today's work shows up without waiting for the next fire |

They cannot suppress one another: `--throttle` is the only thing that touches
`.last-run`, and the scheduled run deliberately passes none.

```bash
node setup.js --token clct_xxx --url https://lens.your-company.internal --hook --schedule
```

Prefer the platform wrappers if you unzipped the package — they do the same thing:

```bash
# macOS / Linux
./install-mac.sh --token clct_xxx --url https://lens.your-company.internal

# Windows (no admin needed)
powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Token clct_xxx -Url https://lens.your-company.internal
```

`--url` is the **backend origin** (e.g. `http://localhost:3000` locally).

**Check it actually worked** — this reads the schedule back out of the OS rather than
assuming the install succeeded:

```bash
node setup.js --status      # prints the live trigger, ending in tier=scheduler
```

If your machine cannot schedule (some corporate Windows policies block Task Scheduler),
the installer says so and falls back — Startup folder, then the session hook — instead of
claiming success. `tier=hook` means you will miss any day you do not use Claude Code.

Change the times with `--at 09:05,17:05`; remove the job with `node setup.js --unschedule`.

> **macOS "cannot verify… malware" alert?** That's Gatekeeper, because the folder was
> downloaded. It's not malware — it's an unsigned script. Easiest fix: run from Terminal
> instead (no Gatekeeper prompt). In Terminal, `cd` into this folder and run:
> ```bash
> xattr -cr .          # clear the download quarantine on these files (one time)
> node collector.js    # push now — no double-click needed
> ```

## Weekends

Nothing is sent on Saturday or Sunday. The OS job does not fire, **and** the collector
filters weekend days out of the payload before choosing which days to send — both are
needed. Filtering only at the end would let a weekend consume the send window: someone
who worked Fri/Sat/Sun would push `[Sat, Sun, Mon]` on Monday and **Friday would never be
sent at all**.

Weekend work still counts locally; it simply is not reported.

## What runs

```
launchd / Task Scheduler        Claude Code SessionEnd hook
  13:05 + 18:05, Mon-Fri          after a session, max once / 12h
        └──────────────┬──────────────┘
                       ▼
        node collector.js --days 4 --skip-weekends
              reads ~/.claude/projects/**   (local, read-only)
              computes content-free aggregates
              POST <lensBaseUrl>/api/ingest/claude-usage
                Authorization: Bearer <ingestToken>
              offline? -> outbox.json, retried next run
```

The daily job sends the last 4 **weekday** days, not just yesterday, so a machine that
was off for a stretch backfills itself. Ingest is idempotent, so re-sending is free.

## Turn it off / uninstall

- **From Lens:** *My Claude Report → Disable* revokes your token; the collector's next
  POST gets `401`, it **stops**, and prints how to remove the local job.
- **Remove the local job:** `node setup.js --reset` removes the daily job, the session
  hook and your local config in one step. (`./uninstall-mac.sh` /
  `uninstall-windows.ps1` just call it for you.)
- **Delete your data:** *My Claude Report → Delete my collected data* purges your rows
  (aggregates only — nothing customer-identifying was ever stored).

## Manual / debugging

```bash
node collector.js --dry-run --days 7   # compute + print payloads, send nothing
node collector.js --date 2026-08-01    # process one specific day
node collector.js --local-dashboard    # also write a local-only dashboard.html
node collector.js --vpn-check          # is the VPN gate currently holding reports back?
node setup.js --status                 # what is actually triggering your reports
```

**"My data has stopped appearing in Lens."** Run `node vpn.js`. If it says
`VPN: yes`, that is the answer — the days are queued in `outbox.json` and will go out
once you are off the VPN.

## Tests

```bash
bash test/run.sh                     # end-to-end: really registers a launchd job and waits for it to fire
node test-privacy.js                 # asserts the payload stays content-free
node test/vpn.test.js                # asserts the VPN gate decides correctly
node test/no-network-on-vpn.test.js  # asserts the collector OBEYS it — zero packets, zero DNS
```

`no-network-on-vpn.test.js` runs the collector with `dns.lookup` and `Socket.connect`
replaced by functions that kill the process, and includes a control case that opens the
gate and requires the process to die — so the test cannot pass by checking nothing.

### Why nothing may touch the network before the gate

The guarantee would otherwise rest on where one line sits in `main()`: everything above the
gate happens to avoid the network. That is true only by arrangement, and ordinary
maintenance breaks it. The realistic failure is an edit six months from now adding
something reasonable near the top — a version check, a heartbeat, a token refresh. Every
test still passes, the collector still refuses to send reports on a VPN, and it looks fine.
But resolving the Lens hostname has emitted a DNS query from inside a customer network,
with no error and nothing wrong-looking in review.

So the ordering is made irrelevant. `installNetworkLock()` runs first in `main()` and
replaces name resolution and socket connects with functions that throw; only the gate,
once passed, releases them. A network call in the wrong place now fails immediately and
loudly on the developer's own machine, exits non-zero, and names the cause. The comment
above the gate is documentation; the lock is the enforcement.

It covers Node's own networking. Code that shells out (curl, PowerShell) would bypass it —
nothing here does, and nothing should.

`test/run.sh` runs in a scratch `HOME` against a local stub, so it never touches your
real install or production. Its central case removes the session hook entirely and proves
data still arrives — the failure mode a "does it work?" trial run cannot produce.

`config.json` (`{ lensBaseUrl, ingestToken, enabled }`) can be edited directly; set
`"enabled": false` to pause without uninstalling.

## Sysadmin bulk rollout

Provision per-user tokens in Lens (admin), push this folder + a per-user `config.json`
via GPO/MDM/Intune, and deploy the scheduled task the same way — no engineer action
required.

## Integrity model & limitations (read this)

This is a **coaching tool, not an audit.** The numbers are **self-reported** from a
machine the engineer controls, so Lens **cannot cryptographically prove** they are
accurate — and it does not try to. Instead:

- **Impossible data is rejected.** Rows that break basic arithmetic (e.g. more "good"
  prompts than scored prompts, a score sum that implies an average above 100) are
  refused at ingest and never stored.
- **Implausible data is flagged, not blocked.** Rows that merely look unusual
  (implausibly perfect scores at volume, odd token ratios, sudden regime shifts) are
  surfaced in **Admin → Data Quality** for a human glance. Honest heavy users can trip
  these, so a flag means "worth a look", never "proof of anything".
- **It is deliberately not tied to compensation or ratings.** The value/leverage and
  vibe signals exist to encourage better use. Because gaming them buys nothing, there
  is little incentive to. The private vibe nudge is shown only to the individual, never
  to managers.

Do not present any of these figures to a customer as their cost, or use them
punitively — that breaks the trust the tool depends on.

## Notes

- Covers **Claude Code** usage (CLI/desktop), which is what writes `~/.claude/projects`.
  Usage only via the claude.ai website is not in local transcripts and isn't captured.
- Scores and the vibe-coding index are **heuristic estimates** meant to coach, not grade.
