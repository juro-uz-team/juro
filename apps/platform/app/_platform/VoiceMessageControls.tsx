"use client";

import { Mic, Pause, Play, RotateCcw, Square, Trash2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { deleteVoiceRecording, uploadAndTranscribeVoice } from "../../lib/ai/client-voice";
import type { VoiceRecorderPhase, VoiceSpeechPhase } from "../../lib/ai/voice-ui";
import type { PlatformLocale } from "../../lib/platform/routing";

const voiceCopy = {
  ru: {
    unsupported: "Браузер не поддерживает безопасную запись микрофона.",
    microphoneUnavailable: "Микрофон недоступен. Разрешите доступ в браузере или используйте текст.",
    emptyRecording: "Запись пуста. Попробуйте ещё раз.",
    inputAria: "Голосовой ввод",
    recordQuestionAria: "Записать вопрос голосом",
    recordQuestion: "Записать вопрос",
    resume: "Продолжить",
    pause: "Пауза",
    finish: "Завершить",
    cancel: "Отменить",
    removeAudio: "Удалить аудио",
    retry: "Повторить",
    processingAria: "Обработка голосовой записи",
    speechUnavailable: "Озвучивание недоступно.",
    playbackBlocked: "Браузер не разрешил воспроизведение. Нажмите повтор.",
    aiVoice: "AI-голос",
    preparingAudio: "Готовим аудио…",
    speakAnswer: "Озвучить ответ",
    unmute: "Включить звук",
    mute: "Без звука",
    stop: "Остановить",
    replay: "Повторить",
    syntheticNotice: "Синтетический AI-голос, не живой юрист.",
    phases: {
      idle: "Микрофон включается только после нажатия.",
      listening: "Идёт запись.",
      paused: "Запись приостановлена.",
      hashing: "Проверяем запись перед загрузкой…",
      uploading: "Загружаем в private R2…",
      finalizing: "Проверяем формат и контрольную сумму…",
      transcribing: "Распознаём речь…",
      ready: "Текст распознан. Проверьте его в поле и отправьте.",
      error: "Голосовая запись не завершена.",
    },
  },
  uz: {
    unsupported: "Brauzer xavfsiz mikrofon yozuvini qo‘llamaydi.",
    microphoneUnavailable: "Mikrofon mavjud emas. Brauzerda ruxsat bering yoki matndan foydalaning.",
    emptyRecording: "Yozuv bo‘sh. Qayta urinib ko‘ring.",
    inputAria: "Ovozli kiritish",
    recordQuestionAria: "Savolni ovoz bilan yozish",
    recordQuestion: "Savolni yozish",
    resume: "Davom etish",
    pause: "Pauza",
    finish: "Tugatish",
    cancel: "Bekor qilish",
    removeAudio: "Audioni o‘chirish",
    retry: "Qayta urinish",
    processingAria: "Ovozli yozuv qayta ishlanmoqda",
    speechUnavailable: "Ovoz chiqarish mavjud emas.",
    playbackBlocked: "Brauzer ijro etishga ruxsat bermadi. Qayta urinishni bosing.",
    aiVoice: "AI ovozi",
    preparingAudio: "Audio tayyorlanmoqda…",
    speakAnswer: "Javobni ovozlantirish",
    unmute: "Ovozni yoqish",
    mute: "Ovozni o‘chirish",
    stop: "To‘xtatish",
    replay: "Qayta eshitish",
    syntheticNotice: "Sun’iy AI ovozi, tirik yurist emas.",
    phases: {
      idle: "Mikrofon faqat bosgandan keyin yoqiladi.",
      listening: "Yozuv davom etmoqda.",
      paused: "Yozuv pauzada.",
      hashing: "Yozuv yuklashdan oldin tekshirilmoqda…",
      uploading: "Private R2 ga yuklanmoqda…",
      finalizing: "Format va nazorat summasi tekshirilmoqda…",
      transcribing: "Nutq matnga aylantirilmoqda…",
      ready: "Matn tayyor. Uni maydonda tekshirib yuboring.",
      error: "Ovozli yozuv yakunlanmadi.",
    },
  },
  en: {
    unsupported: "This browser does not support secure microphone recording.",
    microphoneUnavailable: "The microphone is unavailable. Allow access in your browser or enter the question as text.",
    emptyRecording: "The recording is empty. Try again.",
    inputAria: "Voice input",
    recordQuestionAria: "Record a voice question",
    recordQuestion: "Record question",
    resume: "Resume",
    pause: "Pause",
    finish: "Finish",
    cancel: "Cancel",
    removeAudio: "Delete audio",
    retry: "Try again",
    processingAria: "Processing voice recording",
    speechUnavailable: "Text-to-speech is unavailable.",
    playbackBlocked: "Your browser blocked playback. Select replay to try again.",
    aiVoice: "AI voice",
    preparingAudio: "Preparing audio…",
    speakAnswer: "Listen to answer",
    unmute: "Turn sound on",
    mute: "Mute",
    stop: "Stop",
    replay: "Replay",
    syntheticNotice: "Synthetic AI voice, not a live lawyer.",
    phases: {
      idle: "The microphone turns on only after you select record.",
      listening: "Recording in progress.",
      paused: "Recording paused.",
      hashing: "Checking the recording before upload…",
      uploading: "Uploading to private storage…",
      finalizing: "Checking the format and checksum…",
      transcribing: "Transcribing speech…",
      ready: "Transcript ready. Review it in the field before sending.",
      error: "The voice recording was not completed.",
    },
  },
} as const;

export function VoiceMessageControls(props: {
  locale: PlatformLocale;
  disabled: boolean;
  onTranscript: (value: { recordingId: string; transcript: string }) => void;
  onClear: () => void;
  recordingId: string;
  presentation?: "inline" | "stage";
  onPhaseChange?: (phase: VoiceRecorderPhase) => void;
}) {
  // Presentation bindings are supplied by the replacement voice controller.
  return <section className={`ai-voice-controls ${props.presentation === "stage" ? "is-stage" : ""}`} data-phase={phase} aria-label={t.inputAria}>
    <div className="ai-voice-actions">
      {phase === "idle" && <button type="button" disabled={props.disabled} aria-label={t.recordQuestionAria} title={t.recordQuestionAria} onClick={() => void start()}><Mic /><span>{t.recordQuestion}</span></button>}
      {(phase === "listening" || phase === "paused") && <>
        <button type="button" onClick={pauseOrResume}>{phase === "paused" ? <Play /> : <Pause />}{phase === "paused" ? t.resume : t.pause}</button>
        <button type="button" onClick={() => recorderRef.current?.stop()}><Square />{t.finish}</button>
        <button type="button" onClick={cancel}><Trash2 />{t.cancel}</button>
      </>}
      {phase === "ready" && <button type="button" onClick={() => void clear()}><Trash2 />{t.removeAudio}</button>}
      {phase === "error" && <button type="button" onClick={() => { setPhase("idle"); setError(""); }}><RotateCcw />{t.retry}</button>}
    </div>
    {(phase === "listening" || phase === "paused") && <output>{formatElapsed(elapsedMs)} / 05:00</output>}
    <p role={phase === "error" ? "alert" : "status"} aria-live="polite">
      {error || phaseLabel(phase, props.locale)}
    </p>
    {busy && <progress aria-label={t.processingAria} />}
  </section>;
}

export function AssistantSpeechControls(props: { locale: PlatformLocale; assistantMessageId: string; disabled?: boolean; onPhaseChange?: (phase: VoiceSpeechPhase) => void }) {
  // Presentation bindings are supplied by the replacement voice controller.
  return <div className="ai-speech-controls">
    <label>{t.aiVoice}<select value={voice} onChange={(event) => setVoice(event.target.value as "marin" | "cedar")}><option value="marin">Marin</option><option value="cedar">Cedar</option></select></label>
    <button type="button" disabled={props.disabled || loading} onClick={() => void speak()}><Volume2 />{loading ? t.preparingAudio : t.speakAnswer}</button>
    {audioUrl && <>
      <audio
        ref={audioRef}
        src={audioUrl}
        controls
        muted={muted}
        preload="metadata"
        onPlay={() => onPhaseChange?.("speaking")}
        onPause={() => { if (audioRef.current && audioRef.current.currentTime > 0 && !audioRef.current.ended) onPhaseChange?.("paused"); }}
        onEnded={() => onPhaseChange?.("completed")}
        onError={() => onPhaseChange?.("error")}
      />
      <button type="button" aria-pressed={muted} onClick={() => setMuted((value) => !value)}>{muted ? <VolumeX /> : <Volume2 />}{muted ? t.unmute : t.mute}</button>
      <button type="button" onClick={stop}><Square />{t.stop}</button>
      <button type="button" onClick={replay}><RotateCcw />{t.replay}</button>
    </>}
    <small>{t.syntheticNotice}</small>
    {error && <p role="alert">{error}</p>}
  </div>;
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function phaseLabel(phase: VoiceRecorderPhase, locale: PlatformLocale) {
  return voiceCopy[locale].phases[phase];
}
