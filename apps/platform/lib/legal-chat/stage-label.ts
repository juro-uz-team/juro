import {aiText} from "../ai/localization";
import type {LegalChatStage} from "./execution";
export function chatStageLabel(stage:LegalChatStage,locale:"ru"|"uz"|"en"){
  const labels:Record<LegalChatStage,[string,string,string]>={
    interpreting:["Уточняем вопрос…","Savolni aniqlashtiryapmiz…","Interpreting your question…"],
    researching:["Проверяем официальные источники…","Rasmiy manbalarni tekshiryapmiz…","Checking official sources…"],
    writing:["Готовим ответ…","Javob tayyorlanmoqda…","Preparing your answer…"],
    verifying:["Проверяем выводы…","Xulosalarni tekshiryapmiz…","Verifying the conclusions…"],
    correcting:["Уточняем выводы…","Xulosalarni aniqlashtiryapmiz…","Correcting the answer…"],
    saving:["Сохраняем ответ…","Javob saqlanmoqda…","Saving your answer…"],
  };return aiText(locale,...labels[stage]);
}
