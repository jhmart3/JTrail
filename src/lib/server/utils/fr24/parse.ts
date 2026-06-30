// Shape we extract from one row of an FR24 airport-board response.
// Mirrors the dict produced by parse_flight() in the Python prototype
// at /Users/jack/Projects/flights/flights.py.
export type FR24Leg = {
  flightNumber: string;
  tail: string | null;
  origin: string | null;
  destination: string | null;
  airline: string;
  schedDep: number | null; // unix seconds
  schedArr: number | null;
  actualDep: number | null;
  actualArr: number | null;
  status: string;
};

// Parse one row from the FR24 airport pluginData.schedule.{departures,arrivals}.data array.
// FR24 returns deeply-nested dicts where any inner object can be null/missing,
// so we use the `value ?? {}` pattern at each level — keeps every subsequent
// `.<field>` lookup safe without a stack of optional chains.
export function parseLeg(raw: unknown): FR24Leg {
  const r = (raw ?? {}) as Record<string, any>;
  const ident = r.identification ?? {};
  const number = ident.number ?? {};
  const aircraft = r.aircraft ?? {};
  const airportInfo = r.airport ?? {};
  const originInfo = airportInfo.origin ?? {};
  const originCode = originInfo.code ?? {};
  const destInfo = airportInfo.destination ?? {};
  const destCode = destInfo.code ?? {};
  const airline = r.airline ?? {};
  const time = r.time ?? {};
  const scheduled = time.scheduled ?? {};
  const estimated = time.estimated ?? {};
  const real = time.real ?? {};
  const status = r.status ?? {};

  // Prefer "real" (after-the-fact) timestamps. Fall back to "estimated" when
  // the flight hasn't departed/landed yet.
  const actualDep: number | null = real.departure ?? estimated.departure ?? null;
  const actualArr: number | null = real.arrival ?? estimated.arrival ?? null;

  return {
    flightNumber: (number.default ?? '') as string,
    tail: (aircraft.registration ?? null) as string | null,
    origin: (originCode.iata ?? null) as string | null,
    destination: (destCode.iata ?? null) as string | null,
    airline: (airline.name ?? 'Unknown') as string,
    schedDep: (scheduled.departure ?? null) as number | null,
    schedArr: (scheduled.arrival ?? null) as number | null,
    actualDep,
    actualArr,
    status: (status.text ?? 'Unknown') as string,
  };
}
