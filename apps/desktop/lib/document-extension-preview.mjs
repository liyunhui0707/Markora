// Parser-owned display data only. Resource loading and file navigation are never
// derived from a label, link, diagram or metadata field.
const noteTypes=new Set(['NOTE','TIP','IMPORTANT','WARNING','CAUTION']);
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
  const first=n.children[0]?.children?.[0],m=first?.type==='text'&&first.value.match(/^\[!([A-Z]+)\](?:\r\n|\r|\n|$)/);
  if(m&&noteTypes.has(m[1])){
   const clone={...n.children[0],children:[{...first,value:first.value.slice(m[0].length)},...n.children[0].children.slice(1)]};
   const children=[clone,...n.children.slice(1)].map(c=>convert(c,depth+1));if(children.includes(null))return null;
   return {tag:'blockquote',children:[{tag:'strong',children:[m[1]]},...children]};
  }
 }
 if(n.type==='text'&&n.value.includes('[[')&&source.slice(n.position.start.offset,n.position.end.offset)===n.value){
  const children=[];let index=0;
  for(const match of n.value.matchAll(/(?<![!\[])\[\[([^\[\]|\r\n]+)(?:\|([^\[\]\r\n]+))?\]\](?!\])/g)){
   children.push(n.value.slice(index,match.index),{tag:'button',jump:'wiki',target:match[1],children:[match[2]||match[1]]});
   index=match.index+match[0].length;
  }
  if(index)return {tag:'span',children:[...children,n.value.slice(index)]};
 }
 return undefined;
}
