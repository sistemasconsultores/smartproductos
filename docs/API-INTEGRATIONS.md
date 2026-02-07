# APIs Externas - SmartEnrich

## 1. Go-UPC (Barcode Lookup Principal)

URL: https://go-upc.com/api/v1/code/{barcode}
Auth: Header Authorization: Bearer {API_KEY}
Precio: $10-$99/mes

Request:
```
GET https://go-upc.com/api/v1/code/0196802498302
Authorization: Bearer GO_UPC_API_KEY
```

Response:
```json
{
  "code": "0196802498302",
  "codeType": "UPC-A",
  "product": {
    "name": "Lenovo ThinkPad T14 Gen 4",
    "description": "14-inch business laptop...",
    "imageUrl": "https://...",
    "brand": "Lenovo",
    "category": "Electronics > Computers > Laptops",
    "specs": { "Weight": "1.21 kg", "Dimensions": "317.7 x 226.9 x 17.9 mm" }
  }
}
```

---

## 2. UPCitemdb (Barcode Lookup Backup)

URL: https://api.upcitemdb.com/prod/trial/lookup
Auth: Sin auth para trial (100 req/dia)

Request:
```
GET https://api.upcitemdb.com/prod/trial/lookup?upc=0196802498302
```

Response:
```json
{
  "items": [{
    "title": "Lenovo ThinkPad T14 Gen 4",
    "description": "...",
    "brand": "Lenovo",
    "model": "21HD00LXUS",
    "dimension": "12.44 x 8.94 x 0.70 inches",
    "weight": "2.67 lb",
    "images": ["https://..."]
  }]
}
```

---

## 3. Google Custom Search

URL: https://www.googleapis.com/customsearch/v1
Auth: Query param key={API_KEY}
Precio: 100/dia gratis, luego $5/1000

Setup:
1. Crear Search Engine en programmablesearchengine.google.com
2. Buscar en toda la web
3. Habilitar Image Search
4. Obtener CX y API Key

Request texto:
```
GET https://www.googleapis.com/customsearch/v1?key=KEY&cx=CX&q=Lenovo+ThinkPad+specifications&num=5
```

Request imagenes:
```
GET https://www.googleapis.com/customsearch/v1?key=KEY&cx=CX&q=Lenovo+ThinkPad&searchType=image&imgSize=xlarge&num=5
```

---

## 4. Google Gemini 2.5 Flash

Ver docs/GEMINI-PROMPTS.md

---

## Estrategia de Busqueda

1. Si tiene barcode: Go-UPC -> UPCitemdb -> Cache Redis 30 dias
2. Si tiene SKU: Google Search "{sku} specifications" -> Cache 7 dias
3. Siempre: Google Search "{titulo} {marca} ficha tecnica" -> Cache 7 dias
4. Si faltan imagenes: Google Images "{titulo} {marca}" -> Filtrar >= 800x800 -> MinIO

## Caching Redis

```typescript
const CACHE_KEYS = {
  barcode: (code: string) => `cache:barcode:${code}`,      // TTL: 30 dias
  search: (query: string) => `cache:search:${md5(query)}`, // TTL: 7 dias
  images: (query: string) => `cache:images:${md5(query)}`, // TTL: 7 dias
};
```

## Manejo de Errores

| API | Error | Accion |
|---|---|---|
| Go-UPC | 404 | Intentar UPCitemdb |
| Go-UPC | 429 | Esperar y reintentar |
| UPCitemdb | Empty | Continuar sin barcode data |
| Google Search | 429 | Continuar sin search data |
| Gemini | 429 | Retry backoff (2s, 4s, 8s, 16s) |
| Gemini | 500 | Retry hasta 3 veces |
| Gemini | Invalid JSON | Marcar como fallido |
