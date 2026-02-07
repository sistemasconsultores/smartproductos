import { Client as MinioClient } from "minio";

let client: MinioClient | null = null;

function getMinioClient(): MinioClient {
  if (!client) {
    client = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT || "localhost",
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || "",
      secretKey: process.env.MINIO_SECRET_KEY || "",
    });
  }
  return client;
}

const BUCKET = process.env.MINIO_BUCKET || "smartenrich-images";

export async function ensureBucket(): Promise<void> {
  const minio = getMinioClient();
  const exists = await minio.bucketExists(BUCKET);
  if (!exists) {
    await minio.makeBucket(BUCKET);
  }
}

export async function cacheImage(
  imageUrl: string,
  productId: string,
  index: number,
): Promise<string | null> {
  try {
    const minio = getMinioClient();
    await ensureBucket();

    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType =
      response.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";

    const cleanProductId = productId.replace(/[^a-zA-Z0-9]/g, "_");
    const objectName = `${cleanProductId}/${index}.${ext}`;

    await minio.putObject(BUCKET, objectName, buffer, buffer.length, {
      "Content-Type": contentType,
    });

    return objectName;
  } catch (error) {
    console.error("[image-cache] Failed to cache image:", error);
    return null;
  }
}

export async function getImageUrl(objectName: string): Promise<string> {
  const minio = getMinioClient();
  return minio.presignedGetObject(BUCKET, objectName, 24 * 60 * 60);
}
