import { tz } from '@date-fns/tz';
import { startOfDay } from 'date-fns';
import { APIClient } from 'flightradarapi';

import { parseLeg, type FR24Leg } from './parse';

// Same TLS-impersonation client the wrapper uses internally. We point it at
// FR24's flight/list endpoint, which the typed wrapper doesn't expose.
const client = new APIClient();

const FR24_FLIGHT_LIST =
  'https://api.flightradar24.com/common/v1/flight/list.json';

// How many recent flights to ask for at a time. 25 is the FR24 page default
// and is far more than a single same-day rotation should ever need.
const TAIL_HISTORY_LIMIT = 25;

// Hard cap on returned legs, kept symmetric with the old arrivals-walk
// implementation. Even at major hubs, an aircraft will not fly more than ~12
// rotations in one calendar day.
const MAX_HISTORY_LEGS = 12;

function startOfTodayUnixAtTz(originTz: string, referenceMs: number): number {
  const reference = new Date(referenceMs);
  const localMidnight = startOfDay(reference, { in: tz(originTz) });
  return Math.floor(localMidnight.getTime() / 1000);
}

/**
 * Fetch the recent flight history for a tail registration and return today's
 * legs that preceded `beforeTs`, in chronological order (earliest first).
 *
 * Replaces the arrivals-board walk that this module used to implement.
 * The boards approach was subject to FR24's rolling-window display: legs
 * that landed more than a few hours ago aged off the board and the walk
 * gave up at the first invisible link. `flight/list?fetchBy=reg` queries
 * the aircraft's history directly and returns every flight regardless of
 * board freshness.
 */
export async function getTailHistoryToday(
  tail: string,
  beforeTs: number,
  originTz: string,
): Promise<FR24Leg[]> {
  const url =
    `${FR24_FLIGHT_LIST}?query=${encodeURIComponent(tail)}` +
    `&fetchBy=reg&page=1&limit=${TAIL_HISTORY_LIMIT}`;

  let response: { statusCode: number; content: any };
  try {
    response = await client.request(url);
  } catch (err) {
    console.error(
      `[fr24] flight/list?reg=${tail} failed:`,
      (err as Error)?.message ?? err,
    );
    return [];
  }
  if (response.statusCode !== 200) return [];

  const rows: unknown[] = response.content?.result?.response?.data ?? [];
  const legs = rows.map((row) => parseLeg(row));

  const todayStartUnix = startOfTodayUnixAtTz(originTz, beforeTs * 1000);

  return legs
    .filter((leg) => {
      const sched = leg.schedDep;
      return !!sched && sched < beforeTs && sched >= todayStartUnix;
    })
    .sort((a, b) => (a.schedDep ?? 0) - (b.schedDep ?? 0))
    .slice(-MAX_HISTORY_LEGS);
}
