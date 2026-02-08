import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { getRedis } from "../services/redis.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const checks: Record<string, "ok" | "error"> = {
    app: "ok",
    database: "error",
    redis: "error",
  };

  // Check database (5s timeout)
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB timeout")), 5000),
      ),
    ]);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  // Check Redis (5s timeout)
  try {
    const redis = getRedis();
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis timeout")), 5000),
      ),
    ]);
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }

  const allHealthy = Object.values(checks).every((v) => v === "ok");

  return json(
    {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allHealthy ? 200 : 503 },
  );
};
