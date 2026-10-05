"use client";

import { Select } from "../_components/Select";

import { type FormEvent, useState } from "react";
import { lawyerText } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";

const ratingValues = [5, 4, 3, 2, 1] as const;

type RatingField = "overallRating" | "speedRating" | "qualityRating" | "communicationRating";
type Ratings = Record<RatingField, number>;

export function LawyerReviewForm({ requestId, locale }: { requestId: string; locale: PlatformLocale }) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const [ratings, setRatings] = useState<Ratings>({ overallRating: 5, speedRating: 5, qualityRating: 5, communicationRating: 5 });
  const [body, setBody] = useState("");
  const [state, setState] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const labels: Record<RatingField, string> = {
    overallRating: text("Общая оценка", "Umumiy baho", "Overall rating"),
    speedRating: text("Скорость", "Tezlik", "Responsiveness"),
    qualityRating: text("Качество", "Sifat", "Quality"),
    communicationRating: text("Коммуникация", "Muloqot", "Communication"),
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setState("");
    try {
      const response = await fetch(`/api/platform/lawyer-requests/${encodeURIComponent(requestId)}/review`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ ...ratings, body: body.trim() || undefined, locale }),
      });
      setState(response.ok
        ? text("Спасибо, отзыв передан на модерацию.", "Rahmat, fikr moderatsiyaga yuborildi.", "Thank you. Your review has been submitted for moderation.")
        : text("Не удалось отправить отзыв.", "Fikr yuborilmadi.", "We could not submit your review."));
    } catch {
      setState(text("Не удалось отправить отзыв.", "Fikr yuborilmadi.", "We could not submit your review."));
    } finally { setSubmitting(false); }
  }

  return <form className="lawyer-review-form" onSubmit={(event) => void submit(event)}>
    <h3>{text("Оценить работу юриста", "Yurist ishini baholash", "Rate your lawyer")}</h3>
    <div className="lawyer-review-ratings">
      {(Object.keys(labels) as RatingField[]).map((field) => <label key={field}>{labels[field]}
        <Select value={ratings[field]} disabled={submitting} onChange={(event) => setRatings((current) => ({ ...current, [field]: Number(event.target.value) }))}>
          {ratingValues.map((value) => <option key={value} value={value}>{value}/5</option>)}
        </Select>
      </label>)}
    </div>
    <label>{text("Комментарий (необязательно)", "Izoh (ixtiyoriy)", "Comment (optional)")}
      <textarea value={body} maxLength={2000} disabled={submitting} onChange={(event) => setBody(event.target.value)} />
    </label>
    <button type="submit" disabled={submitting}>{submitting ? text("Отправляется…", "Yuborilmoqda…", "Submitting…") : text("Отправить отзыв", "Fikr yuborish", "Submit review")}</button>
    {state && <p role="status">{state}</p>}
  </form>;
}
