"use client";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { ShoppingCart } from "lucide-react";

export default function Page() {
  return (
    <PagePlaceholder
      titleKey="pages.orders.title"
      descKey="pages.orders.desc"
      pointsKey="pages.orders.points"
      icon={ShoppingCart}
    />
  );
}
