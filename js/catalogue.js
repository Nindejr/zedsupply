/* Zed Supply — store data and settings.
   Edit this file to change products, sellers, brands, promotions, vouchers and
   pricing settings. Save it and refresh the page. No build step.

   This file holds the LIVE store content. Demo content is in js/catalogue-sample.js
   and only appears with ?demo=1 in the address.

   Prices
   - Local products: priceZMW is the price shown. wasZMW (optional) shows a
     crossed-out "was" price.
   - When a promotion is live, its discount is applied automatically to the
     products listed in it.
   - China products (source: 'china') only appear when chinaOrdering is true:
       item      = priceCNY × exchangeRate × quantity
       shipping  = weightKg × quantity × shippingPerKg
       clearance = % of (item + shipping), or a fixed amount
       fee       = % of (item + shipping + clearance), or a fixed amount
*/
window.ZS_CATALOGUE = {
  settings: {
    isSample: false,             // true only in demo mode (?demo=1), set automatically

    // ---- Shop the World switch ----
    // false: "Shop the World" shows a coming-soon page and China products are hidden.
    // true:  China products and the landed cost calculator appear under Shop the World.
    chinaOrdering: false,

    // China pricing [ALL SAMPLE VALUES]
    exchangeRate: 3.50,          // Kwacha per 1 Chinese Yuan (CNY) [SAMPLE]
    rateUpdated: '[DATE]',
    shippingPerKg: 250,          // Kwacha per kg, air cargo to Lusaka [SAMPLE]
    clearance: { type: 'percent', value: 15 },
    fee: { type: 'percent', value: 10 },

    // Affiliate / agent tracking, added to "View original listing" links as ?ref=CODE.
    // Leave the square-bracket placeholder and nothing is added.
    tracking: { param: 'ref', value: '[TRACKING_CODE]' },

    deliveryText: 'Lusaka delivery: [__] days',  // shown on every local product
    whatsapp: '260979050042',

    // ---- How customers can pay ----
    // Shown in the cart (customer picks one; it's added to the WhatsApp order), on
    // product pages, in the footer and in the help centre. Set enabled: false to hide
    // one. Never publish merchant codes or till numbers here: payment instructions are
    // sent on WhatsApp after the order is confirmed. Customers approve the payment on
    // their own phone; Zed Supply never asks for a PIN.
    paymentMethods: [
      { id: 'mtn', name: 'MTN MoMo', kind: 'Mobile money', colour: '#FFCB05', enabled: true },
      { id: 'airtel', name: 'Airtel Money', kind: 'Mobile money', colour: '#E4002B', enabled: true },
      { id: 'zamtel', name: 'Zamtel Mobile Money', kind: 'Mobile money', colour: '#00A651', enabled: true }
    ],

    // ---- Mobile apps ----
    // Paste each store's full https:// address once the app is published. The footer
    // buttons then link to it; until then they show "Coming soon".
    apps: { ios: '', android: '', huawei: '' },

    // ---- Courier options ----
    // The courier list (ZICTA's licensed operators, plus details for well-known couriers)
    // lives in js/couriers.js. Set this to false to hide courier choices everywhere.
    couriersEnabled: true,

    // ---- Festive periods ----
    // Each period shows a bar above the header and the first homepage banner slide
    // on its dates, every year. Only one runs at a time: if two would overlap, the
    // one that starts later begins the day after the other ends.
    // Fixed dates are month-day; day is the date the bar counts down to.
    // Moveable dates are worked out each year:
    //   easter:      two weeks before Easter Sunday, to Easter Monday
    //   farmers:     the week before Farmers' Day (first Monday of August), to the day
    //   blackfriday: Monday to Cyber Monday around Black Friday (the day after the
    //                fourth Thursday of November). Christmas starts after it ends.
    // Independence also turns on the Zambian flag theme (Independence Day 24 October 1964).
    // Set enabled: false on a period to skip it. Preview one on any date with
    // ?theme=christmas (or easter, independence...); ?theme=off hides them all.
    festive: {
      enabled: true,
      independenceYear: 1964,
      periods: [
        { id: 'school', start: '01-02', end: '01-20' },              // adjust to the Ministry of Education's term dates
        { id: 'valentines', start: '02-01', end: '02-14', day: '02-14' },
        { id: 'easter', rule: 'easter' },
        { id: 'farmers', rule: 'farmers' },
        { id: 'independence', start: '10-01', end: '10-31', day: '10-24' },
        { id: 'blackfriday', rule: 'blackfriday' },
        { id: 'christmas', start: '12-01', end: '01-01', day: '12-25' }   // runs to New Year's Day
      ]
    }
  },

  /* Homepage advertising banner (carousel). Slides appear in this order, followed by
     every live seller promotion (sellers can upload a banner image in the Seller Centre).

     Two kinds of slide:
     - Image advert: set image (desktop, 1600×500) and imageMobile (phones, 800×640),
       plus alt text describing the advert. Leave title empty: the artwork carries the words.
       Put files in assets/banners/ as JPEG, under 150KB each.
     - Designed slide: leave image empty and fill in title, text, cta and colours.
       art is optional decorative artwork on the right. Keep banner copy in HTML.
     link: where the slide goes, e.g. '#/promo/P2', '#/dept/solar', '#/sell' */
  banners: [
    { id: 'welcome', label: "Zambia's marketplace", title: 'Everything Within Reach', text: 'Discover everyday favourites and business essentials from Zambian sellers, priced in Kwacha.', cta: 'Explore categories', link: '#/departments', colours: ['#0A2A66', '#0057AE'], art: 'logo', photo: true, image: 'assets/banners/alternatives/marketplace-3d.webp', imageMobile: 'assets/banners/alternatives/marketplace-3d-mobile.webp' },
    { id: 'solar-collection', label: 'Solar & power', title: 'Keep your day moving', text: 'Explore solar lighting, portable power and energy essentials for your home or business.', cta: 'Explore solar & power', link: '#/dept/solar', colours: ['#071D47', '#0E7C86'], photo: true, image: 'assets/banners/alternatives/solar-3d.webp', imageMobile: 'assets/banners/alternatives/solar-3d-mobile.webp' },
    { id: 'business-collection', label: 'For your next big step', title: 'Built for your business', text: 'Find tools, packaging, office essentials and equipment for the work ahead.', cta: 'Shop business supplies', link: '#/dept/business', colours: ['#0A2A66', '#0057AE'], photo: true, image: 'assets/banners/alternatives/business-3d.webp', imageMobile: 'assets/banners/alternatives/business-3d-mobile.webp' },
    { id: 'world', label: 'Coming soon', title: 'A world of possibility', text: 'Shop from China and beyond, with landed costs in Kwacha. Opening once supplier agreements are in place.', cta: 'Discover Shop the World', link: '#/world', colours: ['#071D47', '#0E7C86'], photo: true, image: 'assets/banners/alternatives/world-3d.webp', imageMobile: 'assets/banners/alternatives/world-3d-mobile.webp', art: '<img src=\"assets/icons/world.svg\" alt=\"\">' }
  ],

  // Departments. Link to one with index.html#/dept/<id>
  departments: [
    { id: 'tech', name: 'Phones, Tech & Smart Gadgets', icon: '<img src=\"assets/icons/tech.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'solar', name: 'Solar, Power & Energy', icon: '<img src=\"assets/icons/solar.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'fashion', name: 'Fashion, Beauty & Hair', icon: '<img src=\"assets/icons/fashion.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'home', name: 'Home, Kitchen & Appliances', icon: '<img src=\"assets/icons/home.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'business', name: 'Small Business & Manufacturing Equipment', icon: '<img src=\"assets/icons/business.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'office', name: 'Office, School & Stationery', icon: '<img src=\"assets/icons/office.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'agri', name: 'Agriculture & Farming', icon: '<img src=\"assets/icons/agri.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'auto', name: 'Auto Parts & Accessories', icon: '<img src=\"assets/icons/auto.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'hardware', name: 'Building, Tools & Hardware', icon: '<img src=\"assets/icons/hardware.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'baby', name: 'Baby, Kids & Toys', icon: '<img src=\"assets/icons/baby.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'health', name: 'Health, Fitness & Personal Care', icon: '<img src=\"assets/icons/health.svg\" alt=\"\" width=\"32\" height=\"32\">' },
    { id: 'essentials', name: 'Everyday Essentials', icon: '<img src=\"assets/icons/essentials.svg\" alt=\"\" width=\"32\" height=\"32\">' }
  ],

  // Seasons sellers can choose for a promotion
  seasons: [
    { id: 'christmas', name: 'Christmas & festive season', colours: ['#8A1022', '#C8102E'] },
    { id: 'blackfriday', name: 'Black Friday', colours: ['#111827', '#374151'] },
    { id: 'school', name: 'Back to school', colours: ['#0A2A66', '#0B6E99'] },
    { id: 'easter', name: 'Easter', colours: ['#5B21B6', '#7C3AED'] },
    { id: 'valentines', name: "Valentine's Day", colours: ['#9D174D', '#BE185D'] },
    { id: 'independence', name: 'Independence Day', colours: ['#0F5E1A', '#137200'] },
    { id: 'farmers', name: "Farmers' Day", colours: ['#2F4A10', '#3F6212'] },
    { id: 'own', name: "Seller's own promotion", colours: ['#0A2A66', '#0057AE'] }
  ],

  /* ---- Live store content ----
     Empty until real sellers and products are confirmed. Each section of the store
     shows a friendly "coming soon / request it on WhatsApp" message while empty.
     Demo content lives in js/catalogue-sample.js (view it with ?demo=1);
     copy an entry from there as a starting point for a real one. */

  // Registered sellers: { id, name, city, verified, about, colours: [a, b], couriers: ['zampost', ...] (optional, courier ids from js/couriers.js) }
  sellers: [],

  /* Brand stores: { id, name, tagline, colours: [a, b], featured, logo }
     featured: true puts the brand first in the Featured brands strip under the banner.
     logo (optional): authentic square brand image, 80×80, in assets/brands/.
     category (optional): department ID for the 3D artwork when no logo is supplied.
     Never substitute an invented logo for a real business identity. */
  brands: [],

  /* Products
     { id, title, category, seller, brand, priceZMW, wasZMW (optional, only for a
       genuine previous price), stock: 'in' | 'low' | 'request', image, alt, tags,
       description, reviews: [], and optionally: }
       sales:  units sold per month from confirmed WhatsApp orders, e.g. { '2026-10': 14, '2026-09': 9 }.
               Drives Trending now and the monthly Top picks, so keep this and last month up to date.
       match:  the same word for the same item from different sellers, e.g. 'solar-lantern-led'.
               Buyers then see "Also sold by" and can compare the sellers side by side.
       added:  date first listed, 'YYYY-MM-DD'. New listings get a small lift in Trending.
       deal:   { price, reason, ends } a lower price for a limited time. reason is one of
               'reduced', 'clearance', 'limited', 'bundle', 'seasonal'; ends is 'YYYY-MM-DD' or ''.
     image: square photo, 600×600, WebP or JPEG under 80KB, in assets/products/
     Keep product images faithful to the actual item, including its colour and contents.
     Use consistent square framing and a clean background; do not add campaign text.
     Decorative 3D category artwork belongs in department and campaign panels, not
     as a replacement for real product photography. Sample illustrations stay in demo mode.
     Reviews must come from real customers. */
  products: [],

  /* Promotions run by sellers. Optional image: a 1600×500 banner shown in the homepage
     carousel while the promotion is live. Sellers can also create their own in the
     Seller Centre demo; those are saved in that browser only until Phase 2. */
  promotions: [],

  // Voucher codes customers can enter in the cart: { code, percent, minSpend, label }
  vouchers: [],

  // Order shown when someone types its number on the Track order page (demo only)
  demoOrder: null
};
