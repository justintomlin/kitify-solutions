"use client";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { Truck } from "lucide-react";

export default function Page() {
  return (
    <PagePlaceholder
      titleKey="pages.orderTracking.title"
      descKey="pages.orderTracking.desc"
      pointsKey="pages.orderTracking.points"
      icon={Truck}
    />
  );
}
