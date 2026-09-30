"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, FileText, MessageSquare, Bell, Users, ScanLine, Pause, Play, ArrowUp, Layers3 } from "lucide-react";
import { OfficialLogo } from "./OfficialLogo";
import type { PublicLanguage } from "../../../content/types";
import styles from "./intelligence-scene.module.css";

const copy = {
  ru: { label: "Демонстрация интерфейсов · пример, не ответ AI", group: "Этапы работы JURO", stages: ["Вопрос", "Анализ", "Риск", "Документ", "Контекст", "Результат"], chat: "AI-помощник", analysis: "Анализ документа", builder: "Конструктор", monitoring: "Мониторинг", lawyer: "Консультация", question: "Проверь договор аренды. На что обратить внимание?", reply: "Сначала проверим условия возврата депозита.", file: "Договор аренды.pdf", clause: "4.2. Депозит удерживается по усмотрению арендодателя.", risk: "Основания удержания не определены", revision: "Уточнить основания и срок возврата", rows: ["Стороны", "Предмет", "Условия", "Подписи"], source: "Правовые источники", update: "Уведомление · пример", handoff: "Вы выбираете, что передать", facts: "Факты", documents: "Документы", pause: "Приостановить демонстрацию", play: "Воспроизвести демонстрацию", statuses: ["Запрос поступает в рабочее пространство", "JURO сопоставляет формулировки и контекст", "Риск связан с конкретным пунктом", "Структура документа собирается по шагам", "Материалы готовы к выборочной передаче", "Следующий шаг — у вас перед глазами"] },
  uz: { label: "Interfeys namoyishi · misol, AI javobi emas", group: "JURO ish bosqichlari", stages: ["Savol", "Tahlil", "Xavf", "Hujjat", "Kontekst", "Natija"], chat: "AI-yordamchi", analysis: "Hujjat tahlili", builder: "Konstruktor", monitoring: "Monitoring", lawyer: "Maslahat", question: "Ijara shartnomasini tekshiring. Nimaga e’tibor berish kerak?", reply: "Avval depozitni qaytarish shartlarini tekshiramiz.", file: "Ijara shartnomasi.pdf", clause: "4.2. Depozit ijaraga beruvchining ixtiyoriga ko‘ra ushlab qolinadi.", risk: "Ushlab qolish asoslari belgilanmagan", revision: "Asoslar va qaytarish muddatini aniqlashtirish", rows: ["Tomonlar", "Predmet", "Shartlar", "Imzolar"], source: "Huquqiy manbalar", update: "Bildirishnoma · misol", handoff: "Nimani yuborishni o‘zingiz tanlaysiz", facts: "Faktlar", documents: "Hujjatlar", pause: "Namoyishni to‘xtatish", play: "Namoyishni boshlash", statuses: ["Savol ish makoniga keladi", "JURO matn va kontekstni solishtiradi", "Xavf aniq band bilan bog‘lanadi", "Hujjat tuzilmasi bosqichma-bosqich yig‘iladi", "Materiallar tanlab yuborishga tayyor", "Keyingi qadam ko‘z oldingizda"] },
  en: { label: "Interface demonstration · illustration, not an AI response", group: "JURO workflow stages", stages: ["Question", "Analysis", "Risk", "Document", "Context", "Next step"], chat: "AI assistant", analysis: "Document analysis", builder: "Contract builder", monitoring: "Monitoring", lawyer: "Consultation", question: "Review this lease. What should I look out for?", reply: "Let’s start with the conditions for returning the deposit.", file: "Lease agreement.pdf", clause: "4.2. The landlord may withhold the deposit at their discretion.", risk: "Grounds for withholding are undefined", revision: "Specify grounds and the return deadline", rows: ["Parties", "Subject", "Terms", "Signatures"], source: "Legal sources", update: "Notification · example", handoff: "You choose what to share", facts: "Facts", documents: "Documents", pause: "Pause demonstration", play: "Play demonstration", statuses: ["A question enters the workspace", "JURO connects wording and context", "A risk is linked to the exact clause", "A document takes shape, step by step", "Materials are ready for selective handoff", "A clear next step, in front of you"] },
};

export function IntelligenceScene({ language }: { language: PublicLanguage }) {
  const t = copy[language];
  const [step, setStep] = useState(5);
  const [playing, setPlaying] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current;
    const visual = camera.current;
    if (!el || !visual) return;
    const media = matchMedia("(prefers-reduced-motion: no-preference) and (min-width: 761px) and (pointer: fine)");
    let visible = false;
    let frame = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let x = 0, y = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      if (!media.matches || !visible || !playing || document.hidden) return;
      frame = requestAnimationFrame(() => {
        const depth = Math.max(-1, Math.min(1, el.getBoundingClientRect().top / innerHeight));
        visual.style.transform = `translate3d(${x * 6}px,${y * 4 + depth * 2}px,0)`;
      });
    };
    const sync = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      const active = visible && !document.hidden && media.matches && playing;
      el.dataset.running = String(active);
      if (!media.matches) { visual.style.transform = ""; }
      if (active) timer = setInterval(() => setStep(value => (value + 1) % 6), 2100);
      paint();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .2 });
    observer.observe(el);
    const move = (event: PointerEvent) => {
      if (!playing || event.pointerType === "touch") return;
      const rect = el.getBoundingClientRect();
      x = (event.clientX - rect.left) / rect.width - .5;
      y = (event.clientY - rect.top) / rect.height - .5;
      paint();
    };
    const reset = () => { x = 0; y = 0; paint(); };
    el.addEventListener("pointermove", move, { passive: true });
    el.addEventListener("pointerleave", reset);
    window.addEventListener("scroll", paint, { passive: true });
    document.addEventListener("visibilitychange", sync);
    media.addEventListener("change", sync);
    return () => { if (timer) clearInterval(timer); cancelAnimationFrame(frame); observer.disconnect(); el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", reset); window.removeEventListener("scroll", paint); document.removeEventListener("visibilitychange", sync); media.removeEventListener("change", sync); visual.style.transform = ""; };
  }, [playing]);

  return <div className={styles.scene} ref={stage} data-step={step}>
    <div className={styles.meta}><span>JURO / LEGAL WORKSPACE</span><button className={styles.play} type="button" aria-label={playing ? t.pause : t.play} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={13} /> : <Play size={13} />}<span>{playing ? t.pause : t.play}</span></button></div>
    <div className={styles.space}>
      <div className={styles.camera} ref={camera} aria-hidden="true">
        <div className={styles.grid} /><div className={styles.halo} /><div className={styles.laptopBase}><div className={styles.keyboard}>{Array.from({length:40},(_,i)=><i key={i}/>)}</div><div className={styles.trackpad}/></div>
        <div className={`${styles.panel} ${styles.monitor}`}><header><Bell size={13} /><strong>{t.monitoring}</strong><i /></header><div className={styles.feed} key={step > 3 ? "update" : "source"}><span>{t.source}</span><div className={styles.feedLine} /><p>{step > 3 ? t.update : "LexUZ / UZ"}</p><small>{t.label.split(" · ")[0]}</small></div></div>
        <div className={`${styles.panel} ${styles.analysisPane}`} data-active={step >= 2}><header><FileText size={13}/><strong>{t.analysis}</strong><span>PDF</span></header><div><i/><i/><i/><p>{step >= 2 ? t.risk : t.file}</p><i/></div></div>
        <div className={`${styles.panel} ${styles.main}`}>
          <div className={styles.webcam} /><header className={styles.toolbar}><OfficialLogo inverse /><span>workspace / 024</span><div><i /><i /><i /></div></header>
          <div className={styles.desktop}>
            <aside><MessageSquare size={16} /><FileText size={16} /><Layers3 size={16} /><Bell size={16} /><Users size={16} /></aside>
            <div className={styles.chat}>
              <h3><MessageSquare size={13} />{t.chat}</h3>
              <div className={styles.message} data-visible={step >= 0}><p>{t.question}</p><span><FileText size={11} />{t.file}</span></div>
              <div className={styles.answer} data-visible={step >= 1}><div className={styles.aiMark}>AI</div><p>{t.reply}</p></div>
              <div className={styles.chatRisk} data-visible={step >= 2}><span>!</span>{t.risk}</div>
              <div className={styles.input}><span>{t.stages[0]}…</span><ArrowUp size={14} /></div>
            </div>
            <div className={styles.document}>
              <h3><ScanLine size={13} />{t.analysis}</h3><div className={styles.paper}><span>LEASE / 024</span><strong>{t.file.replace(".pdf", "")}</strong><div className={styles.lines}><i /><i /><i /></div><p className={styles.clause} data-active={step >= 2}>{t.clause}</p><div className={styles.lines}><i /><i /></div><div className={styles.signature} /><div className={styles.scan} /></div>
              <div className={styles.riskFlag} data-visible={step >= 2}><span>!</span>{t.risk}</div>
            </div>
          </div>
          <div className={styles.status}><i /><span>{t.stages[step]}</span><span>0{step + 1} / 06</span></div>
        </div>
        <div className={`${styles.panel} ${styles.builder}`}><header><Layers3 size={14} /><strong>{t.builder}</strong><span>DOC</span></header><div className={styles.builderRows}>{t.rows.map((row,index)=><div key={row} data-filled={step >= 3 || index===0}><span>0{index+1}</span><strong>{row}</strong><Check size={12} /><i /></div>)}</div><div className={styles.builderProgress}><i /></div></div>
        <div className={`${styles.panel} ${styles.consultation}`}><header><Users size={14} /><strong>{t.lawyer}</strong></header><p>{t.handoff}</p><div className={styles.attachments}><span><Check size={11} />{t.facts}</span><span><FileText size={11} />{t.documents}</span></div></div>
        <div className={styles.result} data-visible={step >= 5}><Check size={16} /><span>{t.revision}</span><ArrowUpRight size={16} /></div>
        <div className={styles.connector} />
      </div>
    </div>
    <div className={styles.timeline} role="group" aria-label={t.group}>{t.stages.map((label,index)=><button key={label} type="button" aria-pressed={step === index} onClick={()=>{setPlaying(false);setStep(index);}}><span>0{index+1}</span><strong>{label}</strong><i /></button>)}</div>
    <p className={styles.description} aria-live={playing ? "off" : "polite"}>{t.statuses[step]}</p>
    <p className={styles.caption}>{t.label}</p>
  </div>;
}

