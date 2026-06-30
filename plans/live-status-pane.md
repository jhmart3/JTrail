# Live status pane — implementation plan

Branch: `live-status-pane`
Source-of-truth reference: `/Users/jack/Projects/flights/flights.py` (the working Python prototype this fork is porting).

## Goal

Add a "Live status" pane to JTrail that shows the same-day rotation history of the aircraft assigned to a user's upcoming flight, surfacing real-time delay information from FlightRadar24 before they head to the airport. Modeled exactly on the Python prototype's three operations:

1. **Tail lookup** — find the aircraft registration assigned to a given flight number on the origin airport's departures board.
2. **Same-day rotation walk** — recursively walk that tail's prior legs *today only*, stopping at midnight local of the user's flight date.
3. **Backup routes** — surface alternative same-day origin→destination flights so the user knows their fallback options.

## Aligned decisions

| Question | Decision |
|---|---|
| Where do FR24 calls happen? | TypeScript port inside the SvelteKit server. Use the `flightradarapi` npm package (same author as the Python lib, same API surface). |
| Caching? | None for v1. Stateless lookups per modal open. Add only if FR24 rate-limits surface. |
| Refresh cadence while modal is open? | 120 s. Friendly to FR24. |
| Scope of which flights show up? | Must satisfy all three: (a) flight exists in user's JTrail DB and the user is a seat-holder, (b) `departure_scheduled` is within 24 hours of `now()`, (c) `flight_number` is set. |
| UI form factor? | Modal, following the existing `ListFlightsModal` / `StatisticsModal` / `AddFlightModal` pattern. Mounted once in `+layout.svelte`. |
| Entry point? | New icon in `NavigationDock.svelte` between "List Flights" and "Statistics". |
| Backup routes section? | Included in v1. |
| Polling interval inside modal? | 120 s via `@tanstack/svelte-query`'s `refetchInterval`. |

## Backend

### New module: `src/lib/server/utils/fr24/`

Direct port of `flights.py`. Mirrors the existing `src/lib/server/utils/flight-lookup/` shape. Files:

- `client.ts` — thin wrapper around the `flightradarapi` npm package's `FlightRadar24API` class. Exposes `getAirportDetails(iata, page)` returning the same shape the Python script parses.
- `parse.ts` — port of `parse_flight(raw)`. Same defensive `value || {}` pattern. Returns a `Leg` type:

  ```ts
  type Leg = {
    flightNum: string;          // "WN500"
    tail: string | null;        // "N469WN"
    origin: string | null;      // "BNA"
    destination: string | null; // "DEN"
    airline: string;            // "Southwest Airlines"
    schedDep: number | null;    // unix seconds
    schedArr: number | null;
    actualDep: number | null;
    actualArr: number | null;
    status: string;             // "Scheduled" | "Estimated 13:24" | "Landed 12:42" | ...
  };
  ```
- `boards.ts` — port of `get_board_page(airport, board, page)`. Returns `Leg[]` for one page.
- `rotation.ts` — ports `find_assigned_tail`, `find_preceding_leg`, `walk_tail_history`. Honors the same constants (`MAX_HISTORY_LEGS=12`, `MAX_BOARD_PAGES=15`, `MAX_ARRIVAL_PAGES=10`). Same-day cutoff via `startOfToday()` from `date-fns`. Returns `{ yourLeg: Leg, priorLegs: Leg[] }`.
- `backup.ts` — port of `check_backup_routes(origin, destination, flightNum)`. Returns `Leg[]` of alternatives.

Same-day cutoff is computed in the **user's flight origin airport's local timezone**, not the server's. The airport's tz is on the `airport` row in the DB; pass it through.

### New tRPC router: `src/lib/server/routes/live-status.ts`

Two `authedProcedure` endpoints, registered in `_app.ts` under `liveStatus`:

```ts
export const liveStatusRouter = router({
  // Lists the user's flights eligible for live tracking.
  listUpcoming: authedProcedure.query(async ({ ctx }) => {
    // SELECT flight.* FROM flight
    // INNER JOIN seat ON seat.flight_id = flight.id
    // WHERE seat.user_id = ctx.user.id
    //   AND flight.flight_number IS NOT NULL
    //   AND flight.departure_scheduled BETWEEN now() AND now() + interval '24 hours'
    // ORDER BY flight.departure_scheduled ASC
    //
    // Returns the minimum fields needed for the modal header + rotation lookup:
    //   id, flightNumber, departureScheduled, from { iata, tz }, to { iata }, airline
  }),

  // Performs the full FR24 rotation lookup for one flight.
  getRotation: authedProcedure
    .input(z.object({
      flightNumber: z.string(),
      originIata: z.string(),
      destinationIata: z.string(),
      // departureScheduled is the user's expected gate-out, used as the cutoff
      // for the rotation walk and the day boundary for backup routes.
      departureScheduled: z.string().datetime({ offset: true }),
      originTz: z.string(), // e.g. "America/Chicago"
    }))
    .query(async ({ input }) => {
      // 1. findAssignedTail(originIata, flightNumber) → yourLeg
      // 2. walkTailHistory(yourLeg.tail, originIata, yourLeg.schedDep, originTz) → priorLegs
      // 3. checkBackupRoutes(originIata, destinationIata, flightNumber) → backupRoutes
      // Return { yourLeg, priorLegs, backupRoutes, fetchedAt: new Date().toISOString() }
    }),
});
```

Error handling: each procedure catches FR24 failures and returns a typed error result (`{ kind: 'fr24_unreachable' | 'tail_not_found' | 'no_upcoming_flights', message: string }`) rather than throwing. Lets the UI render specific empty states without an exception boundary.

### Authorization

Both procedures are `authedProcedure`. `listUpcoming` only returns the calling user's flights. `getRotation` accepts a flight number directly (doesn't check ownership) — that's fine, FR24 data is public and tying the rotation lookup to a DB ownership check would force the user to round-trip an internal flight ID just to ask "what's the rotation for WN500." Simpler this way.

## Frontend

### Global state

In `src/lib/state.svelte.ts`, add:

```ts
export const openModalsState = $state<OpenModalsState>({
  addFlight: false,
  listFlights: false,
  statistics: false,
  liveStatus: false,    // ← new
  settings: false,
  settingsTab: 'general',
});
```

Update `OpenModalsState` type accordingly.

### New component tree

`src/lib/components/modals/live-status/`:

- `LiveStatusModal.svelte` — top-level modal wrapper. Hosts a `flightSelector` (only shown when >1 upcoming flight), `RotationView`, and `BackupRoutes` sections.
- `FlightSelector.svelte` — pill bar at the top of the modal. Only rendered when `listUpcoming` returns 2+ rows. Defaults to the next-soonest flight.
- `RotationView.svelte` — renders "Your flight" header card + a vertical stack of `RotationLegRow` instances for prior legs in chronological order, your flight last. Highlights your flight (a `border-l-4 border-primary` or similar visual treatment).
- `RotationLegRow.svelte` — one row in the rotation. Reuses the airline icon + IATA→IATA route pattern from `FlightCard.svelte`. Shows scheduled dep/arr times, actual times where available, the existing delay formatter from `ListFlightsModal.svelte` (`+14`, `+1:15`).
- `BackupRoutes.svelte` — collapsed by default. Header row "Backup routes (N)". Expanded view is a list of alternative flights with airline, scheduled dep, current status.
- `EmptyState.svelte` — used when `listUpcoming` returns zero flights. Friendly message + CTA to add a flight.

### Entry point

In `src/lib/components/NavigationDock.svelte`: add a new dock item between "List Flights" and "Statistics". Icon: `Radio` or `Activity` from `@o7/icon/lucide` (TBD which reads as "live" better). Click → `openModalsState.liveStatus = true`.

### Layout mount

In `src/routes/+layout.svelte`, add `<LiveStatusModal bind:open={openModalsState.liveStatus} />` alongside `AddFlightModal` and `SettingsModal`.

### Query wiring

Inside `LiveStatusModal.svelte`:

```ts
const upcomingQuery = trpc.liveStatus.listUpcoming.query();
const selectedFlightId = $state<number | null>(null);

const selectedFlight = $derived(
  upcomingQuery.data?.find(f => f.id === selectedFlightId) ??
  upcomingQuery.data?.[0] ?? null
);

const rotationInput = $derived(selectedFlight ? {
  flightNumber: selectedFlight.flightNumber,
  originIata: selectedFlight.from.iata,
  destinationIata: selectedFlight.to.iata,
  departureScheduled: selectedFlight.departureScheduled,
  originTz: selectedFlight.from.tz,
} : null);

// Only fires when we have a flight selected. Refetches every 120s while the modal is open.
const rotationQuery = trpc.liveStatus.getRotation.query(
  () => rotationInput,
  { refetchInterval: 120_000, enabled: !!rotationInput && open }
);
```

### Empty / loading / error states

| State | UI |
|---|---|
| No upcoming flights in next 24 h | `EmptyState` — "No flights scheduled in the next 24 hours" + "Add a flight" button. |
| Upcoming flight found, FR24 fetch in flight | Skeleton rows (3-4 placeholder leg rows + 1 highlighted "your flight" placeholder). |
| FR24 returned, tail not found | Soft message: "FR24 hasn't assigned an aircraft to flight WN500 yet. This usually happens within ~12 hours of departure. Check back later." Still show the user's flight as a single-row card. |
| FR24 unreachable | Inline error banner inside the modal with a "Retry" button. The query will auto-retry per `refetchInterval` regardless. |
| Multiple upcoming flights | `FlightSelector` pill bar at the top, default selection = next-soonest. |

## Mobile

Modal must be responsive — wrap the rotation list in the same `Sheet`/`Drawer` variant the other modals use on `< md`. The `RotationLegRow` should remain visually identical to the desktop row; AirTrail's existing list view already proves a card-based vertical layout reads well on mobile.

## Visual treatment

- **Status pill** on each leg: derived from FR24's `status.text` (`"Scheduled"`, `"Estimated 13:24"`, `"Landed 12:42"`, `"Departed 11:55"`, etc.). Map to a small badge: green for on-time / landed, amber for "Estimated" with delay, red for ≥30 min late, gray for "Scheduled" / unknown.
- **Delay number formatting:** reuse the `formatDelay(minutes)` helper from `ListFlightsModal.svelte` so `<60 min` shows as `"+14"` and `≥60 min` shows as `"+1:15"`. If we end up using this in two places, hoist it to `src/lib/utils/datetime.ts` or similar.
- **Your-flight row:** distinguished by accent border on the left side and a `font-semibold` on the route text. Don't use the badge "👉" emoji from the Python script — too playful for AirTrail's aesthetic.

## Implementation order

Phased so each phase is independently demoable.

### Phase 1 — FR24 client

- Install `flightradarapi` npm package.
- Port `parse_flight` to `parse.ts` with unit tests (vitest) against canned FR24 response fixtures.
- Port `get_board_page` to `boards.ts`.
- Port `find_assigned_tail`, `find_preceding_leg`, `walk_tail_history` to `rotation.ts`.
- Port `check_backup_routes` to `backup.ts`.
- One-off smoke test: a vitest test that calls the live FR24 API with the same `WN500 / BNA / DEN` inputs as the Python script and verifies non-empty results. Skipped by default; runnable with `bunx vitest run src/lib/server/utils/fr24 --include "*.live.test.ts"`.

### Phase 2 — tRPC router

- Add `live-status.ts` router with the two procedures sketched above.
- Register in `_app.ts`.
- No UI yet — test via `bunx tsx scripts/...` or the SvelteKit `/api/trpc` endpoint directly with curl.

### Phase 3 — UI scaffolding

- Add `openModalsState.liveStatus`.
- Build `LiveStatusModal`, `RotationView`, `RotationLegRow`, `BackupRoutes`, `EmptyState` skeletons with hardcoded mock data first.
- Wire to `+layout.svelte`.

### Phase 4 — Wire it all up

- Replace mock data with `trpc.liveStatus.listUpcoming` and `trpc.liveStatus.getRotation` queries.
- Add `NavigationDock` entry.
- Test on both desktop and mobile breakpoints.
- Verify 120s refetch interval triggers (check Network tab).

### Phase 5 — Polish + ship

- Status pill mapping (`text` → color tier).
- Auto-refresh visible indicator (small dot or "Updated 12s ago" footer).
- Error states + retry buttons.
- Lint, unit tests, manual smoke.

## Risks / open items

- **FR24 rate limits.** Unknown. The Python script polls 15-20 pages per flight per modal open. If FR24 starts 429-ing us once this is used in production, we add a tiny per-flight cache (e.g. 60s TTL) to deduplicate same-second loads from auto-refresh.
- **Timezone for "same day" cutoff.** Python uses `datetime.now()` which is the server's local time. The TS port must use the user's flight origin airport timezone (e.g. a 11:55 BNA departure with a CST midnight cutoff). The airport's `tz` field is already on the `airport` table — pass through `originTz` and use `@date-fns/tz` to compute the boundary correctly. Otherwise an east-coast server processing a west-coast flight will get the cutoff wrong by hours.
- **"FR24 hasn't assigned an aircraft yet" case.** Common when the flight is >12 h away. The board scan returns no match. UI handles this with the "check back later" empty state — don't treat it as an error.
- **Flight number format variations.** `"WN500"`, `"WN 500"`, `"WN-500"`, `"SWA500"` (ICAO not IATA). The Python script doesn't normalize. The JTrail DB stores whatever the user typed. For robustness, the tRPC procedure could strip spaces and uppercase before sending to FR24, but ICAO vs IATA flight codes can't be resolved cheaply — punt for v1 and require the user to enter the FR24-compatible form.
- **`flightradarapi` npm package maintenance.** Check the GitHub repo + recent commits before installing. If it's stale or has open issues around the `airport` endpoint, fall back to writing thin HTTP calls directly against `api.flightradar24.com/common/v1/airport.json` ourselves. The Python script uses the same endpoint, so we have a known-good shape to match.

## Out of scope for v1 (capture for later)

- Persistent storage of rotation history (we don't write anything to the JTrail DB; everything is fetched fresh).
- Push notifications when a delay crosses a threshold.
- Historical "this flight was X min late" backfill for past flights in the user's list.
- Cross-day rotation walks (we explicitly cap at start-of-day of the user's flight).
- Map overlay of the rotation route (could be a nice future addition — the existing MapLibre setup could render the multi-leg path as connected arcs).
