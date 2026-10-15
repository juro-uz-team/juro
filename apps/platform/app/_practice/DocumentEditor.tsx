"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../lib/practice/domain";
import { ActionForm, RichEditor } from "./controls";
import { t } from "./copy";
type Row = Record<string, any>;
type Api = (path: string, payload?: unknown, form?: FormData) => Promise<any>;

export function DocumentEditor({
  id,
  locale,
  api,
  href,
  actor,
  close,
}: {
  id: string;
  locale: Locale;
  api: Api;
  href: (path: string) => string;
  actor: Row;
  close: () => void;
}) {
  const [record, setRecord] = useState<Row | null>(null),
    [html, setHtml] = useState(""),
    [proposal, setProposal] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [files, setFiles] = useState<Row[]>([]),
    [busy, setBusy] = useState(false);
  const revision = useRef(1),
    latest = useRef(""),
    pending = useRef(Promise.resolve()),
    dirty = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const client = actor.role === "client",
    legal = ["owner", "admin", "lawyer", "assistant"].includes(actor.role),
    canApprove = ["owner", "admin", "lawyer"].includes(actor.role),
    editable =
      legal &&
      actor.writable &&
      ["draft", "changes_requested"].includes(record?.document?.state);
  const load = useCallback(async () => {
    const result = await api(`document?documentId=${encodeURIComponent(id)}`);
    revision.current = result.document.revision;
    latest.current = result.document.content.html;
    setRecord(result);
    setHtml(result.document.content.html);
    setProposal(result.document.content.html);
    dirty.current = false;
    const attachments = await api(
      `files?caseId=${encodeURIComponent(result.document.case_id)}`,
    );
    setFiles(attachments.items);
  }, [api, id]);
  useEffect(() => {
    load().catch((error) => setError(error.message));
    return () => clearTimeout(timer.current);
  }, [load]);
  const save = useCallback(
    (checkpoint = false) => {
      clearTimeout(timer.current);
      const content = latest.current;
      const operation = pending.current.then(async () => {
        const result = await api("commands", {
          action: "document.save",
          documentId: id,
          revision: revision.current,
          content,
          checkpoint,
        });
        revision.current = result.revision;
        if (latest.current === content) dirty.current = false;
        setSaved(true);
      });
      pending.current = operation.catch((error) => {
        setError(error.message);
      });
      return operation;
    },
    [api, id],
  );
  function changed(value: string) {
    latest.current = value;
    dirty.current = true;
    setSaved(false);
    setHtml(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      save().catch(() => {});
    }, 1400);
  }
  async function action(payload: Row) {
    setBusy(true);
    setError("");
    try {
      if (editable && dirty.current) await save();
      else await pending.current;
      await api("commands", {
        ...payload,
        documentId: id,
        revision: revision.current,
      });
      await load();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const doc = record?.document;
  if (!doc) return <p role="status">{error || t(locale, "loading")}</p>;
  const transitions: { state: string; label: string }[] =
    doc.state === "draft" || doc.state === "changes_requested"
      ? [{ state: "review", label: "sendReview" }]
      : doc.state === "review"
        ? [
            { state: "agreed", label: "agree" },
            { state: "changes_requested", label: "changes_requested" },
          ]
        : doc.state === "agreed"
          ? [
              { state: "awaiting_signed", label: "awaiting_signed" },
              { state: "draft", label: "newDraft" },
            ]
          : ["signed_confirmed", "awaiting_signed"].includes(doc.state)
            ? [{ state: "draft", label: "newDraft" }]
            : [];
  return (
    <div className="practice-document-layout">
      <section className="practice-panel practice-document-main">
        <header>
          <button
            onClick={async () => {
              if (editable && dirty.current) {
                try {
                  await save();
                } catch {
                  return;
                }
              }
              close();
            }}
          >
            {t(locale, "previous")}
          </button>
          <h2>{doc.title}</h2>
          <span className="practice-badge">{t(locale, doc.state)}</span>
        </header>
        <p className="practice-muted">{t(locale, "draftNote")}</p>
        {error && (
          <p role="alert" className="practice-error">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="practice-muted">
            {t(locale, "saved")}
          </p>
        )}
        <RichEditor
          html={html}
          locale={locale}
          onChange={changed}
          readOnly={!editable || busy}
        />
        <div className="practice-actions">
          {editable && (
            <>
              <button
                disabled={busy}
                onClick={() => {
                  setError("");
                  save().catch((error) => setError(error.message));
                }}
              >
                {t(locale, "save")}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setError("");
                  save(true)
                    .then(load)
                    .catch((error) => setError(error.message));
                }}
              >
                {t(locale, "checkpoint")}
              </button>
            </>
          )}
          {canApprove &&
            actor.writable &&
            transitions.map((item) => (
              <button
                className="practice-primary"
                disabled={busy}
                key={item.state}
                onClick={() =>
                  action({ action: "document.transition", state: item.state })
                }
              >
                {t(locale, item.label)}
              </button>
            ))}
          <a href={href(`export/document/${id}?format=pdf`)}>PDF</a>
          <a href={href(`export/document/${id}?format=docx`)}>DOCX</a>
        </div>
        {client &&
          actor.writable &&
          ["review", "changes_requested"].includes(doc.state) && (
            <button
              className="practice-primary"
              disabled={busy}
              onClick={() =>
                action({
                  action: "document.review",
                  kind: "approval",
                  body: t(locale, "approval"),
                  anchor: "",
                })
              }
            >
              {t(locale, "approve")}
            </button>
          )}
        <section className="practice-signature">
          <h3>{t(locale, "signed")}</h3>
          <p>{t(locale, "signingNote")}</p>
          {actor.writable && doc.agreed_version_id && (
            <form
              className="practice-inline-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setError("");
                const form = new FormData(event.currentTarget);
                form.set("caseId", doc.case_id);
                form.set("documentId", id);
                form.set("purpose", "signed");
                form.set("versionId", doc.agreed_version_id);
                form.set("clientVisible", "true");
                try {
                  await api("uploads", undefined, form);
                  await load();
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              <label>
                {t(locale, "signed")}
                <input type="file" name="file" accept=".pdf" required />
              </label>
              <button>{t(locale, "upload")}</button>
            </form>
          )}
          {files
            .filter(
              (file) => file.document_id === id && file.purpose === "signed",
            )
            .map((file) => (
              <div className="practice-dashboard-row" key={file.id}>
                <a href={href(`files/${file.id}`)}>{file.file_name}</a>
                {canApprove &&
                  actor.writable &&
                  doc.state === "awaiting_signed" &&
                  file.version_id === doc.agreed_version_id && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        action({
                          action: "document.transition",
                          state: "signed_confirmed",
                          signedFileId: file.id,
                        })
                      }
                    >
                      {t(locale, "confirm")}
                    </button>
                  )}
              </div>
            ))}
          {record.signatures?.map((signature: Row) => (
            <p key={signature.id}>
              {t(locale, "signed_confirmed")} · {signature.confirmed_name} ·{" "}
              {new Date(signature.confirmed_at).toLocaleString(locale, {
                timeZone: "Asia/Tashkent",
              })}
            </p>
          ))}
        </section>
      </section>
      <aside className="practice-document-aside">
        <section className="practice-panel">
          <h3>{t(locale, "review")}</h3>
          {record.reviews.map((review: Row) => (
            <article className="practice-review" key={review.id}>
              <small>
                {review.author_name} · {t(locale, review.kind)} ·{" "}
                {new Date(review.created_at).toLocaleString(locale, {
                  timeZone: "Asia/Tashkent",
                })}
              </small>
              <p>{review.body}</p>
              {review.anchor && <blockquote>{review.anchor}</blockquote>}
              {review.proposal && (
                <details>
                  <summary>{t(locale, "proposal")}</summary>
                  <div
                    className="practice-editor"
                    dangerouslySetInnerHTML={{ __html: review.proposal.html }}
                  />
                </details>
              )}
              <span className="practice-badge">
                {t(locale, review.state === "open" ? "pending" : review.state)}
              </span>
              {canApprove &&
                actor.writable &&
                review.kind === "proposal" &&
                review.state === "open" && (
                  <div className="practice-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        action({
                          action: "document.resolve",
                          reviewId: review.id,
                          accept: true,
                        })
                      }
                    >
                      {t(locale, "accept")}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        action({
                          action: "document.resolve",
                          reviewId: review.id,
                          accept: false,
                        })
                      }
                    >
                      {t(locale, "reject")}
                    </button>
                  </div>
                )}
            </article>
          ))}
          {actor.writable &&
            ["review", "changes_requested"].includes(doc.state) && (
              <ActionForm
                locale={locale}
                fields={[
                  {
                    key: "kind",
                    type: "select",
                    options: ["comment", "proposal"].map((value) => ({
                      value,
                      label: t(locale, value),
                    })),
                  },
                  { key: "anchor", required: false },
                  { key: "body", type: "textarea" },
                ]}
                initial={{ kind: "comment" }}
                submit={async (values) => {
                  await action({
                    action: "document.review",
                    ...values,
                    anchor: values.anchor ?? "",
                    ...(values.kind === "proposal" ? { proposal } : {}),
                  });
                }}
              />
            )}
          {actor.writable &&
            ["review", "changes_requested"].includes(doc.state) && (
              <details>
                <summary>{t(locale, "proposal")}</summary>
                <RichEditor
                  html={proposal}
                  locale={locale}
                  onChange={setProposal}
                />
              </details>
            )}
        </section>
        <section className="practice-panel">
          <h3>{t(locale, "history")}</h3>
          {record.versions.map((version: Row) => (
            <div className="practice-version" key={version.id}>
              <b>
                v{version.revision} · {version.author_name}
              </b>
              <span>
                {new Date(version.created_at).toLocaleString(locale, {
                  timeZone: "Asia/Tashkent",
                })}
              </span>
              <div>
                <a
                  href={href(
                    `export/document/${id}?format=pdf&versionId=${version.id}`,
                  )}
                >
                  PDF
                </a>
                <a
                  href={href(
                    `export/document/${id}?format=docx&versionId=${version.id}`,
                  )}
                >
                  DOCX
                </a>
              </div>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
