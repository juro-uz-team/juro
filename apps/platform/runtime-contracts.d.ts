// Provider-independent compatibility contracts for existing application storage call sites.
interface Env {
  ASSETS: Fetcher;
	BUCKET: R2Bucket;
	BACKUP_BUCKET: R2Bucket;
	QUARANTINE_BUCKET: R2Bucket;
	DB: D1Database;
	LEX_UZ_INDEX: VectorizeIndex;
	ADVICE_UZ_INDEX: VectorizeIndex;
	INTERNAL_LEGAL_MATERIALS_INDEX: VectorizeIndex;
	USER_DOCUMENTS_INDEX: VectorizeIndex;
	PLATFORM_ANALYTICS: AnalyticsEngineDataset;
	DOCUMENT_ANALYSIS_QUEUE: Queue;
	DOCUMENT_ANALYSIS_DLQ: Queue;
	OCR_PROCESSING_QUEUE: Queue;
	OCR_PROCESSING_DLQ: Queue;
	DOCUMENT_EXPORT_QUEUE: Queue;
	DOCUMENT_EXPORT_DLQ?: Queue;
	EMAIL_NOTIFICATIONS_QUEUE: Queue;
	LEGAL_SOURCES_SYNC_QUEUE: Queue;
	DATA_RETENTION_CLEANUP_QUEUE: Queue;
	NOTIFICATIONS_QUEUE: Queue;
	MALWARE_SCAN_QUEUE?: Queue;
	MALWARE_SCAN_DLQ?: Queue;
	STAGING_QUEUE_HEALTH_PROBE_QUEUE?: Queue;
	WORKER_VERSION?: WorkerVersionMetadata;
	APP_ENV: "development" | "staging" | "production";
	LEGAL_RETRIEVAL_ENVIRONMENT: string;
	ASYNC_RUNTIME_ENABLED: string;
	CRON_ENABLED: string;
	ACCOUNT_DELETION_PURGE_ENABLED: string;
	MALWARE_SCAN_ENABLED?: string;
	MALWARE_SCANNER_PROBE_ENABLED?: string;
	STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED?: string;
	GUEST_AI_ENABLED: string;
	STAGING_SYNTHETIC_PROBES_ENABLED: string;
	STAGING_LEGAL_EVALUATION_ENABLED?: string;
	STAGING_QUEUE_HEALTH_PROBE_ENABLED: string;
	PRODUCTION_SYNTHETIC_PROBES_ENABLED: string;
	PUBLIC_DOCUMENT_URL_IMPORT_ENABLED: string;
	PAYMENT_FOUNDATION_ENABLED: string;
	PAYMENT_SANDBOX_ENABLED: string;
	PAYMENT_PRODUCTION_APPROVED: string;
	PAYMENT_PRODUCTION_DEMO_ENABLED: string;
	LEGAL_LEX_INGESTION_ENABLED: string;
	LEGAL_LEX_METADATA_MONITOR_ENABLED: string;
	LEGAL_ADVICE_INGESTION_ENABLED: string;
	LEGAL_DIRECT_RETRIEVAL_ENABLED: string;
	LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST: string;
	LEGAL_ADVICE_SITEMAP_DISCOVERY_ENABLED: string;
	LEGAL_LEX_RSS_DISCOVERY_ENABLED: string;
	LEGAL_SOURCE_STAFF_API_ENABLED: string;
	LAWYER_PROFILE_DIRECTORY_ENABLED: string;
	IDENTITY_PROTECTION_MODE: string;
	JOB_SCHEMA_VERSION: string;
	EMBEDDING_MODEL: string;
	EMAIL_FROM: string;
	OPERATIONS_ALERT_EMAIL: string;
	STATUS_HOSTNAME: string;
	ADMIN_CONSOLE_ORIGIN?: string;
	OPENAI_CHAT_MODEL?: string;
	OPENAI_RETRIEVAL_MODEL?: string;
	OPENAI_DEEP_MODEL?: string;
	OPENAI_TRANSCRIPTION_MODEL: string;
	OPENAI_TTS_MODEL: string;
	ANTHROPIC_DOCUMENT_MODEL?: string;
	ANTHROPIC_FALLBACK_MODEL?: string;
	LEGAL_RETRIEVAL_SERVICE: Fetcher  | Fetcher ;
	MALWARE_SCANNER?: Fetcher  | Fetcher ;
	PRODUCTION_QUEUE_HEALTH_PROBE_QUEUE?: Queue;
	TURNSTILE_SITE_KEY?: string;
	PRODUCTION_QUEUE_HEALTH_PROBE_ENABLED?: string;
	ADMIN_CONSOLE?: Fetcher ;
}

interface Fetcher { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
interface QueueRetryOptions { delaySeconds?: number }
interface Queue<T = unknown> { metrics(): Promise<{backlogCount:number;backlogBytes:number;oldestMessageTimestamp?:Date}>; send(body: T, options?: {delaySeconds?:number;contentType?:string}): Promise<unknown>; sendBatch(messages: {body:T;delaySeconds?:number}[]): Promise<void> }
interface Message<T = unknown> {id:string; timestamp:Date; body:T; attempts:number; ack():void; retry(options?:QueueRetryOptions):void}
interface MessageBatch<T = unknown> {queue:string;messages:readonly Message<T>[];metadata?:{metrics:{backlogCount:number;backlogBytes:number;oldestMessageTimestamp?:Date}};ackAll():void;retryAll(options?:QueueRetryOptions):void}
interface ScheduledController {cron:string;scheduledTime:number;noRetry():void}
interface ExecutionContext {waitUntil(promise:Promise<unknown>):void;passThroughOnException():void}
interface ExportedHandler<E = unknown> {fetch?:(request:Request,env:E,ctx:ExecutionContext)=>Response|Promise<Response>;queue?:(batch:MessageBatch,env:E,ctx:ExecutionContext)=>void|Promise<void>;scheduled?:(controller:ScheduledController,env:E,ctx:ExecutionContext)=>void|Promise<void>}
interface AnalyticsEngineDataset {
    writeDataPoint(event?: AnalyticsEngineDataPoint): void;
}
interface AnalyticsEngineDataPoint {
    indexes?: ((ArrayBuffer | string) | null)[];
    doubles?: number[];
    blobs?: ((ArrayBuffer | string) | null)[];
}
interface R2Error extends Error {
    readonly name: string;
    readonly code: number;
    readonly message: string;
    readonly action: string;
    readonly stack: any;
}
interface R2ListOptions {
    limit?: number;
    prefix?: string;
    cursor?: string;
    delimiter?: string;
    startAfter?: string;
    include?: ("httpMetadata" | "customMetadata")[];
}
interface R2Bucket {
    head(key: string): Promise<R2Object | null>;
    get(key: string, options: R2GetOptions & {
        onlyIf: R2Conditional | Headers;
    }): Promise<R2ObjectBody | R2Object | null>;
    get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
    put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions & {
        onlyIf: R2Conditional | Headers;
    }): Promise<R2Object | null>;
    put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object>;
    createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload>;
    resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
    delete(keys: string | string[]): Promise<void>;
    list(options?: R2ListOptions): Promise<R2Objects>;
}
interface R2MultipartUpload {
    readonly key: string;
    readonly uploadId: string;
    uploadPart(partNumber: number, value: ReadableStream | (ArrayBuffer | ArrayBufferView) | string | Blob, options?: R2UploadPartOptions): Promise<R2UploadedPart>;
    abort(): Promise<void>;
    complete(uploadedParts: R2UploadedPart[]): Promise<R2Object>;
}
interface R2UploadedPart {
    partNumber: number;
    etag: string;
}
declare abstract class R2Object {
    readonly key: string;
    readonly version: string;
    readonly size: number;
    readonly etag: string;
    readonly httpEtag: string;
    readonly checksums: R2Checksums;
    readonly uploaded: Date;
    readonly httpMetadata?: R2HTTPMetadata;
    readonly customMetadata?: Record<string, string>;
    readonly range?: R2Range;
    readonly storageClass: string;
    readonly ssecKeyMd5?: string;
    writeHttpMetadata(headers: Headers): void;
}
interface R2ObjectBody extends R2Object {
    get body(): ReadableStream;
    get bodyUsed(): boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    bytes(): Promise<Uint8Array>;
    text(): Promise<string>;
    json<T>(): Promise<T>;
    blob(): Promise<Blob>;
}
type R2Range = {
    offset: number;
    length?: number;
} | {
    offset?: number;
    length: number;
} | {
    suffix: number;
};
interface R2Conditional {
    etagMatches?: string;
    etagDoesNotMatch?: string;
    uploadedBefore?: Date;
    uploadedAfter?: Date;
    secondsGranularity?: boolean;
}
interface R2GetOptions {
    onlyIf?: (R2Conditional | Headers);
    range?: (R2Range | Headers);
    ssecKey?: (ArrayBuffer | string);
}
interface R2PutOptions {
    onlyIf?: (R2Conditional | Headers);
    httpMetadata?: (R2HTTPMetadata | Headers);
    customMetadata?: Record<string, string>;
    md5?: ((ArrayBuffer | ArrayBufferView) | string);
    sha1?: ((ArrayBuffer | ArrayBufferView) | string);
    sha256?: ((ArrayBuffer | ArrayBufferView) | string);
    sha384?: ((ArrayBuffer | ArrayBufferView) | string);
    sha512?: ((ArrayBuffer | ArrayBufferView) | string);
    storageClass?: string;
    ssecKey?: (ArrayBuffer | string);
}
interface R2MultipartOptions {
    httpMetadata?: (R2HTTPMetadata | Headers);
    customMetadata?: Record<string, string>;
    storageClass?: string;
    ssecKey?: (ArrayBuffer | string);
}
interface R2Checksums {
    readonly md5?: ArrayBuffer;
    readonly sha1?: ArrayBuffer;
    readonly sha256?: ArrayBuffer;
    readonly sha384?: ArrayBuffer;
    readonly sha512?: ArrayBuffer;
    toJSON(): R2StringChecksums;
}
interface R2StringChecksums {
    md5?: string;
    sha1?: string;
    sha256?: string;
    sha384?: string;
    sha512?: string;
}
interface R2HTTPMetadata {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
}
type R2Objects = {
    objects: R2Object[];
    delimitedPrefixes: string[];
} & ({
    truncated: true;
    cursor: string;
} | {
    truncated: false;
});
interface R2UploadPartOptions {
    ssecKey?: (ArrayBuffer | string);
}
interface D1Meta {
    duration: number;
    size_after: number;
    rows_read: number;
    rows_written: number;
    last_row_id: number;
    changed_db: boolean;
    changes: number;
    served_by_region?: string;
    served_by_colo?: string;
    served_by_primary?: boolean;
    timings?: {
        sql_duration_ms: number;
    };
    total_attempts?: number;
}
interface D1Response {
    success: true;
    meta: D1Meta & Record<string, unknown>;
    error?: never;
}
type D1Result<T = unknown> = D1Response & {
    results: T[];
};
interface D1ExecResult {
    count: number;
    duration: number;
}
type D1SessionConstraint = 'first-primary' | 'first-unconstrained';
type D1SessionBookmark = string;
declare abstract class D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<D1ExecResult>;
    withSession(constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint): D1DatabaseSession;
    dump(): Promise<ArrayBuffer>;
}
declare abstract class D1DatabaseSession {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    getBookmark(): D1SessionBookmark | null;
}
declare abstract class D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(colName: string): Promise<T | null>;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    raw<T = unknown[]>(options: {
        columnNames: true;
    }): Promise<[
        string[],
        ...T[]
    ]>;
    raw<T = unknown[]>(options?: {
        columnNames?: false;
    }): Promise<T[]>;
}
type VectorizeVectorMetadataValue = string | number | boolean | string[];
type VectorizeVectorMetadata = VectorizeVectorMetadataValue | Record<string, VectorizeVectorMetadataValue>;
interface VectorizeError {
    code?: number;
    error: string;
}
type VectorizeVectorMetadataFilterOp = '$eq' | '$ne' | '$lt' | '$lte' | '$gt' | '$gte';
type VectorizeVectorMetadataFilterCollectionOp = '$in' | '$nin';
type VectorizeVectorMetadataFilter = {
    [field: string]: Exclude<VectorizeVectorMetadataValue, string[]> | null | {
        [Op in VectorizeVectorMetadataFilterOp]?: Exclude<VectorizeVectorMetadataValue, string[]> | null;
    } | {
        [Op in VectorizeVectorMetadataFilterCollectionOp]?: Exclude<VectorizeVectorMetadataValue, string[]>[];
    };
};
type VectorizeDistanceMetric = "euclidean" | "cosine" | "dot-product";
type VectorizeMetadataRetrievalLevel = "all" | "indexed" | "none";
interface VectorizeQueryOptions {
    topK?: number;
    namespace?: string;
    returnValues?: boolean;
    returnMetadata?: boolean | VectorizeMetadataRetrievalLevel;
    filter?: VectorizeVectorMetadataFilter;
}
type VectorizeIndexConfig = {
    dimensions: number;
    metric: VectorizeDistanceMetric;
} | {
    preset: string;
};
interface VectorizeIndexDetails {
    readonly id: string;
    name: string;
    description?: string;
    config: VectorizeIndexConfig;
    vectorsCount: number;
}
interface VectorizeIndexInfo {
    vectorCount: number;
    dimensions: number;
    processedUpToDatetime: number;
    processedUpToMutation: number;
}
interface VectorizeVector {
    id: string;
    values: VectorFloatArray | number[];
    namespace?: string;
    metadata?: Record<string, VectorizeVectorMetadata>;
}
type VectorizeMatch = Pick<Partial<VectorizeVector>, "values"> & Omit<VectorizeVector, "values"> & {
    score: number;
};
interface VectorizeMatches {
    matches: VectorizeMatch[];
    count: number;
}
interface VectorizeVectorMutation {
    ids: string[];
    count: number;
}
interface VectorizeAsyncMutation {
    mutationId: string;
}
declare abstract class VectorizeIndex {
    public describe(): Promise<VectorizeIndexDetails>;
    public query(vector: VectorFloatArray | number[], options?: VectorizeQueryOptions): Promise<VectorizeMatches>;
    public insert(vectors: VectorizeVector[]): Promise<VectorizeVectorMutation>;
    public upsert(vectors: VectorizeVector[]): Promise<VectorizeVectorMutation>;
    public deleteByIds(ids: string[]): Promise<VectorizeVectorMutation>;
    public getByIds(ids: string[]): Promise<VectorizeVector[]>;
}
declare abstract class Vectorize {
    public describe(): Promise<VectorizeIndexInfo>;
    public query(vector: VectorFloatArray | number[], options?: VectorizeQueryOptions): Promise<VectorizeMatches>;
    public queryById(vectorId: string, options?: VectorizeQueryOptions): Promise<VectorizeMatches>;
    public insert(vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation>;
    public upsert(vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation>;
    public deleteByIds(ids: string[]): Promise<VectorizeAsyncMutation>;
    public getByIds(ids: string[]): Promise<VectorizeVector[]>;
}
type WorkerVersionMetadata = {
    id: string;
    tag: string;
    timestamp: string;
};