/**
 * Platform category tree for the East African marketplace.
 * `commissionRateBps` is the take-rate applied at settlement (1000 = 10%).
 * `requiresKyc` gates high-value/counterfeit-prone categories behind approved KYC.
 */

export type CategorySeed = {
  slug: string;
  name: string;
  commissionRateBps?: number;
  requiresKyc?: boolean;
  children?: CategorySeed[];
};

export const CATEGORY_SEED: CategorySeed[] = [
  {
    slug: 'phones-tablets',
    name: 'Phones & Tablets',
    commissionRateBps: 800,
    requiresKyc: true,
    children: [
      { slug: 'smartphones', name: 'Smartphones' },
      { slug: 'feature-phones', name: 'Feature Phones' },
      { slug: 'tablets', name: 'Tablets' },
      { slug: 'phone-accessories', name: 'Phone Accessories' },
      { slug: 'refurbished-phones', name: 'Refurbished Phones' },
      { slug: 'sim-cards-airtime', name: 'SIM Cards & Bundles' },
    ],
  },
  {
    slug: 'computing',
    name: 'Computing',
    commissionRateBps: 800,
    requiresKyc: true,
    children: [
      { slug: 'laptops', name: 'Laptops' },
      { slug: 'desktops', name: 'Desktops & All-in-One' },
      { slug: 'monitors', name: 'Monitors' },
      { slug: 'printers', name: 'Printers & Scanners' },
      { slug: 'components', name: 'Components & RAM' },
      { slug: 'storage', name: 'Flash Disks & Memory Cards' },
      { slug: 'software', name: 'Software & Licenses' },
    ],
  },
  {
    slug: 'electronics',
    name: 'Electronics',
    commissionRateBps: 900,
    children: [
      { slug: 'tvs', name: 'Television & Video' },
      { slug: 'audio', name: 'Audio & Speakers' },
      { slug: 'cameras', name: 'Cameras' },
      { slug: 'gaming', name: 'Gaming' },
      { slug: 'power-solutions', name: 'Solar & Inverters' },
      { slug: 'home-appliances', name: 'Home Appliances' },
    ],
  },
  {
    slug: 'fashion-women',
    name: 'Women Fashion',
    commissionRateBps: 1200,
    children: [
      { slug: 'dresses', name: 'Dresses & Gowns' },
      { slug: 'kitenge-ankara', name: 'Kitenge & Ankara Fabrics' },
      { slug: 'tops', name: 'Tops & Blouses' },
      { slug: 'shoes-women', name: 'Shoes' },
      { slug: 'bags-women', name: 'Bags & Wallets' },
      { slug: 'jewelry-women', name: 'Jewellery' },
      { slug: 'traditional-wear', name: 'Traditional & Kanga' },
    ],
  },
  {
    slug: 'fashion-men',
    name: 'Men Fashion',
    commissionRateBps: 1200,
    children: [
      { slug: 'shirts-men', name: 'Shirts' },
      { slug: 'trousers-men', name: 'Trousers & Jeans' },
      { slug: 'suits-men', name: 'Suits & Formal' },
      { slug: 'shoes-men', name: 'Shoes & Sandals' },
      { slug: 'caps-hats', name: 'Caps & Hats' },
      { slug: 'watches', name: 'Watches' },
    ],
  },
  {
    slug: 'health-beauty',
    name: 'Health & Beauty',
    commissionRateBps: 1100,
    children: [
      { slug: 'skincare', name: 'Skin Care' },
      { slug: 'hair-care', name: 'Hair Care & Wigs' },
      { slug: 'makeup', name: 'Makeup' },
      { slug: 'fragrance', name: 'Perfumes' },
      { slug: 'personal-care', name: 'Personal Care' },
      { slug: 'food-supplements', name: 'Supplements & Vitamins' },
      { slug: 'medicine-otc', name: 'First Aid & OTC' },
    ],
  },
  {
    slug: 'groceries-staples',
    name: 'Groceries & Staples',
    commissionRateBps: 600,
    children: [
      { slug: 'maize-flour', name: 'Maize & Wheat Flour' },
      { slug: 'rice', name: 'Rice & Grains' },
      { slug: 'cooking-oil', name: 'Cooking Oil' },
      { slug: 'sugar-salt', name: 'Sugar & Salt' },
      { slug: 'beans-peas', name: 'Beans & Peas' },
      { slug: 'beverages', name: 'Tea, Coffee & Juice' },
      { slug: 'spices', name: 'Spices & Seasonings' },
      { slug: 'water-drinks', name: 'Bottled Water & Soft Drinks' },
    ],
  },
  {
    slug: 'agriculture',
    name: 'Agriculture & Farming',
    commissionRateBps: 700,
    requiresKyc: true,
    children: [
      { slug: 'seeds', name: 'Seeds & Seedlings' },
      { slug: 'fertilizers', name: 'Fertilizers' },
      { slug: 'animal-feed', name: 'Animal Feed & Livestock' },
      { slug: 'farm-tools', name: 'Hand Tools & Machetes' },
      { slug: 'irrigation', name: 'Irrigation & Water Pumps' },
      { slug: 'poultry', name: 'Poultry Equipment' },
    ],
  },
  {
    slug: 'home-furniture',
    name: 'Home & Furniture',
    commissionRateBps: 1000,
    children: [
      { slug: 'bedding', name: 'Bedding & Mattresses' },
      { slug: 'kitchen-dining', name: 'Kitchen & Dining' },
      { slug: 'storage-organisation', name: 'Storage' },
      { slug: 'decor', name: 'Decor & Wall Art' },
      { slug: 'cleaning', name: 'Cleaning Supplies' },
      { slug: 'garden-outdoor', name: 'Garden & Outdoor' },
    ],
  },
  {
    slug: 'building-materials',
    name: 'Building Materials',
    commissionRateBps: 700,
    requiresKyc: true,
    children: [
      { slug: 'cement-concrete', name: 'Cement & Aggregates' },
      { slug: 'steel-roofing', name: 'Steel & Roofing Sheets' },
      { slug: 'timber-plywood', name: 'Timber & Plywood' },
      { slug: 'paints', name: 'Paints & Finishes' },
      { slug: 'plumbing', name: 'Plumbing & Fittings' },
      { slug: 'electricals', name: 'Electrical Materials' },
      { slug: 'tiles', name: 'Tiles & Floorings' },
    ],
  },
  {
    slug: 'mother-baby',
    name: 'Mother & Baby',
    commissionRateBps: 1000,
    children: [
      { slug: 'diapers', name: 'Diapers & Wipes' },
      { slug: 'baby-feeding', name: 'Feeding & Bottles' },
      { slug: 'baby-clothing', name: 'Baby Clothing' },
      { slug: 'toys', name: 'Toys & Games' },
      { slug: 'maternity', name: 'Maternity' },
    ],
  },
  {
    slug: 'sports-outdoor',
    name: 'Sports & Outdoor',
    commissionRateBps: 1000,
    children: [
      { slug: 'football', name: 'Football & Jerseys' },
      { slug: 'fitness', name: 'Fitness Equipment' },
      { slug: 'cycling', name: 'Cycling' },
      { slug: 'camping', name: 'Camping & Hiking' },
    ],
  },
  {
    slug: 'automotive',
    name: 'Automotive & Boda',
    commissionRateBps: 900,
    requiresKyc: true,
    children: [
      { slug: 'boda-parts', name: 'Boda-Boda Parts & Tyres' },
      { slug: 'car-parts', name: 'Car Spare Parts' },
      { slug: 'car-accessories', name: 'Car Accessories' },
      { slug: 'motorcycle-gear', name: 'Riding Gear & Helmets' },
      { slug: 'lubricants', name: 'Oils & Lubricants' },
    ],
  },
  {
    slug: 'office-supplies',
    name: 'Office & School Supplies',
    commissionRateBps: 900,
    children: [
      { slug: 'writing-instruments', name: 'Pens & Writing' },
      { slug: 'paper-products', name: 'Paper & Reams' },
      { slug: 'school-bags', name: 'School Bags & Shoes' },
      { slug: 'textbooks', name: 'Textbooks & Exams' },
      { slug: 'desk-organisers', name: 'Desk Organisers' },
    ],
  },
  {
    slug: 'crafts-art',
    name: 'African Crafts & Art',
    commissionRateBps: 1300,
    children: [
      { slug: 'basketry', name: 'Baskets & Weaving' },
      { slug: 'wood-carvings', name: 'Wood Carvings' },
      { slug: 'beadwork', name: 'Beadwork' },
      { slug: 'art-paintings', name: 'Paintings & Gallery' },
      { slug: 'instruments', name: 'Musical Instruments' },
    ],
  },
  {
    slug: 'digital-services',
    name: 'Digital Services',
    commissionRateBps: 500,
    requiresKyc: true,
    children: [
      { slug: 'printing-services', name: 'Printing & Binding' },
      { slug: 'design-services', name: 'Design & Branding' },
      { slug: 'mobile-money-float', name: 'Mobile Money Float' },
      { slug: 'tickets-vouchers', name: 'Tickets & Vouchers' },
    ],
  },
  {
    slug: 'second-hand',
    name: 'Used & Refurbished',
    commissionRateBps: 1000,
    children: [
      { slug: 'used-electronics', name: 'Used Electronics' },
      { slug: 'used-furniture', name: 'Used Furniture' },
      { slug: 'used-fashion', name: 'Mitumba (Second-hand Clothes)' },
    ],
  },
];
