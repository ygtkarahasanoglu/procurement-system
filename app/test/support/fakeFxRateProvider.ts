import type { FxBulletin, FxRateProvider } from "../../src/services/fxRateProvider";

// Test-only FX provider, mirroring fakeEmailSender.ts's own convention
// exactly: a controllable double performing no real network call. MUST
// NEVER be imported from app/src/ — lives under app/test/ specifically
// so it is never reachable from that path. Configure exactly one of
// setBulletin/setError per test; calling getBulletin with neither
// configured is itself a test-authoring error, not a silent success.
export class FakeFxRateProvider implements FxRateProvider {
  private bulletin: FxBulletin | null = null;
  private error: Error | null = null;

  setBulletin(bulletin: FxBulletin): void {
    this.bulletin = bulletin;
    this.error = null;
  }

  setError(error: Error): void {
    this.error = error;
    this.bulletin = null;
  }

  async getBulletin(): Promise<FxBulletin> {
    if (this.error) throw this.error;
    if (!this.bulletin) throw new Error("FakeFxRateProvider: no bulletin configured for this test.");
    return this.bulletin;
  }
}

/** A never-call-me provider, for same-currency tests that must prove the FX path was not entered at all. */
export const unreachableFxRateProvider: FxRateProvider = {
  async getBulletin(): Promise<FxBulletin> {
    throw new Error("unreachableFxRateProvider.getBulletin() was called — the same-currency path must never fetch FX.");
  },
};
