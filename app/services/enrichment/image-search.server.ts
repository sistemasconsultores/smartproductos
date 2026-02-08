import { createHash } from "node:crypto";
import {
  getCachedData,
  setCachedData,
  cacheKey,
  SEARCH_CACHE_TTL,
} from "../redis.server";

export interface ImageResult {
  url: string;
  width: number;
  height: number;
  title: string;
}

export async function searchProductImages(
  title: string,
  brand: string,
  sku: string | null,
): Promise<ImageResult[]> {
  const query = `${title} ${brand} ${sku || ""} product photo official`.trim();
  const hash = createHash("md5").update(query).digest("hex");

  const cached = await getCachedData(cacheKey("images", hash));
  if (cached) {
    return JSON.parse(cached) as ImageResult[];
  }

  const results = await serperImageSearch(query);

  // Filter for minimum quality: at least one dimension >= 800, or unknown dimensions accepted
  const filtered = results.filter((img) => {
    // Accept images with unknown dimensions (Serper sometimes omits width/height)
    if (img.width === 0 && img.height === 0) return true;
    // Accept if the larger dimension is >= 800 (handles landscape and portrait)
    return Math.max(img.width, img.height) >= 800;
  });

  console.log(`[images] Query: "${query}" -> ${results.length} raw, ${filtered.length} after quality filter`);

  if (filtered.length > 0) {
    await setCachedData(
      cacheKey("images", hash),
      JSON.stringify(filtered),
      SEARCH_CACHE_TTL,
    );
  }

  return filtered;
}

async function serperImageSearch(query: string): Promise<ImageResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 10 }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unable to read body");
      console.error(`[images] Serper Images ${response.status}: ${errorBody}`);
      return [];
    }

    const json: {
      images?: {
        title: string;
        imageUrl: string;
        imageWidth: number;
        imageHeight: number;
      }[];
    } = await response.json();

    const images = json.images ?? [];
    console.log(`[images] Serper returned ${images.length} images`);

    return images.map((item) => ({
      url: item.imageUrl,
      width: item.imageWidth || 0,
      height: item.imageHeight || 0,
      title: item.title || "",
    }));
  } catch (error) {
    console.error(`[images] Serper exception:`, error instanceof Error ? error.message : error);
    return [];
  }
}
