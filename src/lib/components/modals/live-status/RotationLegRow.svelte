<script lang="ts">
  import type { FR24Leg } from '$lib/server/utils/fr24';

  // Format an FR24 unix-seconds timestamp as a short local time ("11:55 AM").
  // Returns "--" when missing. Uses the rendering client's locale.
  function fmtTime(ts: number | null | undefined): string {
    if (!ts) return '--';
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  // Reuses the same formatter idea as the flight list: < 60 min stays in
  // raw minutes, >= 60 min rolls to h:mm. Negative diffs (early) are folded
  // to absolute and labeled accordingly.
  function fmtDelay(minutes: number): string {
    const abs = Math.abs(minutes);
    if (abs < 60) return `${abs}`;
    const h = Math.floor(abs / 60);
    const mm = String(abs % 60).padStart(2, '0');
    return `${h}:${mm}`;
  }

  function delayMinutes(scheduled: number | null, actual: number | null) {
    if (!scheduled || !actual) return null;
    return Math.round((actual - scheduled) / 60);
  }

  let {
    leg,
    highlighted = false,
  }: { leg: FR24Leg; highlighted?: boolean } = $props();

  const depDelta = $derived(delayMinutes(leg.schedDep, leg.actualDep));
  const arrDelta = $derived(delayMinutes(leg.schedArr, leg.actualArr));

  // Prefer the arrival delta when the leg has landed (it's the bottom-line
  // outcome). Fall back to departure delta when we only know departure.
  const summary = $derived.by(() => {
    const d = arrDelta ?? depDelta;
    if (d === null) return null;
    if (d > 1) return { label: `+${fmtDelay(d)}`, tone: 'late' as const };
    if (d < -1) return { label: `${fmtDelay(d)} early`, tone: 'early' as const };
    return { label: 'on time', tone: 'on-time' as const };
  });
</script>

<div
  class="flex items-stretch gap-3 py-2"
  class:border-l-4={highlighted}
  class:border-primary={highlighted}
  class:pl-3={highlighted}
  class:font-semibold={highlighted}
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
      <span>Dep {fmtTime(leg.schedDep)}</span>
      <span>→</span>
      <span>Arr {fmtTime(leg.schedArr)}</span>
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
    <span class="text-xs text-muted-foreground truncate max-w-[12rem]">
      {leg.status}
    </span>
  </div>
</div>
