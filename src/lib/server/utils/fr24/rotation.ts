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
 *
 * Matches are disambiguated by BOTH origin and destination — some airlines
 * (notably Southwest) reuse the same flight number for unrelated routes on
 * the same day (e.g. WN1563 AUS→MCI at 12:35 AND WN1563 IND→MCI at 13:05).
 * A flight-number-only match on either board would return the wrong leg.
 * The board row's "implied" side (origin on departures, destination on
 * arrivals) can come back null, so we treat null as "trust the queried
 * context" — an explicit non-matching value is what rules a row out.
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
      if (leg.flightNumber !== flightNumber) continue;
      if (leg.destination != null && leg.destination !== destinationIata) {
        continue;
      }
      return { ...leg, origin: originIata };
    }
  }

  for (let page = 1; page <= MAX_BOARD_PAGES; page++) {
    const legs = await getBoardPage(destinationIata, 'arrivals', page);
    if (legs.length === 0) break;
    for (const leg of legs) {
      if (leg.flightNumber !== flightNumber) continue;
      if (leg.origin != null && leg.origin !== originIata) {
        continue;
      }
      return {
        ...leg,
        origin: leg.origin ?? originIata,
        destination: leg.destination ?? destinationIata,
      };
    }
  }

  return null;
}
