"use client";

import { PagePlaceholder } from "@/components/PagePlaceholder";
import { Inbox } from "lucide-react";

export default function Page() {
  return (
    <PagePlaceholder
      titleKey="pages.approvals.title"
      descKey="pages.approvals.desc"
      pointsKey="pages.approvals.points"
      icon={Inbox}
    />
  );
}
