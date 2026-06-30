<script lang="ts">
  import type { FR24Leg } from '$lib/server/utils/fr24';

  import RotationLegRow from './RotationLegRow.svelte';

  import { Separator } from '$lib/components/ui/separator';

  let {
    yourLeg,
    priorLegs,
  }: { yourLeg: FR24Leg; priorLegs: FR24Leg[] } = $props();
</script>

<section class="space-y-1">
  <header class="flex items-baseline justify-between mb-2">
    <h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
      Today's rotation
    </h3>
    {#if yourLeg.tail}
      <span
        class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Aircraft {yourLeg.tail}
      </span>
    {/if}
  </header>

  {#if priorLegs.length === 0}
    <p class="text-sm text-muted-foreground py-2">
      No earlier legs found for this aircraft today. Your flight is the first
      rotation we can see.
    </p>
  {:else}
    {#each priorLegs as leg, i (i)}
      <RotationLegRow {leg} />
      <Separator />
    {/each}
  {/if}

  <RotationLegRow leg={yourLeg} highlighted />
</section>
