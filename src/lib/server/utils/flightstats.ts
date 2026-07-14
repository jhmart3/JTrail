// Resolve a FlightStats deep-link URL for a specific flight instance.
//
// FlightStats' details page URL requires an internal integer `flightId` that
// isn't exposed via any public API. To construct the URL we scrape the
// tracker page's Next.js SSR payload (`window.__NEXT_DATA__`) which contains
// the flightId inside `props.initialState.flightTracker`. The scrape is
// cheap (one HTTP request per unique flight-date-route tuple) but fragile:
//
//   - flightstats.com is fronted by Cloudflare/AWS-WAF which returns 403 to
//     anything without a real browser User-Agent. We pin a Safari 17 UA.
//     If the WAF starts fingerprinting more aggressively, rotate the UA.
//   - The Next.js hydration shape is FlightStats-internal. Any front-end
//     rewrite on their side can break the regex or the object walk. There
//     are no tests for this — if the modal quietly stops showing links,
//     that's the tell.
//
// Consumers (getRotation) always wrap this in `null` handling — a failed
// scrape returns null, the UI renders no link, no tap target, no icon.
// Fail-quiet is a hard requirement; nothing about a broken FlightStats
// integration should be user-visible beyond the missing link.

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.6 Safari/605.1.15';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const pad = (n: number) => String(n).padStart(2, '0');

type Candidate = {
  flightId: number;
  from: string;
  to: string;
};

// Extract flightId candidates from a fetched tracker-page HTML string.
// Walks `flightTracker.flight` (the hero card FlightStats picked itself, may
// be a different route on the same day) and every same-day entry in
// `flightTracker.otherDays[].flights[]`. Dedupes by flightId because the
// hero is usually one of the otherDays entries.
function parseCandidates(
  html: string,
  year: number,
  month: number,
  day: number,
): Candidate[] {
  // FlightStats' inline hydration is emitted as `__NEXT_DATA__ = {...};
  // __NEXT_LOADED_PAGES__=[]...`. The Next.js version they run doesn't
  // prefix with `window.` — an earlier draft of this scraper had that
  // prefix in the regex and silently returned zero candidates on every
  // real page. The trailing `__NEXT_LOADED_PAGES__` anchor is what lets
  // the non-greedy `\{[\s\S]*?\}` match know where the JSON ends.
  const match = html.match(
    /__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});__NEXT_LOADED_PAGES__/,
  );
  if (!match) return [];

  let data: any;
  try {
    data = JSON.parse(match[1]!);
  } catch {
    return [];
  }

  const tracker = data?.props?.initialState?.flightTracker;
  if (!tracker) return [];

  const emit = (raw: any, sink: Candidate[]) => {
    const flightId = Number(raw?.flightId);
    const from = raw?.departureAirport?.fs;
    const to = raw?.arrivalAirport?.fs;
    if (!Number.isFinite(flightId) || !from || !to) return;
    sink.push({ flightId, from, to });
  };

  const candidates: Candidate[] = [];
  emit(tracker.flight, candidates);

  // otherDays entries key by year + a "Mon-D" string (e.g. "Jul-13", no
  // zero-padding on the day). `year` comes back as a string in the payload
  // (`"2026"` not `2026`), so coerce to string for the comparison — an
  // earlier strict-equal check against a number silently skipped every
  // otherDays entry and only same-day-primary-route flights resolved.
  // Filter to the requested day only; without this the rolling ~7-day
  // window would bleed a matching-route sibling from a different day
  // through.
  const targetKey = `${MONTHS[month - 1]}-${day}`;
  const targetYear = String(year);
  const otherDays = Array.isArray(tracker.otherDays) ? tracker.otherDays : [];
  for (const dayEntry of otherDays) {
    if (String(dayEntry?.year) !== targetYear) continue;
    if (dayEntry?.date2 !== targetKey) continue;
    const flights = Array.isArray(dayEntry.flights) ? dayEntry.flights : [];
    for (const flight of flights) {
      // The url field contains flightId as a query param; the number is
      // also duplicated on flight.flightId when present. Prefer the query
      // param since it's what FlightStats' own client-side uses.
      const urlMatch = flight?.url?.match?.(/flightId=(\d+)/);
      const fromUrl = urlMatch ? Number(urlMatch[1]) : null;
      const inline = Number(flight?.flightId);
      const flightId = fromUrl ?? (Number.isFinite(inline) ? inline : null);
      if (!flightId) continue;
      const from = flight?.departureAirport?.fs;
      const to = flight?.arrivalAirport?.fs;
      if (!from || !to) continue;
      candidates.push({ flightId, from, to });
    }
  }

  const seen = new Set<number>();
  return candidates.filter((c) => {
    if (seen.has(c.flightId)) return false;
    seen.add(c.flightId);
    return true;
  });
}

/**
 * Resolve the FlightStats details URL for a specific flight instance.
 *
 * Returns null on any failure — DNS error, WAF challenge, non-200 response,
 * missing `__NEXT_DATA__`, JSON parse failure, no route match in the parsed
 * candidates. Callers must treat null as "no link available"; nothing else.
 *
 * The `year`/`month`/`day` triple must be in the ORIGIN airport's local
 * calendar. FlightStats keys their tracker URL off origin-local date, not
 * UTC. Passing UTC dates for late-evening origin-local departures can
 * silently return the wrong day's rows.
 */
export async function resolveFlightStatsDetailsUrl(input: {
  carrier: string;
  flightNumber: string;
  year: number;
  month: number;
  day: number;
  from: string;
  to: string;
}): Promise<string | null> {
  const trackerUrl =
    `https://www.flightstats.com/v2/flight-tracker/${encodeURIComponent(input.carrier)}/${encodeURIComponent(input.flightNumber)}` +
    `?year=${input.year}&month=${pad(input.month)}&date=${pad(input.day)}`;

  let html: string;
  try {
    const response = await fetch(trackerUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) {
      console.error(
        `[flightstats] tracker fetch returned ${response.status} for ${trackerUrl}`,
      );
      return null;
    }
    html = await response.text();
  } catch (err) {
    console.error(
      `[flightstats] tracker fetch threw for ${trackerUrl}:`,
      (err as Error)?.message ?? err,
    );
    return null;
  }

  const candidates = parseCandidates(html, input.year, input.month, input.day);
  const match = candidates.find(
    (c) => c.from === input.from && c.to === input.to,
  );
  if (!match) return null;

  // Details URL keeps year/month/day unpadded to match how FlightStats' own
  // client emits the URL — tested to work either way, unpadded matches
  // convention.
  return (
    `https://www.flightstats.com/v2/flight-details/${encodeURIComponent(input.carrier)}/${encodeURIComponent(input.flightNumber)}` +
    `?year=${input.year}&month=${input.month}&date=${input.day}&flightId=${match.flightId}`
  );
}
