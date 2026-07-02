"use client";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { ShieldAlert } from "lucide-react";

export default function Page() {
  return (
    <PagePlaceholder
      titleKey="pages.claims.title"
      descKey="pages.claims.desc"
      pointsKey="pages.claims.points"
      icon={ShieldAlert}
    />
  );
}
