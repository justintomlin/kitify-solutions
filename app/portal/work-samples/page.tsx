"use client";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { Camera } from "lucide-react";

export default function Page() {
  return (
    <PagePlaceholder
      titleKey="pages.workSamples.title"
      descKey="pages.workSamples.desc"
      pointsKey="pages.workSamples.points"
      icon={Camera}
    />
  );
}
