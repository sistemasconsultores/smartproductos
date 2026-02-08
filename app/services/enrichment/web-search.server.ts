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

type SearchProvider = (query: string) => Promise<SearchResult[]>;

/** Search providers in priority order: Serper (primary), SerpAPI (fallback) */
const providers: SearchProvider[] = [serperSearch, serpApiSearch];

/**
 * Builds the search query using the product title as the primary search term.
 * SKU and barcode are internal provider codes (not UPC/EAN) - included as auxiliaries
 * to help narrow results when they exist.
 */
export async function searchBySkuOrTitle(
  sku: string | null,
  title: string,
  brand: string,
  barcode?: string | null,
): Promise<SearchResult[]> {
  // Clean title: remove common prefixes like "(CAJA ABIERTA)", "Repuesto", etc.
  const cleanTitle = title
    .replace(/^\(.*?\)\s*/g, "")
    .replace(/^Repuesto\s+/i, "")
    .trim();

  // Title is primary, SKU/barcode as optional auxiliary identifiers
  const auxiliaries = [sku, barcode].filter(Boolean).join(" ");
  const query = auxiliaries
    ? `${cleanTitle} ${auxiliaries} ficha tecnica especificaciones`
    : `${cleanTitle} ${brand} ficha tecnica especificaciones`;

  const hash = md5(query);
  const cached = await getCachedData(cacheKey("search", hash));
  if (cached) {
    return JSON.parse(cached) as SearchResult[];
  }

  console.log(
    `[search] Query: "${query}" | Providers: SERPER_API_KEY=${process.env.SERPER_API_KEY ? "set" : "unset"}, SERPAPI_KEY=${process.env.SERPAPI_KEY ? "set" : "unset"}`,
  );

  let results: SearchResult[] = [];
  for (const provider of providers) {
    results = await provider(query);
    if (results.length > 0) {
      console.log(`[search] Got ${results.length} results from ${provider.name}`);
      break;
    }
  }

  if (results.length === 0) {
    console.log(`[search] No results for: "${query}"`);
  }

  if (results.length > 0) {
    await setCachedData(
      cacheKey("search", hash),
      JSON.stringify(results),
      SEARCH_CACHE_TTL,
    );
  }

  return results;
}

async function serperSearch(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 5 }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unable to read body");
      console.error(`[search] Serper ${response.status}: ${errorBody}`);
      return [];
    }

    const json: { organic?: { title: string; snippet: string; link: string }[] } =
      await response.json();

    console.log(`[search] Serper returned ${json.organic?.length ?? 0} organic results`);
    return (json.organic ?? []).map((item) => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link,
    }));
  } catch (error) {
    console.error(`[search] Serper exception:`, error instanceof Error ? error.message : error);
    return [];
  }
}

async function serpApiSearch(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: apiKey,
      num: "5",
    });

    const response = await fetch(
      `https://serpapi.com/search.json?${params}`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unable to read body");
      console.error(`[search] SerpAPI ${response.status}: ${errorBody}`);
      return [];
    }

    const json: { organic_results?: { title: string; snippet: string; link: string }[] } =
      await response.json();

    console.log(`[search] SerpAPI returned ${json.organic_results?.length ?? 0} results`);
    return (json.organic_results ?? []).map((item) => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link,
    }));
  } catch (error) {
    console.error(`[search] SerpAPI exception:`, error instanceof Error ? error.message : error);
    return [];
  }
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}
