import { AI_MESSAGE_OPERATIONS, AiBranchInputError, listAiAnswerVersions,
  type AiBranchInput, type AiMessageOperation } from "../ai/branch-store";
import { loadAiConversationTurns, type AiConversationTurn } from "../ai/conversation-branch-reader";
import {decodeSavedLegalAnswer, legalAnswerConversationText} from "./saved-answer";

export function conversationOperation(value: unknown, existing: boolean): AiMessageOperation {
  const operation = value === undefined ? existing ? "follow_up" : "new" : value;
  if (!AI_MESSAGE_OPERATIONS.some(item => item === operation) || (operation === "new") === existing) {
    throw new AiBranchInputError("INVALID_BRANCH_OPERATION");
  }
  return operation as AiMessageOperation;
}

/** Stored ancestry includes version forks. Context contains only the active
 * version of each question; assistant text remains explicitly untrusted. */
export function contextTurns(turns: readonly AiConversationTurn[], operations: ReadonlyMap<string, AiMessageOperation>,
  nextOperation?: AiMessageOperation): AiConversationTurn[] {
  const active: AiConversationTurn[] = [];
  for (const turn of turns) {
    const operation = operations.get(turn.branchId);
    if (!operation) throw new AiBranchInputError("SOURCE_MESSAGE_NOT_FOUND");
    if (operation === "edit" || operation === "regenerate") active.pop();
    active.push(turn);
  }
  if (nextOperation === "edit" || nextOperation === "regenerate") active.pop();
  return active;
}

type ConversationOwner = { db: D1Database; workspaceId: string; userId: string; conversationId: string | null };
type SelectedTurn = { branchId: string | null; requestMessageId: string; responseMessageId: string; question: string; createdAt: string };
const CONTEXT_BRANCH_LIMIT=200;
const CONTEXT_READ_PAGE=40;

async function readBranchAncestry(input:ConversationOwner&{conversationId:string;leafBranchId:string}):Promise<AiConversationTurn[]> {
  const turns:AiConversationTurn[]=[];
  const seen=new Set<string>();
  let cursor:string|null=input.leafBranchId;
  while(cursor) {
    const page=await loadAiConversationTurns({...input,leafBranchId:cursor,limit:CONTEXT_READ_PAGE});
    if(!page.length||page.at(-1)?.branchId!==cursor)throw new AiBranchInputError("SOURCE_MESSAGE_NOT_FOUND");
    for(const [index,turn] of page.entries()) {
      if(seen.has(turn.branchId)||(index>0&&turn.parentBranchId!==page[index-1]!.branchId)) {
        throw new AiBranchInputError("SOURCE_MESSAGE_NOT_FOUND");
      }
      seen.add(turn.branchId);
    }
    if(turns.length+page.length>CONTEXT_BRANCH_LIMIT)throw new Error("LEGAL_CONTEXT_CAPACITY_EXCEEDED");
    turns.unshift(...page);
    cursor=page[0]!.parentBranchId;
  }
  return turns;
}

/** Read the selected ancestry independently of the paginated branch menu. */
export async function readSavedConversationTurns(input: ConversationOwner & {
  responseMessageId: string;
}): Promise<AiConversationTurn[]> {
  const selected = await input.db.prepare(`SELECT b.id AS branchId,response.id AS responseMessageId,response.created_at AS createdAt
    FROM conversations c JOIN conversation_messages response ON response.conversation_id=c.id AND response.author_type='assistant'
    LEFT JOIN message_branches b ON b.response_message_id=response.id AND b.conversation_id=c.id
      AND b.workspace_id=c.workspace_id AND b.owner_user_id=c.owner_user_id
    WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND response.id=?`).bind(
    input.conversationId,input.workspaceId,input.userId,input.responseMessageId,
  ).first<Pick<SelectedTurn,"branchId"|"responseMessageId"|"createdAt">>();
  if (!selected) throw new AiBranchInputError("SOURCE_MESSAGE_NOT_FOUND");
  const owner = { ...input, conversationId: input.conversationId! };
  const storedTurns = selected.branchId ? await readBranchAncestry({ ...owner, leafBranchId: selected.branchId }) : [];
  const operations = new Map<string, AiMessageOperation>();
  if (!selected.branchId) {
    const legacy = await input.db.prepare(`SELECT DISTINCT request.id AS requestMessageId,response.id AS responseMessageId,
      request.content AS question,response.content AS answer,response.structured_json AS structuredJson,response.created_at AS createdAt
      FROM conversations c JOIN ai_runs r ON r.conversation_id=c.id AND r.workspace_id=c.workspace_id
        AND r.user_id=c.owner_user_id AND r.status='completed'
      JOIN conversation_messages request ON request.id=r.request_message_id AND request.conversation_id=c.id AND request.author_type='user'
      JOIN conversation_messages response ON response.id=r.response_message_id AND response.conversation_id=c.id AND response.author_type='assistant'
      WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=?
        AND (response.created_at<? OR (response.created_at=? AND response.id<=?))
        AND NOT EXISTS(SELECT 1 FROM message_branches b WHERE b.response_message_id=response.id)
      ORDER BY response.created_at DESC,response.id DESC LIMIT ${CONTEXT_BRANCH_LIMIT+1}`).bind(input.conversationId,input.workspaceId,input.userId,
      selected.createdAt,selected.createdAt,selected.responseMessageId).all<Omit<AiConversationTurn,"branchId"|"parentBranchId">>();
    if(legacy.results.length>CONTEXT_BRANCH_LIMIT)throw new Error("LEGAL_CONTEXT_CAPACITY_EXCEEDED");
    for (const row of legacy.results.reverse()) {
      const branchId = `legacy:${row.responseMessageId}`;
      storedTurns.push({...row,branchId,parentBranchId:null});
      operations.set(branchId,"follow_up");
    }
  } else if (storedTurns.length) {
    const metadata:Array<{id:string;operation:AiMessageOperation;forkedFromMessageId:string|null}>=[];
    // Keep each statement below the database's bound-parameter limit.
    for(let offset=0;offset<storedTurns.length;offset+=CONTEXT_READ_PAGE) {
      const page=storedTurns.slice(offset,offset+CONTEXT_READ_PAGE);
      const rows = await input.db.prepare(`SELECT b.id,b.operation,b.forked_from_message_id AS forkedFromMessageId FROM message_branches b
      JOIN conversations c ON c.id=b.conversation_id
      WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=?
      AND b.workspace_id=c.workspace_id AND b.owner_user_id=c.owner_user_id
      AND b.id IN (${page.map(() => "?").join(",")})`).bind(
      input.conversationId, input.workspaceId, input.userId, ...page.map(turn => turn.branchId),
    ).all<{id:string;operation:AiMessageOperation;forkedFromMessageId:string|null}>();
      metadata.push(...rows.results);
      for (const row of rows.results) operations.set(row.id, row.operation);
    }
    const root = storedTurns[0]!;
    const origin = metadata.find(row => row.id === root.branchId);
    if (!root.parentBranchId && origin?.forkedFromMessageId) {
      const legacy = await input.db.prepare(`SELECT response.id FROM conversations c
        JOIN ai_runs r ON r.conversation_id=c.id AND r.workspace_id=c.workspace_id AND r.user_id=c.owner_user_id AND r.status='completed'
        JOIN conversation_messages response ON response.id=r.response_message_id AND response.conversation_id=c.id
        WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND (r.request_message_id=? OR response.id=?)
        AND NOT EXISTS(SELECT 1 FROM message_branches b WHERE b.response_message_id=response.id) LIMIT 1`).bind(
        input.conversationId,input.workspaceId,input.userId,origin.forkedFromMessageId,origin.forkedFromMessageId,
      ).first<{id:string}>();
      if (legacy) {
        const previous = await readSavedConversationTurns({...owner,responseMessageId:legacy.id});
        if(storedTurns.length+previous.length>CONTEXT_BRANCH_LIMIT)throw new Error("LEGAL_CONTEXT_CAPACITY_EXCEEDED");
        storedTurns.unshift(...previous);
        for (const turn of previous) operations.set(turn.branchId,"follow_up");
      }
    }
  }
  return contextTurns(storedTurns, operations);
}

export async function readConversationContext(input: ConversationOwner & {
  requestedOperation?: unknown; sourceMessageId?: string | null; question?: string;
}): Promise<{ branch: AiBranchInput; turns: AiConversationTurn[] }> {
  const operation = conversationOperation(input.requestedOperation, Boolean(input.conversationId));
  if (operation === "new") {
    if (input.sourceMessageId || !input.question?.trim()) throw new AiBranchInputError("INVALID_BRANCH_OPERATION");
    return { branch: { operation, question: input.question.trim(), sourceMessageId: null,
      forkedFromMessageId: null, parentBranchId: null, versionNumber: 1 }, turns: [] };
  }
  if ((operation === "edit" || operation === "regenerate") && !input.sourceMessageId) {
    throw new AiBranchInputError("SOURCE_MESSAGE_NOT_FOUND");
  }
  const selector = input.sourceMessageId ? "AND (request.id=? OR response.id=?)" : "";
  const statement = input.db.prepare(`SELECT b.id AS branchId,request.id AS requestMessageId,
    response.id AS responseMessageId,request.content AS question,response.created_at AS createdAt
    FROM conversations c JOIN conversation_messages response ON response.conversation_id=c.id AND response.author_type='assistant'
    LEFT JOIN message_branches b ON b.response_message_id=response.id AND b.conversation_id=c.id
      AND b.workspace_id=c.workspace_id AND b.owner_user_id=c.owner_user_id
    LEFT JOIN ai_runs r ON r.response_message_id=response.id AND r.conversation_id=c.id
      AND r.workspace_id=c.workspace_id AND r.user_id=c.owner_user_id AND r.status='completed'
    JOIN conversation_messages request ON request.id=COALESCE(b.request_message_id,r.request_message_id)
      AND request.conversation_id=c.id AND request.author_type='user'
    WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? ${selector}
    ORDER BY response.created_at DESC,response.id DESC LIMIT 1`);
  const values = [input.conversationId, input.workspaceId, input.userId];
  const selected = await statement.bind(...(input.sourceMessageId ? [...values, input.sourceMessageId, input.sourceMessageId] : values)).first<SelectedTurn>();
  if (!selected) throw new AiBranchInputError("SOURCE_MESSAGE_NOT_FOUND");
  const question = operation === "regenerate" ? selected.question : input.question?.trim();
  if (!question) throw new AiBranchInputError("INVALID_BRANCH_OPERATION");
  const owner = { ...input, conversationId: input.conversationId! };
  const turns = await readSavedConversationTurns({...owner,responseMessageId:selected.responseMessageId});
  if (operation === "edit" || operation === "regenerate") turns.pop();
  const versions = operation === "edit" || operation === "regenerate"
    ? await listAiAnswerVersions({ ...owner, branchId: selected.branchId, requestMessageId: selected.requestMessageId }) : [];
  return { branch: { operation, question,
    sourceMessageId: operation === "follow_up" ? null : selected.requestMessageId,
    forkedFromMessageId: input.sourceMessageId ?? (selected.branchId ? null : selected.responseMessageId), parentBranchId: selected.branchId,
    versionNumber: operation === "follow_up" ? 1 : Math.max(1, ...versions.map(version => version.versionNumber)) + 1,
  }, turns: turns.map(turn => {
    if (!turn.structuredJson) return turn;
    try {return {...turn, answer: legalAnswerConversationText(decodeSavedLegalAnswer(turn.structuredJson))};}
    catch {return turn;} // Legacy unstructured messages keep their original text.
  }) };
}
