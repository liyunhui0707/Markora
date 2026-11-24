import {continueInProse} from './document-prose-continuation.mjs';
import capacity from './document-capacity.js';
const {MAX_SOURCE_UNITS} = capacity;
import {TABLE_ROWS,TABLE_COLUMNS,tableCell} from './document-table-source.mjs';
import sourceEdits from './document-source-edit.js';
import {equalCanonicalProjection} from './document-canonical-equal.mjs';
const reject=()=>({ok:false,code:'unsafe-format-range'});
export const tableActions=['insert-table','table-add-row','table-delete-row','table-add-column','table-delete-column','table-before','table-exit'];

// A plain rectangular TSV replaces whole cells starting at the caret. Source
// padding, pipe separators, row endings and every cell outside it stay exact.
export function mapTablePaste(source,p,{from,to,insert},project){
  if(!Number.isSafeInteger(from)||from!==to||typeof insert!=='string'||insert.length>4096
      ||!insert.includes('\t')||!insert.isWellFormed()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u2028\u2029]/u.test(insert))return reject();
  const rows=insert.split(/\r\n|\r|\n/).map(row=>row.split('\t')),width=rows[0].length;
  if(width<2||width>TABLE_COLUMNS||rows.length>TABLE_ROWS||rows.some(r=>r.length!==width))return reject();
  const index=p.blocks.findIndex(b=>b?.cells&&from>b.from&&from<b.to);
  if(index<0)return reject();
  const block=p.blocks[index],first=block.cells.flat().find(c=>from>=c.from&&from<=c.to);
  if(!first||first.tableRow+rows.length>block.cells.length||first.tableCol+width>block.cells[0].length)return reject();
  const expected=structuredClone(p.doc),patches=[];
  for(const [r,values] of rows.entries()){
    for(const [c,value] of values.entries()){
      const cell=block.cells[first.tableRow+r][first.tableCol+c],old=source.slice(cell.sourceFrom,cell.sourceTo);
      const para=expected.content[index].content[cell.tableRow].content[cell.tableCol].content[0];
      if(para.content.some(n=>n.type!=='text'||n.marks?.length)||cell.text!==old)return reject();
      const pad=old.match(/^ */)[0],tail=old.slice(pad.length).match(/ *$/)[0];
      const text=pad+value+tail;
      para.content=text?[{type:'text',text}]:[];
      patches.push({from:cell.sourceFrom,to:cell.sourceTo,text});
    }
  }
  const start=patches[0].from,end=patches.at(-1).to;
  if(end-start>4096)return reject();
  let replacement='',at=start;
  for(const patch of patches){
    replacement+=source.slice(at,patch.from)+patch.text;at=patch.to;
  }
  if(replacement.length>4096)return reject();
  const mapped=sourceEdits.sourceChange(source,{from:start,to:end,insert:replacement});
  if(!mapped.ok)return reject();
  const projection=project(mapped.source);
  if(!equalCanonicalProjection(expected,projection.doc))return reject();
  const last=projection.blocks[index]?.cells?.[first.tableRow+rows.length-1]?.[first.tableCol+width-1];
  if(!last)return reject();
  return {...mapped,projection,inverseSource:mapped.inverse,selection:{from:last.to,to:last.to}};
}

// Main and renderer run the same bounded mapper. No new IPC, save capability,
// arbitrary source offsets or whole-document serializer is introduced.
export function mapTableEdit(source,p,{action,from,to},project) {
  if(from!==to)return reject();
  const index=p.blocks.findIndex(b=>b&&from>b.from&&from<b.to);if(index<0)return reject();
  const block=p.blocks[index],expected=structuredClone(p.doc),node=expected.content[index];
  const nl=source.slice(block.sourceFrom,block.sourceTo).match(/\r\n|\n|\r/)?.[0]||source.match(/\r\n|\n|\r/)?.[0]||'\n';
  let a,b,text,targetIndex=index,targetRow=0,targetCol=0;
  if(action==='insert-table') {
    if(node.type!=='paragraph'||!p.spans.some(s=>s.blockIndex===index&&s.textOffset===undefined&&from>=s.from&&from<=s.to))return reject();
    const created={type:'table',content:[{type:'tableRow',content:[tableCell('列 1',true),tableCell('列 2',true)]},
      ...Array.from({length:2},()=>({type:'tableRow',content:[tableCell('',false),tableCell('',false)]}))]};
    text=['|列 1|列 2|','|---|---|','|||','|||'].join(nl);a=b=block.sourceTo;
    if(!node.content.length){expected.content[index]=created;a=block.sourceFrom;}
    else {text=nl+nl+text;expected.content.splice(index+1,0,created);targetIndex++;}
  } else {
    if(!block.cells)return reject();
    const cell=block.cells.flat().find(c=>from>=c.from&&from<=c.to);if(!cell)return reject();
    targetRow=cell.tableRow;targetCol=cell.tableCol;
    const rows=node.content.length,cols=node.content[0].content.length;
    const lines=block.tableLines.map(l=>({...l,values:[...l.values]}));
    a=block.sourceFrom;b=block.sourceTo;
    if(action==='table-add-row') {
      if(rows>=TABLE_ROWS)return reject();targetRow++;targetCol=0;
      const i=targetRow+1,previous=lines[i-1],eol=previous.eol||nl;
      lines.splice(i,0,{values:Array(cols).fill(''),eol:previous.eol});previous.eol=eol;
      node.content.splice(targetRow,0,{type:'tableRow',content:node.content[0].content.map(c=>tableCell('',false,c.attrs.align))});
    } else if(action==='table-delete-row') {
      if(targetRow===0)return reject();const i=targetRow+1;
      if(i===lines.length-1)lines[i-1].eol=lines[i].eol;
      lines.splice(i,1);node.content.splice(targetRow,1);targetRow=Math.min(targetRow,rows-2);
    } else if(action==='table-add-column'||action==='table-delete-column') {
      const add=action==='table-add-column';if(add?cols>=TABLE_COLUMNS:cols<=1)return reject();
      const col=targetCol+(add?1:0);
      for(const [i,line] of lines.entries())line.values.splice(col,add?0:1,...(add?[i===1?'---':'']:[]));
      for(const [i,row] of node.content.entries())row.content.splice(col,add?0:1,...(add?[tableCell('',i===0)]:[]));
      targetCol=add?col:Math.min(col,cols-2);
    } else if(action==='table-exit'||action==='table-before') {
      return continueInProse(source,p,index,action==='table-before',project);
    } else return reject();
    if(text===undefined)text=lines.map(l=>'|'+l.values.join('|')+'|'+l.eol).join('');
  }
  // Return one minimal source splice; untouched cell spelling, delimiters and
  // line endings stay byte-identical. History retains the exact inverse.
  let old=source.slice(a,b),start=0,end=old.length,last=text.length;
  while(start<end&&start<last&&old[start]===text[start])start++;
  const splits=(s,n)=>/[\uD800-\uDBFF]/.test(s[n-1]||'')&&/[\uDC00-\uDFFF]/.test(s[n]||'');
  if(splits(old,start)||splits(text,start))start--;
  while(end>start&&last>start&&old[end-1]===text[last-1]){end--;last--;}
  if(splits(old,end)||splits(text,last)){end++;last++;}
  b=a+end;a+=start;text=text.slice(start,last);
  if(text.length>4096||b-a>4096)return reject();
  const next=source.slice(0,a)+text+source.slice(b);if(next.length>MAX_SOURCE_UNITS)return reject();
  const projection=project(next);if(JSON.stringify(projection.doc)!==JSON.stringify(expected))return reject();
  const target=projection.blocks[targetIndex],pos=target?.cells?.[targetRow]?.[targetCol]?.from;
  if(!Number.isSafeInteger(pos))return reject();
  return {ok:true,source:next,projection,change:{from:a,to:b,insert:text},inverseSource:{from:a,to:a+text.length,insert:source.slice(a,b)},selection:{from:pos,to:pos}};
}
