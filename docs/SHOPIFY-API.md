# Shopify Admin API - SmartEnrich

## Version: 2026-01

## Scopes: read_products, write_products, read_product_listings, read_inventory

## Auth: OAuth 2.0 via template Shopify Remix (authenticate.admin)

---

## Query: Productos para Enriquecimiento

```graphql
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
        category { id name fullName }
        seo { title description }
        variants(first: 10) {
          edges {
            node {
              id
              title
              sku
              barcode
              inventoryQuantity
              # NUNCA incluir: price, compareAtPrice, inventoryItem.unitCost
            }
          }
        }
        images(first: 10) {
          edges {
            node { id url altText width height }
          }
        }
        metafields(first: 30) {
          edges {
            node { id namespace key value type }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

---

## Mutation: Actualizar Producto

```graphql
mutation UpdateProduct($input: ProductInput!) {
  productUpdate(input: $input) {
    product {
      id title descriptionHtml productType tags
    }
    userErrors { field message }
  }
}
```

Input ejemplo:
```json
{
  "input": {
    "id": "gid://shopify/Product/123456789",
    "descriptionHtml": "<p>Nueva descripcion SEO...</p>",
    "productType": "Laptop",
    "tags": ["laptop", "lenovo", "thinkpad", "intel", "16gb-ram"]
  }
}
```

CRITICO: Input NUNCA incluye variants[].price o campos de precio.

---

## Mutation: Metafields

```graphql
mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message }
  }
}
```

Input ejemplo:
```json
{
  "metafields": [
    {
      "ownerId": "gid://shopify/Product/123456789",
      "namespace": "custom",
      "key": "memoria_ram",
      "value": "16 GB DDR5",
      "type": "single_line_text_field"
    }
  ]
}
```

---

## Mutation: SEO

```graphql
mutation UpdateProductSEO($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id seo { title description } }
    userErrors { field message }
  }
}
```

---

## Mutation: Subir Imagenes

```graphql
mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media {
      ... on MediaImage {
        id
        image { url altText }
      }
    }
    mediaUserErrors { field message }
  }
}
```

---

## Webhooks

### products/create
Producto nuevo creado -> encolar para enriquecimiento.

### products/update
Producto actualizado -> verificar que NO fue SmartEnrich (evitar loop) -> recalcular score.

Validacion: authenticate.webhook(request) del template Remix.

---

## Taxonomia de Categorias (Tecnologia)

```
Electronics > Computers > Desktop Computers
Electronics > Computers > Laptops
Electronics > Computers > Tablets
Electronics > Computers > Computer Components > Storage Devices
Electronics > Computers > Computer Components > Memory
Electronics > Computers > Computer Peripherals > Monitors
Electronics > Computers > Computer Peripherals > Printers
Electronics > Computers > Computer Peripherals > Keyboards
Electronics > Computers > Computer Peripherals > Mice
Electronics > Communications > Telephony > Mobile Phones
Electronics > Communications > Telephony > Phone Accessories
Electronics > Audio > Headphones
Electronics > Audio > Speakers
Electronics > Networking > Routers
Electronics > Networking > Switches
Electronics > Video > Projectors
Electronics > Video > Surveillance
```
