require('tsx/cjs');
const {parentPort} = require('node:worker_threads');
const {publisherHtmlFingerprints} = require('../lib/legal/lex-document-status.ts');

parentPort.on('message', async input => {
  try {parentPort.postMessage({ok:true,value:await publisherHtmlFingerprints(input)});}
  catch (error) {parentPort.postMessage({ok:false,error:error instanceof Error ? error.message : String(error)});}
});
