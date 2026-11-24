// GFM extended email autolinks can include their written mailto:/xmpp: prefix.
// Extend only an already recognized, position-exact bare email token.
export function includeProtocolPrefixes(tree,source){
  if(!source.includes('mailto:')&&!source.includes('xmpp:'))return tree;
  const shift=(point,delta)=>({...point,offset:point.offset+delta,column:point.column+delta});
  const pending=[tree];
  while(pending.length){
    const children=pending.pop().children;
    if(!children)continue;
    for(let i=0;i<children.length;i++){
      const link=children[i];
      if(link.type!=='link'){if(link.children)pending.push(link);continue;}
      const before=children[i-1],label=link.children[0];
      if(before?.type!=='text'||link.children.length!==1||!link.position||!before.position)continue;
      const prefix=before.value.match(/(?:^|[\s*(\[_~])(mailto:|xmpp:)$/)?.[1];
      if(!prefix||link.url!=='mailto:'+label.value||source.slice(link.position.start.offset,link.position.end.offset)!==label.value||
        before.position.end.offset!==link.position.start.offset||source.slice(before.position.end.offset-prefix.length,before.position.end.offset)!==prefix)continue;
      const after=children[i+1];
      let resource='';
      if(prefix==='xmpp:'&&after?.type==='text'&&after.position?.start.offset===link.position.end.offset){
        resource=after.value.match(/^\/[a-zA-Z0-9@._-]+/)?.[0]?.replace(/[.]+$/,'')||'';
        if(source.slice(after.position.start.offset,after.position.start.offset+resource.length)!==resource)resource='';
      }
      const start=shift(link.position.start,-prefix.length),end=shift(link.position.end,resource.length);
      const value=prefix+label.value+resource;
      const nodes=[];
      if(before.value.length>prefix.length)nodes.push({...before,value:before.value.slice(0,-prefix.length),position:{start:before.position.start,end:start}});
      nodes.push({...link,url:value,position:{start,end},children:[{type:'text',value,position:{start,end}}]});
      if(resource&&after.value.length>resource.length)nodes.push({...after,value:after.value.slice(resource.length),position:{start:end,end:after.position.end}});
      children.splice(i-1,resource?3:2,...nodes);
      i=i-2+nodes.length;
    }
  }
  return tree;
}
