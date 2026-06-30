import { FlightRadar24API } from 'flightradarapi';

import { parseLeg, type FR24Leg } from './parse';

// Single shared client instance. Stateless — safe to reuse across requests.
const client = new FlightRadar24API();

export type Board = 'departures' | 'arrivals';

// Page-size used when calling FR24. Matches the airport.json default. The Python
// prototype passed page= without a limit; specifying both makes the request
// behavior explicit and trims allocations when pages come back full.
const FLIGHT_LIMIT_PER_PAGE = 100;

// Fetch one page of an airport's arrivals or departures board.
// Returns parsed legs (one per row). Returns [] on API error or when the page
// is empty so callers can stop paging without needing to handle exceptions.
export async function getBoardPage(
  airportIata: string,
  board: Board,
  page: number,
): Promise<FR24Leg[]> {
  let details: any;
  try {
    details = await client.getAirportDetails(
      airportIata,
      FLIGHT_LIMIT_PER_PAGE,
      page,
    );
  } catch (err) {
    console.error(
      `[fr24] getAirportDetails(${airportIata}, page=${page}) failed:`,
      (err as Error)?.message ?? err,
    );
    return [];
  }

  const rows: unknown[] =
    details?.airport?.pluginData?.schedule?.[board]?.data ?? [];

  return rows.map((row) => parseLeg((row as any)?.flight));
}
