/** Provider fixtures must honor the request's response transport. */
export function structuredResponse<T extends {output?:Array<{content?:Array<{type:string;text?:string}>}>}>(request:{stream?:boolean},response:T) {
  if(!request.stream)return Response.json(response);
  const text=(response.output??[]).flatMap(item=>item.content??[]).filter(item=>item.type==="output_text").map(item=>item.text??"").join("");
  const event=(type:string,value:object)=>`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`;
  return new Response(event("response.output_text.delta",{delta:text})+
    event("response.completed",{response:{...response,status:"completed"}}),{headers:{"content-type":"text/event-stream"}});
}
