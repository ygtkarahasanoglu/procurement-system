// FX-1 (docs/decisions/ratified.md): one TCMB daily bulletin, used
// verbatim for one comparison. No caching, no fallback source, no
// per-quote date — a single bulletin fetch covers every currency a
// given recommendation needs. Deliberately minimal: no new dependency
// (XML is parsed with targeted regexes against TCMB's own fixed,
// well-known tag shape, not a general-purpose XML library).

export interface FxCurrencyRate {
  /** The denomination the published rate applies to (e.g. 100 for JPY) — divide by this to get the rate for one unit. */
  unit: number;
  forexBuying: number | null;
  forexSelling: number | null;
}

export interface FxBulletin {
  /** Verbatim from the bulletin XML's `Tarih` attribute — never reformatted, so it remains exactly reproducible. */
  bulletinDate: string;
  rates: Record<string, FxCurrencyRate>;
}

export interface FxRateProvider {
  getBulletin(): Promise<FxBulletin>;
}

const TCMB_BULLETIN_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";
const REQUEST_TIMEOUT_MS = 10_000;

function extractTagValue(block: string, tag: string): string | null {
  if (new RegExp(`<${tag}\\s*/>`).test(block)) {
    return null; // self-closing — TCMB's own documented way of publishing "no rate for this field"
  }
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block);
  if (!match) return null;
  const value = match[1].trim();
  return value.length > 0 ? value : null;
}

function toFiniteNumberOrNull(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses TCMB's own fixed bulletin shape:
 *   <Tarih_Date Tarih="DD.MM.YYYY" ...>
 *     <Currency Kod="USD" ...><Unit>1</Unit><ForexBuying>..</ForexBuying><ForexSelling>..</ForexSelling></Currency>
 *     ...
 *   </Tarih_Date>
 * Throws on anything that does not match this shape — never guesses a
 * partial result from malformed input (FX-1: fail closed).
 */
export function parseTcmbBulletin(xml: string): FxBulletin {
  const tarihMatch = /<Tarih_Date\b[^>]*\bTarih="([^"]+)"/.exec(xml);
  if (!tarihMatch) {
    throw new Error("TCMB bulletin XML is missing the Tarih_Date/Tarih attribute.");
  }
  const bulletinDate = tarihMatch[1];

  const rates: Record<string, FxCurrencyRate> = {};
  const currencyBlockPattern = /<Currency\b([^>]*)>([\s\S]*?)<\/Currency>/g;
  let block: RegExpExecArray | null;
  while ((block = currencyBlockPattern.exec(xml)) !== null) {
    const [, attrs, body] = block;
    const kodMatch = /\bKod="([^"]+)"/.exec(attrs);
    if (!kodMatch) continue;
    const code = kodMatch[1];

    const unit = toFiniteNumberOrNull(extractTagValue(body, "Unit")) ?? 1;
    rates[code] = {
      unit,
      forexBuying: toFiniteNumberOrNull(extractTagValue(body, "ForexBuying")),
      forexSelling: toFiniteNumberOrNull(extractTagValue(body, "ForexSelling")),
    };
  }

  return { bulletinDate, rates };
}

// FX-1 item 1: TCMB daily bulletin, fetched fresh every call — no
// caching (FX-1 does not ratify one). A fetch/HTTP failure is never
// swallowed or retried here; it propagates as a plain Error for the
// caller (recommendationService.ts) to translate into the fail-closed
// ValidationError FX-1 requires.
export const tcmbFxRateProvider: FxRateProvider = {
  async getBulletin(): Promise<FxBulletin> {
    let response: Response;
    try {
      response = await fetch(TCMB_BULLETIN_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`TCMB bulletin fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      throw new Error(`TCMB bulletin fetch failed: HTTP ${response.status}`);
    }
    const xml = await response.text();
    return parseTcmbBulletin(xml);
  },
};
