"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicLanguage } from "../../../content/types";
import styles from "./juro-home.module.css";

type Question = { question: string; answer: string };

function FaqItem({ question, answer }: Question) {
  return (
    <details className={styles.faqItem}>
      <summary>{question}<Plus aria-hidden="true" size={20} /></summary>
      <p>{answer}</p>
    </details>
  );
}

export function HomepageFaq({ language, initialItems, moreLabel }: { language: PublicLanguage; initialItems: Question[]; moreLabel: string }) {
  const [publishedItems, setPublishedItems] = useState<Question[] | null>(null);

  useEffect(() => {
    const request = new AbortController();
    async function loadQuestions() {
      const response = await fetch(`/api/site-content?kind=faq&locale=${language}`, { signal: request.signal });
      if (!response.ok) return;
      const rows: { title?: unknown; body?: unknown }[] = await response.json();
      if (!Array.isArray(rows) || request.signal.aborted) return;
      const questions = rows.flatMap((row) => typeof row?.title === "string" && typeof row.body === "string"
        ? [{ question: row.title, answer: row.body }]
        : []);
      if (questions.length) setPublishedItems(questions);
    }
    void loadQuestions().catch(() => {});
    return () => request.abort();
  }, [language]);

  const items = publishedItems ?? initialItems;
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ question, answer }) => ({
      "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  }).replaceAll("<", "\\u003c");

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />
      {items.slice(0, 3).map((item, index) => <FaqItem key={index} {...item} />)}
      {items.length > 3 && (
        <details className={styles.faqMore}>
          <summary>{moreLabel}<Plus aria-hidden="true" size={17} /></summary>
          {items.slice(3).map((item, index) => <FaqItem key={index} {...item} />)}
        </details>
      )}
    </div>
  );
}
