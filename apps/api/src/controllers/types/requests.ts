import type { Request } from "../../lib/express-types";
import type {
  ScrapeRequest,
  ScrapeRequestInput,
  BatchScrapeRequest,
  BatchScrapeRequestInput,
  CrawlRequest,
  CrawlRequestInput,
  MapRequest,
  MapRequestInput,
  ExtractRequest,
  ExtractRequestInput,
  AgentRequest,
  SearchRequest,
  SearchRequestInput,
  ScrapeOptions,
  Action,
} from "../schemas";

export type {
  ScrapeRequest,
  ScrapeRequestInput,
  BatchScrapeRequest,
  BatchScrapeRequestInput,
  CrawlRequest,
  CrawlRequestInput,
  MapRequest,
  MapRequestInput,
  ExtractRequest,
  ExtractRequestInput,
  AgentRequest,
  SearchRequest,
  SearchRequestInput,
  ScrapeOptions,
  Action,
};

type AuthObject = {
  team_id: string;
};

type Account = {
  remainingCredits: number;
};

export interface RequestWithMaybeACUC<
  ReqParams = {},
  ReqBody = undefined,
  ResBody = undefined,
> extends Request<ReqParams, ReqBody, ResBody> {
  acuc?: AuthCreditUsageChunk;
}

export interface RequestWithAuth<
  ReqParams = {},
  ReqBody = undefined,
  ResBody = undefined,
> extends RequestWithMaybeACUC<ReqParams, ReqBody, ResBody> {
  auth: AuthObject;
  account?: Account;
}

export interface RequestWithMaybeAuth<
  ReqParams = {},
  ReqBody = undefined,
  ResBody = undefined,
> extends RequestWithMaybeACUC<ReqParams, ReqBody, ResBody> {
  auth?: { team_id: string };
  account?: { remainingCredits: number };
}

export type AuthCreditUsageChunk = any;
export type AuthCreditUsageChunkFromTeam = any;

export type InternalAction = Action & {
  metadata?: { [key: string]: unknown };
};

export type ScrapeOptionsV1 = ScrapeOptions;
