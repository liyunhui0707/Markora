import {decodeString} from 'micromark-util-decode-string';
// Parser-owned display data only. Resource loading and file navigation are never
// derived from a label, link, diagram or metadata field.
const noteTypes=new Set(['NOTE','TIP','IMPORTANT','WARNING','CAUTION']);
export function decodedOffsets(raw,value,start,softSpaces=true){
  if(raw===value)return {start};
  let text='',offsets=[start];
  for(const m of raw.matchAll(/\\[!-/:-@\[-`{-~]|&(?:#[0-9]{1,7}|#x[\da-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]*);|\r\n|[\s\S]/gu)){
    const decoded=decodeString(m[0]);
    const token=softSpaces?decoded.replace(/\r\n?|\n/g,' '):decoded;
    for(let i=1;i<=token.length;i++)offsets.push(i===token.length?start+m.index+m[0].length:null);
    text+=token;
  }
  return text===value?{start,offsets}:null;
}

// Only literal delimiters in the original parser-owned text can create a link.
export function wikiParts(node,source){
 const start=node.position.start.offset,raw=source.slice(start,node.position.end.offset);
 if(!raw.includes('[['))return null;
 const map=decodedOffsets(raw,node.value,start,false);
 if(!map)return null;
 const boundary=i=>map.offsets?map.offsets[i]:start+i;
 const parts=[];let cursor=0;
 for(const match of node.value.matchAll(/(?<![!\[])\[\[([^\[\]|\r\n]+)(?:\|([^\[\]\r\n]+))?\]\](?!\])/g)){
   const first=match.index,last=first+match[0].length,a=boundary(first),b=boundary(last);
   if(a==null||b==null||source.slice(a,b)!==match[0])continue;
   parts.push({text:node.value.slice(cursor,first),start:boundary(cursor),end:a},
     {tree:{tag:'button',jump:'wiki',target:match[1],children:[match[2]||match[1]]}});
   cursor=last;
 }
 if(!parts.length)return null;
 parts.push({text:node.value.slice(cursor),start:boundary(cursor),end:start+raw.length});
 return parts;
}

export function alertMarker(node){
 const first=node.children[0]?.children?.[0];
 const match=first?.type==='text'&&first.value.match(/^\[!([A-Z]+)\](?:\r\n|\r|\n|$)/);
 return match&&noteTypes.has(match[1])?match:null;
}
export function metadataPreview(raw){
 const lines=raw.split(/\r\n|\r|\n/).slice(1,-1);
 return {tag:'section',children:[{tag:'strong',children:['文档属性']},{tag:'pre',children:[lines.join('\n')]}]};
}
export function extensionKind(node,source){
 if(node.type==='math')return 'math';
 if(node.type==='code'&&node.lang?.toLowerCase()==='mermaid')return 'mermaid';
 if(node.type==='footnoteDefinition')return 'footnote';
 if(node.type==='blockquote' && /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|\r|$)/.test(source))return 'alert';
 if(!source.includes('$')&&!source.includes('[^')&&!source.includes('[[')&&!source.includes('mermaid'))return null;
 const has=n=>n.type==='inlineMath'||n.type==='math'||n.type==='footnoteReference'||n.type==='footnoteDefinition'||
   (n.type==='code'&&n.lang?.toLowerCase()==='mermaid')||(n.type==='text'&&/\[\[[^\[\]\r\n]+\]\]/.test(n.value))||n.children?.some(has);
 return has(node)?node.type:null;
}
export function extensionTree(n,convert,depth,source){
 if(n.type==='math'||n.type==='inlineMath')return {tag:n.type==='math'?'div':'span',formula:n.value,display:n.type==='math',children:[n.value]};
 if(n.type==='code'&&n.lang?.toLowerCase()==='mermaid')return {tag:'div',diagram:n.value,children:[n.value]};
 if(n.type==='footnoteReference')return {tag:'button',jump:'note',target:n.identifier,children:['['+n.label+']']};
 if(n.type==='footnoteDefinition'){
  const children=n.children.map(c=>convert(c,depth+1));if(children.includes(null))return null;
  return {tag:'section',note:n.identifier,children:[{tag:'button',jump:'back',target:n.identifier,children:['↩ '+n.label]},...children]};
 }
 if(n.type==='blockquote'){
  const first=n.children[0]?.children?.[0],m=alertMarker(n);
  if(m){
   const clone={...n.children[0],children:[{...first,value:first.value.slice(m[0].length)},...n.children[0].children.slice(1)]};
   const children=[clone,...n.children.slice(1)].map(c=>convert(c,depth+1));if(children.includes(null))return null;
   return {tag:'blockquote',children:[{tag:'strong',children:[m[1]]},...children]};
  }
 }
 if(n.type==='text'&&n.value.includes('[[')){
  const parts=wikiParts(n,source);
  if(parts)return {tag:'span',children:parts.map(part=>part.tree??part.text)};
 }
 return undefined;
}
