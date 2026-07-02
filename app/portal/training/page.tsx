"use client";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { GraduationCap } from "lucide-react";

export default function Page() {
  return (
    <PagePlaceholder
      titleKey="pages.training.title"
      descKey="pages.training.desc"
      pointsKey="pages.training.points"
      icon={GraduationCap}
    />
  );
}
