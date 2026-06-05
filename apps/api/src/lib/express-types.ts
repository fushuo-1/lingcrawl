/**
 * Express-compatible type shim.
 *
 * Allows the existing Express-style controllers to compile and run when
 * invoked through the Fastify `adapt()` wrapper in `routes/api.ts`.
 *
 * The shim mirrors Express's type parameter order:
 *   Request<P = {}, ResBody = any, ReqBody = any, ReqQuery = ParsedQs>
 *   Response<ResBody = any, Locals = Record<string, any>>
 *
 * The `adapt()` wrapper casts Fastify's `request`/`reply` into these types
 * and provides equivalents for the Express surface used by controllers:
 *   `req.body`, `req.headers`, `req.params`, `req.query`, `req.acuc`,
 *   `req.on(...)`, `req.get(...)`,
 *   `res.status(n).json(...)`, `res.status(n).send(...)`.
 */

type Sendable = unknown;

export interface Request<
  P = Record<string, string>,
  ResBody = any,
  ReqBody = any,
  ReqQuery = Record<string, string | string[] | undefined>,
> {
  body: ReqBody;
  headers: Record<string, string | string[] | undefined>;
  params: P;
  query: ReqQuery;
  method: string;
  url: string;
  acuc?: { team_id?: string; [key: string]: unknown };
  on(event: string, listener: (...args: any[]) => void): unknown;
  get(name: string): string | undefined;
  [key: string]: unknown;
}

export interface Response<ResBody = any> {
  status(code: number): Response<ResBody>;
  json(body: ResBody | Sendable): Response<ResBody> | void;
  send(body?: Sendable): Response<ResBody> | void;
  setHeader(name: string, value: string): void;
  [key: string]: unknown;
}
