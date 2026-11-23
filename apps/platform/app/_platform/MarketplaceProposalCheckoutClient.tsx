"use client";

import { WorkspaceTitle } from "./WorkspaceTitle";
import { LockKeyhole } from "lucide-react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { platformBasePath, type AccountType, type PlatformLocale } from "../../lib/platform/routing";

const checkoutCopy = {
  ru: { title: "Подтвердите оплату услуги", description: "Цена и согласие на договор сохранены до перехода к защищённому платёжному событию.", action: "Подтвердить и перейти к оплате", failed: "Не удалось открыть защищённую оплату." },
  uz: { title: "Xizmat to‘lovini tasdiqlang", description: "Narx va shartnomaga rozilik himoyalangan to‘lov hodisasiga o‘tishdan oldin saqlandi.", action: "Tasdiqlash va to‘lovga o‘tish", failed: "Himoyalangan to‘lovni ochib bo‘lmadi." },
  en: { title: "Confirm service payment", description: "The agreed price and contract consent were recorded before opening the protected payment flow.", action: "Confirm and continue to payment", failed: "We could not open the protected payment flow." },
} as const;

export function MarketplaceProposalCheckoutClient({locale,accountType,orderId,workspaceId}:{locale:PlatformLocale;accountType:AccountType;orderId:string;workspaceId?:string}) { const [busy,setBusy]=useState(false),[error,setError]=useState("");const router=useRouter(),copy=checkoutCopy[locale];async function confirm(){setBusy(true);setError("");try{const r=await fetch(`/api/checkout/${encodeURIComponent(orderId)}/confirm-marketplace`,{method:"POST",headers:{"content-type":"application/json","x-juro-csrf":"1"},body:JSON.stringify({requestId:crypto.randomUUID(),locale,accountType,...(workspaceId?{workspaceId}:{})})});const b=await r.json() as {error?:string};if(!r.ok)throw new Error(b.error||copy.failed);router.push(`${platformBasePath(locale,accountType,workspaceId)}/orders/${encodeURIComponent(orderId)}/payment`);}catch(e){setError(e instanceof Error?e.message:String(e));setBusy(false);}} return <section className="checkout-workspace workspace-page"><WorkspaceTitle icon={<LockKeyhole />} title={copy.title} description={copy.description} />{error&&<p className="billing-error" role="alert"><CircleAlert/>{error}</p>}<button type="button" disabled={busy} onClick={()=>void confirm()}>{busy?<LoaderCircle className="spin"/>:<Check/>}{copy.action}</button></section>; }
