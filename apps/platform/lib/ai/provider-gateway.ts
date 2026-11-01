import {AsyncLocalStorage} from "node:async_hooks";
import type {createProviderSpendingLedger} from "./provider-spending-ledger";

export type ProviderPrice={inputMicrousdPerMillion:number;outputMicrousdPerMillion:number;
  /** Whole-operation billable input, including batch items and framing;
   * output includes reasoning. Rates cover every enabled cache mode. */
  maximumInputTokens:number;maximumInputTokensPerItem?:number;maximumOutputTokens:number;validUntil:string;reviewReceiptSha256:string};
export type ProviderOperationReceipt={reservationId:string;operation:"generation"|"embedding";model:string;
  label?:string;phase:"reserved"|"settled"|"unknown";microusd:number|null;pricing:ProviderPrice;
  accounting:"measured-usage-at-reviewed-ceilings";usage?:{inputTokens:number;outputTokens:number}};
type Ledger=ReturnType<typeof createProviderSpendingLedger>;
export type ProviderGatewayScope={
  ledger:Ledger;budgetId:string;experimentId:string;
  generationModel?:"gpt-6-luna";
  price:(model:string,operation:"generation"|"embedding")=>Promise<ProviderPrice|null>;
  recordOperation?:(receipt:ProviderOperationReceipt)=>void|Promise<void>;
};
export const LEGAL_CHAT_GENERATION_OPERATION_LIMIT=8;
export const LEGAL_CHAT_EMBEDDING_OPERATION_LIMIT=120;
type RequestScope=ProviderGatewayScope&{operations:{generation:number;embedding:number}};
// The custom server loads source modules while Next also bundles route modules.
// Share the context carrier across those copies, never the request's contents.
const runtime=globalThis as typeof globalThis & {juroProviderGatewayV1?:AsyncLocalStorage<RequestScope>};
const scopes=runtime.juroProviderGatewayV1??=new AsyncLocalStorage<RequestScope>();

/** Only trusted composition can install a qualification context. HTTP inputs
 * and model output never select it; nested corpus operations inherit it. */
export function withProviderGateway<T>(scope:ProviderGatewayScope,work:()=>T):T {
  if(scopes.getStore())throw Error("PROVIDER_GATEWAY_ALREADY_BOUND");
  return scopes.run({...scope,operations:{generation:0,embedding:0}},work);
}
export function providerGenerationModel(model:string):string {return scopes.getStore()?.generationModel??model;}
export function assertProviderGateway():void {
  if(!scopes.getStore())throw Error("PROVIDER_GATEWAY_REQUIRED");
}

/** Usage belongs to transport accounting, independently of vector validity. */
export function embeddingProviderUsage(value:unknown):{inputTokens:number;outputTokens:number}|null {
  if(!value||typeof value!=="object"||!("usage" in value)||!value.usage||typeof value.usage!=="object")return null;
  const usage=value.usage;
  if(!("prompt_tokens" in usage)||!Number.isSafeInteger(usage.prompt_tokens)||typeof usage.prompt_tokens!=="number"||usage.prompt_tokens<0
    ||!("total_tokens" in usage)||!Number.isSafeInteger(usage.total_tokens)||typeof usage.total_tokens!=="number"||usage.total_tokens!==usage.prompt_tokens)return null;
  return {inputTokens:usage.prompt_tokens,outputTokens:0};
}

function cost(price:ProviderPrice,input:number,output:number) {
  for(const value of [price.inputMicrousdPerMillion,price.outputMicrousdPerMillion,input,output])
    if(!Number.isSafeInteger(value)||value<0)throw Error("PROVIDER_COST_UNKNOWN");
  const value=(BigInt(input)*BigInt(price.inputMicrousdPerMillion)+BigInt(output)*BigInt(price.outputMicrousdPerMillion)+999_999n)/1_000_000n;
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw Error("PROVIDER_COST_UNKNOWN");
  return Number(value);
}

/** Reserve separately for each transport attempt, including retries. Cache
 * discounts are never assumed. No scope means the caller is outside chat. */
export async function reserveProviderOperation(input:{model:string;operation:"generation"|"embedding";
  maximumOutputTokens:number;inputItems?:number;additionalCharges?:boolean;label?:string}) {
  const scope=scopes.getStore();
  if(!scope)return undefined;
  if(input.additionalCharges)throw Error("PROVIDER_COST_UNKNOWN");
  const limit=input.operation==="generation"?LEGAL_CHAT_GENERATION_OPERATION_LIMIT:LEGAL_CHAT_EMBEDDING_OPERATION_LIMIT;
  if(scope.operations[input.operation]>=limit)throw Error("PROVIDER_OPERATION_LIMIT");
  scope.operations[input.operation]++;
  const price=await scope.price(input.model,input.operation);
  if(!price)throw Error("PROVIDER_PRICE_UNKNOWN");
  const checkPrice=()=>{
    const expiry=Date.parse(price.validUntil);
    if(!Number.isFinite(expiry)||Date.now()>=expiry)throw Error("PROVIDER_PRICE_EXPIRED");
  };
  checkPrice();
  if(!Number.isSafeInteger(price.maximumInputTokens)||price.maximumInputTokens<1
    ||!/^[a-f0-9]{64}$/u.test(price.reviewReceiptSha256)
    ||!Number.isSafeInteger(price.maximumOutputTokens)||price.maximumOutputTokens<0
    ||!Number.isSafeInteger(input.maximumOutputTokens)||input.maximumOutputTokens<0
    ||input.maximumOutputTokens>price.maximumOutputTokens)throw Error("PROVIDER_COST_BOUND_UNKNOWN");
  // Reserve the reviewed maximum billable input, including provider framing.
  // A byte count or unverified framing allowance cannot prove that ceiling.
  let inputBound=price.maximumInputTokens;
  if(input.operation==="embedding"&&price.maximumInputTokensPerItem!==undefined){
    if(!Number.isSafeInteger(price.maximumInputTokensPerItem)||price.maximumInputTokensPerItem<1
      ||!Number.isSafeInteger(input.inputItems)||input.inputItems!<1)throw Error("PROVIDER_COST_BOUND_UNKNOWN");
    inputBound=Number(BigInt(price.maximumInputTokens)<BigInt(price.maximumInputTokensPerItem)*BigInt(input.inputItems!)
      ?BigInt(price.maximumInputTokens):BigInt(price.maximumInputTokensPerItem)*BigInt(input.inputItems!));
  }
  const maximum=cost(price,inputBound,input.maximumOutputTokens);
  const id=await scope.ledger.reserve({budgetId:scope.budgetId,experimentId:scope.experimentId,maximumMicrousd:Math.max(1,maximum)});
  const record=(phase:ProviderOperationReceipt["phase"],microusd:number|null,usage?:ProviderOperationReceipt["usage"])=>scope.recordOperation?.({
    reservationId:id,operation:input.operation,model:input.model,label:input.label,phase,microusd,pricing:price,
    accounting:"measured-usage-at-reviewed-ceilings",...(usage?{usage}:{})});
  try {await record("reserved",maximum);}catch(error){await scope.ledger.settle(id,0);throw error;}
  return {async dispatch(){checkPrice();await scope.ledger.dispatch(id);checkPrice();},async finish(usage:{inputTokens:number;outputTokens:number}|null) {
    if(!usage){await scope.ledger.settle(id,null);await record("unknown",null);throw Error("PROVIDER_USAGE_UNRECONCILED");}
    let actual:number;
    try {actual=cost(price,usage.inputTokens,usage.outputTokens);}
    catch(error){await scope.ledger.settle(id,null);throw error;}
    if(usage.inputTokens>inputBound||usage.outputTokens>input.maximumOutputTokens){
      await scope.ledger.settle(id,actual>maximum?actual:null);
      await record("unknown",actual);throw Error("PROVIDER_COST_BOUND_EXCEEDED");
    }
    await scope.ledger.settle(id,actual);
    await record("settled",actual,usage);
  }};
}
