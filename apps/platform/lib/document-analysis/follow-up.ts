/** Compatibility for saved reviews that asked the reader how to run the analysis. */
export function documentFollowUpQuestions(questions: string[]): string[] {
  const setupQuestions = [
    /чьи\s+интересы.{0,55}анализ|интересы\s+какой\s+стороны.{0,45}анализ|какую\s+сторону\s+(?:приоритетно\s+)?анализировать/iu,
    /which\s+(?:party|side)(?:['’]s\s+interests)?\s+(?:should\b|to\b|do\s+you\s+want).{0,28}\b(?:analy[sz]e|prioriti[sz]e|review\s+for|focus\s+on)\b/iu,
    /qaysi\s+tomon(?:ning|ni)\b.{0,70}\btahlil/iu,
  ];
  return questions.filter(question => !setupQuestions.some(pattern => pattern.test(question)));
}
