import { ZodError, ZodIssue } from "zod";
import { TransportableError } from "../../lib/error";
import { withErrorHandler } from "../../controllers/error-wrapper";

function mockReqRes() {
  const req = {} as any;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as any;
  return { req, res };
}

describe("withErrorHandler", () => {
  it("passes through when handler succeeds without error", async () => {
    const { req, res } = mockReqRes();
    const handler = withErrorHandler(async (_req, res) => {
      res.status(200).json({ success: true });
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it("returns 400 with validation details on ZodError", async () => {
    const { req, res } = mockReqRes();

    const issues: ZodIssue[] = [
      {
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["url"],
        message: "Required",
      },
      {
        code: "too_small",
        minimum: 0,
        type: "number",
        inclusive: true,
        exact: false,
        path: ["timeout"],
        message: "Number must be greater than 0",
      },
    ];

    const zodError = new ZodError(issues);

    const handler = withErrorHandler(async () => {
      throw zodError;
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: "Invalid request body",
        details: [
          { path: "url", message: "Required" },
          { path: "timeout", message: "Number must be greater than 0" },
        ],
      },
    });
  });

  it("returns mapped status code for TransportableError (timeout -> 408)", async () => {
    const { req, res } = mockReqRes();
    const error = new TransportableError("SCRAPE_TIMEOUT", "scrape timed out");

    const handler = withErrorHandler(async () => {
      throw error;
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: "scrape timed out",
        code: "SCRAPE_TIMEOUT",
      },
    });
  });

  it("returns 500 for TransportableError with unmapped code", async () => {
    const { req, res } = mockReqRes();
    const error = new TransportableError("UNKNOWN_ERROR", "something broke");

    const handler = withErrorHandler(async () => {
      throw error;
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: "something broke",
        code: "UNKNOWN_ERROR",
      },
    });
  });

  it("returns 400 for BAD_REQUEST TransportableError", async () => {
    const { req, res } = mockReqRes();
    const error = new TransportableError("BAD_REQUEST", "bad input");

    const handler = withErrorHandler(async () => {
      throw error;
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: "bad input",
        code: "BAD_REQUEST",
      },
    });
  });

  it("returns 403 for CRAWL_DENIAL TransportableError", async () => {
    const { req, res } = mockReqRes();
    const error = new TransportableError("CRAWL_DENIAL", "denied");

    const handler = withErrorHandler(async () => {
      throw error;
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: "denied",
        code: "CRAWL_DENIAL",
      },
    });
  });

  it("returns 408 for generic timeout Error", async () => {
    const { req, res } = mockReqRes();
    const error = new Error("connection timeout occurred");

    const handler = withErrorHandler(async () => {
      throw error;
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: "Request timed out",
      },
    });
  });

  it("returns 500 for unknown errors", async () => {
    const { req, res } = mockReqRes();
    const error = new Error("something unexpected");

    const handler = withErrorHandler(async () => {
      throw error;
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: "Internal server error",
      },
    });
  });

  it("returns 500 for non-Error thrown values", async () => {
    const { req, res } = mockReqRes();

    const handler = withErrorHandler(async () => {
      throw "string error";
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: "Internal server error",
      },
    });
  });
});
