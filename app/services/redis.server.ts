import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379/2", {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return redis;
}

const BARCODE_CACHE_TTL = 2592000; // 30 days
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

export function cacheKey(type: "barcode" | "search" | "images", id: string) {
  return `cache:${type}:${id}`;
}

export { BARCODE_CACHE_TTL, SEARCH_CACHE_TTL };
