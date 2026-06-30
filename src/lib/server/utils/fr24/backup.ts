import { getBoardPage } from './boards';
import type { FR24Leg } from './parse';

const MAX_BACKUP_PAGES = 5;

// Scan the origin airport's departures board for other same-day flights to the
// destination. Excludes the user's own flight (matched by flight number).
export async function getBackupRoutes(
  originIata: string,
  destinationIata: string,
  excludeFlightNumber: string,
): Promise<FR24Leg[]> {
  const matches: FR24Leg[] = [];
  for (let page = 1; page <= MAX_BACKUP_PAGES; page++) {
    const legs = await getBoardPage(originIata, 'departures', page);
    if (legs.length === 0) break;
    for (const leg of legs) {
      if (leg.destination !== destinationIata) continue;
      if (leg.flightNumber === excludeFlightNumber) continue;
      matches.push({ ...leg, origin: originIata });
    }
  }
  return matches;
}
