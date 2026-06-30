<script lang="ts">
  import { RefreshCw } from '@o7/icon/lucide';
  import { writable } from 'svelte/store';

  import BackupRoutes from './BackupRoutes.svelte';
  import EmptyState from './EmptyState.svelte';
  import FlightSelector from './FlightSelector.svelte';
  import RotationView from './RotationView.svelte';

  import { Modal } from '$lib/components/ui/modal';
  import { trpc } from '$lib/trpc';
  import { cn } from '$lib/utils';

  let { open = $bindable<boolean>() }: { open?: boolean } = $props();

  const upcomingQuery = trpc.liveStatus.listUpcoming.query();
  const upcoming = $derived($upcomingQuery.data ?? []);

  // Default selection to the next-soonest upcoming flight. The list is already
  // ordered by departureScheduled ASC server-side.
  let selectedId = $state<number | null>(null);
  $effect(() => {
    if (selectedId == null && upcoming.length > 0) {
      selectedId = upcoming[0]!.id;
    }
  });

  const selected = $derived(
    upcoming.find((f) => f.id === selectedId) ?? null,
  );

  // tRPC input store for the rotation query. Always populated with something
  // (so the type stays narrow); the query is gated by the reactive `enabled`
  // flag below until we actually have a selected flight.
  const rotationInput = writable<{
    flightNumber: string;
    originIata: string;
    destinationIata: string;
    originTz: string;
  }>({
    flightNumber: '',
    originIata: 'XXX',
    destinationIata: 'XXX',
    originTz: 'UTC',
  });

  $effect(() => {
    if (selected) {
      rotationInput.set({
        flightNumber: selected.flightNumber,
        originIata: selected.from.iata,
        destinationIata: selected.to.iata,
        originTz: selected.from.tz,
      });
    }
  });

  // Reactive options store. trpc-svelte-query wraps plain-object options in
  // `readable()` at construction, capturing their values once — passing a
  // writable store instead lets us flip `enabled` after the upcoming-flights
  // list resolves and a selection lands.
  const rotationOptions = writable({
    enabled: false,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
  });

  $effect(() => {
    rotationOptions.update((o) => ({
      ...o,
      enabled: !!selected && !!open,
    }));
  });

  const rotationQuery = trpc.liveStatus.getRotation.query(
    rotationInput,
    rotationOptions,
  );

  const rotation = $derived($rotationQuery.data);
  const isRotationLoading = $derived($rotationQuery.isLoading);
  const isRotationError = $derived($rotationQuery.isError);
  // isFetching is true during both the initial load AND subsequent refetches,
  // so we use it to disable/animate the refresh button regardless of whether
  // we already have data on screen. tanstack-query keeps the existing `data`
  // value in place while a refetch is in flight, so the rotation view stays
  // visible — only the button itself reflects the pending state.
  const isRotationFetching = $derived($rotationQuery.isFetching);
</script>

<Modal
  bind:open
  class="max-w-2xl"
  closeButton
>
  <div class="space-y-4 p-2 sm:p-4">
    <header class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">Live status</h2>
        <p class="text-sm text-muted-foreground">
          Real-time rotation history for the aircraft assigned to your
          upcoming flights.
        </p>
      </div>
      <!-- Manual refresh. Disabled while a fetch is already in flight so
           rapid clicks don't queue up extra calls to FR24. The icon spins
           via Tailwind's animate-spin during fetch. tanstack-query keeps
           the current rotation on screen until the new data arrives, so
           the user never sees a blank/loading state mid-refresh. -->
      <button
        type="button"
        aria-label="Refresh live status"
        title="Refresh"
        class="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-hover hover:text-foreground transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
        disabled={isRotationFetching || !rotation}
        onclick={() => $rotationQuery.refetch()}
      >
        <RefreshCw
          size="16"
          class={cn(isRotationFetching && 'animate-spin')}
        />
      </button>
    </header>

    {#if $upcomingQuery.isLoading}
      <p class="text-sm text-muted-foreground py-8 text-center">
        Loading upcoming flights…
      </p>
    {:else if $upcomingQuery.isError}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 p-4">
        <p class="text-sm font-medium">Couldn't load upcoming flights</p>
        <p class="text-xs text-muted-foreground mt-1">
          {$upcomingQuery.error?.message ?? 'Unknown error'}
        </p>
      </div>
    {:else if upcoming.length === 0}
      <EmptyState />
    {:else}
      <FlightSelector
        flights={upcoming}
        {selectedId}
        onSelect={(id) => (selectedId = id)}
      />

      {#if isRotationLoading}
        <p class="text-sm text-muted-foreground py-8 text-center">
          Fetching from FlightRadar24…
        </p>
      {:else if isRotationError}
        <div class="rounded-md border border-destructive/40 bg-destructive/10 p-4">
          <p class="text-sm font-medium">FlightRadar24 unreachable</p>
          <p class="text-xs text-muted-foreground mt-1">
            We'll keep trying every 120 seconds. You can also close and reopen
            the modal to retry immediately.
          </p>
        </div>
      {:else if rotation?.kind === 'tail_not_found'}
        <div class="rounded-md border border-border bg-card/40 p-4">
          <p class="text-sm font-medium">No aircraft assigned yet</p>
          <p class="text-xs text-muted-foreground mt-1">
            FlightRadar24 hasn't surfaced this flight on the
            {selected?.from.iata} departures board yet. Aircraft assignments
            usually appear within ~12 hours of departure. Check back closer to
            your flight time.
          </p>
        </div>
      {:else if rotation?.kind === 'ok'}
        <RotationView
          yourLeg={rotation.yourLeg}
          priorLegs={rotation.priorLegs}
        />
        {#if rotation.backupRoutes.length > 0}
          <BackupRoutes
            routes={rotation.backupRoutes}
            userSchedDep={rotation.yourLeg.schedDep}
            userFlightNumber={rotation.yourLeg.flightNumber}
          />
        {/if}
        <footer class="text-xs text-muted-foreground text-right">
          Updated {new Date(rotation.fetchedAt).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
          })}
        </footer>
      {/if}
    {/if}
  </div>
</Modal>
