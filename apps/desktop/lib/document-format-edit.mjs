import {mapWrappedFormat} from './document-wrapped-format.mjs';
import {mapContainerFormat} from './document-container-edit.mjs';
import {mapArticleFormat} from './document-article-source.mjs';
import {mapCombinedMark} from './document-tree-edit.mjs';
import capacity from './document-capacity.js';
const {MAX_SOURCE_UNITS} = capacity;
import {mapImageEdit} from './document-image-edit.mjs';
import {tableActions,mapTableEdit,mapTablePaste} from './document-table-edit.mjs';
import {mapListEdit} from './document-list-edit.mjs';
import {mapStructuredEdit} from './document-structured-edit.mjs';
import { mapLinkEdit } from './document-link-edit.mjs';
import { mapBoundaryEdit } from './document-boundary-edit.mjs';
import { projectSource, inlineRowRange, spanBlock } from './document-source-map.mjs';
import {equalCanonicalProjection} from './document-canonical-equal.mjs';
import {mapQuotedListBoundary} from './document-extended-source.mjs';
const reject = () => ({ok:false,code:'unsafe-format-range'});
const actions = ['paragraph','heading-1','heading-2','heading-3','heading-4','heading-5','heading-6','block-shortcut','fence-shortcut','blockquote','code-block','split-quote','join-quote','exit-block','bold','italic','code','bullet-list','ordered-list','split-list','join-list','split-heading','split-paragraph','join-paragraph','task-list','task-shortcut','toggle-task','indent-list','outdent-list'];
const paragraph = content => ({type:'paragraph',content});
const item = content => ({type:'listItem',content:[paragraph(content)]});
const inline = text => text ? [{type:'text',text}] : [];
const splits = (s,n) => /[\uD800-\uDBFF]/.test(s[n-1]||'') && /[\uDC00-\uDFFF]/.test(s[n]||'');
function merge(nodes) {
  const result=[];
  for(const node of nodes.filter(n=>n.text)) {
    const last=result.at(-1);
    if(last && JSON.stringify(last.marks)===JSON.stringify(node.marks)) last.text+=node.text;
    else result.push({...node});
  }
  return result;
}
// Explicit bounded commands. No caller-provided source, source offsets, path or serializer.
function mapInlineTyping(source,{action,from,to,insert}){
  if(!Number.isSafeInteger(from)||from!==to||typeof insert!=='string'||insert.length>2||!insert.isWellFormed()
      ||(Array.from(insert).length!==1&&!(action==='autolink-input'&&insert===''))||/[\p{Cc}\u2028\u2029]/u.test(insert)||source.length+insert.length>MAX_SOURCE_UNITS)return reject();
  const closing={ '*':['bold','italic'],'_':['bold','italic'],'~':['strike'],'`':['code'],')':['link'] };
  if(action==='inline-close'&&!Object.hasOwn(closing,insert))return reject();
  const original=projectSource(source);
  const extended=original.extended?.find(b=>from>b.from&&from<b.to);
  const span=original.spans.find(s=>from>s.from&&from<=s.to)??original.spans.find(s=>from===s.from);
  const leaf=span??extended?.leaves.find(l=>from>=l.from&&from<=l.to);
  if(!leaf)return reject();
  const index=span?.blockIndex??extended.index, top=original.blocks[index]??extended;
  const offset=from-leaf.from, point=span?span.sourceFrom+offset:leaf.offsets?leaf.offsets[offset]:leaf.start+offset;
  if(!Number.isSafeInteger(point))return reject();
  const range=inlineRowRange(source,point);
  if(!range||range.end-range.start>4096)return reject();
  const raw=source.slice(range.start,range.end);
  const path=[];
  function within(node,start){
    if(node.type==='paragraph'||node.type==='heading')return {node,start};
    if(!['bulletList','orderedList','listItem','blockquote'].includes(node.type))return null;
    let pos=start+1;
    for(const [i,child] of node.content.entries()){
      const size=sizeOf(child);
      if(from>pos&&from<pos+size){path.push(i);return within(child,pos);}
      pos+=size;
    }
    return null;
  }
  function sizeOf(n){
    if(n.type==='text')return n.text.length;
    return n.content?2+n.content.reduce((sum,c)=>sum+sizeOf(c),0):1;
  }
  const row=within(original.doc.content[index],top.from);
  if(!row||!row.node.content.every(n=>n.type==='text'))return reject();
  const old=paragraph(row.node.content),before=projectSource(raw).doc.content;
  if(before.length!==1||!equalCanonicalProjection(old,before[0]))return reject();
  const offsetInRow=from-row.start-1,visible=old.content.map(n=>n.text).join('');
  const suffix=visible.slice(offsetInRow);
  // A caret just after a closed frame belongs outside its closing delimiter.
  let end=suffix?point:range.end;
  if(suffix&&span&&from===span.to&&action==='inline-after')
    end=span.frames?.[0]?.to??span.linkSource?.to??(point+(span.bold?2:span.italic||span.code?1:0));
  if(end<range.start||end>range.end)return reject();
  const removed=action==='autolink-input'&&!insert?Array.from(source.slice(range.start,end)).at(-1):'';
  if(removed===undefined)return reject();
  const at=end-removed.length, nextRaw=source.slice(range.start,at)+insert+source.slice(end,range.end);
  const local=projectSource(nextRaw).doc.content;
  if(local.length!==1||local[0].type!=='paragraph'||!local[0].content.every(n=>n.type==='text'))return reject();
  const children=local[0].content,afterText=children.map(n=>n.text).join('');
  if(!afterText.endsWith(suffix))return reject();
  const caretOffset=afterText.length-suffix.length;
  let length=0;
  const previous=children.find(n=>(length+=n.text.length)>=caretOffset);
  if(action==='inline-close'){
    if(caretOffset<1||!previous?.marks?.some(m=>closing[insert].includes(m.type)))return reject();
  }else{
    const auto=action==='autolink-input';
    const bare=(node,mark)=>mark.type==='link'&&[node.text,'http://'+node.text,'mailto:'+node.text].includes(mark.attrs.href);
    if(auto&&![...old.content,...children].some(n=>n.marks?.some(m=>bare(n,m))))return reject();
    if(!auto&&(!old.content.some(n=>n.marks?.length)||previous?.marks?.length))return reject();
    if(afterText!==visible.slice(0,offsetInRow-removed.length)+insert+suffix)return reject();
    // Compare marks at every surviving UTF-16 unit. Only a bare address may
    // acquire or drop its automatic link as the literal characters change.
    function markRuns(nodes){
      const runs=[];
      for(const node of nodes){
        const marks=(node.marks??[]).filter(mark=>!auto||!bare(node,mark));
        const key=JSON.stringify(marks);
        for(let i=0;i<node.text.length;i++)runs.push(key);
      }
      return runs;
    }
    const expectedMarks=markRuns(old.content),actualMarks=markRuns(children);
    expectedMarks.splice(offsetInRow-removed.length,removed.length,...Array(insert.length).fill('[]'));
    if(expectedMarks.some((key,i)=>key!==actualMarks[i]))return reject();
  }
  const next=source.slice(0,at)+insert+source.slice(end),projection=projectSource(next);
  const expected={...original.doc,content:original.doc.content.slice()};
  expected.content[index]=structuredClone(expected.content[index]);
  let target=expected.content[index];for(const step of path)target=target.content[step];
  target.content=children;
  if(!equalCanonicalProjection(expected,projection.doc))return reject();
  const caret=row.start+1+caretOffset;
  return {ok:true,source:next,projection,change:{from:at,to:end,insert},
    inverseSource:{from:at,to:at+insert.length,insert:removed},selection:{from:caret,to:caret}};
}

export function mapFormatEdit(source, command) {
  if(!command || Object.getPrototypeOf(command)!==Object.prototype) return reject();
  if(['inline-close','inline-after','autolink-input','table-paste'].includes(command.action)){
    if(Object.keys(command).length!==4||!['action','from','to','insert'].every(k=>Object.hasOwn(command,k)))return reject();
    if(command.action==='table-paste')return mapTablePaste(source,projectSource(source),command,projectSource);
    return mapInlineTyping(source,command);
  }
  if(['set-image','remove-image','image-exit'].includes(command.action)) return mapImageEdit(source,command);
  if(['set-link','remove-link'].includes(command.action)) return mapLinkEdit(source,command);
  if(Object.keys(command).length!==3
      || Object.keys(command).some(k=>!['action','from','to'].includes(k))) return reject();
  const {action,from,to}=command;
  if(![...actions,'list-paragraph',...tableActions].includes(action) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from<1 || to<from) return reject();
  const p=projectSource(source);
  const quotedList=mapQuotedListBoundary(source,p,command,projectSource);if(quotedList)return quotedList;
  const container=mapContainerFormat(source,p,command,projectSource);if(container)return container.ok?container:{...container,code:'unsafe-format-range'};
  const wrapped=mapWrappedFormat(source,p,command,projectSource);if(wrapped)return wrapped;
  const article=mapArticleFormat(source,p,command,projectSource);if(article)return article;
  const combined=mapCombinedMark(source,p,command,projectSource);if(combined)return combined;
  if(tableActions.includes(action))return mapTableEdit(source,p,command,projectSource);
  if(p.blocks.some(b=>b?.cells&&from>b.from&&to<b.to))return reject();
  const selectedList=p.blocks.find(b=>b?.items&&from>b.from&&to<b.to);
  const structuredList=selectedList?.items.some(r=>r.path.length>1||r.checked!==null);
  if(['task-shortcut','toggle-task','indent-list','outdent-list'].includes(action)
      ||(action==='task-list'&&selectedList)||(['split-list','join-list'].includes(action)&&structuredList))
    return mapListEdit(source,p,command,projectSource);
  if(['split-list','join-list','split-paragraph','join-paragraph','split-heading'].includes(action)) return mapBoundaryEdit(source,p,command,projectSource);
  const index=p.blocks.findIndex(b=>b && from>b.from && to<b.to);
  if(index<0) return reject();
  const structured=p.blocks[index].quoteRows||p.blocks[index].codeBody;
  if(['blockquote','code-block','split-quote','join-quote','exit-block','fence-shortcut'].includes(action)
      ||(structured&&action==='paragraph')||(action==='block-shortcut'&&/^(?:>|```[A-Za-z0-9_+-]{0,32})$/.test(source.slice(p.blocks[index].sourceFrom,p.blocks[index].sourceTo))))
    return mapStructuredEdit(source,p,command,projectSource);
  const block=p.blocks[index], node=p.doc.content[index], expected=structuredClone(p.doc);
  const list=!!block.items, selected=p.spans.find(s=>s.blockIndex===index && from>=s.from && to<=s.to);
  let a=block.sourceFrom,b=block.sourceTo,text,offset=from-block.from-1, targetIndex=index,targetItem=null,targetQuote=null;
  const nl=source.slice(a,b).match(/\r\n|\n|\r/)?.[0] || source.match(/\r\n|\n|\r/)?.[0] || '\n';
  if(action==='block-shortcut') {
    if(node.type!=='paragraph'||!selected||from!==to||selected.textOffset!==undefined
        ||node.content.length!==1||selected.bold||selected.italic||selected.code||selected.link) return reject();
    const prefix=selected.text.slice(0,from-selected.from), body=selected.text.slice(from-selected.from);
    if(!/^(?:#{1,6}|[-+*]|\d{1,9}[.)])$/.test(prefix)||source.slice(a,b)!==selected.text) return reject();
    a=b=selected.sourceFrom+prefix.length;text=' ';offset=0;
    if(prefix[0]==='#') expected.content[index]={type:'heading',attrs:{level:prefix.length},content:inline(body)};
    else {
      const ordered=/^\d/.test(prefix);
      expected.content[index]={type:ordered?'orderedList':'bulletList',...(ordered?{attrs:{start:parseInt(prefix,10)}}:{}),content:[item(inline(body))]};targetItem=0;
    }
  } else if(['bold','italic','code'].includes(action)) {
    if(!selected || selected.link || from===to || selected.textOffset!==undefined || ['bold','italic','code'].some(mark=>mark!==action&&selected[mark])) return reject();
    const start=from-selected.from,end=to-selected.from,value=selected.text.slice(start,end);
    if(splits(selected.text,start)||splits(selected.text,end)||!value.trim()||value.trim()!==value) return reject();
    const parent=spanBlock({doc:expected},selected), child=selected.inlineIndex??selected.childIndex;
    a=selected.sourceFrom+start;b=selected.sourceFrom+end;
    const marker=action==='bold'?'**':action==='italic'?'*':'`';
    if(selected[action]) {
      if(start!==0||end!==selected.text.length) return reject();
      a-=marker.length;b+=marker.length;text=value; parent.content.splice(child,1,{type:'text',text:value});
    } else {
      text=marker+value+marker;
      parent.content.splice(child,1,...inline(selected.text.slice(0,start)),{type:'text',text:value,marks:[{type:action}]},...inline(selected.text.slice(end)));
    }
    parent.content=merge(parent.content);
    targetItem=selected.itemIndex??null;targetQuote=selected.quoteIndex??null; offset=to-(list?block.items[targetItem].from:targetQuote!==null?block.quoteRows[targetQuote].from:block.from+1);
  } else if(list) {
    if(block.items.some(r=>r.path.length>1||r.checked!==null))return reject();
    if(!['paragraph','bullet-list','ordered-list'].includes(action)) return reject();
    const rows=block.items.map(row=>source.slice(row.bodyFrom,row.sourceTo));
    // Block conversion owns only these markers and their intervening separators.
    if(action==='paragraph'||(action==='bullet-list'&&node.type==='bulletList')||(action==='ordered-list'&&node.type==='orderedList')) {
      text=rows.join(nl+nl);expected.content.splice(index,1,...node.content.map(n=>paragraph(n.content[0].content)));
      targetIndex=index+(selected?.itemIndex??0);offset=selected?from-block.items[selected.itemIndex].from:0;
    } else {
      text=rows.map((s,i)=>(action==='ordered-list'?`${i+1}. `:'- ')+s).join(nl);
      expected.content[index]={type:action==='ordered-list'?'orderedList':'bulletList',...(action==='ordered-list'?{attrs:{start:1}}:{}),content:node.content};
      targetItem=selected?.itemIndex??0;offset=selected?from-block.items[targetItem].from:0;
    }
  } else {
    if(!['paragraph','heading'].includes(node.type)||!selected||selected.textOffset!==undefined) return reject();
    const raw=source.slice(a,b),prefix=node.type==='heading'?raw.match(/^#{1,6}[ \t]+/)?.[0]:'';
    if(prefix===undefined || /[\r\n]/.test(raw)) return reject();
    const body=raw.slice(prefix.length);
    if(body.trim()!==body) return reject();
    if(action==='paragraph') {text=body;expected.content[index]=paragraph(node.content);}
    else if(action.startsWith('heading-')) {text='#'.repeat(Number(action.at(-1)))+' '+body;expected.content[index]={type:'heading',attrs:{level:Number(action.at(-1))},content:node.content};}
    else {
      text=(action==='ordered-list'?'1. ':action==='task-list'?'- [ ] ':'- ')+body;
      expected.content[index]={type:action==='ordered-list'?'orderedList':'bulletList',...(action==='ordered-list'?{attrs:{start:1}}:{}),content:[action==='task-list'?{type:'listItem',attrs:{checked:false},content:[paragraph(node.content)]}:item(node.content)]};targetItem=0;
    }
  }
  if(typeof text!=='string'||text.length>4096||b-a>4096) return reject();
  const next=source.slice(0,a)+text+source.slice(b);
  if(next.length>MAX_SOURCE_UNITS) return reject();
  const projection=projectSource(next);
  if(JSON.stringify(projection.doc)!==JSON.stringify(expected)) return reject();
  const target=projection.blocks[targetIndex];
  if(!target) return reject();
  const position=(targetItem!==null?target.items?.[targetItem]?.from:targetQuote!==null?target.quoteRows?.[targetQuote]?.from:target.from+1)+offset;
  if(!Number.isSafeInteger(position)||position>=target.to) return reject();
  return {ok:true,source:next,projection,change:{from:a,to:b,insert:text},
    inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},selection:{from:['bold','italic','code'].includes(action)?position-(to-from):position,to:position}};
}
