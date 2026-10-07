import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDevEmailSender } from "../src/api/devEmailSender";

// RFQ UI End-to-End V1 — development/demo-only EmailSender. Must never
// perform a real network call, never become createApp's production
// default, and never route the raw token through this codebase's
// shared/general console.error logging path.
describe("createDevEmailSender", () => {
  it("captures a sent email in memory and returns success", async () => {
    const dev = createDevEmailSender();
    const outcome = await dev.sender.send({
      to: "supplier@example.com",
      subject: "RFQ",
      body: "link: http://localhost:5173/rfq-response/abc123",
    });
    expect(outcome).toEqual({ kind: "success" });
    expect(dev.getCapturedEmails()).toHaveLength(1);
    expect(dev.getCapturedEmails()[0].body).toContain("abc123");
  });

  it("getLastEmailFor returns the most recent capture for a given recipient", async () => {
    const dev = createDevEmailSender();
    await dev.sender.send({ to: "a@example.com", subject: "First", body: "token-1" });
    await dev.sender.send({ to: "a@example.com", subject: "Second", body: "token-2" });
    await dev.sender.send({ to: "b@example.com", subject: "Other", body: "token-3" });

    expect(dev.getLastEmailFor("a@example.com")?.body).toBe("token-2");
    expect(dev.getLastEmailFor("nonexistent@example.com")).toBeUndefined();
  });

  it("invokes the optional onCapture callback with exactly the captured email", async () => {
    const captures: unknown[] = [];
    const dev = createDevEmailSender((email) => captures.push(email));
    await dev.sender.send({ to: "a@example.com", subject: "S", body: "B" });
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ to: "a@example.com", subject: "S", body: "B" });
  });

  it("performs no real network/transport call of any kind (source inspection)", async () => {
    const source = await readFile(join(__dirname, "../src/api/devEmailSender.ts"), "utf-8");
    expect(source).not.toMatch(/\b(fetch|http|https|smtp|mailer|sendMail|axios)\b/i);
  });

  it("never calls console.* itself — any visibility is strictly through the caller-supplied onCapture callback", async () => {
    const source = await readFile(join(__dirname, "../src/api/devEmailSender.ts"), "utf-8");
    expect(source).not.toMatch(/console\./);
  });

  it("is never selected as createApp's default dependency (DEFAULT_SEND_DEPS in server.ts uses the real SendGrid adapter, per RFQ-EP1, never createDevEmailSender)", async () => {
    const source = await readFile(join(__dirname, "../src/api/server.ts"), "utf-8");
    const defaultDepsBlock = source.match(/const DEFAULT_SEND_DEPS[\s\S]*?};/);
    expect(defaultDepsBlock).not.toBeNull();
    expect(defaultDepsBlock![0]).toMatch(/sendGridEmailSender/);
    expect(defaultDepsBlock![0]).not.toMatch(/createDevEmailSender/);
  });

  it("the composition root only activates it behind an explicit opt-in env var, never unconditionally", async () => {
    const source = await readFile(join(__dirname, "../src/api/server.ts"), "utf-8");
    expect(source).toMatch(/RFQ_DEV_EMAIL_CAPTURE/);
    const unconditionalCall = /^const app = createApp\(sessionAuthenticator, \{\s*emailSender: createDevEmailSender/m;
    expect(source).not.toMatch(unconditionalCall);
  });
});
