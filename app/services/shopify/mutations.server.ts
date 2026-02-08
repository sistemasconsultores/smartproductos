import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// CRITICAL: NEVER include price, compareAtPrice, or cost in any mutation

const UPDATE_PRODUCT_MUTATION = `#graphql
  mutation UpdateProduct($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        descriptionHtml
        productType
        tags
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SET_METAFIELDS_MUTATION = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CREATE_MEDIA_MUTATION = `#graphql
  mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        ... on MediaImage {
          id
          image {
            url
            altText
          }
        }
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

export interface ProductUpdateInput {
  id: string;
  descriptionHtml?: string;
  productType?: string;
  tags?: string[];
  seo?: {
    title?: string;
    description?: string;
  };
}

export interface MetafieldInput {
  ownerId: string;
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export async function updateProduct(
  admin: AdminApiContext,
  input: ProductUpdateInput,
): Promise<{ success: boolean; errors: string[] }> {
  // Safety: strip any price fields that might accidentally be included
  const safeInput = { ...input };
  const dangerousKeys = ["variants", "price", "compareAtPrice", "cost"];
  for (const key of dangerousKeys) {
    delete (safeInput as Record<string, unknown>)[key];
  }

  const response = await admin.graphql(UPDATE_PRODUCT_MUTATION, {
    variables: { input: safeInput },
  });

  const json = await response.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = json.data as any;

  if (!data) {
    const gqlErrors = (json as Record<string, unknown>).errors;
    return {
      success: false,
      errors: [`Shopify GraphQL error: ${JSON.stringify(gqlErrors || "No data returned")}`],
    };
  }

  const errors = data.productUpdate?.userErrors ?? [];

  return {
    success: errors.length === 0,
    errors: errors.map(
      (e: { field: string; message: string }) =>
        `${e.field}: ${e.message}`,
    ),
  };
}

export async function setMetafields(
  admin: AdminApiContext,
  metafields: MetafieldInput[],
): Promise<{ success: boolean; errors: string[] }> {
  const response = await admin.graphql(SET_METAFIELDS_MUTATION, {
    variables: { metafields },
  });

  const json = await response.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = json.data as any;

  if (!data) {
    const gqlErrors = (json as Record<string, unknown>).errors;
    return {
      success: false,
      errors: [`Shopify GraphQL error: ${JSON.stringify(gqlErrors || "No data returned")}`],
    };
  }

  const errors = data.metafieldsSet?.userErrors ?? [];

  return {
    success: errors.length === 0,
    errors: errors.map(
      (e: { field: string; message: string }) =>
        `${e.field}: ${e.message}`,
    ),
  };
}

export async function addProductImages(
  admin: AdminApiContext,
  productId: string,
  images: Array<{ originalSource: string; alt: string }>,
): Promise<{ success: boolean; errors: string[] }> {
  const media = images.map((img) => ({
    originalSource: img.originalSource,
    alt: img.alt,
    mediaContentType: "IMAGE" as const,
  }));

  const response = await admin.graphql(CREATE_MEDIA_MUTATION, {
    variables: { productId, media },
  });

  const json = await response.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = json.data as any;

  if (!data) {
    const gqlErrors = (json as Record<string, unknown>).errors;
    return {
      success: false,
      errors: [`Shopify GraphQL error: ${JSON.stringify(gqlErrors || "No data returned")}`],
    };
  }

  const errors = data.productCreateMedia?.mediaUserErrors ?? [];

  return {
    success: errors.length === 0,
    errors: errors.map(
      (e: { field: string; message: string }) =>
        `${e.field}: ${e.message}`,
    ),
  };
}
