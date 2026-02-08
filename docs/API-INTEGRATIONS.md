# APIs Externas - SmartEnrich

## 1. Serper.dev (Busqueda Web - Primario)

URL: https://google.serper.dev/search
Auth: Header X-API-KEY
Precio: 2,500 gratis, luego $50/50,000 busquedas

### Busqueda web:
```
POST https://google.serper.dev/search
X-API-KEY: SERPER_API_KEY
Content-Type: application/json

{"q": "Lenovo ThinkPad specifications ficha tecnica", "num": 5}
```

Response:
```json
{
  "organic": [
    {
      "title": "Lenovo ThinkPad T14 Gen 4 Specs",
      "snippet": "14-inch business laptop with...",
      "link": "https://www.notebookcheck.net/..."
    }
  ]
}
```

### Busqueda de imagenes:
```
POST https://google.serper.dev/images
X-API-KEY: SERPER_API_KEY
Content-Type: application/json

{"q": "Lenovo ThinkPad product photo official", "num": 10}
```

Response:
```json
{
  "images": [
    {
      "title": "Lenovo ThinkPad T14",
      "imageUrl": "https://...",
      "imageWidth": 2048,
      "imageHeight": 2048
    }
  ]
}
```

---

## 2. SerpAPI (Busqueda Web - Fallback)

URL: https://serpapi.com/search.json
Auth: Query param api_key
Precio: $50/mes por 5,000 busquedas

Request:
```
GET https://serpapi.com/search.json?engine=google&q=Lenovo+ThinkPad+specifications&api_key=KEY&num=5
```

Response:
```json
{
  "organic_results": [
    {
      "title": "Lenovo ThinkPad T14 Gen 4 Specs",
      "snippet": "14-inch business laptop...",
      "link": "https://..."
    }
  ]
}
```

---

## 3. Google Gemini 2.5 Flash

Ver docs/GEMINI-PROMPTS.md

---

## Estrategia de Busqueda

1. Si tiene SKU: Serper Search "{sku} {marca} specifications ficha tecnica" -> Cache 7 dias
2. Si no tiene SKU: Serper Search "{titulo} {marca} ficha tecnica especificaciones" -> Cache 7 dias
3. Si faltan imagenes: Serper Images "{titulo} {marca} product photo official" -> Filtrar >= 1024x1024 -> MinIO
4. Fallback: Si Serper falla, SerpAPI busca lo mismo automaticamente

## Caching Redis

```typescript
const CACHE_KEYS = {
  search: (query: string) => `cache:search:${md5(query)}`, // TTL: 7 dias
  images: (query: string) => `cache:images:${md5(query)}`, // TTL: 7 dias
};
```

## Manejo de Errores

| API | Error | Accion |
|---|---|---|
| Serper | 401 | Verificar API key en serper.dev |
| Serper | 429 | Creditos agotados, pasa a SerpAPI |
| SerpAPI | 401/429 | Continuar sin search data |
| Gemini | 429 | Retry backoff (2s, 4s, 8s, 16s) |
| Gemini | 500 | Retry hasta 3 veces |
| Gemini | Invalid JSON | Marcar como fallido |
