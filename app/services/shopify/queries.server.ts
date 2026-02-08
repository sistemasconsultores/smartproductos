import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// CRITICAL: NEVER include price, compareAtPrice, or cost fields
const PRODUCTS_FOR_ENRICHMENT_QUERY = `#graphql
  query GetProductsForEnrichment($cursor: String, $query: String) {
    products(first: 50, after: $cursor, query: $query) {
      edges {
        node {
          id
          title
          handle
          descriptionHtml
          productType
          vendor
          tags
          status
          totalInventory
          category {
            id
            name
            fullName
          }
          seo {
            title
            description
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                sku
                barcode
                inventoryQuantity
              }
            }
          }
          images(first: 10) {
            edges {
              node {
                id
                url
                altText
                width
                height
              }
            }
          }
          metafields(first: 30) {
            edges {
              node {
                id
                namespace
                key
                value
                type
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const SINGLE_PRODUCT_QUERY = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      descriptionHtml
      productType
      vendor
      tags
      status
      totalInventory
      category {
        id
        name
        fullName
      }
      seo {
        title
        description
      }
      variants(first: 10) {
        edges {
          node {
            id
            title
            sku
            barcode
            inventoryQuantity
          }
        }
      }
      images(first: 10) {
        edges {
          node {
            id
            url
            altText
            width
            height
          }
        }
      }
      metafields(first: 30) {
        edges {
          node {
            id
            namespace
            key
            value
            type
          }
        }
      }
    }
  }
`;

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: string;
  totalInventory: number;
  category: { id: string; name: string; fullName: string } | null;
  seo: { title: string; description: string };
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        sku: string | null;
        barcode: string | null;
        inventoryQuantity: number;
      };
    }>;
  };
  images: {
    edges: Array<{
      node: {
        id: string;
        url: string;
        altText: string | null;
        width: number;
        height: number;
      };
    }>;
  };
  metafields: {
    edges: Array<{
      node: {
        id: string;
        namespace: string;
        key: string;
        value: string;
        type: string;
      };
    }>;
  };
}

interface ProductsResponse {
  products: {
    edges: Array<{ node: ShopifyProduct }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export async function fetchProductsForEnrichment(
  admin: AdminApiContext,
  cursor?: string,
  query?: string,
): Promise<{
  products: ShopifyProduct[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}> {
  const response = await admin.graphql(PRODUCTS_FOR_ENRICHMENT_QUERY, {
    variables: {
      cursor: cursor || null,
      query: query || "status:active",
    },
  });

  const json = await response.json();
  const data = json.data as ProductsResponse | null;

  if (!data?.products) {
    const errors = (json as Record<string, unknown>).errors;
    throw new Error(
      `Shopify GraphQL query failed: ${JSON.stringify(errors || "No data returned")}`,
    );
  }

  return {
    products: data.products.edges.map((edge) => edge.node),
    pageInfo: data.products.pageInfo,
  };
}

export async function fetchSingleProduct(
  admin: AdminApiContext,
  productId: string,
): Promise<ShopifyProduct | null> {
  const response = await admin.graphql(SINGLE_PRODUCT_QUERY, {
    variables: { id: productId },
  });

  const json = await response.json();
  const data = json.data as { product: ShopifyProduct | null } | null;

  if (!data) {
    const errors = (json as Record<string, unknown>).errors;
    throw new Error(
      `Shopify GraphQL query failed: ${JSON.stringify(errors || "No data returned")}`,
    );
  }

  return data.product ?? null;
}

export async function fetchAllActiveProducts(
  admin: AdminApiContext,
  maxProducts: number = 50,
): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let cursor: string | undefined;
  let hasNextPage = true;

  while (hasNextPage && allProducts.length < maxProducts) {
    const { products, pageInfo } = await fetchProductsForEnrichment(
      admin,
      cursor,
      "status:active",
    );

    allProducts.push(...products);
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor ?? undefined;
  }

  return allProducts.slice(0, maxProducts);
}
