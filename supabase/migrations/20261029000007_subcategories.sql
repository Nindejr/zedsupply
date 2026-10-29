-- Department groups, subcategories and product subcategories (PostgreSQL 15+). Apply after 001–006.
-- Mirrors js/catalogue.js: departmentGroups, departments[].subs and products[].sub.
-- Load the rows from catalogue.js when importing; ids there never change once products use them.

BEGIN;

CREATE TABLE department_groups (
  id        text PRIMARY KEY,                       -- 'tech-group'
  name      text NOT NULL,                          -- 'Electronics & technology'
  position  smallint NOT NULL DEFAULT 0
);

ALTER TABLE departments
  ADD COLUMN short_name text,                        -- menus and the search box
  ADD COLUMN group_id   text REFERENCES department_groups (id),
  ADD COLUMN featured   boolean NOT NULL DEFAULT false,   -- homepage "Shop by category"
  ADD COLUMN has_3d_art boolean NOT NULL DEFAULT false,
  ADD COLUMN position   smallint NOT NULL DEFAULT 0;

CREATE TABLE subcategories (
  department_id text NOT NULL REFERENCES departments (id) ON DELETE CASCADE,
  id            text NOT NULL CHECK (id ~ '^[a-z0-9-]+$'),   -- 'phones'; unique within its department
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  position      smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (department_id, id)
);

-- A product's subcategory must belong to the product's own department
ALTER TABLE products
  ADD COLUMN subcategory_id text,
  ADD FOREIGN KEY (department_id, subcategory_id) REFERENCES subcategories (department_id, id);
CREATE INDEX products_subcategory_idx ON products (department_id, subcategory_id) WHERE subcategory_id IS NOT NULL;

COMMIT;
