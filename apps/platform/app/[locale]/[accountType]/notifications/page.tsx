import { requireChatGPTUser } from "../../../chatgpt-auth";
import { NotificationsClient } from "../../../_document-builder/notifications/NotificationsClient";

export const dynamic = "force-dynamic";

export default async function CanonicalNotifications({ params }: { params: Promise<{ locale: string; accountType: string }> }) {
  const { locale, accountType } = await params;
  await requireChatGPTUser(`/${locale}/${accountType}/notifications`);
  return <NotificationsClient />;
}
