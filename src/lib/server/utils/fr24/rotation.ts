import { getBoardPage } from './boards';
import type { FR24Leg } from './parse';
import { getTailHistoryToday } from './tail-history';

// Page cap when scanning a departures board for the user's own flight.
// Only used by findAssignedTail; the rotation walk no longer pages through
// boards at all — see tail-history.ts.
const MAX_BOARD_PAGES = 15;

// Page through `airport`'s departures board looking for `flightNumber`.
// Returns the matched leg with `origin` stamped on (the board row only carries
// the destination — the origin is implied by the airport we queried).
export async function findAssignedTail(
  airportIata: string,
  flightNumber: string,
): Promise<FR24Leg | null> {
  for (let page = 1; page <= MAX_BOARD_PAGES; page++) {
    const legs = await getBoardPage(airportIata, 'departures', page);
    if (legs.length === 0) return null;
    for (const leg of legs) {
      if (leg.flightNumber === flightNumber) {
        return { ...leg, origin: airportIata };
      }
    }
  }
  return null;
}

/**
 * Walk a tail's same-day rotation backwards from `startTs`.
 *
 * Now a thin delegate over `getTailHistoryToday`, which uses FR24's
 * per-aircraft history endpoint (flight/list?fetchBy=reg) instead of
 * paginating arrivals boards. That older approach missed legs that had
 * aged off the rolling board window; the new endpoint returns the full
 * recent history regardless of board freshness.
 *
 * Same signature as before so the router doesn't need to change.
 * Returned legs are in chronological (earliest-first) order, capped at
 * MAX_HISTORY_LEGS, scoped to the origin-airport's calendar day.
 */
export async function walkTailHistory(
  tail: string,
  _startAirportIata: string,
  startTs: number,
  originTz: string,
): Promise<FR24Leg[]> {
  return getTailHistoryToday(tail, startTs, originTz);
}
