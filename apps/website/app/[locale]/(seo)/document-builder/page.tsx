import { SeoLanding, generateSeoLandingMetadata } from "../../_seo/SeoLanding";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) { return generateSeoLandingMetadata("document-builder", { params }); }
export default function Page({ params }: Props) { return <SeoLanding slug="document-builder" params={params} />; }
