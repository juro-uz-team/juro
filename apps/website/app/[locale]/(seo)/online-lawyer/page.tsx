import { generateSeoLandingMetadata, SeoLanding } from "../../_seo/SeoLanding";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) { return generateSeoLandingMetadata("online-lawyer", { params }); }

export default function OnlineLawyerPage({ params }: Props) { return <SeoLanding slug="online-lawyer" params={params} />; }
