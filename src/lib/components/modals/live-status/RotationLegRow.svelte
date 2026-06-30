<script lang="ts" module>
  // Visual classification of a leg row, controls the left-border color.
  //   - 'mine'      → the user's own flight, accent blue
  //   - 'active'    → the rotation leg currently in motion or most recently
  //                   landed; neutral grey to draw the eye without competing
  //                   with 'mine'
  //   - 'landed'    → completed past legs, faint emerald
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
  //   - If the leg has REAL (after-the-fact) arrival → "h:mm Early/Late"
  //   - Else if the leg has an ESTIMATED arrival → "Est. h:mm Early/Late"
  //   - Falls back to departure if arrival data is missing
  //   - Returns null when the diff is within ±1 min (treat as on-time)
  type Summary = { label: string; tone: 'early' | 'late' | 'on-time' };
  function pickSummary(): Summary | null {
    const candidates: Array<{
      scheduled: number | null;
      actual: number | null;
      kind: 'real' | 'est';
    }> = [
      { scheduled: leg.schedArr, actual: leg.realArr, kind: 'real' },
      { scheduled: leg.schedDep, actual: leg.realDep, kind: 'real' },
      { scheduled: leg.schedArr, actual: leg.estArr, kind: 'est' },
      { scheduled: leg.schedDep, actual: leg.estDep, kind: 'est' },
    ];
    for (const c of candidates) {
      if (!c.scheduled || !c.actual) continue;
      const diffMin = Math.round((c.actual - c.scheduled) / 60);
      if (diffMin >= -1 && diffMin <= 1) {
        return { label: 'on time', tone: 'on-time' };
      }
      const prefix = c.kind === 'est' ? 'Est. ' : '';
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
    state === 'active' &&
      'border-l-4 border-zinc-400 dark:border-zinc-500 pl-3',
    state === 'landed' && 'border-l-4 border-emerald-500/50 pl-3',
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
      <span>Dep {fmtTime(leg.schedDep, leg.originTz)}</span>
      <span>→</span>
      <span>Arr {fmtTime(leg.schedArr, leg.destinationTz)}</span>
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
