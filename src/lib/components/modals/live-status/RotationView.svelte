<script lang="ts">
  import type { FR24Leg } from '$lib/server/utils/fr24';

  import RotationLegRow, {
    type LegState,
  } from './RotationLegRow.svelte';

  import { Separator } from '$lib/components/ui/separator';

  let {
    yourLeg,
    priorLegs,
  }: { yourLeg: FR24Leg; priorLegs: FR24Leg[] } = $props();

  // Once the user's own leg has pushed back (realDep set), it becomes the
  // active leg — no earlier rotation can still be "in motion" ahead of it,
  // since a prior leg must complete before this aircraft can fly out again.
  // Before push-back the user's leg is 'mine' (blue border, no FR24 link)
  // so they don't see a live-tracking link for a flight that hasn't taken
  // off yet.
  //
  // 'active' here also covers a just-landed yourLeg (realArr set) — that
  // window is brief because the client-side Rule 2b filter drops the whole
  // flight from the modal on the next re-derive.
  const yourLegState = $derived<LegState>(yourLeg.realDep ? 'active' : 'mine');

  // Pick the "active" leg among the priors. Definition:
  //   - First preference: the last leg that's pushed back but not yet arrived
  //     (realDep set, realArr null). That's currently in flight or on the
  //     tarmac, the most actionable signal for the user's eventual handoff.
  //   - Fallback: the most recently landed leg (highest realArr).
  //   - If no leg has any real data at all, nothing is "active".
  //
  // Short-circuits to -1 once the user's own leg is airborne: at that point
  // the emerald "watch this one" cue belongs on yourLeg, and every prior
  // leg is by definition already on the ground.
  const activeIndex = $derived.by<number>(() => {
    if (yourLeg.realDep) return -1;
    for (let i = priorLegs.length - 1; i >= 0; i--) {
      const leg = priorLegs[i]!;
      if (leg.realDep && !leg.realArr) return i;
    }
    let bestArr = 0;
    let bestIdx = -1;
    for (let i = 0; i < priorLegs.length; i++) {
      const arr = priorLegs[i]!.realArr ?? 0;
      if (arr > bestArr) {
        bestArr = arr;
        bestIdx = i;
      }
    }
    return bestIdx;
  });

  const classifyPrior = (leg: FR24Leg, i: number): LegState => {
    if (i === activeIndex) return 'active';
    if (leg.realArr) return 'landed';
    return 'scheduled';
  };
</script>

<section class="space-y-1">
  <header class="flex items-baseline justify-between mb-2">
    <h3 class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
      Today's rotation
    </h3>
    {#if yourLeg.tail}
      <span class="text-xs text-muted-foreground">
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
      <RotationLegRow {leg} state={classifyPrior(leg, i)} />
      <Separator />
    {/each}
  {/if}

  <RotationLegRow leg={yourLeg} state={yourLegState} isMine />
</section>
