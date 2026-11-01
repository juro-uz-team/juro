const patterns=[
  /Текст акта приводится на [^.\n]{2,80} языке/iu,
  /Hujjat matni [^.\n]{2,80} tilida (?:berilgan|keltirilgan)/iu,
  /Ҳужжат матни [^.\n]{2,80} тилида (?:берилган|келтирилган)/iu,
  /The text of (?:this|the) act is (?:available|provided|given) in [^.\n]{2,80}/iu,
] as const;

/** Use only for publisher notice metadata or an otherwise empty legal body. */
export function isLexLanguageNotice(text:string):boolean{
  const normalized=text.replace(/\s+/gu," ");
  return patterns.some(pattern=>pattern.test(normalized));
}
