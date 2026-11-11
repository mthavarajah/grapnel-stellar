import Finance from "@/components/finance";
import { notFound, redirect } from "next/navigation";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ page?: string[] }>;
  searchParams: Promise<{category?:string|string[]}>;
}) {
  const path = (await params).page ?? [];
  const page = path[0] ?? "home";
  if(path.length===1 && ["fund","return"].includes(page))redirect("/funds");
  if (
    path.length > 1 ||
    ![
      "home",
      "login",
      "funds",
      "fund",
      "return",
      "markets",
      "trade",
      "earn",
      "borrow",
      "activity",
    ].includes(page)
  )
    notFound();
  const requestedCategory=(await searchParams).category;
  const initialCategory=typeof requestedCategory==="string"&&["crypto_spot","perps","stocks","commodities"].includes(requestedCategory)?requestedCategory:undefined;
  return <Finance page={page} initialCategory={initialCategory} />;
}
