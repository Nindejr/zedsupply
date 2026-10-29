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

    // ---- VAT ----
    // Zambia's standard VAT rate is 16%. Only a business registered for VAT with ZRA may charge
    // it: set registered: true and the TPIN once Zed Supply is registered. included: true means
    // listed prices already include VAT (usual for shops), so totals show "Includes VAT".
    // A seller who isn't VAT-registered can set vatRegistered: false on their seller entry, and
    // their items are left out of the VAT figure.
    vat: { rate: 16, included: true, registered: true, tpin: '[TPIN]' },

    // ---- Delivery days and times ----
    // Buyers pick a preferred day and time at checkout; it's confirmed on WhatsApp.
    // estimates: typical delivery time by distance, shown at checkout once filled in ('' hides it).
    // leadDays: the earliest day a buyer can pick, counted from today. closedDays: 0 = Sunday … 6 = Saturday.
    delivery: {
      enabled: true,
      estimates: { town: '', country: '', world: '' },      // e.g. '1–2 working days'
      leadDays: 1, daysAhead: 14, closedDays: [0],
      slots: [
        { id: 'morning', label: 'Morning (08:00–12:00)' },
        { id: 'afternoon', label: 'Afternoon (12:00–17:00)' },
        { id: 'evening', label: 'Evening (17:00–19:00)' }
      ]
    },

    // ---- Orders: gifts, cancelling, saved addresses, complaints ----
    // gifts: a gift message and "leave prices out of the parcel" at checkout.
    // cancel.untilStatus: buyers can ask to cancel until this step (0 sent, 1 confirmed, 2 packed).
    // addresses: an address book in My Account, chosen from at checkout. Saved on the buyer's
    //   device for now; sync: true once accounts are on the server (db/migrations/006).
    // complaints.replyDays: working days we promise to reply to a complaint within.
    //   sellerDashboard: true once sellers sign in on the server and can answer complaints themselves.
    // returns: the interim returns policy in the help centre. Review it with legal advice.
    orderOptions: {
      gifts: true,
      cancel: { enabled: true, untilStatus: 1 },
      addresses: { enabled: true, max: 10, sync: false },
      complaints: { enabled: true, replyDays: 2, sellerDashboard: false },
      returns: { changeOfMindDays: 7, faultyDays: 7, refundDays: 14 }
    },
    whatsapp: '260979050042',

    // ---- How customers can pay ----
    // Shown in the cart (customer picks one; it's added to the WhatsApp order), on
    // product pages, in the footer and in the help centre. Set enabled: false to hide
    // one. Never publish merchant codes or till numbers here: payment instructions are
    // sent on WhatsApp after the order is confirmed. Customers approve the payment on
    // their own phone; Zed Supply never asks for a PIN.
    //
    // kind: 'mobile' (mobile money), 'bank' (bank transfer or bank app), 'card' (a secure
    // payment link from a licensed payment provider) or 'cash' (cash on delivery).
    // note: one line for buyers, shown at checkout and in the help centre.
    // The bank, card and cash methods are off until their accounts are open: switch one on
    // with enabled: true. preview: true shows it in demo mode (?demo=1) so it can be tried first.
    // Cards: Zed Supply never takes card numbers. Open an account with a payment provider
    // licensed by the Bank of Zambia, then send buyers its secure payment link on WhatsApp;
    // name the provider in `provider` so the help centre and privacy policy can say who it is.
    // Only list card networks the provider account actually accepts.
    paymentMethods: [
      { id: 'mtn', name: 'MTN MoMo', kind: 'mobile', colour: '#FFCB05', enabled: true },
      { id: 'airtel', name: 'Airtel Money', kind: 'mobile', colour: '#E4002B', enabled: true },
      { id: 'zamtel', name: 'Zamtel Mobile Money', kind: 'mobile', colour: '#00A651', enabled: true },
      { id: 'bank', name: 'Bank transfer', kind: 'bank', colour: '#0057AE', enabled: false, preview: true,
        note: 'Pay from your bank app, internet banking or at a branch. We send our account details on WhatsApp.' },
      { id: 'card', name: 'Visa or Mastercard', kind: 'card', colour: '#E2A93A', enabled: false, preview: true,
        networks: ['Visa', 'Mastercard'], provider: '[PAYMENT PROVIDER]',
        note: 'Pay on our payment provider\'s secure page. We send you the link on WhatsApp.' },
      { id: 'cod', name: 'Cash on delivery', kind: 'cash', colour: '#198A00', enabled: false, preview: true,
        note: 'Pay the rider in cash when your order arrives, where available. We confirm on WhatsApp.' }
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
    // Swap image and imageMobile together to change that season's banner artwork.
    // Copy and buttons remain HTML; removing the paths uses the lightweight artwork.
    // text (optional) replaces the banner's standard line for that season.
    // caption (optional) replaces the small note under the button; captionUrl turns it into a
    // link. Only link to a page you have opened and checked yourself.
    // slides (optional): several banners for one period, shown one after the other at the
    // start of the slideshow. Each takes image, imageMobile and optional title, text, caption.
    festive: {
      enabled: true,
      independenceYear: 1964,
      periods: [
        { id: 'school', start: '01-02', end: '01-20', image: 'assets/banners/seasons/school-wide.webp', imageMobile: 'assets/banners/seasons/school-mobile.webp' }, // adjust to confirmed term dates
        { id: 'valentines', start: '02-01', end: '02-14', day: '02-14', image: 'assets/banners/seasons/valentines-wide.webp', imageMobile: 'assets/banners/seasons/valentines-mobile.webp' },
        { id: 'easter', rule: 'easter', image: 'assets/banners/seasons/easter-wide.webp', imageMobile: 'assets/banners/seasons/easter-mobile.webp' },
        { id: 'farmers', rule: 'farmers', image: 'assets/banners/seasons/farmers-wide.webp', imageMobile: 'assets/banners/seasons/farmers-mobile.webp' },
        { id: 'independence', start: '10-01', end: '10-31', day: '10-24', slides: [
          { image: 'assets/banners/seasons/freedom-statue-wide.webp', imageMobile: 'assets/banners/seasons/freedom-statue-mobile.webp', text: 'Honouring our freedom fighters. Celebrating the Zambia we build together.', caption: 'Illustration inspired by the Freedom Statue, Lusaka · Honouring Zambia\'s freedom fighters' },
          { image: 'assets/banners/seasons/independence-wide.webp', imageMobile: 'assets/banners/seasons/independence-mobile.webp', title: 'Proudly Zambian. Proudly local.' }
        ] },
        { id: 'blackfriday', rule: 'blackfriday', image: 'assets/banners/seasons/blackfriday-wide.webp', imageMobile: 'assets/banners/seasons/blackfriday-mobile.webp' },
        { id: 'christmas', start: '12-01', end: '01-01', day: '12-25', image: 'assets/banners/seasons/christmas-wide.webp', imageMobile: 'assets/banners/seasons/christmas-mobile.webp' } // runs to New Year's Day
      ]
    }
  },

  /* Homepage advertising banner (carousel). Slides appear in this order, followed by
     every live seller promotion (sellers can upload a banner image in the Seller Centre).

     Two kinds of slide:
     - Image advert: set image (desktop, 1600×500) and imageMobile (phones, 800×640),
       plus alt text describing the advert. Leave title empty: the artwork carries the words.
       Put files in assets/banners/ as JPEG, under 150KB each.
     - Designed slide: fill in title, text, cta and colours. art is optional artwork.
       photo: true adds an image behind the HTML copy. curated: true uses the new
       collection layout, with 1600×500 desktop and 800×900 mobile artwork.
       categories lists the department IDs a collection shows; on wide screens each one
       appears on the slide as a link to that category.
     link: where the slide goes, e.g. '#/promo/P2', '#/dept/solar', '#/sell' */
  banners: [
    { id: 'welcome', label: "Zambia's marketplace", title: 'Everything Within Reach', text: 'Discover everyday favourites and business essentials from Zambian sellers, priced in Kwacha.', cta: 'Explore categories', link: '#/departments', colours: ['#0A2A66', '#0057AE'], art: 'logo', photo: true, image: 'assets/banners/alternatives/marketplace-3d.webp', imageMobile: 'assets/banners/alternatives/marketplace-3d-mobile.webp' },
    { id: 'everyday-collection', label: 'Home, family & everyday living', title: 'Little comforts. More possibilities.', text: 'Explore fashion, home and kitchen, baby and kids, and everyday essentials.', cta: 'Explore everyday living', link: '#/departments', categories: ['womens', 'home', 'baby', 'essentials'], colours: ['#0A2A66', '#0057AE'], photo: true, curated: true, image: 'assets/banners/collections/everyday-wide.webp', imageMobile: 'assets/banners/collections/everyday-mobile.webp' },
    { id: 'connected-collection', label: 'Tech, power, motoring & wellbeing', title: 'Keep life moving', text: 'Discover tech and gadgets, solar power, car accessories, and fitness essentials.', cta: 'Explore the collection', link: '#/departments', categories: ['tech', 'solar', 'auto', 'sports'], colours: ['#071D47', '#0E7C86'], photo: true, curated: true, image: 'assets/banners/collections/connected-wide.webp', imageMobile: 'assets/banners/collections/connected-mobile.webp' },
    { id: 'enterprise-collection', label: 'Work, build & grow', title: 'Equip your next big step', text: 'Browse business equipment, office and school supplies, tools and hardware, and farming essentials.', cta: 'Explore work & farming', link: '#/departments', categories: ['business', 'office', 'hardware', 'agri'], colours: ['#0A2A66', '#0057AE'], photo: true, curated: true, image: 'assets/banners/collections/enterprise-wide.webp', imageMobile: 'assets/banners/collections/enterprise-mobile.webp' },
    { id: 'world', label: 'Coming soon', title: 'A world of possibility', text: 'Shop from China and beyond, with landed costs in Kwacha. Opening once supplier agreements are in place.', cta: 'Discover Shop the World', link: '#/world', colours: ['#071D47', '#0E7C86'], photo: true, image: 'assets/banners/alternatives/world-3d.webp', imageMobile: 'assets/banners/alternatives/world-3d-mobile.webp', art: '<img src=\"assets/icons/world.svg\" alt=\"\">' }
  ],

  /* Departments and their subcategories, modelled on Amazon.com's departments, plus four that
     matter in Zambia and Amazon doesn't have (solar, agriculture, office and school, groceries).
     Link to one with index.html#/dept/<id>, and to a subcategory with #/dept/<id>?sub=<sub id>.
       short:    the short name for menus, the search box and buttons
       group:    the heading it sits under in All categories and the menu
       featured: shown in "Shop by category" on the homepage (the rest are under See all)
       note:     a line shown on the department page and in the seller form, e.g. what can't be sold there
       art3d:    true when assets/categories-3d/<id>.webp exists, or another artwork's name to
                 borrow it (e.g. 'fashion'); otherwise the line icon
                 assets/icons/<id>.svg is used. Add 3D artwork later and set this to true.
       subs:     [id, name] pairs. Products set `sub` to one of these ids. Ids never change once
                 products use them; rename the name freely. */
  departmentGroups: [
    ['tech-group', 'Electronics & technology'], ['fashion-group', 'Fashion, beauty & travel'], ['home-group', 'Home, tools & power'],
    ['family-group', 'Family, health & pets'], ['leisure-group', 'Sports, toys & motoring'], ['work-group', 'Business, farming & school'], ['food-group', 'Food & essentials']
  ],
  departments: [
    { id: 'tech', name: 'Electronics', short: 'Electronics', group: 'tech-group', featured: true, art3d: true, subs: [
      ['phones', 'Mobile Phones & Accessories'], ['headphones', 'Headphones & Earbuds'], ['audio', 'Speakers & Home Audio'], ['cameras', 'Cameras & Photo'],
      ['wearables', 'Smartwatches & Wearables'], ['power', 'Power Banks & Chargers'], ['car-electronics', 'Car Electronics & GPS'], ['office-electronics', 'Office Electronics'],
      ['security', 'Security & Surveillance'], ['projectors', 'Projectors'], ['ereaders', 'eReaders & Accessories'], ['accessories', 'Cables, Batteries & Accessories']] },
    { id: 'computers', name: 'Computers & Accessories', short: 'Computers', group: 'tech-group', art3d: true, subs: [
      ['laptops', 'Laptops'], ['desktops', 'Desktops & All-in-ones'], ['tablets', 'Tablets & Accessories'], ['monitors', 'Monitors'],
      ['components', 'Computer Components'], ['storage', 'Data Storage'], ['networking', 'Networking & Wi-Fi'], ['printers', 'Printers, Scanners & Ink'],
      ['peripherals', 'Keyboards, Mice & Peripherals'], ['laptop-accessories', 'Laptop Bags & Accessories'], ['ups', 'UPS & Power Protection'], ['software', 'Software']] },
    { id: 'smarthome', name: 'Smart Home', short: 'Smart Home', group: 'tech-group', art3d: true, subs: [
      ['lighting', 'Smart Lighting'], ['locks', 'Smart Locks & Entry'], ['cameras', 'Security Cameras & Systems'], ['plugs', 'Smart Plugs & Outlets'],
      ['climate', 'Heating & Cooling'], ['sensors', 'Detectors & Sensors'], ['hubs', 'Voice Assistants & Hubs'], ['entertainment', 'Home Entertainment'],
      ['kitchen', 'Smart Kitchen'], ['cleaning', 'Robot Vacuums & Mops'], ['garden', 'Lawn & Garden'], ['wifi', 'Wi-Fi & Mesh Networking']] },
    { id: 'tv', name: 'Television & Video', short: 'Television', group: 'tech-group', art3d: true, subs: [
      ['tvs', 'Televisions'], ['streaming', 'Streaming Devices'], ['satellite', 'Satellite Dishes & Decoders'], ['soundbars', 'Soundbars & Home Theatre'],
      ['projectors', 'Projectors & Screens'], ['mounts', 'TV Mounts & Stands'], ['antennas', 'Antennas'], ['remotes', 'Remotes & TV Accessories'],
      ['players', 'Blu-ray & DVD Players'], ['cables', 'AV Cables & Adapters']] },
    { id: 'games', name: 'Video Games', short: 'Video Games', group: 'tech-group', art3d: true, subs: [
      ['playstation', 'PlayStation'], ['xbox', 'Xbox'], ['nintendo', 'Nintendo Switch'], ['pc', 'PC Gaming'], ['vr', 'Virtual Reality'],
      ['controllers', 'Controllers & Gamepads'], ['headsets', 'Gaming Headsets'], ['chairs', 'Gaming Chairs & Desks'], ['retro', 'Retro Gaming'], ['credit', 'Gift Cards & Game Credit']] },

    { id: 'womens', name: 'Women\'s Fashion', short: 'Women', group: 'fashion-group', featured: true, art3d: 'fashion', subs: [
      ['clothing', 'Clothing'], ['shoes', 'Shoes'], ['jewellery', 'Jewellery'], ['watches', 'Watches'], ['handbags', 'Handbags & Wallets'],
      ['accessories', 'Accessories'], ['traditional', 'Chitenge & African Prints'], ['sportswear', 'Activewear']] },
    { id: 'mens', name: 'Men\'s Fashion', short: 'Men', group: 'fashion-group', featured: true, art3d: true, subs: [
      ['clothing', 'Clothing'], ['shoes', 'Shoes'], ['jewellery', 'Jewellery'], ['watches', 'Watches'], ['accessories', 'Accessories'],
      ['traditional', 'African Prints & Traditional Wear'], ['sportswear', 'Activewear']] },
    { id: 'girls', name: 'Girls\' Fashion', short: 'Girls', group: 'fashion-group', art3d: true, subs: [
      ['clothing', 'Clothing'], ['shoes', 'Shoes'], ['jewellery', 'Jewellery'], ['watches', 'Watches'], ['accessories', 'Accessories'], ['uniforms', 'School Uniforms']] },
    { id: 'boys', name: 'Boys\' Fashion', short: 'Boys', group: 'fashion-group', art3d: true, subs: [
      ['clothing', 'Clothing'], ['shoes', 'Shoes'], ['jewellery', 'Jewellery'], ['watches', 'Watches'], ['accessories', 'Accessories'], ['uniforms', 'School Uniforms']] },
    { id: 'beauty', name: 'Beauty & Personal Care', short: 'Beauty', group: 'fashion-group', featured: true, art3d: true, subs: [
      ['makeup', 'Makeup'], ['skincare', 'Skin Care'], ['haircare', 'Hair Care'], ['hair-extensions', 'Wigs, Braids & Hair Extensions'], ['fragrance', 'Fragrance'],
      ['nails', 'Foot, Hand & Nail Care'], ['tools', 'Beauty Tools & Accessories'], ['shave', 'Shaving & Hair Removal'], ['personal', 'Personal Care'], ['oral', 'Oral Care']] },
    { id: 'luggage', name: 'Luggage & Travel', short: 'Luggage', group: 'fashion-group', art3d: true, subs: [
      ['suitcases', 'Suitcases'], ['carry-on', 'Carry-ons'], ['sets', 'Luggage Sets'], ['backpacks', 'Backpacks'], ['laptop-bags', 'Laptop Bags'],
      ['duffels', 'Duffel Bags'], ['totes', 'Travel Totes'], ['garment', 'Garment Bags'], ['messenger', 'Messenger Bags'], ['kids', 'Kids\' Luggage'],
      ['umbrellas', 'Umbrellas'], ['accessories', 'Travel Accessories']] },

    { id: 'home', name: 'Home & Kitchen', short: 'Home & Kitchen', group: 'home-group', featured: true, art3d: true, subs: [
      ['kitchen', 'Kitchen & Dining'], ['small-appliances', 'Small Appliances'], ['bedding', 'Bedding'], ['bath', 'Bath'], ['furniture', 'Furniture'],
      ['decor', 'Home Décor'], ['wall-art', 'Wall Art'], ['lighting', 'Lighting & Ceiling Fans'], ['seasonal', 'Seasonal Décor'], ['party', 'Event & Party Supplies'],
      ['climate', 'Heating, Cooling & Air Quality'], ['irons', 'Irons & Steamers'], ['vacuums', 'Vacuums & Floor Care'], ['storage', 'Storage & Organisation'],
      ['cleaning', 'Cleaning Supplies'], ['kids-home', 'Kids\' Home Store']] },
    { id: 'hardware', name: 'Tools & Home Improvement', short: 'Tools & DIY', group: 'home-group', featured: true, art3d: true, subs: [
      ['appliances', 'Large Appliances'], ['building', 'Building Supplies'], ['electrical', 'Electrical'], ['hardware', 'Hardware'], ['fixtures', 'Kitchen & Bath Fixtures'],
      ['bulbs', 'Light Bulbs'], ['lighting', 'Lighting & Ceiling Fans'], ['measuring', 'Measuring & Layout Tools'], ['paint', 'Paint & Wall Treatments'],
      ['tools', 'Power & Hand Tools'], ['plumbing', 'Plumbing'], ['security', 'Safety & Security'], ['storage', 'Storage & Garage Organisation'],
      ['welding', 'Welding & Soldering'], ['garden', 'Garden & Outdoor']] },
    { id: 'solar', name: 'Solar, Power & Energy', short: 'Solar & Power', group: 'home-group', featured: true, art3d: true, subs: [
      ['panels', 'Solar Panels'], ['kits', 'Solar Home Kits'], ['batteries', 'Batteries & Power Stations'], ['inverters', 'Inverters & Charge Controllers'],
      ['lights', 'Solar Lights & Lanterns'], ['generators', 'Generators'], ['ups', 'UPS & Surge Protection'], ['water-heating', 'Solar Geysers & Water Heating'],
      ['pumps', 'Solar Water Pumps'], ['installation', 'Cables, Mounts & Installation'], ['cooking', 'Gas & Clean Cooking']] },
    { id: 'arts', name: 'Arts & Crafts', short: 'Arts & Crafts', group: 'home-group', art3d: true, subs: [
      ['painting', 'Painting, Drawing & Art Supplies'], ['beading', 'Beading & Jewellery Making'], ['crafting', 'Crafting'], ['fabric', 'Fabric & Chitenge'],
      ['knitting', 'Knitting & Crochet'], ['needlework', 'Needlework & Embroidery'], ['sewing', 'Sewing'], ['scrapbooking', 'Scrapbooking & Stamping'],
      ['party', 'Party Decorations & Supplies'], ['gift-wrap', 'Gift Wrapping'], ['storage', 'Craft Storage']] },

    { id: 'baby', name: 'Baby', short: 'Baby', group: 'family-group', featured: true, art3d: true, subs: [
      ['activity', 'Activity & Entertainment'], ['apparel', 'Baby Clothing & Accessories'], ['toys', 'Baby & Toddler Toys'], ['care', 'Baby Care'],
      ['car-seats', 'Car Seats & Accessories'], ['nappies', 'Nappies & Changing'], ['feeding', 'Feeding'], ['gifts', 'Baby Gifts'], ['nursery', 'Nursery'],
      ['travel', 'Prams & Travel Gear'], ['maternity', 'Pregnancy & Maternity'], ['potty', 'Potty Training'], ['safety', 'Baby Safety']] },
    { id: 'health', name: 'Health & Household', short: 'Health & Household', group: 'family-group', featured: true, art3d: true,
      note: 'Medicines, prescription or over the counter, are not sold on Zed Supply.', subs: [
      ['healthcare', 'First Aid & Health Monitors'], ['medical', 'Medical Equipment & Mobility Aids'], ['vitamins', 'Vitamins & Supplements'], ['sports-nutrition', 'Sports Nutrition'],
      ['personal', 'Personal Care'], ['oral', 'Oral Care'], ['vision', 'Vision Care'], ['baby-child', 'Baby & Child Care'], ['household', 'Household Supplies'],
      ['wellness', 'Wellness & Relaxation']] },
    { id: 'pets', name: 'Pet Supplies', short: 'Pets', group: 'family-group', art3d: true, subs: [
      ['dogs', 'Dogs'], ['cats', 'Cats'], ['fish', 'Fish & Aquatic Pets'], ['birds', 'Birds'], ['small', 'Small Animals'], ['reptiles', 'Reptiles & Amphibians'], ['horses', 'Horses']] },

    { id: 'toys', name: 'Toys & Games', short: 'Toys', group: 'leisure-group', featured: true, art3d: true, subs: [
      ['action', 'Action Figures & Statues'], ['arts', 'Arts & Crafts for Kids'], ['baby', 'Baby & Toddler Toys'], ['building', 'Building Toys'], ['dolls', 'Dolls & Accessories'],
      ['pretend', 'Dress Up & Pretend Play'], ['electronics', 'Kids\' Electronics'], ['games', 'Board Games & Cards'], ['hobbies', 'Hobbies'], ['learning', 'Learning & Education'],
      ['party', 'Party Supplies'], ['puzzles', 'Puzzles'], ['outdoor', 'Sports & Outdoor Play'], ['plush', 'Stuffed Animals & Plush'], ['rc', 'Remote Control & Play Vehicles'],
      ['ride-ons', 'Tricycles, Scooters & Ride-ons']] },
    { id: 'sports', name: 'Sports & Outdoors', short: 'Sports', group: 'leisure-group', art3d: true, subs: [
      ['fitness', 'Exercise & Fitness'], ['team', 'Team Sports'], ['racquet', 'Racquet Sports'], ['golf', 'Golf'], ['cycling', 'Cycling'], ['camping', 'Camping & Hiking'],
      ['fishing', 'Fishing'], ['water', 'Water Sports'], ['sportswear', 'Sports Clothing & Shoes'], ['leisure', 'Leisure Sports & Game Room'], ['fan', 'Fan Shop']] },
    { id: 'auto', name: 'Automotive', short: 'Automotive', group: 'leisure-group', featured: true, art3d: true, subs: [
      ['car-care', 'Car Care'], ['electronics', 'Car Electronics & Accessories'], ['exterior', 'Exterior Accessories'], ['interior', 'Interior Accessories'],
      ['lights', 'Lights & Lighting'], ['motorcycle', 'Motorcycle & Powersports'], ['oils', 'Oils & Fluids'], ['paint', 'Paint & Paint Supplies'],
      ['performance', 'Performance Parts'], ['parts', 'Replacement Parts'], ['tyres', 'Tyres & Wheels'], ['tools', 'Tools & Equipment'], ['heavy', 'Heavy Duty & Commercial Vehicles']] },

    { id: 'business', name: 'Industrial & Scientific', short: 'Industrial', group: 'work-group', art3d: true, subs: [
      ['small-business', 'Small Business & Manufacturing Equipment'], ['food-service', 'Food Service Equipment & Supplies'], ['packaging', 'Packaging & Shipping Supplies'],
      ['retail', 'Retail Store Fixtures & Equipment'], ['safety', 'Safety Equipment & PPE'], ['janitorial', 'Janitorial & Sanitation'], ['power-tools', 'Industrial Power & Hand Tools'],
      ['electrical', 'Industrial Electrical'], ['plumbing', 'Hydraulics, Pneumatics & Plumbing'], ['fasteners', 'Fasteners'], ['hardware', 'Industrial Hardware'],
      ['abrasives', 'Abrasives & Finishing'], ['cutting', 'Cutting Tools'], ['filtration', 'Filtration'], ['material-handling', 'Material Handling'],
      ['tapes', 'Tapes, Adhesives & Sealants'], ['test', 'Test, Measure & Inspect'], ['lab', 'Lab & Scientific'], ['science-ed', 'Science Education'],
      ['medical-dental', 'Professional Medical & Dental Equipment'], ['raw', 'Raw Materials']] },
    { id: 'agri', name: 'Agriculture & Farming', short: 'Agriculture', group: 'work-group', art3d: true,
      note: 'Veterinary medicines are not sold on Zed Supply.', subs: [
      ['seeds', 'Seeds & Seedlings'], ['fertiliser', 'Fertilisers'], ['crop', 'Crop Protection'], ['irrigation', 'Irrigation & Water'], ['tools', 'Farm Tools & Equipment'],
      ['poultry', 'Poultry Equipment & Supplies'], ['livestock', 'Livestock Equipment & Supplies'], ['feed', 'Animal Feed'], ['storage', 'Grain Storage & Processing'],
      ['machinery', 'Tractors & Machinery Parts'], ['aquaculture', 'Fish Farming']] },
    { id: 'office', name: 'Office, School & Stationery', short: 'Office & School', group: 'work-group', art3d: true, subs: [
      ['paper', 'Paper & Notebooks'], ['writing', 'Pens & Writing'], ['school', 'School Supplies'], ['furniture', 'Office Furniture'], ['electronics', 'Calculators & Office Electronics'],
      ['printing', 'Ink, Toner & Printing'], ['filing', 'Filing & Organisation'], ['presentation', 'Boards & Presentation'], ['mailing', 'Mailing & Shipping'], ['breakroom', 'Breakroom Supplies']] },

    { id: 'essentials', name: 'Grocery & Everyday Essentials', short: 'Grocery & Essentials', group: 'food-group', featured: true, art3d: true, subs: [
      ['staples', 'Mealie Meal, Rice & Staples'], ['cooking', 'Cooking Oil & Ingredients'], ['beverages', 'Drinks & Beverages'], ['snacks', 'Snacks & Sweets'],
      ['breakfast', 'Breakfast & Cereals'], ['canned', 'Canned & Packaged Food'], ['household', 'Household & Cleaning Essentials'], ['toiletries', 'Toiletries'],
      ['baby', 'Baby Essentials'], ['bulk', 'Bulk & Wholesale Packs']] }
  ],

  /* Listing templates: the extra fields the seller form shows for each department.
     fields: any of 'colour', 'size', 'ageRange', 'inBox', 'manufacturer', 'specs',
     'condition', 'features'. Sellers can enable other relevant fields themselves.
     sizeUnits: the units in the size dropdown, first is the default. Leave it empty for
     letter or shoe sizes typed by the seller. specs: suggested specification names. */
  attributeTemplates: {
    tech:       { fields: ['colour', 'size', 'inBox', 'manufacturer', 'specs', 'condition', 'features'], sizeUnits: ['gb', 'tb', 'mah', 'in'], specs: ['Model', 'Battery', 'Storage', 'Compatibility', 'Warranty'] },
    solar:      { fields: ['size', 'inBox', 'manufacturer', 'specs', 'condition'], sizeUnits: ['w', 'kw', 'wh', 'kwh', 'ah', 'v'], specs: ['Panel output', 'Battery capacity', 'Battery type', 'Warranty', 'Installation'] },
    computers:  { fields: ['colour', 'size', 'inBox', 'manufacturer', 'specs', 'condition', 'features'], sizeUnits: ['gb', 'tb', 'in'], specs: ['Model', 'Processor', 'Memory (RAM)', 'Storage', 'Screen size', 'Operating system', 'Warranty'] },
    smarthome:  { fields: ['colour', 'inBox', 'manufacturer', 'specs', 'features'], specs: ['Works with', 'Connection (Wi-Fi, Bluetooth, Zigbee)', 'Power', 'Warranty'] },
    tv:         { fields: ['size', 'inBox', 'manufacturer', 'specs', 'condition', 'features'], sizeUnits: ['in', 'cm'], specs: ['Model', 'Resolution', 'Smart platform', 'Ports', 'Warranty'] },
    games:      { fields: ['colour', 'size', 'ageRange', 'inBox', 'manufacturer', 'specs', 'condition'], sizeUnits: ['gb', 'tb'], specs: ['Platform', 'Age rating', 'Region', 'Players'] },
    womens:     { fields: ['colour', 'size', 'specs', 'features'], sizeUnits: [], specs: ['Material', 'Care instructions', 'Fit'] },
    mens:       { fields: ['colour', 'size', 'specs', 'features'], sizeUnits: [], specs: ['Material', 'Care instructions', 'Fit'] },
    girls:      { fields: ['colour', 'size', 'ageRange', 'specs'], sizeUnits: [], specs: ['Material', 'Care instructions', 'Age'] },
    boys:       { fields: ['colour', 'size', 'ageRange', 'specs'], sizeUnits: [], specs: ['Material', 'Care instructions', 'Age'] },
    beauty:     { fields: ['colour', 'size', 'ageRange', 'manufacturer', 'specs'], sizeUnits: ['ml', 'g', 'l'], specs: ['Skin or hair type', 'Ingredients', 'Best before / expiry'] },
    luggage:    { fields: ['colour', 'size', 'specs', 'features'], sizeUnits: ['l', 'cm', 'in', 'kg'], specs: ['Dimensions', 'Weight', 'Material', 'Wheels', 'Lock'] },
    arts:       { fields: ['colour', 'size', 'ageRange', 'specs'], sizeUnits: ['ml', 'm', 'cm', 'g'], specs: ['Material', 'Pack size'] },
    pets:       { fields: ['size', 'manufacturer', 'specs'], sizeUnits: ['kg', 'g', 'l'], specs: ['Pet', 'Life stage', 'Ingredients', 'Best before / expiry'] },
    toys:       { fields: ['colour', 'ageRange', 'inBox', 'manufacturer', 'specs', 'features'], specs: ['Recommended age', 'Batteries needed', 'Safety standard', 'Pieces'] },
    sports:     { fields: ['colour', 'size', 'ageRange', 'manufacturer', 'specs'], sizeUnits: ['kg', 'cm', 'm'], specs: ['Sport', 'Material', 'Weight'] },
    home:       { fields: ['colour', 'size', 'inBox', 'specs'], sizeUnits: ['l', 'ml', 'cm'], specs: ['Material', 'Power', 'Warranty'] },
    business:   { fields: ['inBox', 'manufacturer', 'specs', 'condition'], specs: ['Power', 'Output', 'Warranty'] },
    office:     { fields: ['colour', 'size', 'ageRange', 'specs'], sizeUnits: ['cm', 'mm'], specs: ['Pack size'] },
    agri:       { fields: ['size', 'manufacturer', 'specs'], sizeUnits: ['kg', 'g', 'l', 'ml'], specs: ['Crop or use', 'Active ingredient', 'Best before / expiry', 'Storage instructions'] },
    auto:       { fields: ['inBox', 'manufacturer', 'specs', 'condition'], specs: ['Fits (make, model, year)', 'Part number', 'Warranty'] },
    hardware:   { fields: ['size', 'inBox', 'specs', 'condition'], sizeUnits: ['mm', 'cm', 'm', 'kg', 'l', 'w', 'v'], specs: ['Material', 'Power', 'Warranty'] },
    baby:       { fields: ['colour', 'size', 'ageRange', 'inBox', 'specs'], sizeUnits: [], specs: ['Material', 'Safety standard', 'Recommended age'] },
    health:     { fields: ['size', 'ageRange', 'inBox', 'specs'], sizeUnits: ['ml', 'g', 'l', 'kg'], specs: ['Ingredients', 'Best before / expiry', 'Storage instructions'] },
    essentials: { fields: ['size', 'specs'], sizeUnits: ['l', 'ml', 'kg', 'g'], specs: ['Pack size', 'Ingredients', 'Best before / expiry', 'Storage instructions'] }
  },

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
       sub:    the subcategory id within the department, e.g. category: 'tech', sub: 'phones'.
               See departments above for each department's subcategories.
       sales:  units sold per month from confirmed WhatsApp orders, e.g. { '2026-10': 14, '2026-09': 9 }.
               Drives Trending now and the monthly Top picks, so keep this and last month up to date.
       match:  the same word for the same item from different sellers, e.g. 'solar-lantern-led'.
               Buyers then see "Also sold by" and can compare the sellers side by side.
       added:  date first listed, 'YYYY-MM-DD'. New listings get a small lift in Trending.
       deal:   { price, reason, ends } a lower price for a limited time. reason is one of
               'reduced', 'clearance', 'limited', 'bundle', 'seasonal'; ends is 'YYYY-MM-DD' or ''.
       attributes: the item's specifications. Every part is optional.
               condition:    'new' | 'open_box' | 'refurbished' | 'used'; omit if unknown.
               conditionNotes: description of wear, repairs or packaging; required unless new.
               features:     up to eight strings, 160 characters each, displayed as feature bullets.
               size:         { value: 1.7, unit: 'l' }  one size only. Units: 'ml', 'cl', 'l', 'g', 'kg', 'oz', 'lb', 'mm', 'cm', 'm', 'in', 'ft',
                             'mb', 'gb', 'tb' (storage), 'mah', 'ah' (battery), 'w', 'kw' (power), 'wh', 'kwh' (energy), 'v'
               ageRange:     ['kid', 'teen']            any of 'infant', 'kid', 'teen', 'adult', 'senior'
               manufacturer: 'Maker name'               only when it differs from the brand store
               specs:        { 'Battery': '20,000 mAh', 'Warranty': '12 months' }
       options: the choices a buyer makes. Each one becomes a column in the variants.
               colour: [{ name: 'Black', hex: '#1F2937' }]   hex must match the real item
               size:   ['S', 'M', 'L']  or measured: [{ value: 500, unit: 'ml' }, { value: 1, unit: 'l' }]
               extra: [{ key: 'custom_storage', name: 'Storage', values: ['128 GB', '256 GB'] }]
               Up to two extra axes; stable keys start custom_. Max 256 total combinations.
               Variation rows and buyer selections carry these keys, e.g. custom_storage: '128 GB'.
               Different brands are separate products, not variants of the same item.
       variants: needed when options are set; one row per combination.
               [{ sku: 'ZS-L008-WHT-42', colour: 'White', size: '42', stock: 3, priceZMW: 760 }]
               colour and size use the option's name or label ('500 ml'); stock is the number on hand
               and 0 shows the combination as sold out; priceZMW is optional, otherwise the product price.
       inBox:  what comes with it: [{ item: 'USB-C cable' }, { item: 'Wall charger', addonZMW: 120 }]
               Without addonZMW it is included; with addonZMW it is an optional add-on the buyer can tick.
       commit: buyer commit pricing, { min: 450, max: 520 }. Buyers name a price between min and
               max and the seller confirms it on WhatsApp; priceZMW stays the Buy now price.
               max must not be above priceZMW. Buyers can see min, so set one you would accept.
     reviews: [{ name, rating: 1-5, date: 'YYYY-MM-DD', title, text, verified }]
               verified: true only for a confirmed order delivered to that customer.
               The average and star breakdown are worked out from these when the page loads.
     image: square photo, 600×600, WebP or JPEG under 80KB, in assets/products/
     images (optional): up to 6 more photos of the same item, shown as thumbnails under the main
       photo, e.g. [{ src: 'assets/products/L004-2.webp', alt: 'Side view showing the USB-C port' }].
       Each needs alt text saying what it shows. Same size and framing as the main photo.
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
