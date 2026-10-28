-- Optional condition and feature bullets. Other variation types use the existing
-- product_options(kind='custom') graph; flexible specifications remain JSONB.
BEGIN;
CREATE TYPE item_condition AS ENUM ('new', 'open_box', 'refurbished', 'used');
CREATE FUNCTION valid_product_features(items text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE WHEN coalesce(array_ndims(items),1) <> 1 THEN false ELSE
    cardinality(items) <= 8 AND (cardinality(items)=0 OR array_lower(items,1)=1)
    AND NOT EXISTS (SELECT 1 FROM unnest(items) f WHERE f IS NULL OR char_length(btrim(f)) NOT BETWEEN 1 AND 160)
  END
$$;
ALTER TABLE products
  ADD COLUMN condition item_condition,
  ADD COLUMN condition_notes text CHECK (condition_notes IS NULL OR char_length(condition_notes) <= 1000),
  ADD COLUMN key_features text[] NOT NULL DEFAULT '{}' CHECK (valid_product_features(key_features)),
  ADD CONSTRAINT product_condition_notes CHECK (
    (condition IS NULL AND condition_notes IS NULL) OR
    (condition IS NOT NULL AND (condition='new' OR
      (condition_notes IS NOT NULL AND char_length(btrim(condition_notes))>0))));
ALTER TABLE attribute_templates DROP CONSTRAINT attribute_templates_attribute_check;
ALTER TABLE attribute_templates ADD CONSTRAINT attribute_templates_attribute_check
  CHECK (attribute IN ('colour','size','age_range','components','manufacturer','spec','condition','features'));
CREATE INDEX products_condition_idx ON products (department_id,condition) WHERE condition IS NOT NULL;
CREATE INDEX products_manufacturer_idx ON products (lower(manufacturer)) WHERE manufacturer IS NOT NULL;
COMMIT;
