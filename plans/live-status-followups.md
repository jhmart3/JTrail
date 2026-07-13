# Live status pane — known follow-ups

Tracked here so they don't get lost. None are blockers; they're polish items
for a later pass over the live-status pane after the core flow ships.

## Status pill coloring

The leg rows currently render FR24's raw `status` string as muted text
("Scheduled", "Estimated 13:24", "Landed 12:42", "Departed 11:55", etc.).
That's information-dense but visually uniform — at a glance you can't tell
"this flight is fine" from "this flight is delayed an hour" without reading.

Map the status text to a small colored badge:

- `Landed *` or `Arrived *` → green
- `Departed *` or `En route` → blue or muted (in-flight, not actionable)
- `Estimated *` with a delay vs scheduled → amber if 15-30 min late, red if >30 min
- `Scheduled` (no estimate yet) → gray
- `Canceled` / `Diverted` → red

Files: `src/lib/components/modals/live-status/RotationLegRow.svelte`,
`src/lib/components/modals/live-status/BackupRoutes.svelte`.

## Mobile layout verification

Desktop layout has been visually verified. The Modal component uses a drawer
variant on `< md` widths but the live-status modal hasn't been clicked through
on a phone-width viewport. Check:

- Rotation rows wrap/truncate cleanly at narrow widths
- FlightSelector pill bar scrolls horizontally without overflow
- BackupRoutes section expands without breaking the drawer height

## Relative "Updated 12s ago" timestamp

Currently shows absolute fetch time ("Updated 1:32:47 PM"). A relative
timestamp ("Updated 12s ago", refreshing every second) is more useful for
"is this fresh?" at a glance — the absolute time loses meaning quickly.

`src/lib/components/modals/live-status/LiveStatusModal.svelte` — the
`<footer>` at the bottom of the rotation view.

## Tail-not-found could still show user's flight card

When FR24 hasn't assigned an aircraft yet (common for flights >12h out), the
modal shows an explanatory paragraph but doesn't display the user's flight
itself. Could improve by rendering a single-row card with the user's flight
info (airline, route, scheduled times) so the user has visual confirmation
the right flight is being tracked.

## Stack Gate-Out and Gate-In on the user's own flight

For state='mine' the relevant timestamp depends on perspective: pre-departure
the user cares about gate-out (boarding cutoff); in-air they care about
gate-in (when to plan the rest of the trip). Single-summary view forces a
choice. Could replace the right column with two stacked lines for 'mine'
only:

  Est. Gate-Out 8:00 PM (+1:05)
  Est. Gate-In 11:30 PM (+0:20)

One eventDisplay() helper picks the best timestamp per event
(real > est > sched), prefixes it appropriately, and computes the delay
against scheduled. Other states keep the existing single-summary display.

Prototyped on the `live-status-cache-invalidation` branch and reverted —
recoverable from local reflog (commit `0ec8ad1`) if we want to restore.

## Include in-progress flights in listUpcoming

**Landed on branch `live-status-window-rules`** (2026-07-13). Replaced the
strict `[now, now+24h]` filter with:

- Rule 1 — `COALESCE(departureScheduled, departure) <= now + 24h`
- Rule 2a — `flight.arrival IS NULL` (user hasn't logged the arrival yet)
- Rule 2b — cached rotation's `yourLeg.realArr` is null (client-side)
- Rule 3 — `COALESCE(arrivalScheduled, departureScheduled + 24h,
  departure + 24h) >= now - 6h`

Same PR also fixed `findAssignedTail` to fall back from origin departures to
destination arrivals so a mid-flight leg is still located after FR24 drops
it from the departures board.

The RotationView `activeIndex` short-circuit for `yourLeg.realDep`-set is
still a follow-up — currently a prior leg can still receive the green border
when the user's own flight has already pushed back.

## Derive arrival estimate when FR24 doesn't have one

For the user's own flight, if FR24 has a real or estimated departure but no
arrival estimate, fall back to a derived `Est. Gate-In` = depTs + (schedArr
- schedDep). Heuristic matches what airline apps do — propagate the dep
delay to arrival assuming no in-flight makeup.

Useful when a flight is in progress but FR24 hasn't published an estArr
yet (data lag). Current behavior falls back to scheduled, which feels
inconsistent against a clearly-delayed gate-out line above.

Prototyped on the `live-status-cache-invalidation` branch and reverted —
recoverable from local reflog (commit `a63e5ea`).

## Disambiguate tail lookup by user's scheduled departure + destination

`findAssignedTail` currently returns the first board row matching the flight
number. FR24's departures board returns multiple days of the same flight
number (yesterday's, today's, tomorrow's), AND flight numbers can repeat
within a day for different routes — so the first-match behavior can pick up
the wrong day's row OR a same-flight-number row for a different destination.
Either way the wrong tail leaks through and the rotation walk produces stale
data for downstream legs.

Fix: thread the user's `departureScheduled` (ISO) and `destinationIata`
through to `findAssignedTail`. Filter by destination, then pick the
remaining row whose schedDep is closest to the user's target. Short-circuit
on the first within ±6h (definitely the right day), else track best across
all pages.

Prototyped on the `live-status-cache-invalidation` branch and reverted —
recoverable from local reflog (commits `91bc10c` for the time fix and
`d5eaedc` for the destination filter). Both need to land together to fully
fix the wrong-tail case in production. Reverted because reproduction wasn't
confirmed cleanly enough to ship — needs another round of testing against
a flight where the wrong tail is consistently reported, then re-apply.
