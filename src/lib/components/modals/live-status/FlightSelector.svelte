<script lang="ts">
  import { cn } from '$lib/utils';

  type Flight = {
    id: number;
    flightNumber: string;
    from: { iata: string; tz: string };
    to: { iata: string };
    departureScheduled: string;
  };

  let {
    flights,
    selectedId,
    onSelect,
  }: {
    flights: Flight[];
    selectedId: number | null;
    onSelect: (id: number) => void;
  } = $props();

  // Render the pill's time in the *origin airport's* local tz, in 12-hour
  // format. A 5pm-Tokyo flight should read "5:00 PM" on the pill regardless
  // of where the user is sitting or which locale their browser uses.
  function fmtTime(iso: string, tz: string) {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz,
    });
  }
</script>

<div class="flex gap-2 overflow-x-auto pb-1">
  {#each flights as f (f.id)}
    <button
      type="button"
      onclick={() => onSelect(f.id)}
      class={cn(
        'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        f.id === selectedId
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-card/40 text-muted-foreground hover:bg-hover',
      )}
    >
      <span class="font-semibold">{f.flightNumber}</span>
      <span class="mx-1 opacity-60">·</span>
      <span>{f.from.iata}→{f.to.iata}</span>
      <span class="mx-1 opacity-60">·</span>
      <span>{fmtTime(f.departureScheduled, f.from.tz)}</span>
    </button>
  {/each}
</div>
