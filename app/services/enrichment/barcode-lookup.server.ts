import {
  getCachedData,
  setCachedData,
  cacheKey,
  BARCODE_CACHE_TTL,
} from "../redis.server";

export interface BarcodeData {
  name: string;
  description: string;
  brand: string;
  category: string;
  imageUrl: string | null;
  specs: Record<string, string>;
  source: "go-upc" | "upcitemdb";
}

export async function lookupBarcode(
  barcode: string,
): Promise<BarcodeData | null> {
  // Check cache first
  const cached = await getCachedData(cacheKey("barcode", barcode));
  if (cached) {
    return JSON.parse(cached) as BarcodeData;
  }

  // Try Go-UPC first, then UPCitemdb as fallback
  let data = await goUpcLookup(barcode);
  if (!data) {
    data = await upcItemDbLookup(barcode);
  }

  // Cache result
  if (data) {
    await setCachedData(
      cacheKey("barcode", barcode),
      JSON.stringify(data),
      BARCODE_CACHE_TTL,
    );
  }

  return data;
}

async function goUpcLookup(barcode: string): Promise<BarcodeData | null> {
  const apiKey = process.env.GO_UPC_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://go-upc.com/api/v1/code/${encodeURIComponent(barcode)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      if (response.status === 429) {
        return null; // Rate limited, silently skip
      }
      throw new Error(`Go-UPC error: ${response.status}`);
    }

    const json = await response.json();
    const product = json.product;
    if (!product) return null;

    return {
      name: product.name || "",
      description: product.description || "",
      brand: product.brand || "",
      category: product.category || "",
      imageUrl: product.imageUrl || null,
      specs: product.specs || {},
      source: "go-upc",
    };
  } catch (error) {
    console.error("[barcode] Go-UPC lookup failed:", error);
    return null;
  }
}

async function upcItemDbLookup(barcode: string): Promise<BarcodeData | null> {
  try {
    const response = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
      {
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      if (response.status === 429) {
        return null; // Rate limited, silently skip
      }
      return null;
    }

    const json = await response.json();
    const item = json.items?.[0];
    if (!item) return null;

    return {
      name: item.title || "",
      description: item.description || "",
      brand: item.brand || "",
      category: item.category || "",
      imageUrl: item.images?.[0] || null,
      specs: {
        ...(item.dimension ? { dimensions: item.dimension } : {}),
        ...(item.weight ? { weight: item.weight } : {}),
        ...(item.model ? { model: item.model } : {}),
      },
      source: "upcitemdb",
    };
  } catch (error) {
    console.error("[barcode] UPCitemdb lookup failed:", error);
    return null;
  }
}
