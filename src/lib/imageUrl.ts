const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * Build a predictable public URL for a product image.
 * Pattern: {sku}/{sku}.{ext}
 *
 * Usage:
 *   getProductImageUrl("FA1-KF100015")
 *   // → https://.../storage/v1/object/public/product-images/FA1-KF100015/FA1-KF100015.png
 */
export const getProductImageUrl = (sku: string, ext = "png") =>
  `${SUPABASE_URL}/storage/v1/object/public/product-images/${sku}.${ext}`;

/**
 * Build the storage file path for a product image (used in upload calls).
 */
export const getProductImagePath = (sku: string, ext = "png") =>
  `${sku}.${ext}`;
