/**
 * Unit tests for financial memory validators (issue #99).
 */
import { validateRequiredFields } from "../../validators.js";
import { FinancialValidationError } from "../../errors.js";
import type { CreateFinancialMemoryInput, EntityType } from "../../types.js";

describe("validateRequiredFields", () => {
  it("passes for a complete opinion", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "opinion",
        ticker: "AAPL",
        direction: "bullish",
        timeHorizon: "medium",
        confidence: 4,
      }),
    ).not.toThrow();
  });

  it("throws for missing opinion fields", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "opinion",
        ticker: "AAPL",
        direction: "bullish",
        // missing timeHorizon, confidence
      } as CreateFinancialMemoryInput),
    ).toThrow(FinancialValidationError);
  });

  it("throws for empty string opinion fields", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "opinion",
        ticker: "AAPL",
        direction: "bullish",
        timeHorizon: "",
        confidence: 4,
      }),
    ).toThrow(/timeHorizon/);
  });

  it("passes for a complete strategy", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "strategy",
        name: "Momentum",
        assetClass: "stock",
      }),
    ).not.toThrow();
  });

  it("throws for missing strategy fields", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "strategy",
        name: "Momentum",
      } as CreateFinancialMemoryInput),
    ).toThrow(FinancialValidationError);
  });

  it("passes for a complete position", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "position",
        ticker: "TSLA",
        positionStatus: "holding",
        quantity: 100,
      }),
    ).not.toThrow();
  });

  it("throws for missing position fields", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "position",
        ticker: "TSLA",
      } as CreateFinancialMemoryInput),
    ).toThrow(FinancialValidationError);
  });

  it("passes for a complete lesson", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "lesson",
        title: "Don't chase pumps",
        lessonCategory: "mistake",
      }),
    ).not.toThrow();
  });

  it("throws for missing lesson fields", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "lesson",
        title: "Don't chase pumps",
      } as CreateFinancialMemoryInput),
    ).toThrow(FinancialValidationError);
  });

  it("throws for unknown entity_type", () => {
    expect(() =>
      validateRequiredFields({
        entityType: "unknown" as EntityType,
      } as CreateFinancialMemoryInput),
    ).toThrow(/Unknown entity_type/);
  });
});
