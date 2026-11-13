import News, { generateMetadata as generateNewsMetadata } from "../../[locale]/news/page";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return generateNewsMetadata({ params: Promise.resolve({ locale: "en" }) }); }
export default function Page() { return <News params={Promise.resolve({ locale: "en" })} />; }
