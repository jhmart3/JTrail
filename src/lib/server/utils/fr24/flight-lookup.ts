import { APIClient } from 'flightradarapi';

import { parseLeg, type FR24Leg } from './parse';

// Direct hit against FR24's flight/list endpoint. The typed FlightRadar24API
// wrapper doesn't expose this endpoint, but the underlying APIClient does
// (with Cloudflare TLS impersonation baked in — same client tail-history uses).
const client = new APIClient();

const FR24_FLIGHT_LIST =
  'https://api.flightradar24.com/common/v1/flight/list.json';

// FR24's default page size. 25 rows typically covers ~1 week of same-flight-
// number instances across all routes that flight number serves, which is more
// than enough context to disambiguate today's user leg.
const FLIGHT_LOOKUP_LIMIT = 25;

/**
 * Locate a specific flight instance by number, origin, destination, and
 * scheduled departure time — using FR24's flight/list endpoint. One HTTP
 * request replaces the up-to-30 board pages that findAssignedTail used to
 * walk (origin departures + destination arrivals fallback).
 *
 * The endpoint returns all recent + upcoming instances of `flightNumber`
 * across every route it serves. Many airlines (notably Southwest) reuse
 * flight numbers for unrelated routes on the same day, and every airline
 * repeats the same route day after day — so a raw response is a mix of:
 *
 *   - the exact flight we want
 *   - same route, different days (yesterday, tomorrow, ...)
 *   - same day, different routes (WN1563 IND→MCI when we want AUS→MCI)
 *   - stale historical entries from previous months
 *
 * Filter by origin+destination match, then pick the instance whose
 * scheduled departure is closest to the user's target — that's the row
 * for their flight regardless of whether it's upcoming, in the air, or
 * already landed.
 *
 * Returns null on network failure, non-200 response, or no matching row —
 * caller renders the "not tracked by FR24" empty state.
 */
export async function findFlightInstance(
  flightNumber: string,
  originIata: string,
  destinationIata: string,
  targetSchedDepTs: number,
): Promise<FR24Leg | null> {
  const url =
    `${FR24_FLIGHT_LIST}?query=${encodeURIComponent(flightNumber)}` +
    `&fetchBy=flight&page=1&limit=${FLIGHT_LOOKUP_LIMIT}`;

  let response: { statusCode: number; content: any };
  try {
    response = await client.request(url);
  } catch (err) {
    console.error(
      `[fr24] flight/list?flight=${flightNumber} failed:`,
      (err as Error)?.message ?? err,
    );
    return null;
  }
  if (response.statusCode !== 200) return null;

  const rows: unknown[] = response.content?.result?.response?.data ?? [];
  const legs = rows.map((row) => parseLeg(row));

  const candidates = legs.filter(
    (leg) =>
      leg.origin === originIata &&
      leg.destination === destinationIata &&
      leg.schedDep != null,
  );
  if (candidates.length === 0) return null;

  return candidates.sort(
    (a, b) =>
      Math.abs((a.schedDep ?? 0) - targetSchedDepTs) -
      Math.abs((b.schedDep ?? 0) - targetSchedDepTs),
  )[0]!;
}
