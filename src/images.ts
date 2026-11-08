/**
 * Menu item -> photo mapping.
 *
 * The 19 owner photos live in public/images/. Garlic Parmesan wings has no
 * owner photo yet, so it uses a stock photo URL (the same approach the Muse
 * app used) — swap it for a local file in public/images/ as soon as the
 * owner sends a Garlic Parmesan photo.
 */

export const GARLIC_PARMESAN_STOCK_PHOTO =
  'https://images.unsplash.com/photo-1527477396000-e27163b481c2?w=800&q=80';

const BY_NAME: Record<string, string> = {
  '12" Cheese Pizza': '/images/cheese-pizza.jpg',
  'Cheese Pizza Slice': '/images/cheese-pizza.jpg',
  '12" Pepperoni Pizza': '/images/pepperoni-pizza-slice.jpg',
  'Pepperoni Pizza Slice': '/images/pepperoni-pizza-slice.jpg',
  '12" All Meat Pizza': '/images/all-meat-pizza.jpg',
  'All Meat Pizza Slice': '/images/all-meat-pizza.jpg',
  'Chicken Sandwich': '/images/chicken-sandwich.jpg',
  'Cheese Burger': '/images/cheese-burger.jpg',
  'BBQ Sandwich': '/images/bbq-sandwich.jpg',
  'Chicken Tenders - 3 Pc': '/images/chicken-tenders.jpg',
  'Boneless Wings - 6 Pc': '/images/boneless-wings.jpg',
  'Cheese Sticks - 6 Pc': '/images/cheese-sticks.jpg',
  'French Fries': '/images/french-fries.jpg',
  'Hash Browns': '/images/hash-browns.jpg',
  'Buttermilk Biscuits': '/images/buttermilk-biscuits.jpg',
};

const WING_PHOTOS: Record<string, string> = {
  Buffalo: '/images/buffalo-wings.jpg',
  BBQ: '/images/bbq-wings.jpg',
  'Nashville Hot': '/images/nashville-hot-wings.jpg',
  Teriyaki: '/images/teriyaki-wings.jpg',
  'Thai Chili': '/images/thai-chili-wings.jpg',
  'Korean BBQ': '/images/korean-bbq-wings.jpg',
  'Mango Habanero': '/images/mango-habanero-wings.jpg',
  // Garlic Parmesan: no owner photo yet — stock photo (see above).
  'Garlic Parmesan': GARLIC_PARMESAN_STOCK_PHOTO,
};

/** Photo URL for a menu item. Wing flavors are matched before the generic rules. */
export function imageForItem(name: string, description: string): string {
  if (BY_NAME[name]) return BY_NAME[name];
  const flavor = description.trim();
  if (WING_PHOTOS[flavor]) return WING_PHOTOS[flavor];
  // Fallback: match a flavor word inside the item name.
  for (const [key, url] of Object.entries(WING_PHOTOS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return url;
  }
  return '';
}
