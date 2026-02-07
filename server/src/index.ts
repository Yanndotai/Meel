import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type Express } from "express";
import { widgetsDevServer } from "skybridge/server";
import type { ViteDevServer } from "vite";
import { mcp } from "./middleware.js";
import server, { getFillCartProgress } from "./server.js";

const app = express() as Express & { vite: ViteDevServer };

app.use(express.json());

app.get("/api/fill-cart/progress/:jobId", (req, res) => {
  const progress = getFillCartProgress(req.params.jobId);
  if (!progress) {
    res.status(404).json({ error: "Job not found or expired" });
    return;
  }
  res.json({
    status: progress.status,
    added_products: progress.added_products,
    failed_products: progress.failed_products,
    cart_url: progress.cart_url,
    error: progress.error,
    current_product: progress.current_product,
  });
});

app.use(mcp(server));

const env = process.env.NODE_ENV || "development";

if (env !== "production") {
  const { devtoolsStaticServer } = await import("@skybridge/devtools");
  app.use(await devtoolsStaticServer());
  app.use(await widgetsDevServer());
}

if (env === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  app.use("/assets", cors());
  app.use("/assets", express.static(path.join(__dirname, "assets")));
}

app.listen(3000, (error) => {
  if (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

process.on("SIGINT", async () => {
  console.log("Server shutdown complete");
  process.exit(0);
});
