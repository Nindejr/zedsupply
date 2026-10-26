/* Zed Supply — shop data and pricing settings.
   This is the ONLY file you need to edit to change products, the exchange rate
   or fees. Save it and refresh shop.html. No build step.

   LOCAL products (source: 'local') use priceZMW as the price shown. Delivery is
   confirmed on WhatsApp.

   CHINA products (source: 'china') and the calculator, only when chinaOrdering is true:
     item      = priceCNY × exchangeRate × quantity
     shipping  = weightKg × quantity × shippingPerKg
     clearance = % of (item + shipping), or a fixed amount per order
     fee       = % of (item + shipping + clearance), or a fixed amount per order
     TOTAL     = item + shipping + clearance + fee   (rounded up to the nearest Kwacha)
*/
window.ZS_CATALOGUE = {
  settings: {
    // ---- China ordering switch ----
    // false: only local products are shown; the CNY calculator and Alibaba/1688/Taobao
    //        wording on shop.html are hidden.
    // true:  China products, the landed cost calculator and the China wording appear.
    chinaOrdering: false,

    // ---- Pricing: ALL VALUES BELOW ARE SAMPLES. Replace them before launch. ----
    isSample: true,              // set to false once your products and numbers are real
    exchangeRate: 3.50,          // Kwacha per 1 Chinese Yuan (CNY/RMB) [SAMPLE]
    rateUpdated: '[DATE]',       // e.g. '26 Oct 2026', shown next to every estimate
    shippingPerKg: 250,          // Kwacha per kg, air cargo to Lusaka [SAMPLE]
    clearance: { type: 'percent', value: 15 },  // duties and clearing [SAMPLE]; type 'percent' or 'fixed'
    fee: { type: 'percent', value: 10 },        // Zed Supply service fee [SAMPLE]; type 'percent' or 'fixed'

    // ---- Affiliate / agent tracking ----
    // Added to every "View original listing" link as ?ref=YOURCODE.
    // Leave the square-bracket placeholder and nothing is added.
    tracking: { param: 'ref', value: '[TRACKING_CODE]' },

    whatsapp: '260979050042'
  },

  // Departments shown as filter chips. Link to one with shop.html?cat=<id>
  categories: [
    { id: 'tech', name: 'Phones, Tech & Smart Gadgets' },
    { id: 'solar', name: 'Solar, Power & Energy' },
    { id: 'fashion', name: 'Fashion, Beauty & Hair' },
    { id: 'home', name: 'Home, Kitchen & Appliances' },
    { id: 'business', name: 'Small Business & Manufacturing Equipment' },
    { id: 'office', name: 'Office, School & Stationery' },
    { id: 'agri', name: 'Agriculture & Farming' },
    { id: 'auto', name: 'Auto Parts & Accessories' },
    { id: 'hardware', name: 'Building, Tools & Hardware' },
    { id: 'baby', name: 'Baby, Kids & Toys' },
    { id: 'health', name: 'Health, Fitness & Personal Care' },
    { id: 'essentials', name: 'Everyday Essentials' }
  ],

  /* Products. Copy a block to add one.
     source:   'local' or 'china'
     priceZMW: local items, the price in Kwacha
     priceCNY: China items, the price on the Chinese listing (plus weightKg)
     badge:    optional gold label, e.g. 'Trending in Lusaka' (only if true!)
     shipping: text for the delivery badge
     url:      original listing link (Alibaba / 1688 / Taobao), or '' for none
     image:    put a square photo (600×600, under 80KB) in assets/products/ */
  products: [
    // ---- Local samples (shown now) ----
    {
      id: 'ZS-L001',
      sample: true,
      title: 'A4 copy paper, box of 5 reams',
      category: 'office',
      source: 'local',
      priceZMW: 450,
      badge: '',
      shipping: 'Lusaka delivery: [__] days',
      url: '',
      image: 'assets/products/sample-a4-paper.jpg',
      alt: 'Box of five reams of white A4 copy paper'
    },
    {
      id: 'ZS-L002',
      sample: true,
      title: 'Rechargeable solar LED lantern',
      category: 'solar',
      source: 'local',
      priceZMW: 380,
      badge: 'Trending in Lusaka',
      shipping: 'Lusaka delivery: [__] days',
      url: '',
      image: 'assets/products/sample-solar-lantern.jpg',
      alt: 'Portable LED lantern with a small solar panel on top'
    },
    {
      id: 'ZS-L003',
      sample: true,
      title: 'Non-stick cookware set, 7 pieces',
      category: 'home',
      source: 'local',
      priceZMW: 1200,
      badge: '',
      shipping: 'Lusaka delivery: [__] days',
      url: '',
      image: 'assets/products/sample-cookware.jpg',
      alt: 'Set of black non-stick pots and pans with glass lids'
    },

    // ---- China samples (hidden while chinaOrdering is false) ----
    {
      id: 'ZS-S001',
      sample: true,
      title: 'Wireless earbuds with charging case',
      category: 'tech',
      source: 'china',
      priceCNY: 85,
      weightKg: 0.2,
      badge: 'Hot in China',
      shipping: '[__] days air cargo',
      url: '',
      image: 'assets/products/sample-earbuds.jpg',
      alt: 'White wireless earbuds next to their open charging case'
    },
    {
      id: 'ZS-S002',
      sample: true,
      title: '100W foldable solar panel kit',
      category: 'solar',
      source: 'china',
      priceCNY: 260,
      weightKg: 3.5,
      badge: 'Trending in Lusaka',
      shipping: '[__] days air cargo',
      url: '',
      image: 'assets/products/sample-solar-panel.jpg',
      alt: 'Foldable solar panel opened flat on grass with its charge controller'
    },
    {
      id: 'ZS-S003',
      sample: true,
      title: 'Human hair lace-front wig, 18 inch',
      category: 'fashion',
      source: 'china',
      priceCNY: 320,
      weightKg: 0.5,
      badge: '',
      shipping: '[__] days air cargo',
      url: '',
      image: 'assets/products/sample-wig.jpg',
      alt: 'Long straight dark lace-front wig on a mannequin head'
    }
  ]
};
