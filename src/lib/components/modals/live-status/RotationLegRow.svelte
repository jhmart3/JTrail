<script lang="ts" module>
  // Visual classification of a leg row, controls the left-border color.
  //   - 'mine'      → the user's own flight, accent blue
  //   - 'active'    → the rotation leg currently in motion or most recently
  //                   landed; emerald to signal "this one matters now"
  //   - 'landed'    → completed past legs, faint grey (faded, not interesting)
  //   - 'scheduled' → not yet started, no border
  export type LegState = 'mine' | 'active' | 'landed' | 'scheduled';
</script>

<script lang="ts">
  import type { FR24Leg } from '$lib/server/utils/fr24';
  import { cn } from '$lib/utils';

  let {
    leg,
    state,
  }: { leg: FR24Leg; state: LegState } = $props();

  // Format an FR24 unix-seconds timestamp as a short local time ("11:55 AM")
  // in the given IANA tz. Falls back to the user's local tz when tz is null
  // (rare — only if the JTrail airports table doesn't know this IATA).
  function fmtTime(ts: number | null, tz: string | null): string {
    if (!ts) return '--';
    return new Date(ts * 1000).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
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
      if (diffMin >= -1 && diffMin <= 1) {
        return { label: `${prefix}on time`, tone: 'on-time' };
      }
      if (diffMin > 0) {
        return { label: `${prefix}${fmtHM(diffMin)} Late`, tone: 'late' };
      }
      return { label: `${prefix}${fmtHM(diffMin)} Early`, tone: 'early' };
    }
    return null;
  }

  const summary = $derived(pickSummary());
</script>

<div
  class={cn(
    'flex items-stretch gap-3 py-2',
    state === 'mine' && 'border-l-4 border-primary pl-3 font-semibold',
    state === 'active' && 'border-l-4 border-emerald-500 pl-3',
    state === 'landed' &&
      'border-l-4 border-zinc-400/50 dark:border-zinc-500/50 pl-3',
  )}
>
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2 text-sm">
      <span class="font-extrabold tracking-wide">
        {leg.origin ?? '???'}
      </span>
      <span class="text-muted-foreground">→</span>
      <span class="font-extrabold tracking-wide">
        {leg.destination ?? '???'}
      </span>
      <span class="text-muted-foreground text-xs ml-2 truncate">
        {leg.flightNumber}
      </span>
    </div>
    <div class="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
      {#if leg.realDep}
        <span>Dep. {fmtTime(leg.realDep, leg.originTz)}</span>
      {:else}
        <span>Sch {fmtTime(leg.schedDep, leg.originTz)}</span>
      {/if}
      <span>→</span>
      {#if leg.realArr}
        <span>Arr {fmtTime(leg.realArr, leg.destinationTz)}</span>
      {:else}
        <span>Sch {fmtTime(leg.schedArr, leg.destinationTz)}</span>
      {/if}
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
    <!-- Second line: actual or estimated landing time, in destination tz.
         Mirrors what FR24 surfaces as the leg's headline status string, but
         localized to the airport the plane is heading to so the user can map
         it against their own arrival expectations. -->
    {#if leg.realArr}
      <span class="text-xs text-muted-foreground">
        Landed {fmtTime(leg.realArr, leg.destinationTz)}
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
