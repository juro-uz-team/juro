export type VoiceRecorderPhase = "idle" | "listening" | "paused" | "hashing" | "uploading" | "finalizing" | "transcribing" | "ready" | "error";
export type VoiceSpeechPhase = "idle" | "preparing" | "speaking" | "paused" | "completed" | "error";
export type VoiceModeState = "idle" | "ready" | "listening" | "transcribing" | "thinking" | "speaking" | "paused" | "completed" | "offline" | "error";

export function resolveVoiceModeState(input: {configured: boolean; answerReady: boolean; sending: boolean;
  recorderPhase: VoiceRecorderPhase; speechPhase: VoiceSpeechPhase}): VoiceModeState {
  if (!input.configured) return "offline";
  if (input.recorderPhase === "error" || input.speechPhase === "error") return "error";
  if (input.sending || input.speechPhase === "preparing") return "thinking";
  if (input.recorderPhase === "listening") return "listening";
  if (input.recorderPhase === "paused") return "paused";
  if (["hashing", "uploading", "finalizing", "transcribing"].includes(input.recorderPhase)) return "transcribing";
  if (input.speechPhase === "speaking") return "speaking";
  if (input.speechPhase === "paused") return "paused";
  return input.answerReady || input.speechPhase === "completed" ? "completed" : "ready";
}
