import "@shopify/shopify-app-remix/adapters/node";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

// Create a standalone Shopify API context for the worker process
// The worker doesn't go through Remix routes, so it needs its own API client

const api = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  scopes: (process.env.SCOPES || "").split(","),
  hostName: (process.env.SHOPIFY_APP_URL || "").replace("https://", ""),
  apiVersion: ApiVersion.January25,
  isEmbeddedApp: true,
});

export function createAdminApiContext(shop: string, accessToken: string) {
  const session = api.session.customAppSession(shop);
  session.accessToken = accessToken;

  const client = new api.clients.Graphql({ session });

  return {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      const response = await client.request(query, {
        variables: options?.variables,
      });
      return {
        json: async () => response.data,
      };
    },
  };
}
