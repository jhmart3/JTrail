import { getBoardPage } from './boards';
import type { FR24Leg } from './parse';

// Page cap when scanning a departures board for the user's own flight.
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
