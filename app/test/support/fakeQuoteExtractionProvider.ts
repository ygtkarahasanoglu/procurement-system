import type {
  QuoteExtractionInput,
  QuoteExtractionProvider,
  QuoteExtractionResult,
} from "../../src/services/quoteExtractionProvider";

// Test-only QuoteExtractionProvider, mirroring fakeEmailSender.ts's own
// convention exactly: a dedicated, controllable test double that
// performs no real AI call of any kind. MUST NEVER be imported from
// app/src/, and must never be wired into server.ts's own (production/
// dev) composition root.
export class FakeQuoteExtractionProvider implements QuoteExtractionProvider {
  readonly name = "fake";
  readonly calls: QuoteExtractionInput[] = [];
  private next: QuoteExtractionResult | Error = {
    provider: "fake",
    model: "fake-1",
    result: { lines: [{ description: "Widget", quantity: "10", unit: "EA", unitPrice: "5.00", currency: "EUR" }] },
  };

  setNextResult(result: QuoteExtractionResult): void {
    this.next = result;
  }

  setNextError(err: Error): void {
    this.next = err;
  }

  async extract(input: QuoteExtractionInput): Promise<QuoteExtractionResult> {
    this.calls.push(input);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}
