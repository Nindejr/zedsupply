/* Zed Supply — DEMO content (sample sellers, brands, products, reviews, promotions,
   voucher, demo order and sample advert).

   None of this is shown on the live store. It loads only in demo mode:
     index.html?demo=1   turn demo mode on (stays on while the tab is open)
     index.html?demo=0   turn it off again
   Use it to show sellers or investors how a full store will look.

   To launch a real product, add it to js/catalogue.js (not here).
*/
window.ZS_SAMPLE = {
  // Sample advert slide, added to the banner in demo mode
  banners: [
    { id: 'sample-ad', sample: true, image: 'assets/banners/sample-ad-wide.webp', imageMobile: 'assets/banners/sample-ad-mobile.webp', alt: 'Sample advert: your banner here. Replace with real advertising artwork.', link: '#/sell' }
  ],

  // Registered sellers [SAMPLE]
  sellers: [
    { id: 'store-a', sample: true, couriers: ['rapidriders', 'zampost'], name: 'Sample Store A', city: 'Lusaka', verified: true, about: '[SAMPLE] Office, tech and home products.', colours: ['#0A2A66', '#0057AE'] },
    { id: 'store-b', sample: true, couriers: ['kingsway', 'fedex', 'dhl'], name: 'Sample Store B', city: 'Lusaka', verified: true, about: '[SAMPLE] Solar, power and small business equipment.', colours: ['#0F5E2E', '#1A8A3A'] },
    { id: 'store-c', sample: true, couriers: ['dropsync', 'yango', 'zampost'], name: 'Sample Store C', city: 'Lusaka', verified: false, about: '[SAMPLE] Fashion, homeware and everyday essentials.', colours: ['#7C2D12', '#C2410C'] }
  ],

  // Brand stores [SAMPLE]
  brands: [
    { id: 'brand-a', sample: true, featured: true, name: 'Sample Brand A', tagline: '[SAMPLE] Electronics and accessories', colours: ['#0B3A85', '#1BA6C9'] },
    { id: 'brand-b', sample: true, featured: true, name: 'Sample Brand B', tagline: '[SAMPLE] Solar and power', colours: ['#0F5E2E', '#4CC21A'] },
    { id: 'brand-c', sample: true, name: 'Sample Brand C', tagline: '[SAMPLE] Home and kitchen', colours: ['#7C2D12', '#EA580C'] },
    { id: 'brand-d', sample: true, name: 'Sample Brand D', tagline: '[SAMPLE] Tools and hardware', colours: ['#1F2937', '#4B5563'] }
  ],

  /* Products [SAMPLE]
     image: square photo, 600×600, under 80KB, in assets/products/ ('' shows the department icon)
     stock: 'in' (in stock), 'low' (few left) or 'request' (sourced on request) */
  products: [
    { id: 'L001', sample: true, demoSales: [9, 12], title: 'A4 copy paper, box of 5 reams', category: 'office', seller: 'store-a', brand: '', priceZMW: 450, wasZMW: 520, stock: 'in', image: 'assets/products/L001.webp', alt: 'Box of five reams of white A4 copy paper', tags: 'paper printing office',
      reviews: [{ name: 'Sample customer', rating: 5, date: '2026-10-12', verified: true, text: '[SAMPLE REVIEW] Replace with a real customer review.' }] },
    { id: 'L002', sample: true, demoSales: [14, 10], match: 'solar-lantern-led', title: 'Rechargeable solar LED lantern', category: 'solar', seller: 'store-b', brand: 'brand-b', priceZMW: 380, stock: 'in', image: 'assets/products/L002.webp', alt: 'Portable LED lantern with a small solar panel on top', tags: 'light load-shedding lamp',
      reviews: [{ name: 'Sample customer', rating: 4, date: '2026-10-02', text: '[SAMPLE REVIEW] Replace with a real customer review.' }] },
    { id: 'L003', sample: true, demoSales: [4, 6], title: 'Non-stick cookware set, 7 pieces', category: 'home', seller: 'store-c', brand: 'brand-c', priceZMW: 1200, wasZMW: 1450, commit: { min: 1050, max: 1200 }, stock: 'low', image: 'assets/products/L003.webp', alt: 'Set of black non-stick pots and pans with glass lids', tags: 'pots pans kitchen', reviews: [] },
    { id: 'L004', sample: true, demoSales: [11, 7], match: 'power-bank-20000', title: 'Power bank, 20,000 mAh', category: 'tech', seller: 'store-b', brand: 'brand-a', priceZMW: 520, commit: { min: 470, max: 520 }, stock: 'in',
      attributes: { specs: { 'Capacity': '20,000 mAh', 'Ports': '2 × USB' } },
      inBox: [{ item: 'Charging cable' }, { item: '[SAMPLE] Wall charger', addonZMW: 120 }], image: 'assets/products/L004.webp', alt: 'Slim black power bank with two USB ports', tags: 'charger battery phone',
      reviews: [{ name: 'Sample customer', rating: 5, date: '2026-09-28', text: '[SAMPLE REVIEW] Replace with a real customer review.' }] },
    { id: 'L005', sample: true, demoSales: [6, 8], title: 'Portable Bluetooth speaker', category: 'tech', seller: 'store-a', brand: 'brand-a', priceZMW: 650, stock: 'in', image: 'assets/products/L005.webp', alt: 'Round portable speaker with a carry strap', tags: 'music audio', reviews: [] },
    { id: 'L006', sample: true, demoSales: [7, 9], title: 'Solar home lighting kit, 4 bulbs', category: 'solar', seller: 'store-b', brand: 'brand-b', priceZMW: 1850, wasZMW: 2100, stock: 'in', image: 'assets/products/L006.webp', alt: 'Small solar panel with battery box and four LED bulbs', tags: 'load-shedding power lights',
      reviews: [{ name: 'Sample customer', rating: 4, date: '2026-10-15', text: '[SAMPLE REVIEW] Replace with a real customer review.' }] },
    { id: 'L007', sample: true, demoSales: [5, 3], title: "Women's leather handbag", category: 'fashion', seller: 'store-c', brand: '', priceZMW: 480, stock: 'in', image: 'assets/products/L007.webp', alt: 'Brown leather handbag with a shoulder strap', tags: 'bag ladies', reviews: [] },
    { id: 'L008', sample: true, demoSales: [3, 4], title: "Men's casual sneakers", category: 'fashion', seller: 'store-c', brand: '', priceZMW: 720, stock: 'low',
      attributes: { ageRange: ['teen', 'adult'] },
      options: { colour: [{ name: 'White', hex: '#F5F5F0' }], size: ['40', '41', '42', '43', '44'] },
      variants: [{ sku: 'S-L008-WHT-40', colour: 'White', size: '40', stock: 2 }, { sku: 'S-L008-WHT-41', colour: 'White', size: '41', stock: 4 },
        { sku: 'S-L008-WHT-42', colour: 'White', size: '42', stock: 3 }, { sku: 'S-L008-WHT-43', colour: 'White', size: '43', stock: 0 },
        { sku: 'S-L008-WHT-44', colour: 'White', size: '44', stock: 1 }], image: 'assets/products/L008.webp', alt: 'White casual sneakers', tags: 'shoes trainers', reviews: [] },
    { id: 'L009', sample: true, demoSales: [8, 5], match: 'kettle-1-7l', title: 'Electric kettle, 1.7 litre', category: 'home', seller: 'store-a', brand: 'brand-c', priceZMW: 390, stock: 'in', attributes: { size: { value: 1.7, unit: 'l' } }, image: 'assets/products/L009.webp', alt: 'Stainless steel electric kettle', tags: 'kitchen appliance', reviews: [] },
    { id: 'L010', sample: true, demoSales: [1, 2], title: 'Heat sealing machine for packaging', category: 'business', seller: 'store-b', brand: '', priceZMW: 1650, stock: 'request', image: 'assets/products/L010.webp', alt: 'Tabletop heat sealing machine sealing a plastic bag', tags: 'packaging sme sealer', reviews: [] },
    { id: 'L011', sample: true, demoSales: [2, 6], title: 'School backpack with laptop pocket', category: 'baby', seller: 'store-a', brand: '', priceZMW: 280, stock: 'in', image: 'assets/products/L011.webp', alt: 'Navy school backpack with a front zip pocket', tags: 'school bag kids', reviews: [] },
    { id: 'L012', sample: true, demoSales: [6, 2], title: 'Knapsack sprayer, 16 litre', category: 'agri', seller: 'store-b', brand: '', priceZMW: 560, stock: 'in', image: 'assets/products/L012.webp', alt: 'Green 16 litre knapsack crop sprayer', tags: 'farming garden', deal: { price: 499, reason: 'clearance', ends: '' }, reviews: [] },
    { id: 'L013', sample: true, demoSales: [3, 3], title: 'Cordless drill kit with 2 batteries', category: 'hardware', seller: 'store-a', brand: 'brand-d', priceZMW: 1350, wasZMW: 1500, stock: 'in', image: 'assets/products/L013.webp', alt: 'Cordless drill with two batteries in a carry case', tags: 'tools diy', reviews: [] },
    { id: 'L014', sample: true, demoSales: [4, 2], title: 'Car phone holder with charger', category: 'auto', seller: 'store-a', brand: 'brand-a', priceZMW: 210, stock: 'in', image: 'assets/products/L014.webp', alt: 'Phone holder clipped to a car air vent', tags: 'car accessories', deal: { price: 179, reason: 'reduced', ends: '' }, reviews: [] },
    { id: 'L015', sample: true, demoSales: [2, 1], title: 'Digital bathroom scale', category: 'health', seller: 'store-c', brand: '', priceZMW: 330, stock: 'in', image: 'assets/products/L015.webp', alt: 'Glass digital bathroom scale', tags: 'weight fitness', reviews: [] },
    { id: 'L016', sample: true, demoSales: [9, 8], title: 'Household cleaning bundle', category: 'essentials', seller: 'store-c', brand: '', priceZMW: 260, stock: 'in', image: 'assets/products/L016.webp', alt: 'Bundle of household cleaning products', tags: 'cleaning soap detergent', reviews: [] },

    // Same items from a second seller, so buyers can compare sellers [SAMPLE]
    { id: 'L017', sample: true, demoSales: [5, 4], match: 'solar-lantern-led', title: 'Solar LED camping lantern, rechargeable', category: 'solar', seller: 'store-a', brand: '', priceZMW: 350, stock: 'low', image: 'assets/products/L002.webp', alt: 'Portable LED lantern with a small solar panel on top', tags: 'light load-shedding lamp', reviews: [] },
    { id: 'L018', sample: true, demoSales: [3, 2], match: 'power-bank-20000', title: 'Power bank 20,000 mAh, fast charging', category: 'tech', seller: 'store-c', brand: 'brand-a', priceZMW: 495, stock: 'in', image: 'assets/products/L004.webp', alt: 'Slim black power bank with two USB ports', tags: 'charger battery phone', reviews: [] },
    { id: 'L019', sample: true, demoSales: [2, 1], match: 'kettle-1-7l', title: 'Stainless steel electric kettle, 1.7 litre', category: 'home', seller: 'store-c', brand: '', priceZMW: 365, stock: 'in', image: 'assets/products/L009.webp', alt: 'Stainless steel electric kettle', tags: 'kitchen appliance', reviews: [] },

    // ---- China samples: only shown when chinaOrdering is true ----
    { id: 'C001', sample: true, source: 'china', title: 'Wireless earbuds with charging case', category: 'tech', seller: '', brand: '', priceCNY: 85, weightKg: 0.2, shipping: '[__] days air cargo', url: '', image: 'assets/products/C001.webp', alt: 'White wireless earbuds next to their charging case', reviews: [] },
    { id: 'C002', sample: true, source: 'china', title: '100W foldable solar panel kit', category: 'solar', seller: '', brand: '', priceCNY: 260, weightKg: 3.5, shipping: '[__] days air cargo', url: '', image: 'assets/products/C002.webp', alt: 'Foldable solar panel opened flat', reviews: [] }
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
