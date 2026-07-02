"use client";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { Wand2 } from "lucide-react";

export default function Page() {
  return (
    <PagePlaceholder
      titleKey="pages.configurator.title"
      descKey="pages.configurator.desc"
      pointsKey="pages.configurator.points"
      icon={Wand2}
    />
  );
}
