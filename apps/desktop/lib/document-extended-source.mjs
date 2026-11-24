// Fallback for parser-owned text in structures outside the ordinary fast planners.
// Every editable boundary is derived from the source and checked against the AST.
import {decodeString} from 'micromark-util-decode-string';
import {copyEditedBlock} from './document-edit-projection.mjs';
import {equalCanonicalProjection} from './document-canonical-equal.mjs';
import capacity from './document-capacity.js';
import {containerNodeAt,containerPosition} from './document-container-source.mjs';

const reject=()=>({ok:false,code:'unsafe-source-range'});
function decodedOffsets(raw,value,start){
  if(raw===value)return {start};
  let text='',offsets=[start];
  for(const m of raw.matchAll(/\\[!-/:-@\[-`{-~]|&(?:#[0-9]{1,7}|#x[\da-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]*);|\r\n|[\s\S]/gu)){
    const token=decodeString(m[0]).replace(/\r\n?|\n/g,' ');
    for(let i=1;i<=token.length;i++)offsets.push(i===token.length?start+m.index+m[0].length:null);
    text+=token;
  }
  return text===value?{start,offsets}:null;
}

export function projectExtended(node,source,position,definitions){
  const start=node.position.start.offset,end=node.position.end.offset;
  if(end-start>32768 || /^:::/.test(source.slice(start,start+3)))return null;
  if(node.type==='blockquote'&&source.slice(start,end).split(/\r\n|\r|\n/).some(line=>!/^ {0,3}>/.test(line)))return null;
  let pos=position,rowCount=0;const leaves=[];
  function text(value,map,marks,path){
    if(!value)return [];
    if(map)leaves.push({from:pos,to:pos+value.length,path,...map});
    pos+=value.length;
    return [{type:'text',text:value,...(marks.length?{marks}:{})}];
  }
  function inline(n,marks,path){
    if(!n.position)return null;
    const a=n.position.start.offset,b=n.position.end.offset,raw=source.slice(a,b);
    if(n.type==='text'){
      const value=n.value.replace(/\r\n?|\n/g,' ');
      return text(value,decodedOffsets(raw,value,a),marks,path);
    }
    if(n.type==='break'){pos++;return [{type:'hardBreak'}];}
    if(n.type==='inlineCode'){
      const fence=raw.match(/^`+/)?.[0];
      if(!fence || !raw.endsWith(fence))return null;
      let body=raw.slice(fence.length,-fence.length),at=a+fence.length;
      const normalized=body.replace(/\r\n?|\n/g,' ');
      if(normalized!==n.value && normalized.startsWith(' ')&&normalized.endsWith(' ')){body=body.slice(1,-1);at++;}
      return text(n.value,body===n.value?{start:at}:null,[...marks,{type:'code'}],path);
    }
    let mark;
    if(n.type==='link'||n.type==='linkReference'){
      const target=n.type==='link'?n:definitions.get(n.identifier.toLowerCase());
      if(!target)return null;
      mark={type:'link',attrs:{href:target.url,title:target.title??null}};
    }else{
      const type=({strong:'bold',emphasis:'italic',delete:'strike'})[n.type];
      if(!type)return null;
      mark={type};
    }
    if(marks.some(m=>m.type===mark.type))return null;
    const children=[];
    for(const child of n.children){
      const part=inline(child,[...marks,mark],[...path.slice(0,-1),path.at(-1)+children.length]);
      if(!part)return null;children.push(...part);
    }
    return children;
  }
  function block(n,path,depth=0){
    if(depth>12 || (n.type==='blockquote'&&depth>=6) || (n.type==='list'&&depth>=12))return null;
    if(n.type==='code'&&depth>0)return null;
    if(['listItem','blockquote'].includes(n.type)&&++rowCount>32)return null;
    const type=({paragraph:'paragraph',heading:'heading',blockquote:'blockquote',list:n.ordered?'orderedList':'bulletList',listItem:'listItem',code:'codeBlock',table:'table',tableRow:'tableRow'})[n.type];
    if(!type)return null;
    const content=[],out={type};
    if(type==='heading')out.attrs={level:n.depth};
    if(type==='orderedList')out.attrs={start:n.start??1};
    if(type==='listItem'&&typeof n.checked==='boolean')out.attrs={checked:n.checked};
    pos++;
    if(n.type==='code'){
      const raw=source.slice(n.position.start.offset,n.position.end.offset);
      if(!n.value || n.value.length>8192)return null;
      const lines=Array.from(raw.matchAll(/[^\r\n]+|\r\n|[\r\n]/g));
      const fenced=/^ {0,3}(?:`{3,}|~{3,})/.test(raw);
      const value=n.value.replace(/\r\n?/g,'\n');
      const bodyLines=value.split('\n'),offsets=[];
      let i=fenced?lines.findIndex(m=>/[\r\n]/.test(m[0]))+1:0;
      for(const [row,line] of bodyLines.entries()){
        const m=lines[i];if(!m)return null;
        const phys=/^[\r\n]/.test(m[0])?'':m[0];
        if(!phys.endsWith(line)||!/^[ \t]*$/.test(phys.slice(0,phys.length-line.length)))return null;
        const base=n.position.start.offset+m.index+phys.length-line.length;
        for(let j=0;j<=line.length;j++)offsets.push(base+j);
        if(phys)i++;
        if(row<bodyLines.length-1){if(!/^[\r\n]/.test(lines[i++]?.[0]||''))return null;}
      }
      out.attrs={language:n.lang||null,sourceEditable:true};
      content.push(...text(value,{start:offsets[0],offsets},[],[...path,0]));
    }else if(n.type==='paragraph'||n.type==='heading'){
      for(const child of n.children){const part=inline(child,[],[...path,content.length]);if(!part)return null;content.push(...part);}
      if(n===node&&n.type==='paragraph'&&n.position.start.line===n.position.end.line&&n.children.length){
        const at=n.children.at(-1).position.end.offset,margin=source.slice(at,end);
        if(/^ +$/.test(margin))content.push(...text(margin,{start:at},[],[content.length]));
      }
    }else if(n.type==='table'){
      if(n.children.length>32||n.align.length>8||n.children.some(r=>r.children.length!==n.align.length))return null;
      for(const [i,row] of n.children.entries()){
        pos++;const cells=[];
        for(const [j,cell] of row.children.entries()){
          pos+=2;const parts=[];
          for(const child of cell.children){const run=inline(child,[],[...path,i,j,0,parts.length]);if(!run)return null;parts.push(...run);}
          pos+=2;cells.push({type:i?'tableCell':'tableHeader',attrs:{align:n.align[j]},content:[{type:'paragraph',content:parts}]});
        }
        pos++;content.push({type:'tableRow',content:cells});
      }
    }else{
      if(n.children.length>32 || (n.type==='listItem'&&n.children[0]?.type!=='paragraph'))return null;
      for(const child of n.children){const part=block(child,[...path,content.length],depth+1);if(!part)return null;content.push(part);}
    }
    out.content=content;pos++;return out;
  }
  const doc=block(node,[]);
  return doc&&leaves.length?{doc,size:pos-position,from:position,to:pos,sourceFrom:start,sourceTo:end,leaves}:null;
}

// Only split a top-level paragraph where both endpoints belong to one plain
// lexical leaf. The complete paragraph trees verify the new Markdown boundaries.
function splitExtended(source,projection,block,leaf,change,a,b,project){
  const {from,to,insert}=change;
  const node=projection.doc.content[block.index],index=leaf.path[0];
  if(node.type!=='paragraph'||leaf.path.length!==1||node.content[index].marks?.length)return null;
  const pieces=insert.split('\n\n');
  if(pieces.length<2||pieces.length>32||pieces.some(s=>/[\r\n]/.test(s)))return null;
  const newline=source.slice(a).match(/\r\n|\r|\n/)?.[0]||source.match(/\r\n|\r|\n/)?.[0]||'\n';
  const raw=pieces.join(newline+newline);
  if(raw.length>4096)return null;
  const next=source.slice(0,a)+raw+source.slice(b);
  if(next.length>capacity.MAX_SOURCE_UNITS||!next.isWellFormed())return null;
  const value=node.content[index].text;
  pieces[0]=value.slice(0,from-leaf.from)+pieces[0];
  pieces[pieces.length-1]+=value.slice(to-leaf.from);
  const paragraphs=pieces.map((part,i)=>({type:'paragraph',content:[
    ...(i===0?node.content.slice(0,index):[]),...(part?[{type:'text',text:part}]:[]),
    ...(i===pieces.length-1?node.content.slice(index+1):[])]}));
  const expected={type:'doc',content:[...projection.doc.content.slice(0,block.index),...paragraphs,...projection.doc.content.slice(block.index+1)]};
  const after=project(next);
  if(!equalCanonicalProjection(expected,after.doc))return null;
  const caret=from+insert.length;
  return {ok:true,source:next,projection:after,change:{from:a,to:b,insert:raw},
    inverseSource:{from:a,to:a+raw.length,insert:source.slice(a,b)},selection:{from:caret,to:caret},structural:true};
}

export function mapExtendedText(source,projection,{from,to,insert},project){
  const block=projection.extended?.find(b=>from>b.from&&to<b.to);
  if(!block)return null;
  if(!insert.isWellFormed()||/[\r\0]/.test(insert))return reject();
  const candidates=block.leaves.filter(l=>from>=l.from&&to<=l.to);
  for(const leaf of candidates){
    const boundary=pos=>leaf.offsets?leaf.offsets[pos-leaf.from]:leaf.start+pos-leaf.from;
    const a=boundary(from),b=boundary(to);
    if(a==null||b==null||b-a>4096||!source.slice(a,b).isWellFormed())continue;
    const type=projection.doc.content[block.index].type;
    if(insert.includes('\n')&&type!=='codeBlock'){
      const split=splitExtended(source,projection,block,leaf,{from,to,insert},a,b,project);
      if(split)return split;
      continue;
    }
    const expected=copyEditedBlock(projection.doc,block.index);
    let parent=expected.content[block.index];for(const step of leaf.path.slice(0,-1))parent=parent.content[step];
    const i=leaf.path.at(-1),text=parent.content[i].text;
    const value=text.slice(0,from-leaf.from)+insert+text.slice(to-leaf.from);
    if(value)parent.content[i].text=value;else parent.content.splice(i,1);
    let rawInsert=insert;
    if(type==='table')rawInsert=insert.replaceAll('|','\\|');
    if(type==='codeBlock'&&insert.includes('\n')){
      const rowIndex=text.lastIndexOf('\n',from-leaf.from-1)+1;
      const offset=leaf.offsets[rowIndex];
      const lineStart=Math.max(source.lastIndexOf('\r',offset-1),source.lastIndexOf('\n',offset-1))+1;
      const prefix=source.slice(lineStart,offset);
      if(!/^[ \t]*$/.test(prefix))continue;
      const newline=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\r|\n/)?.[0]||source.match(/\r\n|\r|\n/)?.[0]||'\n';
      rawInsert=insert.replaceAll('\n',newline+prefix);
    }
    if(rawInsert.length>4096)continue;
    const next=source.slice(0,a)+rawInsert+source.slice(b);
    if(next.length>capacity.MAX_SOURCE_UNITS||!next.isWellFormed())continue;
    const after=project(next);
    if(equalCanonicalProjection(expected,after.doc))return {ok:true,source:next,projection:after,change:{from:a,to:b,insert:rawInsert},
      inverseSource:{from:a,to:a+rawInsert.length,insert:source.slice(a,b)},selection:{from:from+insert.length,to:from+insert.length},
      structural:insert.includes('\n')||rawInsert!==insert||source.slice(a,b)!==text.slice(from-leaf.from,to-leaf.from)};
  }
  return reject();
}

// A list embedded in an explicitly prefixed quote. Edit only sibling items
// that own one unmarked, single-line paragraph. A neighboring subtree must
// survive the independent whole-document comparison.
export function mapQuotedListBoundary(source,p,{action,from,to},project){
  if(from!==to||!['split-list','join-list'].includes(action))return null;
  const block=p.extended?.find(b=>from>b.from&&from<b.to);
  if(!block||p.doc.content[block.index].type!=='blockquote')return null;
  const leaf=block.leaves.find(l=>from>=l.from&&from<=l.to);
  if(!leaf||leaf.path.length<4||leaf.offsets)return reject();
  const expected=copyEditedBlock(p.doc,block.index),root=expected.content[block.index];
  const listPath=leaf.path.slice(0,-3),list=containerNodeAt(root,listPath),i=leaf.path.at(-3);
  if(!['bulletList','orderedList'].includes(list.type))return reject();
  function plainItem(index){
    const item=list.content[index],para=item?.content?.[0],text=para?.content?.[0];
    if(item?.type!=='listItem'||item.attrs?.checked!=null||item.content.length!==1||para.type!=='paragraph'
        ||para.content.length!==1||text.type!=='text'||text.marks?.length)return null;
    return text.text;
  }
  const value=plainItem(i);
  if(!value||source.slice(leaf.start,leaf.start+value.length)!==value)return reject();
  const lineStart=Math.max(source.lastIndexOf('\n',leaf.start-1),source.lastIndexOf('\r',leaf.start-1))+1;
  const prefix=source.slice(lineStart,leaf.start),marker=prefix.match(/^((?: {0,3}> ?)+ *)([-+*]|\d{1,9}[.)]) $/);
  if(!marker)return reject();
  let a=leaf.start+from-leaf.from,b=a,insert,caretPath=[...listPath,i+1,0],caretOffset=0;
  if(action==='split-list'){
    const offset=from-leaf.from;
    if(offset<1||offset>=value.length||list.content.length>=32)return reject();
    const eol=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\r|\n/)?.[0]??source.match(/\r\n|\r|\n/)?.[0]??'\n';
    const nextMarker=list.type==='orderedList'?String(parseInt(marker[2],10)+1)+marker[2].at(-1):marker[2];
    insert=eol+marker[1]+nextMarker+' ';
    const makeItem=text=>({type:'listItem',content:[{type:'paragraph',content:[{type:'text',text}]}]});
    list.content.splice(i,1,makeItem(value.slice(0,offset)),makeItem(value.slice(offset)));
  }else{
    const prev=plainItem(i-1);
    if(from!==leaf.from||!prev)return reject();
    const path=[...listPath,i-1,0,0],before=block.leaves.find(l=>l.path.length===path.length&&path.every((v,k)=>v===l.path[k]));
    if(!before||before.offsets||source.slice(before.start,before.start+prev.length)!==prev)return reject();
    a=before.start+prev.length;b=leaf.start;insert='';
    if(!['\r\n','\r','\n'].some(nl=>source.slice(a,b)===nl+prefix))return reject();
    list.content[i-1].content[0].content[0].text+=value;
    list.content.splice(i,1);caretPath=[...listPath,i-1,0];caretOffset=prev.length;
  }
  const next=source.slice(0,a)+insert+source.slice(b);
  if(next.length>capacity.MAX_SOURCE_UNITS||!next.isWellFormed()||b-a>4096)return reject();
  const projection=project(next);
  if(!equalCanonicalProjection(expected,projection.doc))return reject();
  const caret=containerPosition(projection.doc.content[block.index],block.from,caretPath)+caretOffset;
  return {ok:true,source:next,projection,change:{from:a,to:b,insert},
    inverseSource:{from:a,to:a+insert.length,insert:source.slice(a,b)},selection:{from:caret,to:caret}};
}
