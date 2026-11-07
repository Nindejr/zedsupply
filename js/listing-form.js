/* Zed Supply — the seller listing form (#/listing): add or edit a product, its options and
   variations, prices and bulk prices, trade quantities, photos, what's in the box, and the checks
   in js/products.js before it's saved or sent for review.

   Split from js/main.js, which loads this file first and then calls ZSModules.listing(K) with the
   helpers both share (K); none of them change after start-up. */
(function () {
  'use strict';
  window.ZSModules = window.ZSModules || {};
  window.ZSModules.listing = function (K) {
    var $ = K.$, $$ = K.$$, BASE_PRODUCTS = K.BASE_PRODUCTS, D = K.D, ZP = K.ZP, bannerFromFile = K.bannerFromFile;
    var brand = K.brand, byId = K.byId, crumbs = K.crumbs, dept = K.dept;
    var esc = K.esc, head = K.head, listing = K.listing, listingsApi = K.listingsApi;
    var loadProducts = K.loadProducts, perUnit = K.perUnit, product = K.product;
    var route = K.route, seller = K.seller, show = K.show, store = K.store, toast = K.toast;
    var views = K.views;
    var form = {
      listing: function (id, q) {
        var sess = store.get('seller', null), s = sess ? seller(sess.id) : null;
        if (!s) { location.hash = '#/seller'; return; }
        var editing = id && id !== 'new' ? product(id) : null;
        if (id && id !== 'new' && (!editing || editing.seller !== s.id)) return views.notfound();
        var dr = editing ? JSON.parse(JSON.stringify(editing)) : { title: '', category: '', brand: '', priceZMW: '', wasZMW: '', stock: 'in', description: '', tags: '', image: '', alt: '' };
        dr.seller = s.id;
        dr.attributes = dr.attributes || {}; dr.options = dr.options || {}; dr.variants = dr.variants || []; dr.inBox = dr.inBox || [];
        dr.priceTiers = dr.priceTiers || [];
        var enabledFields = {};
        var fieldNames = { colour: 'Colour choices', size: 'Size / volume / weight', ageRange: 'Age suitability', inBox: 'Included items / add-ons', manufacturer: 'Manufacturer / brand name', specs: 'Custom specifications', condition: 'Item condition', features: 'Key features' };
        var specRows = Object.keys(dr.attributes.specs || {}).map(function (k) { return [k, dr.attributes.specs[k]]; });
        var ctx = { departments: D.departments, brands: D.brands, products: BASE_PRODUCTS };
        var tpl = function () { return (D.attributeTemplates || {})[dr.category] || { fields: dr.category ? ZP.FIELDS : [] }; };
        var used = {
          colour: function () { return (dr.options.colour || []).length; }, size: function () { return (dr.options.size || []).length || dr.attributes.size; },
          ageRange: function () { return (dr.attributes.ageRange || []).length; }, inBox: function () { return dr.inBox.length; },
          manufacturer: function () { return dr.attributes.manufacturer; }, specs: function () { return specRows.length; },
          condition: function () { return dr.attributes.condition || dr.attributes.conditionNotes; }, features: function () { return (dr.attributes.features || []).length; }
        };
        var has = function (f) { return enabledFields[f] || tpl().fields.indexOf(f) !== -1 || !!used[f](); };
        var units = function () { var suggested = tpl().sizeUnits || [], selected = dr.attributes.size ? [dr.attributes.size.unit] : []; if (!suggested.length && !selected.length && !enabledFields.measured && Array.isArray(tpl().sizeUnits)) return []; return suggested.concat(selected, Object.keys(ZP.UNITS)).filter(function (u, i, all) { return all.indexOf(u) === i; }); };
        var fieldsHTML = function () { return '<details class="lf-optional"><summary>Add other relevant product details</summary><p class="hint">Category suggestions are a starting point. Add only fields that describe this product; existing values are preserved.</p><div class="checks">' + ZP.FIELDS.filter(function (f) { return tpl().fields.indexOf(f) === -1; }).map(function (f) { return '<div class="check"><input type="checkbox" id="lf-enable-' + f + '" data-enable-field="' + f + '"' + (has(f) ? ' checked' : '') + (used[f]() ? ' disabled' : '') + '><label for="lf-enable-' + f + '">' + esc(fieldNames[f]) + '</label></div>'; }).join('') + '</div></details>'; };
        var addSuggestedSpecs = function () {
          (tpl().specs || []).forEach(function (k) { if (!specRows.some(function (r) { return r[0].toLowerCase() === k.toLowerCase(); })) specRows.push([k, '']); });
        };
        addSuggestedSpecs();

        var fieldHTML = function (fid, label, input, hint) { return '<div class="field" id="lf-f-' + fid + '"><label for="lf-' + fid + '">' + label + '</label>' + input + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>'; };
        // Subcategories of the chosen department (catalogue.js departments[].subs)
        var subHTML = function () {
          var subs = dr.category ? dept(dr.category).subs : [], note = dr.category ? dept(dr.category).note : '';
          return (note ? '<p class="notice">' + esc(note) + ' See <a href="help.html#not-sold" target="_blank" rel="noopener noreferrer">what can\'t be sold</a>.</p>' : '') + (subs.length ? fieldHTML('sub', 'Subcategory', '<select id="lf-sub"><option value="">Choose a subcategory…</option>' + subs.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === dr.sub ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>', 'Helps buyers find it when they browse, e.g. Electronics › Headphones & Earbuds.') : '');
        };
        var photosHTML = function () {
          var list = dr.images || [];
          return list.length ? '<ul class="lf-photos">' + list.map(function (im, i) {
            return '<li><img src="' + esc(im.src) + '" alt="" width="72" height="72"><div class="field"><label for="lf-pa-' + i + '">Photo ' + (i + 2) + ' shows *</label><input id="lf-pa-' + i + '" data-photo-alt="' + i + '" maxlength="160" placeholder="e.g. Side view showing the USB-C port" value="' + esc(im.alt) + '"></div>' +
              '<button class="link-btn link-btn--danger" type="button" data-del-photo="' + i + '">Remove<span class="visually-hidden"> photo ' + (i + 2) + '</span></button></li>';
          }).join('') + '</ul>' : '';
        };
        var attrsHTML = function () {
          var t = tpl(), out = '';
          if (!dr.category) return '<p class="pmeta">Choose a department to see the details buyers look for in it.</p>';
          if (has('size') && Array.isArray(t.sizeUnits) && !t.sizeUnits.length) out += '<div class="check"><input id="lf-measured" type="checkbox" data-measured' + (enabledFields.measured || dr.attributes.size ? ' checked' : '') + '><label for="lf-measured">Also specify a measured size, such as cm or ml</label></div>';
          if (has('size') && units().length) out += '<div class="field-row lf-size" id="lf-f-size"><div class="field"><label for="lf-size">Size, capacity or weight (one value only)</label><input id="lf-size" type="number" min="0" step="any" inputmode="decimal" value="' + esc(dr.attributes.size ? dr.attributes.size.value : '') + '"><p class="hint">Leave empty if buyers choose a size below.</p></div>' +
            '<div class="field"><label for="lf-unit">Unit</label><select id="lf-unit">' + units().map(function (u) { return '<option value="' + u + '"' + (dr.attributes.size && dr.attributes.size.unit === u ? ' selected' : '') + '>' + esc(ZP.UNITS[u].name) + '</option>'; }).join('') + '</select></div></div>';
          if (has('ageRange')) out += '<fieldset class="field" id="lf-f-ageRange"><legend>Age range</legend><div class="checks checks--ages">' + ZP.AGES.map(function (a) {
            return '<div class="check"><input type="checkbox" id="lf-age-' + a[0] + '" value="' + a[0] + '" data-age' + ((dr.attributes.ageRange || []).indexOf(a[0]) !== -1 ? ' checked' : '') + '><label for="lf-age-' + a[0] + '">' + a[1] + '</label></div>';
          }).join('') + '</div></fieldset>';
          if (has('manufacturer')) out += fieldHTML('manufacturer', 'Manufacturer / brand name', '<input id="lf-manufacturer" maxlength="80" value="' + esc(dr.attributes.manufacturer || '') + '">', 'Enter the actual brand or manufacturer. Choose a brand store above only when one exists.');
          if (has('condition')) out += fieldHTML('condition', 'Item condition', '<select id="lf-condition"><option value="">Not specified</option>' + ZP.CONDITIONS.map(function (c) { return '<option value="' + c[0] + '"' + (dr.attributes.condition === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select><label for="lf-conditionNotes">Condition details</label><textarea id="lf-conditionNotes" maxlength="1000" placeholder="For used or refurbished items, describe wear, repairs and missing packaging.">' + esc(dr.attributes.conditionNotes || '') + '</textarea>');
          if (has('features')) out += fieldHTML('features', 'Key features', '<textarea id="lf-features" rows="5" placeholder="One feature per line">' + esc((dr.attributes.features || []).join('\n')) + '</textarea>', 'Up to eight checked facts, 160 characters each. Put warranty, compatibility, material and model details under Specifications.');
          if (has('specs')) out += '<fieldset class="field" id="lf-f-specs"><legend>Specifications</legend><p class="hint">Leave a value empty to skip it. Only list what you have checked on the item.</p><div class="lf-rows">' + specRows.map(function (r, i) {
            return '<div class="lf-row"><label class="visually-hidden" for="lf-sk-' + i + '">Specification name</label><input id="lf-sk-' + i + '" data-spec-key placeholder="Name" maxlength="60" value="' + esc(r[0]) + '">' +
              '<label class="visually-hidden" for="lf-sv-' + i + '">' + esc(r[0] || 'Specification') + ' value</label><input id="lf-sv-' + i + '" data-spec-val placeholder="Value" maxlength="200" value="' + esc(r[1]) + '">' +
              '<button class="link-btn link-btn--danger" type="button" data-del-spec="' + i + '">Remove<span class="visually-hidden"> ' + esc(r[0] || 'specification') + '</span></button></div>';
          }).join('') + '</div><button class="btn btn--secondary btn--sm" type="button" data-add-spec>Add a specification</button></fieldset>';
          if (has('inBox')) out += '<fieldset class="field" id="lf-f-inBox"><legend>In the box</legend><p class="hint">What the buyer gets. An optional add-on is ticked by the buyer and adds its price.</p><div class="lf-rows">' + dr.inBox.map(function (c, i) {
            var addon = c.addonZMW != null && c.addonZMW !== '';
            return '<div class="lf-row lf-row--box"><label class="visually-hidden" for="lf-bi-' + i + '">Item</label><input id="lf-bi-' + i + '" data-box-item placeholder="e.g. Charging cable" maxlength="80" value="' + esc(c.item || '') + '">' +
              '<label class="visually-hidden" for="lf-bk-' + i + '">Included or add-on</label><select id="lf-bk-' + i + '" data-box-kind><option value="included">Included</option><option value="addon"' + (addon ? ' selected' : '') + '>Optional add-on</option></select>' +
              '<label class="visually-hidden" for="lf-bp-' + i + '">Add-on price in Kwacha</label><input id="lf-bp-' + i + '" data-box-price type="number" min="0" step="0.01" inputmode="decimal" placeholder="K price"' + (addon ? ' value="' + esc(c.addonZMW) + '"' : ' hidden') + '>' +
              '<button class="link-btn link-btn--danger" type="button" data-del-box="' + i + '">Remove<span class="visually-hidden"> ' + esc(c.item || 'item') + '</span></button></div>';
          }).join('') + '</div><button class="btn btn--secondary btn--sm" type="button" data-add-box>Add an item</button></fieldset>';
          return out || '<p class="pmeta">No extra details for this department.</p>';
        };
        var varsHTML = function () {
          var out = '', cols = dr.options.colour || [], sizes = dr.options.size || [];
          if (has('colour')) out += '<fieldset class="field" id="lf-f-colour"><legend>Colours the buyer can choose</legend><p class="hint">Pick a swatch that matches the real item.</p><div class="lf-rows">' + cols.map(function (c, i) {
            return '<div class="lf-row lf-row--colour"><label class="visually-hidden" for="lf-cn-' + i + '">Colour name</label><input id="lf-cn-' + i + '" data-col-name placeholder="e.g. Midnight black" maxlength="40" value="' + esc(c.name) + '">' +
              '<label class="visually-hidden" for="lf-ch-' + i + '">Swatch for ' + esc(c.name || 'this colour') + '</label><input id="lf-ch-' + i + '" data-col-hex type="color" value="' + esc(/^#[0-9a-f]{6}$/i.test(c.hex || '') ? c.hex : '#808080') + '">' +
              '<button class="link-btn link-btn--danger" type="button" data-del-col="' + i + '">Remove<span class="visually-hidden"> ' + esc(c.name || 'colour') + '</span></button></div>';
          }).join('') + '</div><button class="btn btn--secondary btn--sm" type="button" data-add-col>Add a colour</button></fieldset>';
          if (has('size')) out += '<fieldset class="field" id="lf-f-sizes"><legend>Sizes the buyer can choose</legend><p class="hint">For example S, M, L, 42, or 500 ml and 1 l. Measured sizes are read with their unit.</p>' +
            (sizes.length ? '<ul class="lf-chips">' + sizes.map(function (sz, i) { return '<li><span>' + esc(ZP.sizeLabel(sz)) + '</span><button type="button" class="lf-chip-x" data-del-size="' + i + '" aria-label="Remove size ' + esc(ZP.sizeLabel(sz)) + '">×</button></li>'; }).join('') + '</ul>' : '') +
            '<div class="lf-row"><label class="visually-hidden" for="lf-newsize">New size</label><input id="lf-newsize" maxlength="20" placeholder="Add a size"><button class="btn btn--secondary btn--sm" type="button" data-add-size>Add size</button></div></fieldset>';
          out += '<fieldset class="field lf-extra"><legend>Other buyer choices</legend><p class="hint">Use related variations such as Storage, Capacity, Material, Pack size or Fit. Different brands should have separate product listings.</p>' + (dr.options.extra || []).map(function (axis, i) {
            return '<div class="lf-row"><label for="lf-extra-name-' + i + '">Choice name</label><input id="lf-extra-name-' + i + '" data-extra-name="' + axis.key + '" maxlength="40" placeholder="e.g. Storage" value="' + esc(axis.name) + '"><label for="lf-extra-values-' + i + '">Values</label><input id="lf-extra-values-' + i + '" data-extra-values="' + axis.key + '" placeholder="e.g. 128 GB, 256 GB" value="' + esc(axis.values.join(', ')) + '"><button type="button" class="link-btn" data-del-extra="' + i + '">Remove choice</button></div>';
          }).join('') + ((dr.options.extra || []).length < 2 ? '<button type="button" class="btn btn--secondary btn--sm" data-add-extra>Add another choice</button>' : '') + '<p class="hint">Up to two extra choice types and ' + ZP.MAX_COMBINATIONS + ' total combinations.</p></fieldset>';
          if (ZP.combinationCount(dr.options) > ZP.MAX_COMBINATIONS) out += '<p class="form-status is-error">There are too many combinations. Remove some values to generate the stock table.</p>';
          if (dr.variants.length) {
            var withC = cols.length > 0, matrixAxes = ZP.options(dr);
            out += '<div class="field" id="lf-f-variants"><p class="lf-label" id="lf-vt">Stock for each combination (' + dr.variants.length + ')</p><p class="hint">Stock 0 shows that combination as sold out. Leave the price empty to use the main price.</p>' +
              '<div class="cmp lf-matrix" tabindex="0" role="region" aria-labelledby="lf-vt"><table><thead><tr>' + matrixAxes.map(function (a) { return '<th scope="col">' + esc(a.name) + '</th>'; }).join('') + '<th scope="col">SKU</th><th scope="col">Stock</th><th scope="col">Price (K)</th></tr></thead><tbody>' +
              dr.variants.map(function (v, i) {
                var name = matrixAxes.map(function (a) { return v[a.key]; }).join(' / ');
                var hex = withC ? ((cols.filter(function (c) { return c.name === v.colour; })[0] || {}).hex || '') : '';
                return '<tr>' + matrixAxes.map(function (a, ai) { var tag = ai === 0 ? 'th' : 'td'; return '<' + tag + (ai === 0 ? ' scope="row"' : '') + '>' + (a.key === 'colour' ? '<span class="swatch swatch--sm" style="--sw:' + esc(hex) + '" aria-hidden="true"></span> ' : '') + esc(v[a.key]) + '</' + tag + '>'; }).join('') +
                  '<td><input data-v-sku="' + i + '" maxlength="40" value="' + esc(v.sku || '') + '" aria-label="SKU for ' + esc(name) + '"></td>' +
                  '<td><input data-v-stock="' + i + '" type="number" min="0" step="1" inputmode="numeric" value="' + esc(v.stock) + '" aria-label="Stock for ' + esc(name) + '"></td>' +
                  '<td><input data-v-price="' + i + '" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(v.priceZMW || '') + '" placeholder="Main price" aria-label="Price for ' + esc(name) + ' in Kwacha"></td></tr>';
              }).join('') + '</tbody></table></div><button class="btn btn--secondary btn--sm" type="button" data-fill-sku>Fill in empty SKUs</button></div>';
          }
          return out || '<p class="pmeta">This department doesn\'t use colours or sizes.</p>';
        };
        var commitOn = !!dr.commit;
        // Bulk prices: up to four "from this many, this price each" rows
        var tiersHTML = function () {
          return '<div class="field" id="lf-f-priceTiers"><p class="lf-label" id="lf-tiers-label">Bulk prices</p><p class="hint">A lower price ' + esc(perUnit(dr)) + ' when a buyer orders at least this many. Up to 4, each cheaper than the one before.</p>' +
            (dr.priceTiers.length ? '<ul class="lf-tiers">' + dr.priceTiers.map(function (t, i) {
              return '<li><label for="lf-tm-' + i + '">From quantity</label><input id="lf-tm-' + i + '" data-tier-min="' + i + '" type="number" min="2" step="1" inputmode="numeric" value="' + esc(t.min) + '">' +
                '<label for="lf-tp-' + i + '">Price ' + esc(perUnit(dr)) + ' (K)</label><input id="lf-tp-' + i + '" data-tier-price="' + i + '" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(t.price) + '">' +
                '<button class="link-btn link-btn--danger" type="button" data-del-tier="' + i + '">Remove<span class="visually-hidden"> bulk price ' + (i + 1) + '</span></button></li>';
            }).join('') + '</ul>' : '') +
            (dr.priceTiers.length < 4 ? '<button class="btn btn--secondary btn--sm" type="button" data-add-tier>Add a bulk price</button>' : '') + '</div>';
        };
        var html = crumbs([['Seller Centre', '#/seller'], [editing ? 'Edit product' : 'Add a product']]) +
          head(editing ? 'Edit ' + esc(editing.title) : 'Add a product', 'Selling as ' + esc(s.name) + '. Fields marked * are required.') +
          (q && q.get('saved') && editing ? '<div class="notice notice--secure" role="status"><p><strong>Saved.</strong> <a href="#/product/' + esc(editing.id) + '">View the product page</a>. Prototype: saved in this browser only.</p>' +
            '<details><summary>Copy for catalogue.js</summary><p class="pmeta">To publish it for everyone, paste this into the products list in js/catalogue.js' + (function () {
              // Photos uploaded here live in this browser; for the live store they become files in assets/products/
              var files = (/^data:/.test(editing.image || '') ? ['assets/products/' + editing.id + '.webp'] : [])
                .concat((editing.images || []).map(function (im, i) { return /^data:/.test(im.src) ? 'assets/products/' + editing.id + '-' + (i + 2) + '.webp' : ''; }).filter(Boolean));
              return files.length ? ' and save the photo' + (files.length === 1 ? ' as ' : 's as ') + esc(files.join(', ')) : '';
            })() + '.</p><textarea class="lf-code" readonly rows="10" aria-label="Catalogue entry">' + esc(ZP.catalogueEntry(editing)) + ',</textarea><button class="btn btn--secondary btn--sm" type="button" data-copy-entry>Copy</button></details></div>' : '') +
          '<form class="form form--card lf" id="lf" novalidate>' +
            '<div class="lf-errors" id="lf-errors" tabindex="-1" hidden></div>' +
            '<section class="lf-sec" aria-labelledby="lf-h1"><h2 class="h3" id="lf-h1">Basics</h2>' +
              fieldHTML('title', 'Product name *', '<input id="lf-title" maxlength="120" required value="' + esc(dr.title) + '">', 'Say what it is, its size or capacity, and the pack size, e.g. "Electric kettle, 1.7 litre".') +
              '<div class="field-row">' + fieldHTML('category', 'Department *', '<select id="lf-category" required><option value="">Choose a department</option>' + D.departments.map(function (x) { return '<option value="' + x.id + '"' + (x.id === dr.category ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>') +
                fieldHTML('brand', 'Brand', '<select id="lf-brand"><option value="">No brand store</option>' + D.brands.map(function (x) { return '<option value="' + x.id + '"' + (x.id === dr.brand ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>') + '</div>' +
              '<div id="lf-sub-wrap">' + subHTML() + '</div>' +
              fieldHTML('description', 'Description', '<textarea id="lf-description" maxlength="2000">' + esc(dr.description || '') + '</textarea>') +
              fieldHTML('tags', 'Search words', '<input id="lf-tags" maxlength="200" value="' + esc(dr.tags || '') + '">', 'Other words buyers might search for, separated by spaces.') +
              '<div class="field-row">' + fieldHTML('image', 'Photo', '<input id="lf-image" type="file" accept="image/jpeg,image/png,image/webp">', 'A square photo of the actual item on a plain background. We crop it to 600 × 600.') +
                fieldHTML('alt', 'Photo description', '<input id="lf-alt" maxlength="160" value="' + esc(dr.alt || '') + '">', 'What the photo shows, for buyers using screen readers.') + '</div>' +
              (dr.image ? '<img class="lf-photo" id="lf-photo" src="' + esc(dr.image) + '" alt="Current photo" width="120" height="120">' : '<img class="lf-photo" id="lf-photo" alt="" width="120" height="120" hidden>') +
              '<div class="field" id="lf-f-images"><label for="lf-images">More photos (up to ' + ZP.MAX_PHOTOS + ')</label><input id="lf-images" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby="lf-images-hint">' +
                '<p class="hint" id="lf-images-hint">Other angles, close-ups, labels, what\'s in the box or the item in use. Photos of the actual item only.</p><div id="lf-photos">' + photosHTML() + '</div></div>' +
            '</section>' +
            '<section class="lf-sec" aria-labelledby="lf-h2"><h2 class="h3" id="lf-h2">Details</h2><div id="lf-optional">' + fieldsHTML() + '</div><div id="lf-attrs">' + attrsHTML() + '</div></section>' +
            '<section class="lf-sec" aria-labelledby="lf-h3"><h2 class="h3" id="lf-h3">Variations</h2><div id="lf-vars">' + varsHTML() + '</div></section>' +
            '<section class="lf-sec" aria-labelledby="lf-h4"><h2 class="h3" id="lf-h4">Price and stock</h2>' +
              '<div class="field-row">' + fieldHTML('priceZMW', 'Price (K) *', '<input id="lf-priceZMW" type="number" min="0.01" step="0.01" inputmode="decimal" required value="' + esc(dr.priceZMW) + '">', 'The Buy now price.') +
                fieldHTML('wasZMW', 'Was price (K)', '<input id="lf-wasZMW" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(dr.wasZMW || '') + '">', 'Only a genuine previous price.') + '</div>' +
              fieldHTML('stock', 'Stock status', '<select id="lf-stock">' + [['in', 'In stock'], ['low', 'Only a few left'], ['request', 'Sourced on request']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === dr.stock ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>', 'With variations, buyers see the stock from the table above instead.') +
              '<div class="lf-switch"><input type="checkbox" role="switch" id="lf-commit"' + (commitOn ? ' checked' : '') + ' aria-describedby="lf-commit-hint"><label for="lf-commit">Enable buyer offer and commit pricing</label></div>' +
              '<p class="hint" id="lf-commit-hint">Buyers can name a price between your lowest and target prices. You confirm each offer on WhatsApp. Buyers see the range, including your lowest price.</p>' +
              '<div class="field-row" id="lf-commit-fields"' + (commitOn ? '' : ' hidden') + '>' + fieldHTML('commitMin', 'Lowest price you\'ll accept (K) *', '<input id="lf-commitMin" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(dr.commit ? dr.commit.min : '') + '">') +
                fieldHTML('commitMax', 'Target price (K) *', '<input id="lf-commitMax" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + esc(dr.commit ? dr.commit.max : dr.priceZMW) + '">', 'Usually your Buy now price. It can\'t be higher.') + '</div>' +
            '</section>' +
            '<section class="lf-sec" aria-labelledby="lf-h5"><h2 class="h3" id="lf-h5">Trade and bulk buying</h2><p class="hint">For farms, building sites, shops and other businesses buying in quantity.</p>' +
              '<div class="field-row">' + fieldHTML('sellUnit', 'Sold by the', '<select id="lf-sellUnit"><option value="">Item</option>' + ZP.SELL_UNITS.map(function (u) { return '<option value="' + u[0] + '"' + (u[0] === dr.sellUnit ? ' selected' : '') + '>' + esc(u[1].charAt(0).toUpperCase() + u[1].slice(1)) + '</option>'; }).join('') + '</select>', 'Buyers see the price per unit, e.g. "K185 per bag". Put the size in the name, e.g. "Cement, 50 kg bag".') +
                fieldHTML('unitWeightKg', 'Weight of one unit (kg)', '<input id="lf-unitWeightKg" type="number" min="0.001" step="0.001" inputmode="decimal" value="' + esc(dr.unitWeightKg || '') + '">', 'Helps quote delivery for large orders.') + '</div>' +
              '<div id="lf-tiers">' + tiersHTML() + '</div>' +
              '<div class="lf-switch"><input type="checkbox" role="switch" id="lf-trade"' + (dr.trade ? ' checked' : '') + ' aria-describedby="lf-trade-hint"><label for="lf-trade">Sell in trade quantities</label></div>' +
              '<p class="hint" id="lf-trade-hint">Buyers can order up to ' + ZP.TRADE_QTY_MAX.toLocaleString('en-US') + ' at a time instead of ' + ZP.QTY_MAX + '. You can set a minimum order and sell in multiples, e.g. by the pallet of 40.</p>' +
              '<div class="field-row" id="lf-trade-fields"' + (dr.trade ? '' : ' hidden') + '>' + fieldHTML('minQty', 'Minimum order', '<input id="lf-minQty" type="number" min="1" step="1" inputmode="numeric" value="' + esc(dr.minQty || 1) + '">') +
                fieldHTML('qtyStep', 'Sold in multiples of', '<input id="lf-qtyStep" type="number" min="1" step="1" inputmode="numeric" value="' + esc(dr.qtyStep || 1) + '">', '1 means any quantity.') + '</div>' +
              '<div class="lf-switch"><input type="checkbox" role="switch" id="lf-heavy"' + (dr.heavy ? ' checked' : '') + ' aria-describedby="lf-heavy-hint"><label for="lf-heavy">Heavy or bulky: needs truck delivery</label></div>' +
              '<p class="hint" id="lf-heavy-hint">Couriers aren\'t offered for it. Buyers see that the delivery fee is quoted for their order, or they can collect.</p>' +
            '</section>' +
            '<p class="form-status" role="status" tabindex="-1"></p>' +
            '<div class="btn-row"><button class="btn btn--primary" type="submit">' + (editing ? 'Save changes' : 'Add product') + '</button><a class="btn btn--secondary" href="#/seller">Cancel</a>' +
              (editing && listingsApi.get(editing.id) ? '<button class="link-btn link-btn--danger" type="button" id="lf-delete">' + (byId(BASE_PRODUCTS, editing.id) ? 'Undo my changes' : 'Delete this product') + '</button>' : '') + '</div>' +
          '</form>';
        show(html, editing ? 'Edit product' : 'Add a product');
        var form = $('#lf');

        // Form -> draft
        var collect = function () {
          dr.title = $('#lf-title').value; dr.category = $('#lf-category').value; dr.sub = $('#lf-sub') ? $('#lf-sub').value : ''; dr.brand = $('#lf-brand').value;
          dr.description = $('#lf-description').value; dr.tags = $('#lf-tags').value; dr.alt = $('#lf-alt').value;
          dr.priceZMW = $('#lf-priceZMW').value; dr.wasZMW = $('#lf-wasZMW').value; dr.stock = $('#lf-stock').value;
          var a = dr.attributes;
          if ($('#lf-size')) { var sv = $('#lf-size').value.trim(); a.size = sv ? { value: Number(sv), unit: $('#lf-unit').value } : undefined; }
          if ($('#lf-f-ageRange')) a.ageRange = $$('[data-age]:checked', form).map(function (c) { return c.value; });
          if ($('#lf-manufacturer')) a.manufacturer = $('#lf-manufacturer').value;
          if ($('#lf-condition')) { a.condition = $('#lf-condition').value || undefined; a.conditionNotes = $('#lf-conditionNotes').value; }
          if ($('#lf-features')) a.features = $('#lf-features').value.split('\n').map(function (f) { return f.trim(); }).filter(Boolean);
          if ($('#lf-f-specs')) specRows = $$('[data-spec-key]', form).map(function (k, i) { return [k.value.trim(), $$('[data-spec-val]', form)[i].value.trim()]; });
          a.specs = {};
          specRows.forEach(function (r) { if (r[1]) a.specs[r[0]] = r[1]; });
          if ($('#lf-f-inBox')) dr.inBox = $$('[data-box-item]', form).map(function (it, i) {
            var kind = $$('[data-box-kind]', form)[i].value, price = $$('[data-box-price]', form)[i].value;
            return kind === 'addon' ? { item: it.value, addonZMW: price === '' ? 0 : price } : { item: it.value };
          });
          (dr.images || []).forEach(function (im, i) { var alt = $('[data-photo-alt="' + i + '"]', form); if (alt) im.alt = alt.value.trim(); });
          if ($('#lf-f-colour')) dr.options.colour =$$('[data-col-name]', form).map(function (n, i) { return { name: n.value.trim(), hex: $$('[data-col-hex]', form)[i].value }; });
          (dr.options.extra || []).forEach(function (axis) {
            var name = $('[data-extra-name="' + axis.key + '"]', form), values = $('[data-extra-values="' + axis.key + '"]', form);
            if (name) axis.name = name.value.trim();
            if (values) axis.values = values.value.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
          });
          dr.variants.forEach(function (v, i) {
            var sk = $('[data-v-sku="' + i + '"]', form); if (!sk) return;
            v.sku = sk.value.trim(); v.stock = $('[data-v-stock="' + i + '"]', form).value; v.priceZMW = $('[data-v-price="' + i + '"]', form).value;
          });
          dr.commit = $('#lf-commit').checked ? { min: $('#lf-commitMin').value, max: $('#lf-commitMax').value } : undefined;
          dr.sellUnit = $('#lf-sellUnit').value || undefined; dr.unitWeightKg = $('#lf-unitWeightKg').value;
          dr.trade = $('#lf-trade').checked; dr.heavy = $('#lf-heavy').checked;
          dr.minQty = dr.trade ? Number($('#lf-minQty').value) : 1; dr.qtyStep = dr.trade ? Number($('#lf-qtyStep').value) : 1;
          dr.priceTiers = dr.priceTiers.map(function (t, i) { var m = $('[data-tier-min="' + i + '"]', form), pz = $('[data-tier-price="' + i + '"]', form); return m ? { min: Number(m.value), price: pz.value === '' ? NaN : Number(pz.value) } : t; });
          if (!(dr.options.colour || []).length) delete dr.options.colour;
          if (!(dr.options.size || []).length) delete dr.options.size;
        };
        var rebuildMatrix = function () {
          var o = { colour: (dr.options.colour || []).filter(function (c) { return c.name; }), size: dr.options.size || [], extra: dr.options.extra || [] };
          dr.variants = ZP.matrix(o, dr.variants);
        };
        var redraw = function (focusSel) {
          var optionalOpen = $('#lf-optional details').open;
          $('#lf-optional').innerHTML = fieldsHTML();
          $('#lf-optional details').open = optionalOpen;
          $('#lf-attrs').innerHTML = attrsHTML();
          $('#lf-vars').innerHTML = varsHTML();
          var f = focusSel && $(focusSel, form); if (f) f.focus();
        };

        form.addEventListener('change', function (e) {
          var t = e.target;
          if (t.id === 'lf-category') { collect(); if (dr.sub && !byId(dept(dr.category).subs, dr.sub)) dr.sub = ''; $('#lf-sub-wrap').innerHTML = subHTML(); addSuggestedSpecs(); redraw(); }
          else if (t.hasAttribute('data-enable-field')) { var field = t.getAttribute('data-enable-field'); collect(); enabledFields[field] = t.checked; redraw('#lf-enable-' + field); }
          else if (t.hasAttribute('data-measured')) { collect(); enabledFields.measured = t.checked; if (!t.checked) delete dr.attributes.size; redraw(); }
          else if (t.hasAttribute('data-extra-name') || t.hasAttribute('data-extra-values')) { var extraId = t.id; collect(); rebuildMatrix(); redraw('#' + extraId); }
          else if (t.matches('[data-box-kind]')) { var pr = t.parentNode.querySelector('[data-box-price]'); pr.hidden = t.value !== 'addon'; if (!pr.hidden) pr.focus(); }
          else if (t.matches('[data-col-name]')) { collect(); rebuildMatrix(); var idx = $$('[data-col-name]', form).indexOf(t); redraw('#lf-cn-' + idx); }
          else if (t.matches('[data-col-hex]')) { collect(); $('#lf-vars').innerHTML = varsHTML(); }
          else if (t.id === 'lf-trade') { $('#lf-trade-fields').hidden = !t.checked; if (t.checked) $('#lf-minQty').focus(); }
          else if (t.id === 'lf-sellUnit') { collect(); $('#lf-tiers').innerHTML = tiersHTML(); }
          else if (t.id === 'lf-commit') {
            $('#lf-commit-fields').hidden = !t.checked;
            if (t.checked) { if (!$('#lf-commitMax').value) $('#lf-commitMax').value = $('#lf-priceZMW').value; $('#lf-commitMin').focus(); }
          } else if (t.id === 'lf-images') {
            collect();
            dr.images = dr.images || [];
            var files = Array.prototype.slice.call(t.files || []), room = ZP.MAX_PHOTOS - dr.images.length, st2 = $('.form-status', form), added = 0, failed = 0;
            if (files.length > room) { st2.className = 'form-status is-error'; st2.textContent = 'You can add ' + room + ' more photo' + (room === 1 ? '' : 's') + '; the rest were left out.'; }
            files = files.slice(0, Math.max(0, room));
            // One at a time, so the photos keep the order they were chosen in
            var nextPhoto = function () {
              if (!files.length) {
                t.value = '';
                if (failed) { st2.className = 'form-status is-error'; st2.textContent = failed + ' photo' + (failed === 1 ? ' couldn\'t' : 's couldn\'t') + ' be used. Choose JPEG, PNG or WebP files under 10 MB.'; }
                $('#lf-photos').innerHTML = photosHTML();
                var first = $('[data-photo-alt="' + (dr.images.length - added) + '"]', form); if (first) first.focus();
                return;
              }
              bannerFromFile(files.shift(), 600, 600, function (img) { if (img) { dr.images.push({ src: img, alt: '' }); added++; } else failed++; nextPhoto(); });
            };
            nextPhoto();
          } else if (t.id === 'lf-image') {
            bannerFromFile(t.files[0], 600, 600, function (img) {
              var st = $('.form-status', form);
              if (img === null) { st.className = 'form-status is-error'; st.textContent = 'That photo couldn\'t be used. Choose a JPEG, PNG or WebP under 10 MB.'; return; }
              if (!img) return;
              dr.image = img;
              var ph = $('#lf-photo'); ph.src = img; ph.alt = 'New photo'; ph.hidden = false;
            });
          }
        });
        var addSize = function () {
          var inp = $('#lf-newsize'), val = inp.value.trim();
          if (!val) return inp.focus();
          collect();
          var sz = ZP.parseSize(val), label = ZP.sizeLabel(sz).toLowerCase();
          dr.options.size = dr.options.size || [];
          if (!dr.options.size.some(function (x) { return ZP.sizeLabel(x).toLowerCase() === label; })) dr.options.size.push(sz);
          rebuildMatrix(); redraw('#lf-newsize');
        };
        form.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'lf-newsize') { e.preventDefault(); addSize(); } });
        form.addEventListener('click', function (e) {
          var t = e.target.closest('button');
          if (!t || t.type === 'submit') return;
          var n = function (attr) { return Number(t.getAttribute(attr)); };
          if (t.hasAttribute('data-add-extra')) { collect(); dr.options.extra = dr.options.extra || []; var key = dr.options.extra.some(function (a) { return a.key === 'custom_1'; }) ? 'custom_2' : 'custom_1'; dr.options.extra.push({ key: key, name: '', values: [] }); rebuildMatrix(); redraw('#lf-extra-name-' + (dr.options.extra.length - 1)); }
          else if (t.hasAttribute('data-del-extra')) { collect(); dr.options.extra.splice(n('data-del-extra'), 1); rebuildMatrix(); redraw('[data-add-extra]'); }
          else if (t.hasAttribute('data-del-photo')) { collect(); dr.images.splice(n('data-del-photo'), 1); $('#lf-photos').innerHTML = photosHTML(); $('#lf-images').focus(); }
          else if (t.hasAttribute('data-add-spec')) { collect(); specRows.push(['', '']); redraw('#lf-sk-' + (specRows.length - 1)); }
          else if (t.hasAttribute('data-del-spec')) { collect(); specRows.splice(n('data-del-spec'), 1); redraw('[data-add-spec]'); }
          else if (t.hasAttribute('data-add-box')) { collect(); dr.inBox.push({ item: '' }); redraw('#lf-bi-' + (dr.inBox.length - 1)); }
          else if (t.hasAttribute('data-del-box')) { collect(); dr.inBox.splice(n('data-del-box'), 1); redraw('[data-add-box]'); }
          else if (t.hasAttribute('data-add-col')) { collect(); dr.options.colour = (dr.options.colour || []).concat([{ name: '', hex: '#808080' }]); redraw('#lf-cn-' + (dr.options.colour.length - 1)); }
          else if (t.hasAttribute('data-del-col')) { collect(); dr.options.colour.splice(n('data-del-col'), 1); rebuildMatrix(); redraw('[data-add-col]'); }
          else if (t.hasAttribute('data-add-size')) addSize();
          else if (t.hasAttribute('data-add-tier')) { collect(); var last = dr.priceTiers[dr.priceTiers.length - 1]; dr.priceTiers.push({ min: last ? last.min * 2 : (dr.trade ? dr.minQty : 1) + 1, price: '' }); $('#lf-tiers').innerHTML = tiersHTML(); $('#lf-tp-' + (dr.priceTiers.length - 1)).focus(); }
          else if (t.hasAttribute('data-del-tier')) { collect(); dr.priceTiers.splice(n('data-del-tier'), 1); $('#lf-tiers').innerHTML = tiersHTML(); var addT = $('[data-add-tier]', form); if (addT) addT.focus(); }
          else if (t.hasAttribute('data-del-size')) { collect(); dr.options.size.splice(n('data-del-size'), 1); rebuildMatrix(); redraw('#lf-newsize'); }
          else if (t.hasAttribute('data-fill-sku')) {
            collect();
            dr.variants.forEach(function (v) { if (!v.sku) v.sku = ZP.skuFor(editing ? editing.id : dr.title, v); });
            redraw('[data-fill-sku]');
          }
        });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          collect();
          $$('[aria-invalid]', form).forEach(function (x) { x.removeAttribute('aria-invalid'); });
          var res = editing ? listingsApi.update(editing.id, dr, ctx) : listingsApi.create(dr, ctx), box = $('#lf-errors');
          if (!res.ok) {
            box.hidden = false;
            box.innerHTML = '<h2 class="h3">Please fix ' + (res.errors.length === 1 ? 'this' : 'these ' + res.errors.length + ' things') + '</h2><ul>' + res.errors.map(function (er) {
              var wrap = $('#lf-f-' + er.field), ctl = wrap && $('input, select, textarea', wrap);
              if (ctl) ctl.setAttribute('aria-invalid', 'true');
              return '<li>' + (ctl ? '<a href="#lf-f-' + er.field + '" data-goto="' + er.field + '">' + esc(er.message) + '</a>' : esc(er.message)) + '</li>';
            }).join('') + '</ul>';
            box.focus();
            return;
          }
          loadProducts();
          toast((editing ? 'Changes saved' : 'Product added') + (res.stored ? '' : '. This browser\'s storage is full, so it lasts until you close the page.'));
          var to = '#/listing/' + encodeURIComponent(res.product.id) + '?saved=1';
          if (location.hash === to) route(); else location.hash = to;
        });
        $('#lf-errors').addEventListener('click', function (e) {
          var a = e.target.closest('[data-goto]'); if (!a) return;
          e.preventDefault();
          var wrap = $('#lf-f-' + a.getAttribute('data-goto')), ctl = wrap && $('input, select, textarea', wrap);
          if (ctl) ctl.focus();
        });
        var del = $('#lf-delete');
        if (del) del.addEventListener('click', function () {
          listingsApi.remove(editing.id);
          loadProducts();
          toast(byId(BASE_PRODUCTS, editing.id) ? 'Your changes were undone' : 'Product deleted');
          location.hash = '#/seller';
        });
        var cp = $('[data-copy-entry]');
        if (cp) cp.addEventListener('click', function () {
          var ta = $('.lf-code');
          ta.select();
          var done = function () { toast('Copied'); };
          if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done, function () { document.execCommand('copy'); done(); });
          else { document.execCommand('copy'); done(); }
        });
      }
    };
    return { listing: function () { return form.listing.apply(null, arguments); } };
  };
})();
