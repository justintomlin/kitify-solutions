"use client";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { ClipboardCheck } from "lucide-react";

export default function Page() {
  return (
    <PagePlaceholder
      titleKey="pages.registerJob.title"
      descKey="pages.registerJob.desc"
      pointsKey="pages.registerJob.points"
      icon={ClipboardCheck}
    />
  );
}
