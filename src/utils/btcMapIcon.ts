// BTC Map curates a small palette of category glyph names on each
// merchant (`icon`: 'storefront' | 'chalet' | 'cafe' | …). Their web UI
// renders these via the Material Symbols font; we don't ship that
// font, so map the curated name to the closest Lucide icon component
// we already have. Unknown / null icon falls back to a generic Store.

import type { ComponentType } from 'react';
import {
  Bed,
  Beer,
  Bike,
  Briefcase,
  Building2,
  Camera,
  Coffee,
  Cross,
  Dumbbell,
  Fuel,
  Hammer,
  Hotel,
  type LucideProps,
  Mountain,
  Palette,
  PawPrint,
  Pizza,
  Plane,
  Scissors,
  ShoppingBag,
  Store,
  Truck,
  TreePine,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react-native';

type LucideComponent = ComponentType<LucideProps>;

const ICON_MAP: Record<string, LucideComponent> = {
  // BTC Map's curated set (sampled from their open dataset). When BTC
  // Map adds new glyph names we'll silently fall through to Store; UX
  // remains intelligible.
  storefront: Store,
  shop: Store,
  shopping_bag: ShoppingBag,
  cafe: Coffee,
  coffee: Coffee,
  restaurant: UtensilsCrossed,
  fast_food: Pizza,
  pizza: Pizza,
  bar: Beer,
  pub: Beer,
  hotel: Hotel,
  lodging: Hotel,
  chalet: Mountain,
  bed: Bed,
  office: Briefcase,
  building: Building2,
  apartment: Building2,
  hospital: Cross,
  pharmacy: Cross,
  health: Cross,
  fuel: Fuel,
  gas_station: Fuel,
  car_repair: Wrench,
  bicycle: Bike,
  bike: Bike,
  hardware: Hammer,
  tools: Hammer,
  scissors: Scissors,
  salon: Scissors,
  camera: Camera,
  photo: Camera,
  gym: Dumbbell,
  fitness: Dumbbell,
  palette: Palette,
  art: Palette,
  pet: PawPrint,
  veterinary: PawPrint,
  travel: Plane,
  airport: Plane,
  outdoor: TreePine,
  park: TreePine,
  delivery: Truck,
  truck: Truck,
};

/**
 * Resolve a BTC Map icon name to a Lucide icon component. Returns a
 * Store fallback when no match — keeps the row layout stable even when
 * BTC Map ships a new glyph name we haven't mapped yet.
 */
export const btcMapIconComponent = (name: string | null | undefined): LucideComponent => {
  if (!name) return Store;
  return ICON_MAP[name] ?? Store;
};
