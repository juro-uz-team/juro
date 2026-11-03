import {legalAnswerCopy, type LegalAnswerViewResult} from "./legal-answer-presentation";
import {questionInterpretationFailureText,officialResearchFailureText,answerVerificationFailureText} from "./legal-answer-failure";
import type {PlatformLocale} from "../platform/routing";

/** Narrate the public answer in the same order as LegalAnswerView, not its legacy summary column. */
export function answerSpeechText(result:LegalAnswerViewResult,locale:PlatformLocale):string {
  const copy=legalAnswerCopy[locale],parts:string[]=[];
  const add=(...values:(string|undefined|null)[])=>{for(const value of values)if(value?.trim())parts.push(value);};
  const gaps=()=>{if(result.coverageGaps?.length)add(locale==="ru"?"Что ещё не подтверждено":locale==="uz"?"Hali tasdiqlanmagan jihatlar":"What remains unverified",...result.coverageGaps);};
  const notes=()=>{if(result.referenceNotes?.length){add(copy.additional,copy.secondaryNote);for(const note of result.referenceNotes)add(note.title,note.note);}};
  if(result.responseKind==="clarification_required"){
    const interpretation=result.failureReason==="question_interpretation_unavailable",research=result.failureReason==="official_research_unavailable",verification=result.failureReason==="answer_verification_unavailable";
    add(copy.authority.none,copy.checked,copy.insufficient,interpretation?questionInterpretationFailureText(locale):research?officialResearchFailureText(locale):verification?answerVerificationFailureText(locale):result.answer);
    if(!verification)add(copy.checked,copy.checkedBody,...(!interpretation&&!research?[copy.missing]:[]));
    if(result.confirmedFindings.length)add(copy.law);
    for(const finding of result.confirmedFindings)add(finding.title,finding.explanation);
    gaps();notes();
  }else{
    if(result.summary)add(copy.main,result.summary);
    if(result.conditionalBranches?.length){add(copy.branches);for(const branch of result.conditionalBranches)add(branch.condition,branch.outcome);}
    if(result.issues){
      for(const issue of result.issues){
        const finding=result.confirmedFindings[issue.findingIndex];if(finding)add(finding.title,finding.explanation);
        if(issue.actionIndices.length)add(copy.next);
        for(const index of issue.actionIndices){const step=result.actionPlan[index];if(step)add(step.title,step.description);}
      }
    }else{
      if(result.confirmedFindings.length)add(copy.law);
      for(const finding of result.confirmedFindings)add(finding.title,finding.explanation);
      if(result.actionPlan.length)add(copy.next);
      for(const step of result.actionPlan)add(step.title,step.description);
    }
    if(result.assumptions.length||result.risks.length||result.urgency!=="normal")add(copy.important);
    if(result.urgency!=="normal")add(result.urgency==="critical"?copy.criticalUrgency:copy.priorityUrgency);
    for(const assumption of result.assumptions)add(assumption.statement,assumption.impact);
    for(const risk of result.risks)add(risk.title,risk.explanation);
    if(result.deadlines.length)add(copy.deadlines);
    for(const deadline of result.deadlines)add(deadline.title,deadline.dueDate,deadline.calculationMethod);
    if(result.requiredDocuments.length||result.suggestedDocument)add(copy.prepare);
    for(const document of result.requiredDocuments)add(document.name,document.reason);
    if(result.suggestedDocument)add(result.suggestedDocument.title,result.suggestedDocument.reason);
    notes();gaps();
  }
  if(result.clarificationQuestions.length)add(copy.clarify,...result.clarificationQuestions);
  if(result.responseKind==="answer"&&result.coverageStatus&&result.coverageStatus!=="good_coverage")add(copy.partial);
  return parts.join("\n\n").replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gu,"$1").replace(/^[#>]+\s*/gmu,"").replace(/[*`]/gu,"");
}

/** Keep every character while fitting provider input limits; prefer sentence/word boundaries. */
export function speechTextChunks(text:string,maximum=3500):string[]{
  const chunks:string[]=[];let remaining=text;
  while(remaining.length>maximum){
    const window=remaining.slice(0,maximum);
    let cut=Math.max(window.lastIndexOf("\n"),window.lastIndexOf(". ")+1,window.lastIndexOf("! ")+1,window.lastIndexOf("? ")+1);
    if(cut<maximum/2)cut=window.lastIndexOf(" ");
    if(cut<maximum/2)cut=maximum;
    if(/[\uD800-\uDBFF]/u.test(remaining[cut-1]))cut--;
    chunks.push(remaining.slice(0,cut));remaining=remaining.slice(cut);
  }
  if(remaining.trim())chunks.push(remaining);else if(remaining&&chunks.length)chunks[chunks.length-1]+=remaining;
  return chunks;
}
