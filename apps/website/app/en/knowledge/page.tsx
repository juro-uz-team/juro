import type { Metadata } from "next";
import KnowledgeHub, { generateMetadata as generateKnowledgeMetadata } from "../../[locale]/knowledge/page";

export async function generateMetadata(): Promise<Metadata> {
  return generateKnowledgeMetadata({ params: Promise.resolve({ locale: "en" }) });
}

export default function EnglishKnowledgeHub() {
  return <KnowledgeHub params={Promise.resolve({ locale: "en" })} />;
}
