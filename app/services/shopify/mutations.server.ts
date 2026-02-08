import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// CRITICAL: NEVER include price, compareAtPrice, or cost in any mutation

interface UserError {
  field: string;
  message: string;
}

interface ProductUpdateResponse {
  data?: {
    productUpdate?: {
      userErrors: UserError[];
    };
  };
  errors?: unknown;
}

interface MetafieldsSetResponse {
  data?: {
    metafieldsSet?: {
      userErrors: UserError[];
    };
  };
  errors?: unknown;
}

interface ProductCreateMediaResponse {
  data?: {
    productCreateMedia?: {
      mediaUserErrors: UserError[];
    };
  };
  errors?: unknown;
}

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

  const json = (await response.json()) as ProductUpdateResponse;

  if (!json.data) {
    return {
      success: false,
      errors: [`Shopify GraphQL error: ${JSON.stringify(json.errors || "No data returned")}`],
    };
  }

  const errors = json.data.productUpdate?.userErrors ?? [];

  return {
    success: errors.length === 0,
    errors: errors.map((e) => `${e.field}: ${e.message}`),
  };
}

export async function setMetafields(
  admin: AdminApiContext,
  metafields: MetafieldInput[],
): Promise<{ success: boolean; errors: string[] }> {
  const response = await admin.graphql(SET_METAFIELDS_MUTATION, {
    variables: { metafields },
  });

  const json = (await response.json()) as MetafieldsSetResponse;

  if (!json.data) {
    return {
      success: false,
      errors: [`Shopify GraphQL error: ${JSON.stringify(json.errors || "No data returned")}`],
    };
  }

  const errors = json.data.metafieldsSet?.userErrors ?? [];

  return {
    success: errors.length === 0,
    errors: errors.map((e) => `${e.field}: ${e.message}`),
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

  const json = (await response.json()) as ProductCreateMediaResponse;

  if (!json.data) {
    return {
      success: false,
      errors: [`Shopify GraphQL error: ${JSON.stringify(json.errors || "No data returned")}`],
    };
  }

  const errors = json.data.productCreateMedia?.mediaUserErrors ?? [];

  return {
    success: errors.length === 0,
    errors: errors.map((e) => `${e.field}: ${e.message}`),
  };
}
