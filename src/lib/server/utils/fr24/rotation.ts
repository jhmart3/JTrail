import { tz } from '@date-fns/tz';
import { startOfDay } from 'date-fns';

import { getBoardPage } from './boards';
import type { FR24Leg } from './parse';

// Safety caps lifted verbatim from the Python prototype.
const MAX_HISTORY_LEGS = 12;
const MAX_BOARD_PAGES = 15;
const MAX_ARRIVAL_PAGES = 10;

// Compute the unix-seconds timestamp for midnight local at the origin airport,
// using the airport's tz (e.g. "America/Chicago"). The Python prototype used
// the server's local time which is wrong for any server that isn't in the
// same TZ as the departure airport.
function startOfTodayUnixAtTz(originTz: string, referenceMs: number): number {
  const reference = new Date(referenceMs);
  const localMidnight = startOfDay(reference, { in: tz(originTz) });
  return Math.floor(localMidnight.getTime() / 1000);
}

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

// Find the latest leg flown by `tail` that landed at `airport` before `beforeTs`.
// Scans the arrivals board and returns the leg with the latest scheduled arrival
// still under our cutoff. Returns null when no match.
async function findPrecedingLeg(
  tail: string,
  airportIata: string,
  beforeTs: number,
): Promise<FR24Leg | null> {
  let bestLeg: FR24Leg | null = null;
  let bestSchedArr = 0;

  for (let page = 1; page <= MAX_ARRIVAL_PAGES; page++) {
    const legs = await getBoardPage(airportIata, 'arrivals', page);
    if (legs.length === 0) break;
    for (const leg of legs) {
      if (leg.tail !== tail) continue;
      const sched = leg.schedArr;
      if (!sched || sched >= beforeTs) continue;
      if (sched > bestSchedArr) {
        bestSchedArr = sched;
        bestLeg = leg;
      }
    }
  }

  if (bestLeg !== null) {
    // Arrivals board entry doesn't repeat destination — stamp it on.
    return { ...bestLeg, destination: airportIata };
  }
  return null;
}

// Walk backwards through a tail's same-day rotation. Each hop locates the inbound
// leg at the current airport that arrived before our cutoff. We then use that
// leg's origin and scheduled departure as the next airport + cutoff. The walk
// stops when (a) no earlier leg exists at the current airport, (b) the next leg's
// scheduled departure crosses into yesterday in the *origin airport's local time*,
// (c) the inbound leg lacks origin info, or (d) we hit MAX_HISTORY_LEGS.
//
// Returns the legs in chronological (earliest-first) order.
export async function walkTailHistory(
  tail: string,
  startAirportIata: string,
  startTs: number,
  originTz: string,
): Promise<FR24Leg[]> {
  const legs: FR24Leg[] = [];
  // "Today" is anchored to the user's flight time, not server time. We use
  // startTs * 1000 as the reference instant so daylight-saving / TZ math
  // resolves against the date the user is actually flying.
  const todayStartUnix = startOfTodayUnixAtTz(originTz, startTs * 1000);
  let currentAirport = startAirportIata;
  let cutoffTs = startTs;

  for (let hop = 0; hop < MAX_HISTORY_LEGS; hop++) {
    const leg = await findPrecedingLeg(tail, currentAirport, cutoffTs);
    if (leg === null) break;
    if (leg.schedDep && leg.schedDep < todayStartUnix) break;
    if (!leg.origin) break;
    legs.push(leg);
    currentAirport = leg.origin;
    cutoffTs = leg.schedDep ?? cutoffTs;
  }

  // We pushed newest-found first — reverse for chronological order.
  legs.reverse();
  return legs;
}
