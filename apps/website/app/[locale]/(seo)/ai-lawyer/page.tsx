import { generateSeoLandingMetadata, SeoLanding } from "../../_seo/SeoLanding";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) { return generateSeoLandingMetadata("ai-lawyer", { params }); }

export default function AiLawyerPage({ params }: Props) { return <SeoLanding slug="ai-lawyer" params={params} />; }
