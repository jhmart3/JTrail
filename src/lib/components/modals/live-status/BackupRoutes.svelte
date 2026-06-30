<script lang="ts">
  import { ChevronDown, ChevronRight } from '@o7/icon/lucide';

  import type { FR24Leg } from '$lib/server/utils/fr24';

  // Render an FR24 unix-seconds timestamp as a 12-hour local time
  // ("8:00 PM") in the given IANA tz. hour12 is forced rather than left to
  // the browser locale so non-US locales still render in the same style.
  function fmtTime(ts: number | null, tz: string | null): string {
    if (!ts) return '--';
    return new Date(ts * 1000).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz ?? undefined,
    });
  }

  let { routes }: { routes: FR24Leg[] } = $props();

  let expanded = $state(false);
</script>

<section class="rounded-lg border border-border bg-card/40">
  <button
    type="button"
    class="w-full flex items-center justify-between p-3 text-left hover:bg-hover transition-colors rounded-lg"
    onclick={() => (expanded = !expanded)}
  >
    <span class="text-sm font-semibold">
      Backup routes
      <span class="text-muted-foreground font-normal">
        ({routes.length})
      </span>
    </span>
    {#if expanded}
      <ChevronDown size="16" class="text-muted-foreground" />
    {:else}
      <ChevronRight size="16" class="text-muted-foreground" />
    {/if}
  </button>

  {#if expanded}
    <div class="border-t border-border divide-y divide-border">
      {#each routes as r, i (i)}
        <div
          class="flex items-center justify-between gap-3 p-3 text-sm"
        >
          <div class="min-w-0">
            <div class="font-medium truncate">
              {r.airline}
              <span class="text-muted-foreground font-normal ml-1">
                {r.flightNumber}
              </span>
            </div>
            <div class="text-xs text-muted-foreground">
              Departs {fmtTime(r.schedDep, r.originTz)}
            </div>
          </div>
          <span class="text-xs text-muted-foreground truncate max-w-[12rem]">
            Est. {fmtTime(r.estDep, r.originTz)}
          </span>
        </div>
      {/each}
    </div>
  {/if}
</section>
