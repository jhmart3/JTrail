import { getBoardPage } from './boards';
import type { FR24Leg } from './parse';

// Page cap when scanning a board for the user's own flight.
const MAX_BOARD_PAGES = 15;

/**
 * Locate the FR24 row for a specific flight instance so we can pick up the
 * assigned tail number and live status. FR24 keeps the same flight on
 * different boards at different points in its lifecycle:
 *
 *   - Before push-back / boarding → visible on origin's DEPARTURES board.
 *   - Wheels-up through landing   → drops from departures within an hour or
 *                                    two, appears (or has been visible) on
 *                                    destination's ARRIVALS board.
 *   - Long after landing          → falls off both boards; not recoverable
 *                                    without a tail number (see tail-history
 *                                    for that lookup).
 *
 * We try the origin departures board first because it's the common case for
 * upcoming trips, then fall back to the destination arrivals board so the
 * UI keeps working once the leg is in the air. Returning null means the
 * flight isn't on either board — most likely already landed and aged out.
 */
export async function findAssignedTail(
  originIata: string,
  destinationIata: string,
  flightNumber: string,
): Promise<FR24Leg | null> {
  for (let page = 1; page <= MAX_BOARD_PAGES; page++) {
    const legs = await getBoardPage(originIata, 'departures', page);
    if (legs.length === 0) break;
    for (const leg of legs) {
      if (leg.flightNumber === flightNumber) {
        return { ...leg, origin: originIata };
      }
    }
  }

  // Fallback: the destination's arrivals board carries the leg once it's
  // pushed back / airborne. parseLeg populates origin from the row itself
  // (present on arrivals rows) but the destination side may come back null
  // because it's implied by the board we queried; coalesce both sides so
  // downstream code always sees the right IATA pair.
  for (let page = 1; page <= MAX_BOARD_PAGES; page++) {
    const legs = await getBoardPage(destinationIata, 'arrivals', page);
    if (legs.length === 0) break;
    for (const leg of legs) {
      if (leg.flightNumber === flightNumber) {
        return {
          ...leg,
          origin: leg.origin ?? originIata,
          destination: leg.destination ?? destinationIata,
        };
      }
    }
  }

  return null;
}
