"use client";
import { usePathname } from 'next/navigation';
import Dashboard from './dashboard';
/** Keep the owner session and workspace data mounted during section navigation. */
export function DashboardRouter(){
 const pathname=usePathname();
 return <Dashboard section={pathname.split('/').filter(Boolean)[0]??'overview'}/>;
}
