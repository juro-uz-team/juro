import { notFound } from "next/navigation";

import { NotificationsClient } from "../../../../_document-builder/notifications/NotificationsClient";
import { requireChatGPTUser } from "../../../../chatgpt-auth";
import { isLocale, isWorkspaceId, platformPath } from "../../../../../lib/platform/routing";

export const dynamic = "force-dynamic";

export default async function BusinessNotifications({ params }: { params: Promise<{ locale: string; workspaceId: string }> }) {
  const { locale, workspaceId } = await params;
  if (!isLocale(locale) || !isWorkspaceId(workspaceId)) notFound();
  await requireChatGPTUser(platformPath(locale, "business", "notifications", workspaceId));
  return <NotificationsClient />;
}
