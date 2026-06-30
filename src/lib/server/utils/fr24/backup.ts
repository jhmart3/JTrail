import { getBoardPage } from './boards';
import type { FR24Leg } from './parse';

const MAX_BACKUP_PAGES = 5;

// Scan the origin airport's departures board for other same-day flights to the
// destination. Filters:
//   - destination matches
//   - flight number is NOT the user's own flight (excludeFlightNumber)
//   - scheduled departure is at or after the user's scheduled departure
//     (afterTs, unix seconds). Backup routes are only useful if the user can
//     still physically board them; flights that already left aren't options
//     for "what if my flight is cancelled" planning.
export async function getBackupRoutes(
  originIata: string,
  destinationIata: string,
  excludeFlightNumber: string,
  afterTs: number,
): Promise<FR24Leg[]> {
  const matches: FR24Leg[] = [];
  for (let page = 1; page <= MAX_BACKUP_PAGES; page++) {
    const legs = await getBoardPage(originIata, 'departures', page);
    if (legs.length === 0) break;
    for (const leg of legs) {
      if (leg.destination !== destinationIata) continue;
      if (leg.flightNumber === excludeFlightNumber) continue;
      if (!leg.schedDep || leg.schedDep < afterTs) continue;
      matches.push({ ...leg, origin: originIata });
    }
  }
  return matches;
}
