<script lang="ts">
  import '../app.css';
  import { persistQueryClient } from '@tanstack/query-persist-client-core';
  import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from 'svelte-sonner';

  import { browser, dev } from '$app/environment';
  import { page } from '$app/state';
  import { NavigationDock } from '$lib/components';
  import { TimeDisplayHost } from '$lib/components/display';
  import { ConfirmWrapper, ScreenSize } from '$lib/components/helpers';
  import {
    AddFlightModal,
    LiveStatusModal,
    NewVersionAnnouncement,
    SettingsModal,
  } from '$lib/components/modals';
  import { Provider as TooltipProvider } from '$lib/components/ui/tooltip';
  import { appConfig, openModalsState } from '$lib/state.svelte';
  import { trpc } from '$lib/trpc';

  const { data, children } = $props();

  $effect(() => {
    if (data.appConfig) {
      appConfig.config = data.appConfig.config;
      appConfig.configured = data.appConfig.configured;
      appConfig.envConfigured = data.appConfig.envConfigured;
    }
  });

  const queryClient = data.trpc ? trpc.hydrateFromServer(data.trpc) : undefined;

  // Wire the tanstack-query cache up to localStorage so persistent queries
  // (currently just the live-status rotation) survive page reloads. Queries
  // need staleTime + gcTime set to Infinity individually to opt in; the
  // persister doesn't override per-query staleness, it just keeps the data
  // available for queries that don't auto-refetch.
  //
  // Persister is wired up exactly once per queryClient. We guard on `browser`
  // because localStorage doesn't exist during SSR. Inside the $effect, an
  // own-property check prevents double-wiring if the effect re-runs.
  $effect(() => {
    if (!browser || !queryClient) return;
    const flagKey = '__jtrailPersisterInstalled';
    const tagged = queryClient as unknown as Record<string, boolean>;
    if (tagged[flagKey]) return;
    tagged[flagKey] = true;
    const persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: 'jtrail-query-cache',
    });
    persistQueryClient({
      queryClient,
      persister,
      maxAge: Number.POSITIVE_INFINITY,
    });
  });
</script>

<ModeWatcher />
<ScreenSize />
<Toaster />
<ConfirmWrapper />

{#if !dev && data.user && data.user.role !== 'user'}
  <NewVersionAnnouncement />
{/if}

{#if queryClient}
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <SettingsModal bind:open={openModalsState.settings} />
      <AddFlightModal bind:open={openModalsState.addFlight} />
      <LiveStatusModal bind:open={openModalsState.liveStatus} />
      <TimeDisplayHost />

      <main class="h-full" data-vaul-drawer-wrapper>
        {@render children()}
      </main>

      {#if data.user && !page.error && !['/login', '/setup'].includes(page.url.pathname)}
        <NavigationDock />
      {/if}
    </TooltipProvider>
  </QueryClientProvider>
{:else}
  <main class="h-full">
    {@render children()}
  </main>
{/if}
