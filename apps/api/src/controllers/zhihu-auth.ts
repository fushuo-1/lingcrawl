import { Request, Response } from "../lib/express-types";
import { withErrorHandler } from "./error-wrapper";
import { config } from "../config";
import { logger } from "../lib/logger";
import * as fs from "fs";
import * as path from "path";
import { clearCookieExpired } from "../scraper/scrapeURL/postprocessors/zhihu";

const log = logger.child({ module: "zhihu-auth" });

const ENV_PATH = path.resolve(process.cwd(), "../../.env");

/**
 * Update ZHIHU_COOKIE in the .env file and runtime config.
 */
function updateCookieEnv(cookie: string) {
  try {
    let envContent = "";
    if (fs.existsSync(ENV_PATH)) {
      envContent = fs.readFileSync(ENV_PATH, "utf-8");
    }

    // Replace or add ZHIHU_COOKIE
    if (envContent.includes("ZHIHU_COOKIE=")) {
      envContent = envContent.replace(
        /^ZHIHU_COOKIE=.*$/m,
        `ZHIHU_COOKIE=${cookie}`,
      );
    } else {
      envContent += `\nZHIHU_COOKIE=${cookie}\n`;
    }

    fs.writeFileSync(ENV_PATH, envContent, "utf-8");
    log.info("ZHIHU_COOKIE updated in .env");
  } catch (err) {
    log.warn("Failed to update .env, cookie only in memory", { error: err });
  }

  // Update runtime config (process.env)
  process.env.ZHIHU_COOKIE = cookie;
}

/**
 * POST /api/zhihu/qr-login/start
 * Start a QR login session. Returns a QR code image and session ID.
 */
export const zhihuQrLoginStart = withErrorHandler(
  async (_req: Request, res: Response) => {
    if (!config.PLAYWRIGHT_MICROSERVICE_URL) {
      return res.status(503).json({
        success: false,
        error: "Playwright microservice not configured",
      });
    }

    const pwUrl = config.PLAYWRIGHT_MICROSERVICE_URL.replace(/\/scrape$/, "");

    const response = await fetch(`${pwUrl}/qr-login/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "zhihu.com" }),
    });

    if (!response.ok) {
      const err = await response.text();
      log.warn("QR login start failed", { error: err });
      return res.status(502).json({ success: false, error: err });
    }

    const data = (await response.json()) as {
      sessionId: string;
      qrImage: string;
      expiresIn: number;
    };

    log.info("QR login session started", { sessionId: data.sessionId });
    return res.json({
      success: true,
      sessionId: data.sessionId,
      qrImage: data.qrImage,
      expiresIn: data.expiresIn,
    });
  },
);

/**
 * POST /api/zhihu/qr-login/poll
 * Poll for QR login completion. Returns cookies when done.
 */
export const zhihuQrLoginPoll = withErrorHandler(
  async (req: Request, res: Response) => {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) {
      return res.status(400).json({ success: false, error: "sessionId required" });
    }

    if (!config.PLAYWRIGHT_MICROSERVICE_URL) {
      return res.status(503).json({
        success: false,
        error: "Playwright microservice not configured",
      });
    }

    const pwUrl = config.PLAYWRIGHT_MICROSERVICE_URL.replace(/\/scrape$/, "");

    const response = await fetch(`${pwUrl}/qr-login/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ success: false, error: err });
    }

    const data = (await response.json()) as {
      status: string;
      cookies?: string;
      message?: string;
    };

    // If login successful, save cookies
    if (data.status === "done" && data.cookies) {
      updateCookieEnv(data.cookies);
      clearCookieExpired();
      log.info("Zhihu cookies saved via QR login, expired flag cleared");
    }

    return res.json({
      success: true,
      status: data.status,
      message: data.message,
      ...(data.cookies && { cookies: data.cookies }),
    });
  },
);

const COOKIE_STATUS_FILE = path.resolve(process.cwd(), "../../.zhihu-cookie-status");

/**
 * GET /api/zhihu/cookie-status
 * Check if zhihu cookies are valid or expired.
 */
export const zhihuCookieStatus = withErrorHandler(
  async (_req: Request, res: Response) => {
    let expired = false;
    let reason = "";
    let detectedAt = "";

    if (fs.existsSync(COOKIE_STATUS_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(COOKIE_STATUS_FILE, "utf-8"));
        expired = data.expired ?? false;
        reason = data.reason ?? "";
        detectedAt = data.detectedAt ?? "";
      } catch {
        // corrupted file, treat as not expired
      }
    }

    const hasCookie = !!config.ZHIHU_COOKIE;

    return res.json({
      success: true,
      hasCookie,
      cookieExpired: expired,
      reason,
      detectedAt,
      action: expired
        ? "请调用 POST /api/zhihu/qr-login/start 刷新 Cookie"
        : hasCookie
          ? "Cookie 正常"
          : "未配置 ZHIHU_COOKIE",
    });
  },
);
