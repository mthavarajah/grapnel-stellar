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
  // The root layout retains the client shell across these validated routes.
  return null;
}
