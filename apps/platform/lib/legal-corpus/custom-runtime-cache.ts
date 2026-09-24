/** Per-corpus cache of authenticated immutable binary projections. Keys include
 * their pinned artifact digest and size; no query text or answer is retained. */
export class CustomRuntimeCache {
  private readonly entries=new Map<string,Uint8Array>();
  private bytes=0;
  constructor(private readonly limit=256*1024*1024) {}

  get(key:string):Uint8Array|undefined {
    const value=this.entries.get(key);
    if(value){this.entries.delete(key);this.entries.set(key,value);}
    return value;
  }

  put(key:string,value:Uint8Array):void {
    if(value.byteLength>this.limit)return;
    const previous=this.entries.get(key);
    if(previous){this.bytes-=previous.byteLength;this.entries.delete(key);}
    while(this.bytes+value.byteLength>this.limit) {
      const oldest=this.entries.keys().next().value!;
      this.bytes-=this.entries.get(oldest)!.byteLength;
      this.entries.delete(oldest);
    }
    this.entries.set(key,value);
    this.bytes+=value.byteLength;
  }
}
