import type { ReactNode } from "react";
import { Card } from "../../ui/index.ts";

/** One setting: what it is on the left, its control on the right (below on phones). */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </Card>
  );
}
