'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
test('format corpus projects common structures and explicitly retains unsupported spelling',async()=>{
 const {projectSource}=await import('../../../apps/desktop/lib/document-source-map.mjs');
 const bytes=fs.readFileSync(path.resolve(__dirname,'../../../examples/format-boundaries.md')),source=bytes.toString('utf8');
 const before=Buffer.from(bytes),projection=projectSource(source);const levels=new Set(),types=new Set();
 function walk(n){types.add(n.type);if(n.type==='heading')levels.add(n.attrs.level);for(const c of n.content||[])walk(c);}walk(projection.doc);
 assert.deepEqual([...levels].sort(),[1,2,3,4,5,6]);for(const name of ['bulletList','orderedList','table','hardBreak','documentImage'])assert(types.has(name),name);
 const text=n=>(n.content||[]).map(c=>c.text||'').join('');
 assert(projection.doc.content.some(n=>n.type==='codeBlock'&&n.attrs.sourceEditable&&n.attrs.language==='javascript'));
 assert(projection.doc.content.some(n=>n.type==='documentPreview'&&n.attrs.kind==='horizontalRule'));
 for(const expected of ['转义文字：*这不是斜体*，# 这不是标题，[这不是链接]。','字符实体与字面量：& < > "；全角空格：甲　乙；不换行空格：甲 乙。']){
   const paragraph=projection.doc.content.find(n=>n.type==='paragraph'&&text(n)===expected);
   assert.ok(paragraph,expected);
   assert(paragraph.content.every(n=>n.type==='text'&&!n.marks?.length));
 }
 assert(projection.doc.content.some(n=>n.type==='codeBlock'&&!n.attrs.sourceEditable&&text(n).startsWith('<details>')));
 assert.deepEqual(fs.readFileSync(path.resolve(__dirname,'../../../examples/format-boundaries.md')),before);
});
