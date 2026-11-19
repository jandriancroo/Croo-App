import type { ReactNode } from "react";
import { Pizza, Salad, UtensilsCrossed, Package, Layers } from "lucide-react";
import type { SectionType } from "./types";

export const SECTION_ICONS: Record<SectionType, ReactNode> = {
  md_pizza: <Pizza className="h-4 w-4" />,
  lg_pizza: <Pizza className="h-4 w-4" />,
  half_pizza: <Pizza className="h-4 w-4" />,
  detroit: <Pizza className="h-4 w-4" />,
  salads: <Salad className="h-4 w-4" />,
  sides: <UtensilsCrossed className="h-4 w-4" />,
  catering: <Package className="h-4 w-4" />,
  drinks: <UtensilsCrossed className="h-4 w-4" />,
  other: <Layers className="h-4 w-4" />,
};
