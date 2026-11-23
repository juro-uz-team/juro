"use client";

import { useEffect, useRef } from "react";

export function HomepageMotion() {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const homepage = marker.current?.parentElement;
    if (!homepage || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target.getAttribute("data-home-reveal") === "repeat") {
          entry.target.toggleAttribute("data-entered", entry.isIntersecting);
          continue;
        }
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute("data-entered", "");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -56px 0px", threshold: 0.08 });

    for (const chapter of homepage.querySelectorAll("[data-home-reveal]")) {
      observer.observe(chapter);
    }
    return () => observer.disconnect();
  }, []);

  return <span ref={marker} hidden />;
}
