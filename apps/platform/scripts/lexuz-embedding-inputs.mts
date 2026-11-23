// Detached stdin/stdout transformation. This module imports no provider client.
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {prepareEmbeddingChunks, serializeCustomEmbeddingInput,
  countCustomEmbeddingTokens, CUSTOM_EMBEDDING_MODEL} from '../lib/legal-corpus/custom-hybrid-index';
import {stableSourceSnapshotJson} from '../lib/legal-corpus/source-snapshot';

async function prepare(source: Parameters<typeof prepareEmbeddingChunks>[0]) {
  try {
    const chunks = await prepareEmbeddingChunks(source, {targetTokens: 512});
    if (chunks.map(chunk => chunk.officialText).join('') !== source.officialText) throw Error('TEXT_COVERAGE_MISMATCH');
    return {chunks: chunks.map(chunk => {
      const input = serializeCustomEmbeddingInput(chunk);
      const {articleNumber: _locator, articleTitle, hierarchy, schemaVersion: _version, ...fields} = JSON.parse(input);
      const compactInput = stableSourceSnapshotJson({ ...fields, ...(articleTitle === null ? {} : { articleTitle }),
        ...(hierarchy.length ? { hierarchy } : {}) }) + '\n';
      return {chunk, input, inputHash: createHash('sha256').update(input).digest('hex'),
        compactInput, compactTokens: countCustomEmbeddingTokens(compactInput),
        model: CUSTOM_EMBEDDING_MODEL, dimensions: 3072,
        configuration: 'legal-embedding-input-v1', tokenizer: 'cl100k_base'};
    })};
  } catch (error) {
    return {error: String(error)};
  }
}

for await (const line of createInterface({input: process.stdin, crlfDelay: Infinity})) {
  try {
    const source = JSON.parse(line);
    if (Array.isArray(source.batch)) {
      if (source.batch.length > 64 || Buffer.byteLength(line, 'utf8') > 1024 * 1024) {
        throw Error('INPUT_BATCH_LIMIT_EXCEEDED');
      }
      const results = [];
      for (const item of source.batch) results.push(await prepare(item));
      process.stdout.write(JSON.stringify({results}) + '\n');
    } else {
      process.stdout.write(JSON.stringify(await prepare(source)) + '\n');
    }
  } catch (error) {
    process.stdout.write(JSON.stringify({error: String(error)}) + '\n');
  }
}
