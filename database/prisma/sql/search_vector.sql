-- Bemz Africa Marketplace — full-text search support for products.
-- Prisma cannot express GIN indexes or triggers, so this runs after `prisma migrate deploy`:
--   npm run db:search        (psql "$DATABASE_URL" -f prisma/sql/search_vector.sql)
-- Applied manually rather than by migration so it also works on managed Postgres
-- where the app role may not own CREATE EXTENSION.
--
-- Column names are the quoted camelCase identifiers Prisma Migrate generates
-- ("searchVector", not search_vector).

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy title matching ("Iphone" -> "iPhone")
CREATE EXTENSION IF NOT EXISTS unaccent;  -- accents in imported brand names

-- The tsvector column itself lives in schema.prisma as
--   searchVector Unsupported("tsvector")?

CREATE OR REPLACE FUNCTION product_search_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."brand", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."subtitle", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'C');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_search_vector_trigger ON "products";
CREATE TRIGGER products_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "title", "brand", "subtitle", "description"
  ON "products"
  FOR EACH ROW EXECUTE FUNCTION product_search_vector_update();

-- Backfill rows that were seeded before the trigger existed.
UPDATE "products" SET "title" = "title";

CREATE INDEX IF NOT EXISTS products_search_vector_gin
  ON "products" USING GIN ("searchVector");

CREATE INDEX IF NOT EXISTS products_title_trgm_gin
  ON "products" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_brand_trgm_gin
  ON "products" USING GIN ("brand" gin_trgm_ops);

-- Variant attribute filters ({"Colour":"Black","Storage":"128GB"}) use containment
-- queries (`attributes @> '{"Colour":"Black"}'::jsonb`), which need a GIN index.
CREATE INDEX IF NOT EXISTS product_variants_attributes_gin
  ON "product_variants" USING GIN ("attributes" jsonb_path_ops);

-- Review images are a JSONB array of Cloudinary URLs.
CREATE INDEX IF NOT EXISTS reviews_images_gin
  ON "reviews" USING GIN ("images" jsonb_path_ops);

-- Order/payment analytics: active orders by shop and unsettled payments.
CREATE INDEX IF NOT EXISTS orders_shop_open_state_idx
  ON "orders" ("shopId", "status")
  WHERE "status" IN ('AWAITING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY');

CREATE INDEX IF NOT EXISTS payments_pending_idx
  ON "payments" ("status", "createdAt")
  WHERE "status" IN ('INITIATED', 'PENDING_CUSTOMER', 'PROCESSING');
