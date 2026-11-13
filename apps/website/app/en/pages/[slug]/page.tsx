import ContentPage, { generateMetadata as generatePageMetadata } from "../../../[locale]/pages/[slug]/page";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props) { return generatePageMetadata({ params: params.then(value => ({ ...value, locale: "en" })) }); }
export default function Page({ params }: Props) { return <ContentPage params={params.then(value => ({ ...value, locale: "en" }))} />; }
