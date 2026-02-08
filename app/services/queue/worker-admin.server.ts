// Create a standalone Shopify Admin API context for the worker process.
// Uses Node.js 20 built-in fetch instead of the Shopify SDK to avoid
// adapter issues when running outside the Remix server context.

const API_VERSION = "2025-01";

export function createAdminApiContext(shop: string, accessToken: string) {
  const endpoint = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

  return {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options?.variables || {},
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Shopify GraphQL error ${response.status}: ${text}`,
        );
      }

      const data = await response.json();

      return {
        json: async () => data,
      };
    },
  };
}
