import "dotenv/config";
import cors from "cors";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createApiRouter, type ApiRouterDeps } from "./server/apiRouter.ts";
import { validateEnvironmentConfig } from "./server/envConfig.ts";
import { logSecurityEvent } from "./server/logger.ts";

export function createExpressApp(apiDeps?: ApiRouterDeps): express.Express {
  const envConfig = validateEnvironmentConfig();
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Security headers compatible with AI Studio iframe & Firebase OAuth popup
  app.use(
    helmet({
      frameguard: false,
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": envConfig.isProduction
            ? ["'self'", "https://apis.google.com", "https://*.firebaseapp.com"]
            : ["'self'", "'unsafe-inline'", "https://apis.google.com", "https://*.firebaseapp.com"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "img-src": ["'self'", "data:", "blob:", "https://*.googleusercontent.com", "https://www.gstatic.com"],
          "connect-src": [
            "'self'",
            "https://*.googleapis.com",
            "https://*.firebaseio.com",
            "https://*.firebaseapp.com",
            "wss://*.firebaseio.com",
            "https://securetoken.googleapis.com",
            "https://identitytoolkit.googleapis.com",
          ],
          "frame-src": ["'self'", "https://*.firebaseapp.com", "https://accounts.google.com"],
          "frame-ancestors": [
            "'self'",
            "https://aistudio.google.com",
            "https://*.google.com",
            "https://*.googleusercontent.com",
          ],
        },
      },
    })
  );

  const allowedOrigins = envConfig.allowedOrigins;
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow same-origin requests with no Origin header (e.g., server/direct GET or same-host SPA assets)
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        // In non-production AI Studio preview subdomains, allow *.googleusercontent.com / *.run.app origin matching same preview
        if (
          !envConfig.isProduction &&
          /^https:\/\/[a-z0-9.-]+\.(?:googleusercontent\.com|run\.app|web\.app)$/i.test(origin)
        ) {
          callback(null, true);
          return;
        }
        callback(new Error("CORS_ORIGIN_NOT_ALLOWED"));
      },
      credentials: false,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      exposedHeaders: ["X-Avicena-Export-Sha256"],
      maxAge: 600,
    })
  );

  app.use((err: unknown, _req: Request, res: Response, next: express.NextFunction) => {
    if (err instanceof Error && err.message === "CORS_ORIGIN_NOT_ALLOWED") {
      res.status(403).json({ code: "CORS_FORBIDDEN", detail: "Origen no autorizado." });
      return;
    }
    next(err);
  });

  app.use("/api", createApiRouter(apiDeps));
  return app;
}

async function startServer() {
  const envConfig = validateEnvironmentConfig();
  const app = createExpressApp();
  const port = Number(process.env.PORT ?? 3000);
  const httpServer = http.createServer(app);

  if (!envConfig.isProduction) {
    const disableHmr = process.env.DISABLE_HMR === "true";
    if (disableHmr) {
      app.get("/@vite/client", (_req: Request, res: Response) => {
        res.type("application/javascript").send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) { return url; }
export class ErrorOverlay {}
`);
      });
    }

    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ...(disableHmr
          ? { hmr: false, ws: false }
          : { hmr: { server: httpServer }, ws: { server: httpServer } }),
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Build not found");
      }
    });
  }

  httpServer.listen(port, "0.0.0.0", () => {
    logSecurityEvent("info", "server_started", { port, env: process.env.APP_ENV || process.env.NODE_ENV || "development" });
  });
}

// Start HTTP server only when executed as entrypoint
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  startServer().catch((err) => {
    logSecurityEvent("error", "server_start_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
