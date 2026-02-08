import { createHash } from "node:crypto";
import {
  getCachedData,
  setCachedData,
  cacheKey,
  SEARCH_CACHE_TTL,
} from "../redis.server";

export interface SearchResult {
  title: string;
  snippet: string;
  link: string;
}

export async function searchBySkuOrTitle(
  sku: string | null,
  title: string,
  brand: string,
): Promise<SearchResult[]> {
  const query = sku
    ? `${sku} ${brand} specifications ficha tecnica`
    : `${title} ${brand} ficha tecnica especificaciones`;

  const hash = md5(query);
  const cached = await getCachedData(cacheKey("search", hash));
  if (cached) {
    return JSON.parse(cached) as SearchResult[];
  }

  const results = await googleCustomSearch(query);

  if (results.length > 0) {
    await setCachedData(
      cacheKey("search", hash),
      JSON.stringify(results),
      SEARCH_CACHE_TTL,
    );
  }

  return results;
}

async function googleCustomSearch(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) return [];

  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: query,
      num: "5",
    });

    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!response.ok) {
      if (response.status === 429 || response.status === 403) {
        // 403 = quota exceeded or API key issue, 429 = rate limited
        // Both are non-fatal, just skip search
        return [];
      }
      console.warn(`[search] Google Search error: ${response.status}`);
      return [];
    }

    const json = await response.json();
    const items = json.items || [];

    return items.map(
      (item: { title: string; snippet: string; link: string }) => ({
        title: item.title,
        snippet: item.snippet,
        link: item.link,
      }),
    );
  } catch {
    // Search is non-critical, silently return empty
    return [];
  }
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}
