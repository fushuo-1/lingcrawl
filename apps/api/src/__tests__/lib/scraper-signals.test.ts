import {
  AddFeatureError,
  RemoveFeatureError,
  EngineError,
  IndexMissError,
  FEPageLoadFailed,
  EngineSnipedError,
  EngineUnsuccessfulError,
  WaterfallNextEngineSignal,
} from "../../scraper/scrapeURL/signals";
import { TransportableError } from "../../lib/error";
import { Engine } from "../../scraper/scrapeURL/engines";

describe("scraper control-flow signals (signals.ts)", () => {
  describe("inheritance", () => {
    it("AddFeatureError extends plain Error, NOT TransportableError", () => {
      const err = new AddFeatureError(["screenshot"]);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AddFeatureError);
      expect(err).not.toBeInstanceOf(TransportableError);
    });

    it("RemoveFeatureError extends plain Error, NOT TransportableError", () => {
      const err = new RemoveFeatureError(["actions"]);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(RemoveFeatureError);
      expect(err).not.toBeInstanceOf(TransportableError);
    });

    it("EngineError extends plain Error, NOT TransportableError", () => {
      const err = new EngineError("boom");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(EngineError);
      expect(err).not.toBeInstanceOf(TransportableError);
    });

    it("IndexMissError extends plain Error, NOT TransportableError", () => {
      const err = new IndexMissError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(IndexMissError);
      expect(err).not.toBeInstanceOf(TransportableError);
    });

    it("FEPageLoadFailed extends plain Error, NOT TransportableError", () => {
      const err = new FEPageLoadFailed();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(FEPageLoadFailed);
      expect(err).not.toBeInstanceOf(TransportableError);
    });

    it("EngineSnipedError extends plain Error, NOT TransportableError", () => {
      const err = new EngineSnipedError();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(EngineSnipedError);
      expect(err).not.toBeInstanceOf(TransportableError);
    });

    it("EngineUnsuccessfulError extends plain Error, NOT TransportableError", () => {
      const err = new EngineUnsuccessfulError("fetch" as Engine);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(EngineUnsuccessfulError);
      expect(err).not.toBeInstanceOf(TransportableError);
    });

    it("WaterfallNextEngineSignal extends plain Error, NOT TransportableError", () => {
      const err = new WaterfallNextEngineSignal();
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(WaterfallNextEngineSignal);
      expect(err).not.toBeInstanceOf(TransportableError);
    });
  });

  describe("throw and catch via instanceof", () => {
    it("AddFeatureError can be thrown and caught by instanceof", () => {
      try {
        throw new AddFeatureError(["pdf"]);
      } catch (e) {
        expect(e).toBeInstanceOf(AddFeatureError);
        expect((e as AddFeatureError).featureFlags).toEqual(["pdf"]);
      }
    });

    it("RemoveFeatureError can be thrown and caught by instanceof", () => {
      try {
        throw new RemoveFeatureError(["location"]);
      } catch (e) {
        expect(e).toBeInstanceOf(RemoveFeatureError);
        expect((e as RemoveFeatureError).featureFlags).toEqual(["location"]);
      }
    });

    it("EngineError can be thrown and caught by instanceof", () => {
      try {
        throw new EngineError("engine failed");
      } catch (e) {
        expect(e).toBeInstanceOf(EngineError);
        expect((e as EngineError).message).toBe("engine failed");
      }
    });

    it("WaterfallNextEngineSignal can be thrown and caught by instanceof", () => {
      try {
        throw new WaterfallNextEngineSignal();
      } catch (e) {
        expect(e).toBeInstanceOf(WaterfallNextEngineSignal);
      }
    });

    it("IndexMissError can be thrown and caught by instanceof", () => {
      try {
        throw new IndexMissError();
      } catch (e) {
        expect(e).toBeInstanceOf(IndexMissError);
      }
    });

    it("FEPageLoadFailed can be thrown and caught by instanceof", () => {
      try {
        throw new FEPageLoadFailed();
      } catch (e) {
        expect(e).toBeInstanceOf(FEPageLoadFailed);
      }
    });
  });

  describe("none have a serialize() method (internal signals)", () => {
    it("AddFeatureError has no serialize()", () => {
      const err = new AddFeatureError(["screenshot"]);
      expect(typeof (err as any).serialize).toBe("undefined");
    });

    it("RemoveFeatureError has no serialize()", () => {
      const err = new RemoveFeatureError(["actions"]);
      expect(typeof (err as any).serialize).toBe("undefined");
    });

    it("EngineError has no serialize()", () => {
      const err = new EngineError();
      expect(typeof (err as any).serialize).toBe("undefined");
    });

    it("IndexMissError has no serialize()", () => {
      const err = new IndexMissError();
      expect(typeof (err as any).serialize).toBe("undefined");
    });

    it("FEPageLoadFailed has no serialize()", () => {
      const err = new FEPageLoadFailed();
      expect(typeof (err as any).serialize).toBe("undefined");
    });

    it("EngineSnipedError has no serialize()", () => {
      const err = new EngineSnipedError();
      expect(typeof (err as any).serialize).toBe("undefined");
    });

    it("EngineUnsuccessfulError has no serialize()", () => {
      const err = new EngineUnsuccessfulError("fetch" as Engine);
      expect(typeof (err as any).serialize).toBe("undefined");
    });

    it("WaterfallNextEngineSignal has no serialize()", () => {
      const err = new WaterfallNextEngineSignal();
      expect(typeof (err as any).serialize).toBe("undefined");
    });

    it("none have a `code` property (unlike TransportableError)", () => {
      const errors = [
        new AddFeatureError([]),
        new RemoveFeatureError([]),
        new EngineError(),
        new IndexMissError(),
        new FEPageLoadFailed(),
        new EngineSnipedError(),
        new EngineUnsuccessfulError("fetch" as Engine),
        new WaterfallNextEngineSignal(),
      ];
      for (const e of errors) {
        expect((e as any).code).toBeUndefined();
      }
    });
  });

  describe("payload fields", () => {
    it("AddFeatureError stores featureFlags, pdfPrefetch, documentPrefetch", () => {
      const err = new AddFeatureError(
        ["pdf", "screenshot"],
        { status: "fulfilled", url: "https://x.com/file.pdf" } as any,
        { status: "fulfilled", url: "https://x.com/file.docx" } as any,
      );
      expect(err.featureFlags).toEqual(["pdf", "screenshot"]);
      expect(err.pdfPrefetch).toBeDefined();
      expect(err.documentPrefetch).toBeDefined();
    });

    it("RemoveFeatureError stores featureFlags", () => {
      const err = new RemoveFeatureError(["actions", "waitFor"]);
      expect(err.featureFlags).toEqual(["actions", "waitFor"]);
    });

    it("EngineUnsuccessfulError includes engine name in message", () => {
      const err = new EngineUnsuccessfulError("playwright" as Engine);
      expect(err.message).toContain("playwright");
    });

    it("EngineSnipedError and WaterfallNextEngineSignal have correct names", () => {
      expect(new EngineSnipedError().name).toBe("EngineSnipedError");
      expect(new WaterfallNextEngineSignal().name).toBe("WaterfallNextEngineSignal");
    });
  });
});
