import { z } from "zod";

/**
 * Runtime schemas for the Eclesiar public API (https://eclesiar.com/api).
 * Shapes follow the official docs. They are deliberately lenient (coerced
 * numbers, optional extras) so a small upstream change degrades a field
 * instead of breaking a whole panel.
 */

const num = z.coerce.number();
// nullish() short-circuits null/undefined before coercion (Number(null) would be 0).
const numOrNull = z.coerce.number().nullish().transform((v) => v ?? null);
const str = z.string();
const strOpt = z.string().nullish().transform((v) => v ?? null);
/** The API sends flags as true/false or 1/0 depending on the endpoint. */
const flag = z
  .union([z.boolean(), z.coerce.number()])
  .nullish()
  .transform((v) => (v == null ? null : Boolean(v)));

export const RefSchema = z.object({ id: num, name: str, avatar: strOpt });
export type Ref = z.infer<typeof RefSchema>;

export const ServerStatusSchema = z.object({
  status: str,
  version: strOpt,
  server_name: strOpt,
  server_time: strOpt,
  server_day: numOrNull,
});
export type ServerStatus = z.infer<typeof ServerStatusSchema>;

export const ItemSchema = z.object({
  id: num,
  name: str.transform((s) => s.trim()), // some names come with a trailing "\n"
  quality: num.nullish().transform((v) => v ?? 0),
  type: str.nullish().transform((v) => v ?? "OTHER"),
  negotiable: flag,
  avatar: strOpt,
});
export type Item = z.infer<typeof ItemSchema>;

export const CountrySchema = z.object({
  id: num,
  name: str,
  avatar: strOpt,
  currency: z.object({ id: num, name: str, symbol: strOpt.optional() }).nullish(),
  is_available: flag,
  laws: z
    .object({
      work_tax: numOrNull,
      vat: numOrNull,
      import_taxes: numOrNull,
      minimum_wage: numOrNull,
    })
    .partial()
    .nullish(),
});
export type Country = z.infer<typeof CountrySchema>;

export const CountryStatSchema = z.object({
  country: RefSchema,
  value: z.unknown(),
});

export const RegionSchema = z.object({
  id: num,
  name: str,
  country_id: num.nullish(),
});

export const ItemOfferSchema = z.object({
  id: num,
  value: num,
  amount: num,
  owner: z
    .object({ id: num, type: strOpt, name: strOpt, avatar: strOpt, country_id: num.nullish() })
    .nullish(),
  item: z.object({ id: num, name: strOpt, type: strOpt, quality: num.nullish(), avatar: strOpt }).nullish(),
  currency: z.object({ id: num, name: str, avatar: strOpt }).nullish(),
  import_tax: z.object({ origin_country_id: num.nullish(), rate: num.nullish() }).nullish(),
});
export type ItemOffer = z.infer<typeof ItemOfferSchema>;

export const CoinOfferSchema = z.object({
  id: num,
  rate: num,
  amount: num,
  owner: z.object({ id: num, type: strOpt, name: strOpt }).nullish(),
});
export type CoinOffer = z.infer<typeof CoinOfferSchema>;

const zero = num.nullish().transform((v) => v ?? 0);

/** Top damage dealer of one side in a round. */
export const HeroSchema = z
  .object({ id: num, username: strOpt, avatar: strOpt, damage: zero })
  .nullish()
  .transform((v) => v ?? null);

/**
 * One round. Careful: in rounds, `*_score` is the side's total DAMAGE, while the
 * round is won by the side with more `*_points` (verified against /wars, whose
 * `*_score` counts rounds won). End dates are UTC ("YYYY-MM-DD HH:MM:SS").
 */
export const WarRoundSchema = z.object({
  id: num,
  end_date: strOpt,
  attackers_score: zero,
  defenders_score: zero,
  attackers_points: zero,
  defenders_points: zero,
  attackers_hero: HeroSchema,
  defenders_hero: HeroSchema,
});
export type WarRound = z.infer<typeof WarRoundSchema>;

export const WarSchema = z.object({
  id: num,
  attackers: RefSchema,
  defenders: RefSchema,
  region: z.object({ id: num, name: str }).nullish(),
  /** Rounds won. */
  attackers_score: zero,
  defenders_score: zero,
  current_round_number: num.nullish(),
  current_round_id: num.nullish(),
  flags: z.object({ is_revolution: flag, is_civil_war: flag }).nullish(),
  /** Only with extra_details=1. */
  current_round: WarRoundSchema.nullish(),
});
export type War = z.infer<typeof WarSchema>;

export const NukeSchema = z.object({
  nuke_id: num,
  from_country_id: num.nullish(),
  from_region_id: num.nullish(),
  to_region_id: num.nullish(),
  launched_at: num,
  impact_at: num,
  duration_seconds: num.nullish(),
});
export const NukesSchema = z.object({
  server_time: num.nullish(),
  nukes: z.array(NukeSchema).nullish().transform((v) => v ?? []),
});
export type Nuke = z.infer<typeof NukeSchema>;

export const WorldEventSchema = z.object({
  id: z.coerce.number().nullish(),
  image_id: z.coerce.number().nullish(),
  title: strOpt,
  content: strOpt,
  created_at: strOpt,
  nuke_id: num.nullish(),
});
export const WorldEventsSchema = z.object({
  events: z.array(WorldEventSchema).nullish().transform((v) => v ?? []),
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;
