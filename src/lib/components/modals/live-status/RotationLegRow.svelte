<script lang="ts" module>
  // Visual classification of a leg row, controls the left-border color and
  // whether the row is tappable to open FR24. Orthogonal to `isMine` — the
  // user's own leg starts as 'mine' before push-back and becomes 'active'
  // once wheels-up, but the "is this yours" font-weight cue is carried by
  // the separate `isMine` prop so it applies in either state.
  //   - 'mine'      → the user's own flight before push-back, accent blue
  //   - 'active'    → the rotation leg currently in motion or most recently
  //                   landed; emerald to signal "this one matters now".
  //                   May be a prior leg OR the user's own leg once airborne.
  //   - 'landed'    → completed past legs, faint grey (faded, not interesting)
  //   - 'scheduled' → not yet started, no border
  export type LegState = 'mine' | 'active' | 'landed' | 'scheduled';
</script>

<script lang="ts">
  import { ExternalLink } from '@o7/icon/lucide';

  import type { FR24Leg } from '$lib/server/utils/fr24';
  import { cn } from '$lib/utils';

  let {
    leg,
    state,
    isMine = false,
    flightStatsUrl = null,
  }: {
    leg: FR24Leg;
    state: LegState;
    isMine?: boolean;
    // Optional FlightStats deep-link for this row. Only honored when the
    // row is the user's own leg AND state === 'mine' — priors are never
    // linked to FlightStats per product scope. When state === 'active',
    // fr24Url wins and this prop is ignored, so the FR24 live-map link
    // always takes precedence once the flight goes airborne.
    flightStatsUrl?: string | null;
  } = $props();

  // Format an FR24 unix-seconds timestamp as a short 12-hour local time
  // ("11:55 AM") in the given IANA tz. hour12 is forced so non-US locales
  // don't render as 24-hour. Falls back to the user's local tz when tz is
  // null (rare — only if the JTrail airports table doesn't know this IATA).
  function fmtTime(ts: number | null, tz: string | null): string {
    if (!ts) return '--';
    return new Date(ts * 1000).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz ?? undefined,
    });
  }

  // Render a positive-minute delay as "h:mm". 14 min → "0:14", 75 min → "1:15".
  function fmtHM(minutes: number): string {
    const abs = Math.abs(minutes);
    const h = Math.floor(abs / 60);
    const mm = String(abs % 60).padStart(2, '0');
    return `${h}:${mm}`;
  }

  // ±10 min tolerance for "on time". FR24's data is timestamped to the second
  // but the underlying source is minute-precise; sub-10-min deltas are either
  // schedule rounding or normal turn/taxi variance that's not actionable for a
  // passenger. The list view uses 15 min (DOT A15) for historical reporting —
  // different question, slightly looser threshold.
  const ON_TIME_TOLERANCE_MIN = 10;

  // Decide the delay summary for this leg.
  // Priority order matters: arrival (real, then estimated) wins over departure
  // (real, then estimated). A flight that pushed back 23 min late but is
  // expected to land on time should read "Est. on time" rather than "0:23
  // Late" — the eventual arrival is the bottom-line outcome the passenger
  // cares about. Departure is the fallback signal when we have no arrival
  // information at all.
  type Summary = { label: string; tone: 'early' | 'late' | 'on-time' };
  function pickSummary(): Summary | null {
    const candidates: Array<{
      scheduled: number | null;
      actual: number | null;
      kind: 'real' | 'est';
    }> = [
      { scheduled: leg.schedArr, actual: leg.realArr, kind: 'real' },
      { scheduled: leg.schedArr, actual: leg.estArr, kind: 'est' },
      { scheduled: leg.schedDep, actual: leg.realDep, kind: 'real' },
      { scheduled: leg.schedDep, actual: leg.estDep, kind: 'est' },
    ];
    for (const c of candidates) {
      if (!c.scheduled || !c.actual) continue;
      const diffMin = Math.round((c.actual - c.scheduled) / 60);
      const prefix = c.kind === 'est' ? 'Est. ' : '';
      if (Math.abs(diffMin) <= ON_TIME_TOLERANCE_MIN) {
        return { label: `${prefix}On Time`, tone: 'on-time' };
      }
      if (diffMin > 0) {
        return { label: `${prefix}${fmtHM(diffMin)} Late`, tone: 'late' };
      }
      return { label: `${prefix}${fmtHM(diffMin)} Early`, tone: 'early' };
    }
    return null;
  }

  const summary = $derived(pickSummary());

  // Active legs (the one in motion or most-recently-landed) link out to
  // FR24's flight page so the user can see the plane on the map. The URL
  // format matters — FR24's desktop web resolves the shortcut
  // `flightradar24.com/<flight_number>` via server-side redirect, but the
  // mobile app intercepts URLs via Universal Links BEFORE they hit the
  // server, and its route handler doesn't recognize the shortcut → shows
  // "invalid link". Two well-defined formats that BOTH desktop and mobile
  // app handle:
  //   - /<flightId> : direct live-tracking URL when we have FR24's runtime
  //     ID. Opens the map view immediately. Best when available.
  //   - /data/flights/<lowercase flight_number> : flight history page.
  //     Universal fallback when there's no flightId (e.g. a leg that
  //     completed hours ago and dropped its live tracking session).
  // Other states aren't linked: 'mine' is the user's own flight (they can
  // look up their own number); 'landed' is past data; 'scheduled' isn't yet
  // tracked.
  const fr24Url = $derived.by(() => {
    if (state !== 'active') return null;
    if (leg.flightId) {
      return `https://www.flightradar24.com/${encodeURIComponent(leg.flightId)}`;
    }
    if (leg.flightNumber) {
      return `https://www.flightradar24.com/data/flights/${encodeURIComponent(
        leg.flightNumber.toLowerCase(),
      )}`;
    }
    return null;
  });

  // Effective tap-target URL for this row. Two independent link sources
  // stack, with active-state (FR24) always winning:
  //   1. Active state → FR24 live-map link (fr24Url above).
  //   2. Otherwise, if this is the user's own leg in 'mine' state AND we
  //      have a FlightStats URL from the server, use that. FlightStats
  //      fills the pre-departure gap where FR24 has no live tracking yet.
  //
  // When linkUrl is null, no tap-target styling, no icon, no anchor — the
  // row is a plain read-only display. This is the failure mode when the
  // FlightStats scraper couldn't resolve a URL, and matches the
  // "fail-quiet" requirement.
  const linkUrl = $derived.by<string | null>(() => {
    if (fr24Url) return fr24Url;
    if (isMine && state === 'mine' && flightStatsUrl) return flightStatsUrl;
    return null;
  });
</script>

<div
  class={cn(
    'relative flex items-stretch gap-3 py-2',
    state === 'mine' && 'border-l-4 border-primary pl-3',
    state === 'active' && 'border-l-4 border-emerald-500 pl-3',
    state === 'landed' &&
      'border-l-4 border-zinc-400/50 dark:border-zinc-500/50 pl-3',
    isMine && 'font-semibold',
    linkUrl && 'cursor-pointer hover:bg-hover transition-colors rounded',
  )}
>
  <!-- When this row has a resolved link URL, stretch an invisible anchor
       over the whole row so any tap on the row opens the external page.
       The visible content stays plain text; we give a big tap target plus
       a small external-link icon next to the flight number for
       discoverability. FR24 (emerald active) wins; FlightStats (blue
       mine) fills in for the user's own pre-departure leg only. -->
  {#if linkUrl}
    <a
      href={linkUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={fr24Url ? 'View on FlightRadar24' : 'View on FlightStats'}
      class="absolute inset-0"
    ></a>
  {/if}
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2 text-sm">
      <span class="font-extrabold tracking-wide">
        {leg.origin ?? '???'}
      </span>
      <span class="text-muted-foreground">→</span>
      <span class="font-extrabold tracking-wide">
        {leg.destination ?? '???'}
      </span>
      <span
        class="text-muted-foreground text-xs ml-2 truncate inline-flex items-center gap-1"
      >
        {leg.flightNumber}
        {#if linkUrl}
          <ExternalLink size="12" class="shrink-0" />
        {/if}
      </span>
    </div>
    <div class="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
      <span>{fmtTime(leg.schedDep, leg.originTz)}</span>
      <span>→</span>
      <span>{fmtTime(leg.schedArr, leg.destinationTz)}</span>
    </div>
  </div>
  <div class="flex flex-col items-end justify-center text-right shrink-0">
    {#if summary}
      <span
        class="text-sm"
        class:text-red-600={summary.tone === 'late'}
        class:dark:text-red-400={summary.tone === 'late'}
        class:text-green-600={summary.tone === 'early'}
        class:dark:text-green-400={summary.tone === 'early'}
      >
        {summary.label}
      </span>
    {/if}
    <!-- Second line: the *actual* arrival outcome (or best estimate) in the
         destination tz. Scheduled times live under the airport codes above,
         so this line is always the live signal.
         - Completed leg (realArr) → "Arr h:mm"
         - In-air leg (estArr only) → "Est. h:mm"
         - Neither known → fall through to FR24 status text -->
    {#if leg.realArr}
      <span class="text-xs text-muted-foreground">
        Arr {fmtTime(leg.realArr, leg.destinationTz)}
      </span>
    {:else if leg.estArr}
      <span class="text-xs text-muted-foreground">
        Est. {fmtTime(leg.estArr, leg.destinationTz)}
      </span>
    {:else if !summary}
      <span class="text-xs text-muted-foreground truncate max-w-[12rem]">
        {leg.status}
      </span>
    {/if}
  </div>
</div>
