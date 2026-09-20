/** Match a literal quotation without taking a suffix/prefix of a word, amount,
 * date or other compound number. This establishes identity, not truth. */
export function containsExactQuotation(body:string|undefined,quotation:string):boolean {
  if(!body||!quotation)return false;
  const leadingSpace=quotation.length-quotation.trimStart().length;
  const words=quotation.trim().replace(/[.;,:!?]+$/u,"");
  if(!words)return false;
  for(let index=body.indexOf(quotation);index>=0;index=body.indexOf(quotation,index+1)) {
    const before=body.slice(0,index+leadingSpace);
    const after=body.slice(index+leadingSpace+words.length);
    if(/^[\p{L}\p{M}\p{N}]/u.test(words)&&/[\p{L}\p{M}\p{N}]$/u.test(before))continue;
    if(/[\p{L}\p{M}\p{N}]$/u.test(words)&&/^[\p{L}\p{M}\p{N}]/u.test(after))continue;
    if(/^[+−.,/:\-–—]*\p{N}/u.test(words)
      && (/\p{N}[+−.,/:\-–—\s]*$/u.test(before)||/[+−-]$/u.test(before)))continue;
    if(/\p{N}$/u.test(words)&&/^[+−.,/:\-–—\s]+\p{N}/u.test(after))continue;
    return true;
  }
  return false;
}
