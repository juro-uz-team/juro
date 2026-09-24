import {Client,type Pool,type PoolClient,type QueryResultRow} from "pg";
import {awaitIndexedRetrieval,indexedRetrievalSignal} from "../runtime/indexed-retrieval";

const backendIds=new WeakMap<PoolClient,number>();

/** A separate connection can cancel even when the retrieval pool is full. The
 * target stays exclusively leased until cancellation finishes, then is closed. */
async function cancelRead(pool:Pool,pid:number) {
  const connection=new Client({...pool.options,connectionTimeoutMillis:1000,statement_timeout:1000,query_timeout:1500});
  try {await connection.connect();await connection.query("SELECT pg_cancel_backend($1)",[pid]);}
  finally {await connection.end();}
}

/** A cancelled queued acquisition is released when it arrives. */
export async function acquireRetrievalClient(pool:Pool):Promise<{client:PoolClient;release:()=>void}> {
  const signal=indexedRetrievalSignal();
  if(!signal){const client=await pool.connect();return {client,release:()=>client.release()};}
  let acquired:PoolClient|undefined;
  let released=false;
  const release=(destroy=false)=>{
    if(acquired&&!released){released=true;acquired.release(destroy);}
  };
  const pending=pool.connect().then(async client=>{
    acquired=client;
    if(signal.aborted){release();throw signal.reason;}
    if(!backendIds.has(client)) {
      const result=await client.query<{pid:number}>("SELECT pg_backend_pid() AS pid");
      backendIds.set(client,result.rows[0]!.pid);
    }
    if(signal.aborted){release();throw signal.reason;}
    return client;
  });
  let client:PoolClient;
  try{client=await awaitIndexedRetrieval(pending,signal);}
  catch(error){release(true);throw error;}
  let cancellation:Promise<void>|undefined;
  const abort=()=>{
    cancellation??=cancelRead(pool,backendIds.get(client)!).catch(()=>{
      console.error(JSON.stringify({event:"indexed_retrieval_database_cancel_failed"}));
    }).finally(()=>release(true));
  };
  signal.addEventListener("abort",abort,{once:true});
  if(signal.aborted)abort();
  const guarded=new Proxy(client,{get(target,key){
    if(key==="query")return (...args:unknown[])=>{
      indexedRetrievalSignal();
      return Reflect.apply(target.query,target,args);
    };
    const value=Reflect.get(target,key);
    return typeof value==="function"?value.bind(target):value;
  }});
  return {client:guarded,release:()=>{signal.removeEventListener("abort",abort);if(!cancellation)release();}};
}

export async function retrievalQuery<T extends QueryResultRow=QueryResultRow>(pool:Pool,sql:string,values?:unknown[]) {
  if(!indexedRetrievalSignal())return pool.query<T>(sql,values);
  const lease=await acquireRetrievalClient(pool);
  try{return await lease.client.query<T>(sql,values);}finally{lease.release();}
}
