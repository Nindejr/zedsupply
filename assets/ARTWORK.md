# Artwork style

Use the built-in imagegen skill for new raster artwork. Inspect the existing
images before generating replacements or additions. The exact prompts for this
replacement set are recorded in [artwork-prompts.json](artwork-prompts.json).

## Products

Match `products/L001.webp` and `products/L005.webp`: realistic 3D studio product
rendering with tangible materials, visible thickness, three-quarter perspective,
soft upper-left lighting and subtle contact shadows on a seamless near-white
background. Show the complete item, with consistent scale and comfortable margins.
Cloth needs folds and weave; metal, plastic and glass need believable reflections.
Match the listing's product, colour, contents and visible specifications.

Export square 600 × 600 WebP files under 80 KB into `products/demo/` for samples
or `products/` for confirmed live listings. Use one image per distinct product.
Do not bake sample notices, prices, badges, logos or watermarks into images.
Avoid readable letters or numbers on the product itself (alphabet puzzles, keypads,
labels): image generators misspell them. Prompt for blank, shape or picture
versions instead, and check every visible character before accepting an image.
`products/demo/L041.webp` shows "HIJKLMH" and should be regenerated this way.
Keep sample notices in the storefront and sample metadata on the listing.

## Departments

Match `categories-3d/tech.webp`: compact, polished 3D product compositions with
royal blue/navy, teal and green accents, dimensional geometry, bevelled edges,
soft upper-left highlights and natural occlusion shadows. Keep the full product
cluster visible and readable at 112 pixels. Use genuine transparent backgrounds;
do not add a white tile, checkerboard, pedestal, caption or border.

Export square 256 × 256 transparent WebP files under 80 KB into
`categories-3d/<department-id>.webp` and set `art3d: true` in `js/catalogue.js`.
Existing shared artwork may keep its string alias, such as `art3d: 'fashion'`.
Retain `icons/<department-id>.svg` for data-saver mode and fallback handling.

## Review

Inspect the generated results together and in the storefront. Check subjects,
lighting, depth, framing, backgrounds and consistent visual scale. Verify that
all images load, transparency survives export, and data-saver mode uses icons.
Flat vector illustrations, emoji and CSS drawings are unsuitable substitutes for
the primary product and department artwork. Banners and promotional collections
should follow their existing 3D reference artwork and responsive dimensions.
