"use client";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { FileText } from "lucide-react";

export default function Page() {
  return (
    <PagePlaceholder
      titleKey="pages.content.title"
      descKey="pages.content.desc"
      pointsKey="pages.content.points"
      icon={FileText}
    />
  );
}
