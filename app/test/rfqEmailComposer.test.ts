import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { composeRfqEmail, buildResponseUrl } from "../src/services/rfqEmailComposer";

// RFQ SEND — pure email composition only. No database, no EmailSender, no
// authorization; see rfqSend.test.ts for sendRFQDispatch's own behavior.
describe("rfqEmailComposer (pure composition)", () => {
  const baseData = {
    supplierEmail: "supplier@example.com",
    supplierName: "Acme Supply Co",
    productName: "Widget",
    requestedQuantity: "100",
    unit: "EA",
    responseUrl: "http://localhost:3000/rfq-response/deadbeef",
  };

  it("produces the exact recipient from supplierEmail", () => {
    const composed = composeRfqEmail(baseData);
    expect(composed.to).toBe("supplier@example.com");
  });

  it("includes the product, quantity, unit, and response URL in the body", () => {
    const composed = composeRfqEmail(baseData);
    expect(composed.body).toContain("Widget");
    expect(composed.body).toContain("100 EA");
    expect(composed.body).toContain("http://localhost:3000/rfq-response/deadbeef");
  });

  it("strips embedded CR/LF from the subject line (header-injection defense)", () => {
    // The actual injection vector is a literal CR/LF breaking the subject
    // out into a second header line — not the word "Bcc" surviving as
    // harmless text within one line, which is not itself a vulnerability.
    const composed = composeRfqEmail({ ...baseData, productName: "Widget\r\nBcc: attacker@evil.com" });
    expect(composed.subject).not.toMatch(/[\r\n]/);
  });

  it("does not mutate untrusted strings in the body beyond plain interpolation (plain text, no HTML)", () => {
    const composed = composeRfqEmail({ ...baseData, supplierName: "<script>alert(1)</script>" });
    // Plain text body: the raw string is expected verbatim — there is no
    // HTML context for it to execute in. This test documents that
    // assumption rather than asserting an HTML-escaping behavior that
    // would be wrong for a plain-text body.
    expect(composed.body).toContain("<script>alert(1)</script>");
  });

  describe("buildResponseUrl", () => {
    it("constructs a safe, well-formed absolute URL from a base and raw token", () => {
      const url = buildResponseUrl("http://localhost:3000", "abc123");
      expect(url).toBe("http://localhost:3000/rfq-response/abc123");
    });

    it("percent-encodes the token as a path segment", () => {
      const url = buildResponseUrl("http://localhost:3000", "has space");
      expect(url).not.toContain(" ");
      expect(url).toContain("%20");
    });

    it("throws on a malformed base URL rather than producing a broken link", () => {
      expect(() => buildResponseUrl("not-a-url", "abc123")).toThrow();
    });
  });

  // ---------------------------------------------------------------
  // Module boundary — must remain a pure, dependency-free module.
  // ---------------------------------------------------------------
  it("contains no Prisma/tenantScoped/EmailSender import", async () => {
    const source = await readFile(join(__dirname, "../src/services/rfqEmailComposer.ts"), "utf-8");
    const importLines = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import "))
      .join("\n");
    expect(importLines).toBe("");
  });
});
