import express from "express";
// [REMOVED] All admin routes - not needed for self-hosted
// Original routes: redis-health, acuc-cache-clear, feng-check, cclog, zdrcleaner,
// index-queue-prometheus, precrawl, metrics, nuq-metrics, fsearch,
// concurrency-queue-backfill, crawl-monitor, integration endpoints

export const adminRouter = express.Router();

// All admin routes removed for self-hosted deployment
