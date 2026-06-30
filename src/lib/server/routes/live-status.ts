import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '$lib/server/trpc';
import { db } from '$lib/db';
import {
  findAssignedTail,
  walkTailHistory,
  getBackupRoutes,
  type FR24Leg,
} from '$lib/server/utils/fr24';

// Normalize a user-entered flight number to the form FR24's departures board
// uses: uppercase, no spaces/hyphens. "wn 500" → "WN500", "AA-1234" → "AA1234".
function sanitizeFlightNumber(fn: string): string {
  return fn.replace(/\s|-/g, '').toUpperCase();
}

export const liveStatusRouter = router({
  // Flights owned by the calling user, scheduled to depart within the next 24
  // hours, that have a flight number set (required for FR24 lookup).
  //
  // We treat `departure_scheduled` and `departure` as interchangeable for the
  // "when does this flight take off" question: users entering an upcoming
  // flight may put their boarding-pass time into either field, and we want
  // to find them either way. The WHERE clause matches a row if EITHER:
  //   (a) departureScheduled falls in the next 24 hours, or
  //   (b) departureScheduled is null and departure falls in the next 24 hours.
  // Both columns are ISO-8601 strings which sort chronologically, so direct
  // string comparison works without any timezone parsing.
  listUpcoming: authedProcedure.query(async ({ ctx: { user } }) => {
    const nowIso = new Date().toISOString();
    const in24hIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const rows = await db
      .selectFrom('flight')
      .innerJoin('seat', 'seat.flightId', 'flight.id')
      .innerJoin('airport as fromAirport', 'fromAirport.id', 'flight.fromId')
      .innerJoin('airport as toAirport', 'toAirport.id', 'flight.toId')
      .leftJoin('airline', 'airline.id', 'flight.airlineId')
      .where('seat.userId', '=', user.id)
      .where('flight.flightNumber', 'is not', null)
      .where((eb) =>
        eb.or([
          eb.and([
            eb('flight.departureScheduled', 'is not', null),
            eb('flight.departureScheduled', '>=', nowIso),
            eb('flight.departureScheduled', '<=', in24hIso),
          ]),
          eb.and([
            eb('flight.departureScheduled', 'is', null),
            eb('flight.departure', 'is not', null),
            eb('flight.departure', '>=', nowIso),
            eb('flight.departure', '<=', in24hIso),
          ]),
        ]),
      )
      .select([
        'flight.id',
        'flight.flightNumber',
        'flight.departureScheduled',
        'flight.departure',
        'fromAirport.iata as fromIata',
        'fromAirport.tz as fromTz',
        'fromAirport.name as fromName',
        'toAirport.iata as toIata',
        'toAirport.name as toName',
        'airline.name as airlineName',
        'airline.iconPath as airlineIconPath',
      ])
      .orderBy('flight.departureScheduled', 'asc')
      .orderBy('flight.departure', 'asc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      flightNumber: row.flightNumber as string,
      // Prefer the scheduled timestamp when present; fall back to the actual
      // gate-out timestamp. One of the two is guaranteed non-null by the WHERE.
      departureScheduled: (row.departureScheduled ?? row.departure) as string,
      from: { iata: row.fromIata, tz: row.fromTz, name: row.fromName },
      to: { iata: row.toIata, name: row.toName },
      airline: row.airlineName
        ? { name: row.airlineName, iconPath: row.airlineIconPath }
        : null,
    }));
  }),

  // FR24 rotation lookup for one upcoming flight. Returns the user's leg plus
  // each prior leg the assigned aircraft has flown today, plus alternative
  // same-day origin→destination flights.
  getRotation: authedProcedure
    .input(
      z.object({
        flightNumber: z.string().min(1),
        originIata: z.string().length(3),
        destinationIata: z.string().length(3),
        // Origin-airport tz used to compute the same-day cutoff for the
        // rotation walk. Required because the server's local TZ doesn't
        // generally match the user's flight origin TZ.
        originTz: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const cleaned = sanitizeFlightNumber(input.flightNumber);
      const originIata = input.originIata.toUpperCase();
      const destIata = input.destinationIata.toUpperCase();

      let yourLeg: FR24Leg | null;
      try {
        yourLeg = await findAssignedTail(originIata, cleaned);
      } catch (err) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `FR24 unreachable: ${(err as Error)?.message ?? 'unknown'}`,
        });
      }

      // FR24 hasn't surfaced this flight on the board yet (common when the
      // flight is >12 h out). Treat as a soft "not found" so the UI can render
      // a "check back later" empty state instead of an error toast.
      if (yourLeg === null) {
        return {
          kind: 'tail_not_found' as const,
          fetchedAt: new Date().toISOString(),
        };
      }

      const priorLegs =
        yourLeg.tail && yourLeg.schedDep
          ? await walkTailHistory(
              yourLeg.tail,
              originIata,
              yourLeg.schedDep,
              input.originTz,
            )
          : [];

      const backupRoutes = await getBackupRoutes(originIata, destIata, cleaned);

      // Look up the IANA tz for every airport that appears in any leg. FR24
      // sometimes includes tz info in the response but its format is unstable;
      // the JTrail airports table is authoritative IANA. One DB query for the
      // whole rotation is cheaper than serializing tz onto every FR24 row.
      const allLegs = [yourLeg, ...priorLegs, ...backupRoutes];
      const iatas = new Set<string>();
      for (const leg of allLegs) {
        if (leg.origin) iatas.add(leg.origin);
        if (leg.destination) iatas.add(leg.destination);
      }
      const tzByIata = new Map<string, string>();
      if (iatas.size > 0) {
        const rows = await db
          .selectFrom('airport')
          .select(['iata', 'tz'])
          .where('iata', 'in', [...iatas])
          .execute();
        for (const r of rows) {
          if (r.iata) tzByIata.set(r.iata, r.tz);
        }
      }
      const enrich = (leg: FR24Leg): FR24Leg => ({
        ...leg,
        originTz: (leg.origin && tzByIata.get(leg.origin)) ?? null,
        destinationTz:
          (leg.destination && tzByIata.get(leg.destination)) ?? null,
      });

      return {
        kind: 'ok' as const,
        yourLeg: enrich(yourLeg),
        priorLegs: priorLegs.map(enrich),
        backupRoutes: backupRoutes.map(enrich),
        fetchedAt: new Date().toISOString(),
      };
    }),
});

export type LiveStatusRouter = typeof liveStatusRouter;
