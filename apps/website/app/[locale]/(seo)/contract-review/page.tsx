import { generateSeoLandingMetadata, SeoLanding } from "../../_seo/SeoLanding";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) { return generateSeoLandingMetadata("contract-review", { params }); }

export default function ContractReviewPage({ params }: Props) { return <SeoLanding slug="contract-review" params={params} />; }
