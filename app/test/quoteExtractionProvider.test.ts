import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { xlsxToCsv, noneQuoteExtractionProvider, getConfiguredQuoteExtractionProvider } from "../src/services/quoteExtractionProvider";

// AI-1 (docs/decisions/ratified.md). No network call anywhere in this
// file — CI runs with AI_EXTRACTION_PROVIDER=none and no GEMINI_API_KEY,
// so geminiQuoteExtractionProvider.extract() itself is never exercised
// here (see src/scripts/smokeExtract.ts for the real-provider check).
describe("quoteExtractionProvider", () => {
  it("xlsxToCsv converts the first worksheet to CSV text", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Quote");
    sheet.addRow(["Widget", 10, "EA", 5.5, "EUR"]);
    sheet.addRow(["Gadget", 3, "EA", 12, "USD"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const csv = await xlsxToCsv(buffer);
    expect(csv).toContain("Widget,10,EA,5.5,EUR");
    expect(csv).toContain("Gadget,3,EA,12,USD");
  });

  it("noneQuoteExtractionProvider always throws a clear, deterministic message, never calling out to anything", async () => {
    await expect(
      noneQuoteExtractionProvider.extract({
        fileName: "f.pdf",
        mimeType: "application/pdf",
        content: Buffer.from(""),
        requestedProduct: "Widget",
        requestedQuantity: "1",
        requestedUnit: "EA",
      })
    ).rejects.toThrow("AI extraction not configured — enter the quote manually.");
  });

  it("getConfiguredQuoteExtractionProvider defaults to none when AI_EXTRACTION_PROVIDER is unset", () => {
    const original = process.env.AI_EXTRACTION_PROVIDER;
    delete process.env.AI_EXTRACTION_PROVIDER;
    try {
      expect(getConfiguredQuoteExtractionProvider().name).toBe("none");
    } finally {
      if (original !== undefined) process.env.AI_EXTRACTION_PROVIDER = original;
    }
  });

  it("getConfiguredQuoteExtractionProvider selects gemini only when explicitly configured", () => {
    const original = process.env.AI_EXTRACTION_PROVIDER;
    process.env.AI_EXTRACTION_PROVIDER = "gemini";
    try {
      expect(getConfiguredQuoteExtractionProvider().name).toBe("gemini");
    } finally {
      if (original === undefined) delete process.env.AI_EXTRACTION_PROVIDER;
      else process.env.AI_EXTRACTION_PROVIDER = original;
    }
  });
});
