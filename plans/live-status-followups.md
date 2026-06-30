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
