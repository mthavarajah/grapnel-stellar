import Finance from "@/components/finance";
import { notFound } from "next/navigation";
export default async function Page({
  params,
}: {
  params: Promise<{ page?: string[] }>;
}) {
  const path = (await params).page ?? [];
  const page = path[0] ?? "home";
  if (
    path.length > 1 ||
    ![
      "home",
      "login",
      "fund",
      "return",
      "markets",
      "trade",
      "earn",
      "activity",
    ].includes(page)
  )
    notFound();
  return <Finance page={page} />;
}
