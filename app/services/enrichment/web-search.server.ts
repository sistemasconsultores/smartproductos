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

const providers: SearchProvider[] = [serpApiSearch, serperSearch, googleCustomSearch];

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

  console.log(`[search] Query: "${query}" | Providers: SERPAPI_KEY=${process.env.SERPAPI_KEY ? "set" : "unset"}, SERPER_API_KEY=${process.env.SERPER_API_KEY ? "set" : "unset"}, GOOGLE_SEARCH_API_KEY=${process.env.GOOGLE_SEARCH_API_KEY ? "set" : "unset"}, GOOGLE_SEARCH_CX=${process.env.GOOGLE_SEARCH_CX ? "set" : "unset"}`);

  let results: SearchResult[] = [];
  for (const provider of providers) {
    results = await provider(query);
    if (results.length > 0) {
      console.log(`[search] Got ${results.length} results from ${provider.name}`);
      break;
    }
  }

  if (results.length === 0) {
    console.log(`[search] All providers returned 0 results for: "${query}"`);
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

    if (!response.ok) return [];

    const json: { organic_results?: { title: string; snippet: string; link: string }[] } =
      await response.json();

    return (json.organic_results ?? []).map((item) => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link,
    }));
  } catch {
    return [];
  }
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

    if (!response.ok) return [];

    const json: { organic?: { title: string; snippet: string; link: string }[] } =
      await response.json();

    return (json.organic ?? []).map((item) => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link,
    }));
  } catch {
    return [];
  }
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
      const errorBody = await response.text().catch(() => "unable to read body");
      console.error(`[search] Google Custom Search ${response.status}: ${errorBody}`);
      return [];
    }

    const json: { items?: { title: string; snippet: string; link: string }[] } =
      await response.json();

    console.log(`[search] Google Custom Search returned ${json.items?.length ?? 0} items`);
    return (json.items ?? []).map((item) => ({
      title: item.title,
      snippet: item.snippet,
      link: item.link,
    }));
  } catch (error) {
    console.error(`[search] Google Custom Search exception:`, error instanceof Error ? error.message : error);
    return [];
  }
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}
