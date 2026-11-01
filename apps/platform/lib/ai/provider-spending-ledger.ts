import {randomUUID} from "node:crypto";
import type {Pool,PoolClient} from "pg";
export const LEGAL_CHAT_DIAGNOSTIC_BUDGET="legal-chat-diagnostics";

function money(value:number,positive=false) {
  if(!Number.isSafeInteger(value)||value<(positive?1:0))throw Error("PROVIDER_COST_UNKNOWN");
  return value;
}

/** Persistent reservations serialize admission across requests and processes.
 * Never release uncertain spend or reset a budget when credits are restored. */
export function createProviderSpendingLedger(pool:Pool) {
  const transaction=async<T>(work:(client:PoolClient)=>Promise<T>)=>{
    const client=await pool.connect();
    try {await client.query("BEGIN");const result=await work(client);await client.query("COMMIT");return result;}
    catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  };
  return {
    async createDiagnosticBudget(opening?:{receiptSha256:string;experiments:readonly {experimentId:string;spentMicrousd:number}[]}) {
      const id=LEGAL_CHAT_DIAGNOSTIC_BUDGET;
      if(opening){
        if(!/^[a-f0-9]{64}$/u.test(opening.receiptSha256)
          ||new Set(opening.experiments.map(row=>row.experimentId)).size!==opening.experiments.length
          ||opening.experiments.some(row=>!row.experimentId.trim()))throw Error("PROVIDER_OPENING_RECONCILIATION_REQUIRED");
        for(const row of opening.experiments)money(row.spentMicrousd);
      }
      return transaction(async client=>{
        if(opening){
          const inserted=await client.query(`INSERT INTO provider_spending_budgets(id,limit_microusd,experiment_limit_microusd,opening_receipt_sha256)
            VALUES($1,5000000,1000000,$2) ON CONFLICT(id) DO NOTHING RETURNING id`,[id,opening.receiptSha256]);
          if(inserted.rowCount)for(const row of opening.experiments)await client.query(`INSERT INTO provider_spending_reservations
            (id,budget_id,experiment_id,maximum_microusd,accounted_microusd,state) VALUES($1,$2,$3,$4,$5,'settled')`,
            [randomUUID(),id,row.experimentId,Math.max(1,row.spentMicrousd),row.spentMicrousd]);
        }
        const {rows}=await client.query("SELECT * FROM provider_spending_budgets WHERE id=$1 FOR UPDATE",[id]);
        if(!rows[0]?.opening_receipt_sha256)throw Error("PROVIDER_OPENING_RECONCILIATION_REQUIRED");
        if(Number(rows[0].limit_microusd)!==5_000_000||Number(rows[0].experiment_limit_microusd)!==1_000_000
          ||(opening&&rows[0].opening_receipt_sha256!==opening.receiptSha256))throw Error("PROVIDER_BUDGET_POLICY_MISMATCH");
        return id;
      });
    },
    async createProductionBudget(environment:"development"|"staging"|"production",dailyLimitMicrousd:number) {
      money(dailyLimitMicrousd,true);
      const id=`legal-chat:${environment}:${new Date().toISOString().slice(0,10)}`;
      await pool.query(`INSERT INTO provider_spending_budgets(id,limit_microusd,experiment_limit_microusd)
        VALUES($1,$2,$2) ON CONFLICT(id) DO UPDATE SET
        limit_microusd=LEAST(provider_spending_budgets.limit_microusd,EXCLUDED.limit_microusd),
        experiment_limit_microusd=LEAST(provider_spending_budgets.experiment_limit_microusd,EXCLUDED.experiment_limit_microusd)`,[id,dailyLimitMicrousd]);
      return id;
    },
    async reserve(input:{budgetId:string;experimentId:string;maximumMicrousd:number}) {
      money(input.maximumMicrousd,true);
      if(!input.experimentId.trim())throw Error("PROVIDER_EXPERIMENT_REQUIRED");
      return transaction(async client=>{
        const budget=(await client.query("SELECT * FROM provider_spending_budgets WHERE id=$1 FOR UPDATE",[input.budgetId])).rows[0];
        if(!budget)throw Error("PROVIDER_BUDGET_NOT_AGREED");
        const {rows}=await client.query(`SELECT experiment_id,state,COALESCE(accounted_microusd,maximum_microusd) AS held,
          (state='dispatched' AND expires_at<=now()) AS expired
          FROM provider_spending_reservations WHERE budget_id=$1`,[input.budgetId]);
        if(rows.some(row=>row.state==="unknown"||row.expired))throw Error("PROVIDER_USAGE_UNRECONCILED");
        const total=rows.reduce((sum,row)=>sum+BigInt(row.held),0n);
        const experiment=rows.filter(row=>row.experiment_id===input.experimentId).reduce((sum,row)=>sum+BigInt(row.held),0n);
        if(total+BigInt(input.maximumMicrousd)>BigInt(budget.limit_microusd)
          ||experiment+BigInt(input.maximumMicrousd)>BigInt(budget.experiment_limit_microusd))throw Error("PROVIDER_SPENDING_CAP");
        const id=randomUUID();
        await client.query(`INSERT INTO provider_spending_reservations(id,budget_id,experiment_id,maximum_microusd,state)
          VALUES($1,$2,$3,$4,'reserved')`,[id,input.budgetId,input.experimentId,input.maximumMicrousd]);
        return id;
      });
    },
    async dispatch(id:string) {
      await transaction(async client=>{
        const row=(await client.query("SELECT budget_id FROM provider_spending_reservations WHERE id=$1",[id])).rows[0];
        if(!row)throw Error("PROVIDER_RESERVATION_MISSING");
        await client.query("SELECT id FROM provider_spending_budgets WHERE id=$1 FOR UPDATE",[row.budget_id]);
        const unknown=await client.query("SELECT id FROM provider_spending_reservations WHERE budget_id=$1 AND (state='unknown' OR (state='dispatched' AND expires_at<=now())) LIMIT 1",[row.budget_id]);
        if(unknown.rows.length)throw Error("PROVIDER_USAGE_UNRECONCILED");
        const dispatched=await client.query("UPDATE provider_spending_reservations SET state='dispatched' WHERE id=$1 AND state='reserved' AND expires_at>now() RETURNING id",[id]);
        if(dispatched.rowCount!==1)throw Error("PROVIDER_RESERVATION_ALREADY_DISPATCHED");
      });
    },
    async settle(id:string,accountedMicrousd:number|null) {
      if(accountedMicrousd!==null)money(accountedMicrousd);
      const exceeded=await transaction(async client=>{
        const reservation=(await client.query("SELECT budget_id FROM provider_spending_reservations WHERE id=$1",[id])).rows[0];
        if(!reservation)throw Error("PROVIDER_RESERVATION_MISSING");
        await client.query("SELECT id FROM provider_spending_budgets WHERE id=$1 FOR UPDATE",[reservation.budget_id]);
        const row=(await client.query("SELECT * FROM provider_spending_reservations WHERE id=$1 FOR UPDATE",[id])).rows[0];
        if(row.state==="settled") {
          if(accountedMicrousd===null||Number(row.accounted_microusd)!==accountedMicrousd)throw Error("PROVIDER_USAGE_CONFLICT");
          return false;
        }
        const over=accountedMicrousd!==null&&accountedMicrousd>Number(row.maximum_microusd);
        // An underestimated bound is not permission to resume. Hold the full
        // observed charge and require explicit reconciliation of the policy.
        await client.query(`UPDATE provider_spending_reservations SET state=$2,accounted_microusd=$3,
          maximum_microusd=GREATEST(maximum_microusd,$4) WHERE id=$1`,
          [id,accountedMicrousd===null||over?"unknown":"settled",over?null:accountedMicrousd,accountedMicrousd??0]);
        return over;
      });
      if(exceeded)throw Error("PROVIDER_COST_BOUND_EXCEEDED");
    },
  };
}
