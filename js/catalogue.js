/* Zed Supply — store data and settings.
   Edit this file to change products, sellers, brands, promotions, vouchers and
   pricing settings. Save it and refresh the page. No build step.

   EVERYTHING MARKED sample: true IS EXAMPLE CONTENT. Replace it with real
   sellers, products, prices and reviews before launch, then set isSample: false.

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
    isSample: true,              // set to false once the content below is real

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

    // ---- Zambia Independence celebration theme ----
    // Switches on automatically every year between these dates (month-day) and
    // off again on 1 January. Independence Day is 24 October (1964).
    // Preview any time by adding ?theme=zambia to the address (or ?theme=off).
    celebration: { enabled: true, start: '10-01', end: '12-31', independenceDay: '10-24', independenceYear: 1964 }
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
    { id: 'welcome', label: "Zambia's marketplace", title: 'Everything Within Reach', text: 'Discover everyday favourites and business essentials from Zambian sellers, priced in Kwacha.', cta: "Shop today's deals", link: '#/deals', colours: ['#0A2A66', '#0057AE'], art: 'logo', photo: true, image: 'assets/banners/alternatives/marketplace-3d.jpg' },
    { id: 'solar-collection', label: 'Solar & power', title: 'Keep your day moving', text: 'Explore solar lighting, portable power and energy essentials for your home or business.', cta: 'Explore solar & power', link: '#/dept/solar', colours: ['#071D47', '#0E7C86'], photo: true, image: 'assets/banners/alternatives/solar-3d.jpg' },
    { id: 'sample-ad', sample: true, image: 'assets/banners/sample-ad-wide.jpg', imageMobile: 'assets/banners/sample-ad-mobile.jpg', alt: 'Sample advert: your banner here. Replace with real advertising artwork.', link: '#/sell' },
    { id: 'business-collection', label: 'For your next big step', title: 'Built for your business', text: 'Find tools, packaging, office essentials and equipment for the work ahead.', cta: 'Shop business supplies', link: '#/dept/business', colours: ['#0A2A66', '#0057AE'], photo: true, image: 'assets/banners/alternatives/business-3d.jpg' },
    { id: 'world', label: 'Coming soon', title: 'A world of possibility', text: 'Shop from China and beyond, with landed costs in Kwacha. Opening once supplier agreements are in place.', cta: 'Discover Shop the World', link: '#/world', colours: ['#071D47', '#0E7C86'], photo: true, image: 'assets/banners/alternatives/world-3d.jpg', art: '<img src=\"assets/icons/world.svg\" alt=\"\">' }
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
    { id: 'school', name: 'Back to school', colours: ['#0057AE', '#1BA6C9'] },
    { id: 'easter', name: 'Easter', colours: ['#6D28D9', '#A855F7'] },
    { id: 'valentines', name: "Valentine's Day", colours: ['#9D174D', '#DB2777'] },
    { id: 'independence', name: 'Independence Day', colours: ['#0F5E1A', '#198A00'] },
    { id: 'farmers', name: "Farmers' Day", colours: ['#3F6212', '#65A30D'] },
    { id: 'own', name: "Seller's own promotion", colours: ['#0A2A66', '#0057AE'] }
  ],

  // Registered sellers [SAMPLE]
  sellers: [
    { id: 'store-a', sample: true, name: 'Sample Store A', city: 'Lusaka', verified: true, about: '[SAMPLE] Office, tech and home products.', colours: ['#0A2A66', '#0057AE'] },
    { id: 'store-b', sample: true, name: 'Sample Store B', city: 'Lusaka', verified: true, about: '[SAMPLE] Solar, power and small business equipment.', colours: ['#0F5E2E', '#1A8A3A'] },
    { id: 'store-c', sample: true, name: 'Sample Store C', city: 'Lusaka', verified: false, about: '[SAMPLE] Fashion, homeware and everyday essentials.', colours: ['#7C2D12', '#C2410C'] }
  ],

  // Brand stores [SAMPLE]
  brands: [
    { id: 'brand-a', sample: true, name: 'Sample Brand A', tagline: '[SAMPLE] Electronics and accessories', colours: ['#0B3A85', '#1BA6C9'] },
    { id: 'brand-b', sample: true, name: 'Sample Brand B', tagline: '[SAMPLE] Solar and power', colours: ['#0F5E2E', '#4CC21A'] },
    { id: 'brand-c', sample: true, name: 'Sample Brand C', tagline: '[SAMPLE] Home and kitchen', colours: ['#7C2D12', '#EA580C'] },
    { id: 'brand-d', sample: true, name: 'Sample Brand D', tagline: '[SAMPLE] Tools and hardware', colours: ['#1F2937', '#4B5563'] }
  ],

  /* Products [SAMPLE]
     image: square photo, 600×600, under 80KB, in assets/products/ ('' shows the department icon)
     stock: 'in' (in stock), 'low' (few left) or 'request' (sourced on request) */
  products: [
    { id: 'L001', sample: true, title: 'A4 copy paper, box of 5 reams', category: 'office', seller: 'store-a', brand: '', priceZMW: 450, wasZMW: 520, stock: 'in', image: 'assets/products/L001.jpg', alt: 'Box of five reams of white A4 copy paper', tags: 'paper printing office',
      reviews: [{ name: 'Sample customer', rating: 5, date: '2026-10-12', text: '[SAMPLE REVIEW] Replace with a real customer review.' }] },
    { id: 'L002', sample: true, title: 'Rechargeable solar LED lantern', category: 'solar', seller: 'store-b', brand: 'brand-b', priceZMW: 380, stock: 'in', image: 'assets/products/L002.jpg', alt: 'Portable LED lantern with a small solar panel on top', tags: 'light load-shedding lamp',
      reviews: [{ name: 'Sample customer', rating: 4, date: '2026-10-02', text: '[SAMPLE REVIEW] Replace with a real customer review.' }] },
    { id: 'L003', sample: true, title: 'Non-stick cookware set, 7 pieces', category: 'home', seller: 'store-c', brand: 'brand-c', priceZMW: 1200, wasZMW: 1450, stock: 'low', image: 'assets/products/L003.jpg', alt: 'Set of black non-stick pots and pans with glass lids', tags: 'pots pans kitchen', reviews: [] },
    { id: 'L004', sample: true, title: 'Power bank, 20,000 mAh', category: 'tech', seller: 'store-b', brand: 'brand-a', priceZMW: 520, stock: 'in', image: 'assets/products/L004.jpg', alt: 'Slim black power bank with two USB ports', tags: 'charger battery phone',
      reviews: [{ name: 'Sample customer', rating: 5, date: '2026-09-28', text: '[SAMPLE REVIEW] Replace with a real customer review.' }] },
    { id: 'L005', sample: true, title: 'Portable Bluetooth speaker', category: 'tech', seller: 'store-a', brand: 'brand-a', priceZMW: 650, stock: 'in', image: 'assets/products/L005.jpg', alt: 'Round portable speaker with a carry strap', tags: 'music audio', reviews: [] },
    { id: 'L006', sample: true, title: 'Solar home lighting kit, 4 bulbs', category: 'solar', seller: 'store-b', brand: 'brand-b', priceZMW: 1850, wasZMW: 2100, stock: 'in', image: 'assets/products/L006.jpg', alt: 'Small solar panel with battery box and four LED bulbs', tags: 'load-shedding power lights',
      reviews: [{ name: 'Sample customer', rating: 4, date: '2026-10-15', text: '[SAMPLE REVIEW] Replace with a real customer review.' }] },
    { id: 'L007', sample: true, title: "Women's leather handbag", category: 'fashion', seller: 'store-c', brand: '', priceZMW: 480, stock: 'in', image: 'assets/products/L007.jpg', alt: 'Brown leather handbag with a shoulder strap', tags: 'bag ladies', reviews: [] },
    { id: 'L008', sample: true, title: "Men's casual sneakers", category: 'fashion', seller: 'store-c', brand: '', priceZMW: 720, stock: 'low', image: 'assets/products/L008.jpg', alt: 'White casual sneakers', tags: 'shoes trainers', reviews: [] },
    { id: 'L009', sample: true, title: 'Electric kettle, 1.7 litre', category: 'home', seller: 'store-a', brand: 'brand-c', priceZMW: 390, stock: 'in', image: 'assets/products/L009.jpg', alt: 'Stainless steel electric kettle', tags: 'kitchen appliance', reviews: [] },
    { id: 'L010', sample: true, title: 'Heat sealing machine for packaging', category: 'business', seller: 'store-b', brand: '', priceZMW: 1650, stock: 'request', image: 'assets/products/L010.jpg', alt: 'Tabletop heat sealing machine sealing a plastic bag', tags: 'packaging sme sealer', reviews: [] },
    { id: 'L011', sample: true, title: 'School backpack with laptop pocket', category: 'baby', seller: 'store-a', brand: '', priceZMW: 280, stock: 'in', image: 'assets/products/L011.jpg', alt: 'Navy school backpack with a front zip pocket', tags: 'school bag kids', reviews: [] },
    { id: 'L012', sample: true, title: 'Knapsack sprayer, 16 litre', category: 'agri', seller: 'store-b', brand: '', priceZMW: 560, stock: 'in', image: 'assets/products/L012.jpg', alt: 'Green 16 litre knapsack crop sprayer', tags: 'farming garden', reviews: [] },
    { id: 'L013', sample: true, title: 'Cordless drill kit with 2 batteries', category: 'hardware', seller: 'store-a', brand: 'brand-d', priceZMW: 1350, wasZMW: 1500, stock: 'in', image: 'assets/products/L013.jpg', alt: 'Cordless drill with two batteries in a carry case', tags: 'tools diy', reviews: [] },
    { id: 'L014', sample: true, title: 'Car phone holder with charger', category: 'auto', seller: 'store-a', brand: 'brand-a', priceZMW: 210, stock: 'in', image: 'assets/products/L014.jpg', alt: 'Phone holder clipped to a car air vent', tags: 'car accessories', reviews: [] },
    { id: 'L015', sample: true, title: 'Digital bathroom scale', category: 'health', seller: 'store-c', brand: '', priceZMW: 330, stock: 'in', image: 'assets/products/L015.jpg', alt: 'Glass digital bathroom scale', tags: 'weight fitness', reviews: [] },
    { id: 'L016', sample: true, title: 'Household cleaning bundle', category: 'essentials', seller: 'store-c', brand: '', priceZMW: 260, stock: 'in', image: 'assets/products/L016.jpg', alt: 'Bundle of household cleaning products', tags: 'cleaning soap detergent', reviews: [] },

    // ---- China samples: only shown when chinaOrdering is true ----
    { id: 'C001', sample: true, source: 'china', title: 'Wireless earbuds with charging case', category: 'tech', seller: '', brand: '', priceCNY: 85, weightKg: 0.2, shipping: '[__] days air cargo', url: '', image: 'assets/products/C001.jpg', alt: 'White wireless earbuds next to their charging case', reviews: [] },
    { id: 'C002', sample: true, source: 'china', title: '100W foldable solar panel kit', category: 'solar', seller: '', brand: '', priceCNY: 260, weightKg: 3.5, shipping: '[__] days air cargo', url: '', image: 'assets/products/C002.jpg', alt: 'Foldable solar panel opened flat', reviews: [] }
  ],

  /* Promotions run by sellers [SAMPLE]. Optional image: a 1600×500 banner shown in the
     homepage carousel while the promotion is live. Sellers can also create their own in the
     Seller Centre demo; those are saved in that browser only until Phase 2. */
  promotions: [
    { id: 'P1', sample: true, seller: 'store-a', title: 'Grand opening specials', season: 'own', discount: 10, starts: '2026-10-20', ends: '2026-11-30', products: ['L001', 'L005', 'L009'], about: '[SAMPLE] Opening offers across office and home.' },
    { id: 'P2', sample: true, seller: 'store-b', title: 'Beat load-shedding: solar week', season: 'own', discount: 15, starts: '2026-10-24', ends: '2026-11-15', products: ['L002', 'L006'], about: '[SAMPLE] Solar lighting for power cuts.' },
    { id: 'P3', sample: true, seller: 'store-b', title: 'Black Friday weekend', season: 'blackfriday', discount: 20, starts: '2026-11-27', ends: '2026-11-30', products: ['L004', 'L010'], about: '[SAMPLE] Tech and business equipment.' },
    { id: 'P4', sample: true, seller: 'store-c', title: 'Festive season deals', season: 'christmas', discount: 20, starts: '2026-12-01', ends: '2026-12-26', products: ['L003', 'L007', 'L008'], about: '[SAMPLE] Gifts and homeware for the holidays.' },
    { id: 'P5', sample: true, seller: 'store-a', title: 'Back to school', season: 'school', discount: 10, starts: '2027-01-04', ends: '2027-01-31', products: ['L011', 'L001'], about: '[SAMPLE] School bags and stationery.' },
    { id: 'P6', sample: true, seller: 'store-b', title: 'Independence celebration deals', season: 'independence', discount: 12, starts: '2026-10-01', ends: '2026-10-31', products: ['L012', 'L016', 'L013'], about: '[SAMPLE] Celebrating Zambia with local favourites.' }
  ],

  // Voucher codes customers can enter in the cart [SAMPLE]
  vouchers: [
    { code: 'WELCOME10', sample: true, percent: 10, minSpend: 500, label: '10% off orders over K500 [SAMPLE]' }
  ],

  // Demo order so customers can try order tracking: type ZS-DEMO01 on the Track order page
  demoOrder: { ref: 'ZS-DEMO01', sample: true, date: '2026-10-20', items: [{ id: 'L006', qty: 1, price: 1850 }], total: 1850, status: 3 }
};
