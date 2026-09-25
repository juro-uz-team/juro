import {readFile,writeFile,mkdir,open,rename,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {database} from '../lib/storage/connection';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readVectorCandidateCoverage} from '../lib/storage/vector-candidate-coverage';
const [directory,...generations]=process.argv.slice(2);
if(!directory||!generations.length||generations.some(id=>!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id)))throw Error('Usage: prepare-vector-candidates <directory> <generation UUID> ...');
const root=pathToFileURL(resolve(directory)+sep);await mkdir(root,{recursive:true});
const db=database('app'),client=await db.pool.connect();const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');

try{for(const id of generations){
 const dir=new URL(id+'/',root);await mkdir(dir,{recursive:true});const checkpoint=new URL('checkpoint.json',dir);let state:any;
 try{state=JSON.parse(await readFile(checkpoint,'utf8'));}catch(error:any){if(error.code!=='ENOENT')throw error;state={phase:'exporting',id,pages:[],rows:0,cursor:''};}
 if(state.id!==id)throw Error('Generation checkpoint identity differs');
 const save=async()=>{state.at=new Date().toISOString();await writeFile(new URL('checkpoint.tmp',dir),JSON.stringify(state,null,2));await rename(new URL('checkpoint.tmp',dir),checkpoint);console.log(JSON.stringify({id,phase:state.phase,rows:state.rows}));};
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const generation=(await client.query(`SELECT g.*,c.source_revision AS current_revision,c.dimensions,c.metric FROM storage.vector_search_generations g JOIN storage.vector_collections c ON c.name=g.collection WHERE g.id=$1`,[id])).rows[0];
 if(generation?.state!=='verified'||generation.source_revision!==generation.current_revision||generation.dimensions!==1536||generation.metric!=='cosine')throw Error('Generation unavailable');
 if(state.sourceRevision!==undefined&&state.sourceRevision!==generation.source_revision)throw Error('Generation source changed');
 Object.assign(state,{sourceRevision:generation.source_revision,collection:generation.collection,groupCount:generation.group_count});
 // Completed matrices remain authoritative after duplicate preparation pages
 // are removed. Authenticate both the full matrix and each original page slice.
 const reusableMatrix=state.matrix&&state.rows===Number(generation.group_count);
 if(reusableMatrix){
  const matrix=new URL(state.matrix.file,dir),digest=createHash('sha256');
  if((await stat(matrix)).size!==state.rows*6144||state.matrix.sizeBytes!==state.rows*6144)throw Error('Matrix size differs');
  for await(const part of createReadStream(matrix))digest.update(part);
  if(digest.digest('hex')!==state.matrix.sha256)throw Error('Export checkpoint corrupt');
 }
 let offset=0;
 for(const page of state.pages){
  const metadata=await readFile(new URL(page.metadata.file,dir));
  if(hash(metadata)!==page.metadata.sha256)throw Error('Export checkpoint corrupt');
  const digest=createHash('sha256');
  if(reusableMatrix){
   if(page.vectors.sizeBytes!==page.rows*6144)throw Error('Vector page size differs');
   for await(const part of createReadStream(new URL(state.matrix.file,dir),{start:offset,end:offset+page.vectors.sizeBytes-1}))digest.update(part);
  }else digest.update(await readFile(new URL(page.vectors.file,dir)));
  if(digest.digest('hex')!==page.vectors.sha256)throw Error('Export checkpoint corrupt');
  offset+=page.vectors.sizeBytes;
 }
 if(reusableMatrix&&offset!==state.matrix.sizeBytes)throw Error('Matrix page sizes differ');
 // Older exports may have universal coverage even when original members have
 // precise dates. Upgrade metadata without changing authenticated vector pages.
 if(state.pages.some((page:any)=>page.coverageVersion!==1)) {
  state.phase='exporting';await save();
  for(const page of state.pages){if(page.coverageVersion===1)continue;
   const metadata=JSON.parse(await readFile(new URL(page.metadata.file,dir),'utf8'));
   const coverage=await readVectorCandidateCoverage(client,id,generation.collection,metadata.map((row:any)=>row.digest));
   for(const row of metadata)row.coverage=coverage.get(row.digest);
   const bytes=Buffer.from(JSON.stringify(metadata)+'\n'),sha256=hash(bytes),file=sha256+'.json';
   await writeFile(new URL(file,dir),bytes,{flag:'wx'}).catch(async(error:any)=>{if(error.code!=='EEXIST'||hash(await readFile(new URL(file,dir)))!==sha256)throw error;});
   page.metadata={file,sha256,sizeBytes:bytes.length};page.coverageVersion=1;await save();
  }
 }
 while(state.rows<Number(generation.group_count)){
  const rows=(await client.query(`SELECT encode(g.digest,'hex') AS digest,vector_send(g.embedding) AS bytes,g.coverage::text AS coverage FROM storage.vector_search_groups g WHERE g.generation_id=$1 AND g.digest>decode($2,'hex') ORDER BY g.digest LIMIT 1000`,[id,state.cursor])).rows;
  if(!rows.length)throw Error('Generation export incomplete');
  const coverage=await readVectorCandidateCoverage(client,id,generation.collection,rows.map(row=>row.digest));
  const vectors=Buffer.alloc(rows.length*6144),metadata=[];
  for(const [index,row] of rows.entries()){
   if(row.bytes.length!==6148||row.bytes.readUInt16BE(0)!==1536||row.bytes.readUInt16BE(2)!==0||hash(row.bytes)!==row.digest)throw Error('Original vector bytes differ from verified group');
   const native=Buffer.from(row.bytes.subarray(4));native.swap32();native.copy(vectors,index*6144);metadata.push({digest:row.digest,coverage:coverage.get(row.digest)});
  }
  const artifacts:any={};for(const [kind,bytes] of [['vectors',vectors],['metadata',Buffer.from(JSON.stringify(metadata)+'\n')]] as const){const sha256=hash(bytes),file=sha256+(kind==='vectors'?'.f32':'.json');await writeFile(new URL(file,dir),bytes,{flag:'wx'}).catch(async(error:any)=>{if(error.code!=='EEXIST'||hash(await readFile(new URL(file,dir)))!==sha256)throw error;});artifacts[kind]={file,sha256,sizeBytes:bytes.length};}
  state.pages.push({...artifacts,rows:rows.length,coverageVersion:1});state.rows+=rows.length;state.cursor=rows.at(-1).digest;await save();
 }
 await client.query('COMMIT');
 const current=(await client.query('SELECT source_revision FROM storage.vector_collections WHERE name=$1',[generation.collection])).rows[0];if(current.source_revision!==state.sourceRevision)throw Error('Originals changed during export');
 if(!reusableMatrix){
 const target=new URL('matrix.f32',dir),handle=await open(new URL('matrix.tmp',dir),'w');const digest=createHash('sha256');let bytes=0;
 try{for(const page of state.pages){for await(const part of createReadStream(new URL(page.vectors.file,dir))){digest.update(part);await handle.writeFile(part);bytes+=part.length;}}await handle.sync();}finally{await handle.close();}
 if(bytes!==state.rows*6144)throw Error('Matrix size differs');await rename(new URL('matrix.tmp',dir),target);const expected=digest.digest('hex'),actual=createHash('sha256');let actualBytes=0;for await(const part of createReadStream(target)){actual.update(part);actualBytes+=part.length;}if(actualBytes!==bytes||actual.digest('hex')!==expected)throw Error('Matrix readback failed');
 state.matrix={file:'matrix.f32',sha256:expected,sizeBytes:bytes};
 }
 const publishedSource=(await client.query('SELECT source_revision FROM storage.vector_collections WHERE name=$1',[generation.collection])).rows[0];if(publishedSource.source_revision!==state.sourceRevision)throw Error('Originals changed before matrix publication');
 state.phase='complete';await save();
}}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();await db.close();}

