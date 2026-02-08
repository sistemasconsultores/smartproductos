// Create a standalone Shopify Admin API context for the worker process.
// Uses Node.js 20 built-in fetch instead of the Shopify SDK to avoid
// adapter issues when running outside the Remix server context.

const API_VERSION = "2025-01";

export function createAdminApiContext(shop: string, accessToken: string) {
  const endpoint = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

  console.log(
    `[worker-admin] Creating context for ${shop}, token: ${accessToken.slice(0, 8)}...${accessToken.slice(-4)}, endpoint: ${endpoint}`,
  );

  return {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => {
      console.log(
        `[worker-admin] Executing GraphQL query (${query.slice(0, 80).replace(/\s+/g, " ")}...)`,
      );

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

      const responseText = await response.text();

      console.log(
        `[worker-admin] Response status: ${response.status}, body preview: ${responseText.slice(0, 500)}`,
      );

      if (!response.ok) {
        throw new Error(
          `Shopify GraphQL HTTP error ${response.status}: ${responseText.slice(0, 300)}`,
        );
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Shopify returned non-JSON response: ${responseText.slice(0, 300)}`,
        );
      }

      // Log GraphQL errors for debugging
      if (data.errors) {
        console.error(
          `[worker-admin] GraphQL errors for ${shop}:`,
          JSON.stringify(data.errors, null, 2),
        );
      }

      return {
        json: async () => data,
      };
    },
  };
}
