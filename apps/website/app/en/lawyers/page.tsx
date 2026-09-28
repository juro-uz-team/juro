import type { Metadata } from "next";
import LawyersPage, { generateMetadata as generateLocalizedMetadata } from "../../[locale]/lawyers/page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return generateLocalizedMetadata({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) });
}

export default async function EnglishLawyersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LawyersPage params={Promise.resolve({ locale: "en" })} searchParams={searchParams} />;
}
