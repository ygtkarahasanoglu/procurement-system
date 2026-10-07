import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendGridEmailSender } from "../src/api/sendgridEmailSender";

// SendGrid RFQ email adapter — RFQ-EP1/EP4/EP5 (docs/decisions/ratified.md).
// No real network call, no real credential, ever. Every test mocks the
// global `fetch` the adapter uses internally; nothing here reaches the
// real SendGrid API.

const ORIGINAL_API_KEY = process.env.SENDGRID_API_KEY;
const ORIGINAL_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;

const input = { to: "supplier@example.com", subject: "Request for Quote", body: "...link: http://localhost:5173/rfq-response/raw-token-abc123..." };

function setConfig(apiKey: string | undefined, fromEmail: string | undefined) {
  if (apiKey === undefined) delete process.env.SENDGRID_API_KEY;
  else process.env.SENDGRID_API_KEY = apiKey;
  if (fromEmail === undefined) delete process.env.SENDGRID_FROM_EMAIL;
  else process.env.SENDGRID_FROM_EMAIL = fromEmail;
}

function mockFetchResolved(status: number, opts: { headers?: Record<string, string>; jsonBody?: unknown } = {}) {
  const response = new Response(opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : "", {
    status,
    headers: new Headers(opts.headers ?? {}),
  });
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockFetchRejected(err: unknown) {
  const fetchMock = vi.fn().mockRejectedValue(err);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("sendGridEmailSender", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setConfig("sg-test-api-key-do-not-leak", "rfq@ygt.example.com");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setConfig(ORIGINAL_API_KEY, ORIGINAL_FROM_EMAIL);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function allLoggedText(): string {
    return [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" ");
  }

  it("1. 202 -> success", async () => {
    mockFetchResolved(202);
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("success");
  });

  it("2. 202 + X-Message-Id -> providerMessageId captured", async () => {
    mockFetchResolved(202, { headers: { "X-Message-Id": "filter-abc.xyz-0" } });
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome).toEqual({ kind: "success", providerMessageId: "filter-abc.xyz-0" });
  });

  it("3. 202 without X-Message-Id -> success with providerMessageId undefined, never downgraded", async () => {
    mockFetchResolved(202);
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("success");
    expect((outcome as { providerMessageId?: string }).providerMessageId).toBeUndefined();
  });

  it("4. 400 -> failure", async () => {
    mockFetchResolved(400, { jsonBody: { errors: [{ message: "The subject is required." }] } });
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("failure");
  });

  it("5. 401 -> failure", async () => {
    mockFetchResolved(401, { jsonBody: { errors: [{ message: "Unauthorized" }] } });
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("failure");
  });

  it("6. 403 -> failure", async () => {
    mockFetchResolved(403, { jsonBody: { errors: [{ message: "Forbidden" }] } });
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("failure");
  });

  it("7. 413 -> failure", async () => {
    mockFetchResolved(413);
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("failure");
  });

  it("8. 429 -> failure, NOT unknown", async () => {
    mockFetchResolved(429);
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("failure");
  });

  it("9. 5xx -> unknown", async () => {
    mockFetchResolved(503);
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome).toEqual({ kind: "unknown" });
  });

  it("10. timeout/AbortError -> unknown", async () => {
    mockFetchRejected(new DOMException("The operation was aborted.", "AbortError"));
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome).toEqual({ kind: "unknown" });
  });

  it("11. network exception -> unknown", async () => {
    mockFetchRejected(new TypeError("fetch failed"));
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome).toEqual({ kind: "unknown" });
  });

  it("12. connection reset / generic fetch rejection -> unknown", async () => {
    mockFetchRejected(new Error("ECONNRESET"));
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome).toEqual({ kind: "unknown" });
  });

  it("13. malformed/unexpected provider response (unrecognized status code) -> unknown", async () => {
    mockFetchResolved(418);
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome).toEqual({ kind: "unknown" });
  });

  it("13b. a deterministic-failure status with an unparseable error body still classifies as failure (robustness)", async () => {
    const response = new Response("not json", { status: 400 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("failure");
  });

  it("14. missing SENDGRID_API_KEY -> deterministic safe failure, no network call attempted", async () => {
    setConfig(undefined, "rfq@ygt.example.com");
    const fetchMock = mockFetchResolved(202);
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("failure");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("15. missing SENDGRID_FROM_EMAIL -> deterministic safe failure, no network call attempted", async () => {
    setConfig("sg-test-api-key-do-not-leak", undefined);
    const fetchMock = mockFetchResolved(202);
    const outcome = await sendGridEmailSender.send(input);
    expect(outcome.kind).toBe("failure");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("16. the configured API key never appears in any logged output, on success or failure", async () => {
    mockFetchResolved(401, { jsonBody: { errors: [{ message: "Unauthorized" }] } });
    await sendGridEmailSender.send(input);
    expect(allLoggedText()).not.toContain("sg-test-api-key-do-not-leak");
  });

  it("17. the raw RFQ email body (and any token it contains) never appears in any logged output", async () => {
    mockFetchResolved(400, { jsonBody: { errors: [{ message: "bad request" }] } });
    await sendGridEmailSender.send(input);
    const logged = allLoggedText();
    expect(logged).not.toContain(input.body);
    expect(logged).not.toContain("raw-token-abc123");
  });
});
