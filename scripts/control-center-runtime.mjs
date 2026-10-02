import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,lstatSync,linkSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
/** Persist an independent OTP secret on the existing environment data volume.
 * Never return/log it; do not write secrets into a release checkout. */
export function initializeControlCenterEnvironment(environment){
 if(!['production','staging'].includes(environment.DEPLOYMENT_ENVIRONMENT))return;
 if(environment.DEPLOYMENT_ENVIRONMENT==='production'){
  const canonical=`https://admin.${new URL(environment.PUBLIC_SITE_URL??'https://juro.uz').hostname}`;
  if(!environment.ADMIN_CONSOLE_ORIGIN||environment.ADMIN_CONSOLE_ORIGIN===canonical+':3443')environment.ADMIN_CONSOLE_ORIGIN=canonical;
 }
 if(environment.ADMIN_OTP_SECRET){if(environment.ADMIN_OTP_SECRET.length<32)throw Error('Independent admin OTP secret must contain at least 32 characters');return;}
 if(!environment.OBJECT_STORAGE_PATH?.startsWith('/'))throw Error('Control Center requires the existing absolute environment data volume');
 const root=resolve(environment.OBJECT_STORAGE_PATH,'.control-center');mkdirSync(root,{recursive:true,mode:0o700});const path=resolve(root,'otp-secret');
 const temporary=path+'.'+randomBytes(8).toString('hex');writeFileSync(temporary,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});try{linkSync(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}finally{unlinkSync(temporary);}
 const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error('Control Center secret file must be a private regular file');
 const secret=readFileSync(path,'utf8').trim();if(secret.length<32)throw Error('Control Center secret file invalid');environment.ADMIN_OTP_SECRET=secret;
}
