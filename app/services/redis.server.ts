import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379/3", {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return redis;
}

const SEARCH_CACHE_TTL = 604800; // 7 days

export async function getCachedData(key: string): Promise<string | null> {
  return getRedis().get(key);
}

export async function setCachedData(
  key: string,
  data: string,
  ttlSeconds: number,
): Promise<void> {
  await getRedis().set(key, data, "EX", ttlSeconds);
}

export function cacheKey(type: "search" | "images", id: string) {
  return `cache:${type}:${id}`;
}

export { SEARCH_CACHE_TTL };
