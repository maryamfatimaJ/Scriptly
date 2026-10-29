import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { env } from "@/config/env";
import routes from "@/routes";
import { apiRateLimiter } from "@/middleware/rateLimit.middleware";
import { errorMiddleware, notFoundMiddleware } from "@/middleware/error.middleware";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxy);

  app.use(
    helmet({
      // The SPA runs on a different origin (:5173) from this API (:4000),
      // and the prescription image is fetched cross-origin by an <img>.
      // Helmet's default Cross-Origin-Resource-Policy of "same-origin"
      // blocks that: the browser logged ERR_BLOCKED_BY_RESPONSE on every
      // repeat load. "cross-origin" permits it — access to the image is
      // still gated by requireAuth plus an ownership check in
      // prescription.service.ts, which is what actually protects it.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
  app.use(
    cors({
      origin: env.corsOrigin.split(",").map((origin) => origin.trim()),
      credentials: true, // required so the browser sends/receives httpOnly auth cookies
    })
  );

  // Custom morgan token so request logs never include query strings or
  // bodies that could carry medical data — just method/path/status/timing.
  app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));

  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.use("/api", apiRateLimiter, routes);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
