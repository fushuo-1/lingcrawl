// Control-flow signal errors used internally by the scraper.
// These do NOT extend TransportableError — they are used for internal
// control flow (e.g. feature-flag adjustment, waterfall timing) and are
// never returned to clients.

import type { Meta } from "./meta";
import type { Engine, FeatureFlag } from "./engines";

export class AddFeatureError extends Error {
  public featureFlags: FeatureFlag[];
  public pdfPrefetch: Meta["pdfPrefetch"];
  public documentPrefetch: Meta["documentPrefetch"];

  constructor(
    featureFlags: FeatureFlag[],
    pdfPrefetch?: Meta["pdfPrefetch"],
    documentPrefetch?: Meta["documentPrefetch"],
  ) {
    super("New feature flags have been discovered: " + featureFlags.join(", "));
    this.featureFlags = featureFlags;
    this.pdfPrefetch = pdfPrefetch;
    this.documentPrefetch = documentPrefetch;
  }
}

export class RemoveFeatureError extends Error {
  public featureFlags: FeatureFlag[];

  constructor(featureFlags: FeatureFlag[]) {
    super(
      "Incorrect feature flags have been discovered: " +
        featureFlags.join(", "),
    );
    this.featureFlags = featureFlags;
  }
}

export class EngineError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class IndexMissError extends Error {
  constructor() {
    super("Index doesn't have the page we're looking for");
  }
}

export class FEPageLoadFailed extends Error {
  constructor() {
    super(
      "The page failed to load with the specified timeout. Please increase the timeout parameter in your request.",
    );
  }
}

export class EngineSnipedError extends Error {
  name = "EngineSnipedError";

  constructor() {
    super("Engine got sniped");
  }
}

export class EngineUnsuccessfulError extends Error {
  name = "EngineUnsuccessfulError";

  constructor(engine: Engine) {
    super(`Engine ${engine} was unsuccessful`);
  }
}

export class WaterfallNextEngineSignal extends Error {
  name = "WaterfallNextEngineSignal";

  constructor() {
    super("Waterfall next engine");
  }
}
