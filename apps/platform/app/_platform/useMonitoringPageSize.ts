import { useSyncExternalStore } from "react";

function subscribe(onResize: () => void) {
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}

function pageSize() {
  if (window.innerWidth <= 880 || window.innerHeight < 660) return 4;
  return Math.max(4, Math.min(12, Math.floor((window.innerHeight - 365) / 71)));
}

export function useMonitoringPageSize() {
  return useSyncExternalStore(subscribe, pageSize, () => 4);
}
