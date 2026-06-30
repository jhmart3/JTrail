<script lang="ts">
  import { PlaneTakeoff } from '@o7/icon/lucide';

  import { Button } from '$lib/components/ui/button';
  import { openModalsState } from '$lib/state.svelte';
</script>

<div
  class="flex flex-col items-center justify-center gap-4 text-center py-12 px-6"
>
  <PlaneTakeoff size="48" class="text-muted-foreground" />
  <div class="space-y-1">
    <h3 class="text-lg font-semibold">No flights in the next 24 hours</h3>
    <p class="text-sm text-muted-foreground max-w-sm">
      Live status shows the rotation history of the aircraft assigned to a
      flight you're booked on. Add a flight with a flight number set to its
      scheduled departure within the next 24 hours to see it here.
    </p>
  </div>
  <Button
    onclick={() => {
      openModalsState.liveStatus = false;
      openModalsState.addFlight = true;
    }}
  >
    Add flight
  </Button>
</div>
