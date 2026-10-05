"use client";

import { Select } from "../_components/Select";

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
  workspaceId?: string;
  presentation?: "inline" | "stage";
  onPhaseChange?: (phase: VoiceRecorderPhase) => void;
}) {
  const t = voiceCopy[props.locale];
  const [phase, setPhase] = useState<VoiceRecorderPhase>("idle");
  const [error, setError] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const recordingRef = useRef("");
  const propsRef = useRef(props); propsRef.current = props;
  const busy = ["hashing", "uploading", "finalizing", "transcribing"].includes(phase);
  useEffect(() => {propsRef.current.onPhaseChange?.(phase);}, [phase]);
  useEffect(() => () => {
    generation.current++;
    uploadRef.current?.abort();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {recorder.onstop = null; recorder.stop();}
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);
  useEffect(() => {
    if (phase !== "listening") return;
    const timer = setInterval(() => setElapsedMs(value => Math.min(value + 250, 300_000)), 250);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {if (elapsedMs >= 300_000 && recorderRef.current?.state === "recording") recorderRef.current.stop();}, [elapsedMs]);
  const durationRef = useRef(elapsedMs); durationRef.current = elapsedMs;
  function cancel() {
    generation.current++; uploadRef.current?.abort();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {recorder.onstop = null; recorder.stop();}
    streamRef.current?.getTracks().forEach(track => track.stop());
    setPhase("idle"); setElapsedMs(0); setError("");
  }
  function resetRecording() {cancel();}
  async function clear() {
    try {await deleteVoiceRecording(props.recordingId || recordingRef.current, props.locale, props.workspaceId);
      recordingRef.current = ""; props.onClear(); cancel();
    } catch (cause) {setError(cause instanceof Error ? cause.message : t.emptyRecording); setPhase("error");}
  }
  async function start() {
    if (props.disabled || busy || recorderRef.current?.state === "recording") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {setError(t.unsupported); setPhase("error"); return;}
    const current = ++generation.current;
    setError(""); setElapsedMs(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (generation.current !== current) {stream.getTracks().forEach(track => track.stop()); return;}
      streamRef.current = stream;
      const mimeType = ["audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      recorderRef.current = recorder;
      const chunks: Blob[] = []; let bytes = 0;
      recorder.ondataavailable = event => {if (event.data.size) {chunks.push(event.data); bytes += event.data.size;
        if (bytes > 25 * 1024 * 1024 && recorder.state !== "inactive") recorder.stop();}};
      recorder.onerror = () => {cancel(); setError(t.microphoneUnavailable); setPhase("error");};
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        if (generation.current !== current) return;
        const blob = new Blob(chunks, {type: recorder.mimeType});
        if (!blob.size || blob.size > 25 * 1024 * 1024) {setError(t.emptyRecording); setPhase("error"); return;}
        const controller = new AbortController(); uploadRef.current = controller;
        void uploadAndTranscribeVoice({blob, durationMs: Math.max(1, durationRef.current), locale: props.locale,
          workspaceId: props.workspaceId, idempotencyKey: crypto.randomUUID(), signal: controller.signal,
          onPhase: value => {if (generation.current === current) setPhase(value);},
          onRecording: id => {recordingRef.current = id;}}).then(result => {
            if (generation.current !== current) return;
            propsRef.current.onTranscript(result); setPhase("ready");
          }).catch(cause => {if (generation.current === current) {setError(cause instanceof Error ? cause.message : t.emptyRecording); setPhase("error");}});
      };
      recorder.start(1000); setPhase("listening");
    } catch {streamRef.current?.getTracks().forEach(track => track.stop());
      if (generation.current === current) {setError(t.microphoneUnavailable); setPhase("error");}}
  }
  function pauseOrResume() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {recorder.pause(); setPhase("paused");}
    else if (recorder?.state === "paused") {recorder.resume(); setPhase("listening");}
  }
  return <section className={`ai-voice-controls ${props.presentation === "stage" ? "is-stage" : ""}`} data-phase={phase} aria-label={t.inputAria}>
    <div className="ai-voice-actions">
      {phase === "idle" && <button type="button" disabled={props.disabled} aria-label={t.recordQuestionAria} title={t.recordQuestionAria} onClick={() => void start()}><Mic /><span>{t.recordQuestion}</span></button>}
      {(phase === "listening" || phase === "paused") && <>
        <button type="button" onClick={pauseOrResume}>{phase === "paused" ? <Play /> : <Pause />}{phase === "paused" ? t.resume : t.pause}</button>
        <button type="button" onClick={() => recorderRef.current?.stop()}><Square />{t.finish}</button>
        <button type="button" onClick={cancel}><Trash2 />{t.cancel}</button>
      </>}
      {phase === "ready" && <button type="button" onClick={() => void clear()}><Trash2 />{t.removeAudio}</button>}
      {phase === "error" && <button type="button" onClick={resetRecording}><RotateCcw />{t.retry}</button>}
    </div>
    {(phase === "listening" || phase === "paused") && <output>{formatElapsed(elapsedMs)} / 05:00</output>}
    <p role={phase === "error" ? "alert" : "status"} aria-live="polite">
      {error || phaseLabel(phase, props.locale)}
    </p>
    {busy && <progress aria-label={t.processingAria} />}
  </section>;
}

export function AssistantSpeechControls(props: { locale: PlatformLocale; assistantMessageId: string; workspaceId?: string; disabled?: boolean; onPhaseChange?: (phase: VoiceSpeechPhase) => void }) {
  const t = voiceCopy[props.locale], {onPhaseChange} = props;
  const [voice, setVoice] = useState<"marin" | "cedar">("marin");
  const [loading, setLoading] = useState(false), [muted, setMuted] = useState(false);
  const [audioUrl, setAudioUrl] = useState(""), [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => {requestRef.current?.abort();}, [props.assistantMessageId, props.workspaceId]);
  useEffect(() => () => {if (audioUrl) URL.revokeObjectURL(audioUrl);}, [audioUrl]);
  async function speak() {
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller;
    setLoading(true); setError(""); onPhaseChange?.("preparing");
    try {
      const response = await fetch("/api/platform/voice/speech", {method: "POST", signal: controller.signal,
        headers: {"content-type": "application/json", "x-juro-csrf": "1", "x-juro-locale": props.locale,
          ...(props.workspaceId ? {"x-juro-workspace-id": props.workspaceId} : {})},
        body: JSON.stringify({assistantMessageId: props.assistantMessageId, locale: props.locale, voice})});
      if (!response.ok) throw Error(t.speechUnavailable);
      const blob = await response.blob(); if (controller.signal.aborted) return;
      setAudioUrl(URL.createObjectURL(blob)); onPhaseChange?.("paused");
    } catch {if (!controller.signal.aborted) {setError(t.speechUnavailable); onPhaseChange?.("error");}}
    finally {if (!controller.signal.aborted) setLoading(false);}
  }
  function stop() {audioRef.current?.pause(); if (audioRef.current) audioRef.current.currentTime = 0; onPhaseChange?.("completed");}
  function replay() {if (!audioRef.current) return; audioRef.current.currentTime = 0;
    void audioRef.current.play().catch(() => {setError(t.playbackBlocked); onPhaseChange?.("error");});}
  function handleAudioPause() {onPhaseChange?.(audioRef.current?.ended ? "completed" : "paused");}
  return <div className="ai-speech-controls">
    <label>{t.aiVoice}<Select value={voice} onChange={(event) => setVoice(event.target.value as "marin" | "cedar")}><option value="marin">Marin</option><option value="cedar">Cedar</option></Select></label>
    <button type="button" disabled={props.disabled || loading} onClick={() => void speak()}><Volume2 />{loading ? t.preparingAudio : t.speakAnswer}</button>
    {audioUrl && <>
      <audio
        ref={audioRef}
        src={audioUrl}
        controls
        muted={muted}
        preload="metadata"
        onPlay={() => onPhaseChange?.("speaking")}
        onPause={handleAudioPause}
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
