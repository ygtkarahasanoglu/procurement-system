import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { geminiQuoteExtractionProvider } from "../services/quoteExtractionProvider";

// AI-1 (docs/decisions/ratified.md): manual, local-only smoke test for
// the real Gemini provider — never run in CI (AI_EXTRACTION_PROVIDER
// there is always "none"). Use only with a test/sample document, never
// real customer data, per the ratified decision's own provider-usage
// rule.
//
// Usage: npm run smoke:extract -- <file> "<product>" <qty> <unit>

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function main() {
  const [filePath, product, qty, unit] = process.argv.slice(2);
  if (!filePath || !product || !qty || !unit) {
    console.error('Usage: npm run smoke:extract -- <file> "<product>" <qty> <unit>');
    process.exit(1);
  }

  const mimeType = MIME_BY_EXTENSION[extname(filePath).toLowerCase()];
  if (!mimeType) {
    console.error(`Unsupported file extension for ${filePath}. Supported: ${Object.keys(MIME_BY_EXTENSION).join(", ")}`);
    process.exit(1);
  }

  const content = readFileSync(filePath);
  const { provider, model, result } = await geminiQuoteExtractionProvider.extract({
    fileName: filePath,
    mimeType,
    content,
    requestedProduct: product,
    requestedQuantity: qty,
    requestedUnit: unit,
  });

  console.log(JSON.stringify({ provider, model, result }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
