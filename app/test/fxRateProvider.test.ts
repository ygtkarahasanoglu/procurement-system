import { describe, expect, it } from "vitest";
import { parseTcmbBulletin } from "../src/services/fxRateProvider";

// FX-1 (docs/decisions/ratified.md): the TCMB XML parser itself, in
// isolation — no network call, no fake provider needed. The sample
// below mirrors TCMB's own documented bulletin shape (today.xml).

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="08.10.2026" Date="10/08/2026" Bulten_No="2026/193">
  <Currency Kod="USD" CurrencyCode="USD">
    <Unit>1</Unit>
    <Isim>ABD DOLARI</Isim>
    <CurrencyName>US DOLLAR</CurrencyName>
    <ForexBuying>34.0000</ForexBuying>
    <ForexSelling>34.5000</ForexSelling>
    <BanknoteBuying>33.9000</BanknoteBuying>
    <BanknoteSelling>34.6000</BanknoteSelling>
  </Currency>
  <Currency Kod="JPY" CurrencyCode="JPY">
    <Unit>100</Unit>
    <Isim>JAPON YENI</Isim>
    <CurrencyName>JAPANESE YEN</CurrencyName>
    <ForexBuying>22.0000</ForexBuying>
    <ForexSelling>23.0000</ForexSelling>
    <BanknoteBuying/>
    <BanknoteSelling/>
  </Currency>
  <Currency Kod="XYZ" CurrencyCode="XYZ">
    <Unit>1</Unit>
    <Isim>BILINMEYEN</Isim>
    <CurrencyName>UNKNOWN</CurrencyName>
    <ForexBuying></ForexBuying>
    <ForexSelling></ForexSelling>
  </Currency>
</Tarih_Date>`;

describe("parseTcmbBulletin", () => {
  it("reads the bulletin date verbatim from the Tarih attribute", () => {
    expect(parseTcmbBulletin(SAMPLE_XML).bulletinDate).toBe("08.10.2026");
  });

  it("parses Unit/ForexBuying/ForexSelling for each currency block", () => {
    const { rates } = parseTcmbBulletin(SAMPLE_XML);
    expect(rates.USD).toEqual({ unit: 1, forexBuying: 34.0, forexSelling: 34.5 });
    expect(rates.JPY).toEqual({ unit: 100, forexBuying: 22.0, forexSelling: 23.0 });
  });

  it("treats both empty-content and self-closing rate tags as null, never as 0", () => {
    const { rates } = parseTcmbBulletin(SAMPLE_XML);
    expect(rates.XYZ.forexBuying).toBeNull();
    expect(rates.XYZ.forexSelling).toBeNull();
  });

  it("throws on XML missing the Tarih_Date/Tarih attribute, rather than returning a partial result", () => {
    expect(() => parseTcmbBulletin("<NotTheRightRoot/>")).toThrow();
  });
});
