"use client";
import type{ReactNode}from'react';
import{usePathname,useSearchParams}from'next/navigation';
import Finance from'./finance';
const pages=new Set(['home','login','funds','markets','trade','earn','borrow','activity']);
/** Root-layout lifetime keeps the authenticated dashboard and its data mounted.
 * The server page still owns invalid-route and legacy-redirect validation. */
export function FinanceRouter({children}:{children:ReactNode}){
 const pathname=usePathname(),query=useSearchParams(),path=pathname.split('/').filter(Boolean),page=path[0]??'home';
 if(path.length>1||!pages.has(page))return children;
 const requested=query.get('category'),category=requested&&['crypto_spot','stocks','perps'].includes(requested)?requested:undefined;
 return <><Finance page={page} initialCategory={category}/>{children}</>;
}
