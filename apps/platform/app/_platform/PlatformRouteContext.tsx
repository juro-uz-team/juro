"use client";

import { createContext, useContext } from "react";

const PlatformBasePathContext = createContext<string | null>(null);
const PlatformWorkspaceIdContext = createContext<string | null>(null);

export function PlatformRouteProvider({
  basePath,
  workspaceId,
  children,
}: {
  basePath: string;
  workspaceId: string;
  children: React.ReactNode;
}) {
  return (
    <PlatformBasePathContext.Provider value={basePath}>
      <PlatformWorkspaceIdContext.Provider value={workspaceId}>
        {children}
      </PlatformWorkspaceIdContext.Provider>
    </PlatformBasePathContext.Provider>
  );
}

export function usePlatformBasePath(): string {
  const value = useContext(PlatformBasePathContext);
  if (!value) throw new Error("PLATFORM_ROUTE_CONTEXT_REQUIRED");
  return value;
}

export function usePlatformWorkspaceId(): string {
  const value = useOptionalPlatformWorkspaceId();
  if (!value) throw new Error("PLATFORM_WORKSPACE_CONTEXT_REQUIRED");
  return value;
}

export function useOptionalPlatformWorkspaceId(): string | null {
  return useContext(PlatformWorkspaceIdContext);
}
