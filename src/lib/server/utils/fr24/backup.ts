import { getBoardPage } from './boards';
import type { FR24Leg } from './parse';

const MAX_BACKUP_PAGES = 5;

// Scan the origin airport's departures board for other same-day flights to the
// destination. Filters:
//   - destination matches
//   - flight number is NOT the user's own flight (excludeFlightNumber)
//   - scheduled departure is at or after the user's scheduled departure
//     (afterTs, unix seconds) — backup routes are only useful if the user can
//     still physically board them
//   - FR24 has an estimated departure for the flight; rows that are purely
//     scheduled with no estimate are typically too far out to be actionable
//   - same marketing carrier as the user's flight, by IATA prefix. The
//     first two characters of the flight number identify the marketing
//     carrier the ticket is sold under (AA = American, UA = United, etc).
//     Regional operators (Envoy / SkyWest / Republic / PSA) all fly under
//     the parent prefix when ticketed as American Eagle / United Express /
//     Delta Connection, so 2-char prefix matching catches the same-network
//     rebooking case without any per-carrier mapping
//   - duplicates across codeshares are collapsed by (schedDep) since two
//     different real flights from the same origin to the same destination
//     would never share a second-precise scheduled departure
export async function getBackupRoutes(
  originIata: string,
  destinationIata: string,
  excludeFlightNumber: string,
  afterTs: number,
): Promise<FR24Leg[]> {
  const carrierPrefix = excludeFlightNumber.slice(0, 2).toUpperCase();

  const matches: FR24Leg[] = [];
  const seenSchedDep = new Set<number>();
  for (let page = 1; page <= MAX_BACKUP_PAGES; page++) {
    const legs = await getBoardPage(originIata, 'departures', page);
    if (legs.length === 0) break;
    for (const leg of legs) {
      if (leg.destination !== destinationIata) continue;
      if (leg.flightNumber === excludeFlightNumber) continue;
      if (!leg.schedDep || leg.schedDep < afterTs) continue;
      if (!leg.estDep) continue;
      if (
        carrierPrefix &&
        leg.flightNumber.slice(0, 2).toUpperCase() !== carrierPrefix
      ) {
        continue;
      }
      if (seenSchedDep.has(leg.schedDep)) continue;
      seenSchedDep.add(leg.schedDep);
      matches.push({ ...leg, origin: originIata });
    }
  }
  return matches;
}
