import { database } from "../storage/connection";
import { getSelfHostedRuntime } from "../runtime/self-hosted";
import { userIdentityById, createIdentityProtectionContext } from "../auth/identity-protection";
import { sendJuroAuthEmail, renderJuroAuthEmail } from "../auth/transactional-email";
export async function queueDecisionEmail(userId:string,subject:string,body:string){
 const id=crypto.randomUUID();
 await database().pool.query("INSERT INTO control_delivery_jobs(id,user_id,subject,body) VALUES($1,$2,$3,$4)",[id,userId,subject,body]);
 await deliverDecisionEmail(id);return id;
}
export async function deliverDecisionEmail(id:string){
 const rows=await database().pool.query("UPDATE control_delivery_jobs SET status='sending',attempts=attempts+1 WHERE id=$1 AND status IN ('pending','failed') RETURNING *",[id]);
 const row=rows.rows[0];if(!row)return;
 try{
  const env=getSelfHostedRuntime();
  const identity=await userIdentityById(env.DB!,createIdentityProtectionContext(process.env.IDENTITY_PROTECTION_MODE,process.env.IDENTITY_KEYRING),row.user_id);
  if(!identity)throw Error("RECIPIENT_UNAVAILABLE");
  const message=renderJuroAuthEmail({locale:"ru",purpose:"critical_action",details:[{label:"Решение JURO",value:row.subject},{label:"Причина и следующий шаг",value:row.body}]});
  message.subject=`JURO — ${row.subject}`;
  const result=await sendJuroAuthEmail({apiKey:env.RESEND_API_KEY??"",from:env.EMAIL_FROM??"",to:identity.email,idempotencyKey:`control-decision:${id}`,message});
  await database().pool.query("UPDATE control_delivery_jobs SET status=$2,last_error=$3,sent_at=CASE WHEN $2='sent' THEN now() ELSE NULL END WHERE id=$1",[id,result.ok?"sent":"failed",result.ok?null:result.failure]);
 }catch{
  await database().pool.query("UPDATE control_delivery_jobs SET status='failed',last_error='DELIVERY_UNAVAILABLE' WHERE id=$1",[id]);
 }
}
