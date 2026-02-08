import { createHash } from "node:crypto";
import {
  getCachedData,
  setCachedData,
  cacheKey,
  SEARCH_CACHE_TTL,
} from "../redis.server";
import {
  googleSearchDisabledUntil,
  setGoogleSearchDisabled,
} from "./web-search.server";

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

  const results = await googleImageSearch(query);

  // Filter for minimum quality: 1024x1024
  const filtered = results.filter(
    (img) => img.width >= 1024 && img.height >= 1024,
  );

  if (filtered.length > 0) {
    await setCachedData(
      cacheKey("images", hash),
      JSON.stringify(filtered),
      SEARCH_CACHE_TTL,
    );
  }

  return filtered;
}

async function googleImageSearch(query: string): Promise<ImageResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) return [];

  // Share circuit breaker with web-search (same Google API key and quota)
  if (Date.now() < googleSearchDisabledUntil) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: query,
      searchType: "image",
      imgSize: "xlarge",
      num: "5",
    });

    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        setGoogleSearchDisabled(Date.now() + 3600000);
        console.warn(
          `[images] Google Image Search ${response.status} — disabled for 1 hour`,
        );
      }
      return [];
    }

    const json = await response.json();
    const items = json.items || [];

    return items.map(
      (item: {
        link: string;
        image: { width: number; height: number };
        title: string;
      }) => ({
        url: item.link,
        width: item.image?.width || 0,
        height: item.image?.height || 0,
        title: item.title || "",
      }),
    );
  } catch (error) {
    console.error("[images] Google Image Search failed:", error);
    return [];
  }
}
