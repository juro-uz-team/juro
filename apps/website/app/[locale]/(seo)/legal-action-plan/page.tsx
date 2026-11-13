import { SeoLanding, generateSeoLandingMetadata } from "../../_seo/SeoLanding";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) { return generateSeoLandingMetadata("legal-action-plan", { params }); }
export default function Page({ params }: Props) { return <SeoLanding slug="legal-action-plan" params={params} />; }
