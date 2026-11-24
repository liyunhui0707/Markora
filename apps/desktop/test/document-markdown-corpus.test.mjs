import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getSchema} from '@tiptap/core';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource} from '../lib/document-source-map.mjs';

const fixtures=new URL('./fixtures/markdown-spec/',import.meta.url);
const schema=getSchema(documentEditorExtensions());
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function html(spec,content=''){
  if(spec===0)return content;
  if(typeof spec==='string')return escape(spec);
  const [tag,...args]=spec;
  const attrs=args[0]&&typeof args[0]==='object'&&!Array.isArray(args[0])?args.shift():{};
  assert(!['script','iframe','object','embed','style'].includes(tag));
  assert(!Object.keys(attrs).some(key=>/^(?:on|href$|src$|srcdoc$)/i.test(key)),'unexpected active attribute on '+tag);
  const link='data-document-link' in attrs?' data-document-link=""':'';
  return '<'+tag+link+'>'+args.map(child=>html(child,content)).join('')+( ['img','hr','br','input'].includes(tag)?'':'</'+tag+'>');
}
function output(node){
  if(node.type.name==='doc')return node.content.content.map(output).join('');
  if(node.type.name==='listItem'&&typeof node.attrs.checked==='boolean')
    return '<li><input type="checkbox">'+node.content.content.map(output).join('')+'</li>';
  let fragment=node.isText?escape(node.text):html(node.type.spec.toDOM(node),node.content.content.map(output).join(''));
  for(const mark of [...node.marks].reverse())fragment=html(mark.type.spec.toDOM(mark,true),fragment);
  return fragment;
}
test('official CommonMark and GFM examples produce valid editor trees and checked visible semantics',()=>{
 const rows=[];
 for(const [suite,count] of [['commonmark-0.31.2',652],['gfm-0.29',677]]){
  const cases=readFileSync(new URL(suite+'.jsonl',fixtures),'utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
  assert.equal(cases.length,count);
  for(const [index,[markdown,expected]] of cases.entries()){
   const doc=schema.nodeFromJSON(projectSource(markdown).doc);doc.check();
   rows.push(JSON.stringify([suite,index+1,expected,output(doc)]));
  }
 }
 const result=spawnSync('python3',[fileURLToPath(new URL('compare.py',fixtures))],{input:rows.join('\n'),encoding:'utf8',maxBuffer:4000000});
 assert.equal(result.status,0,result.stderr);
 const diffs=result.stdout.trimEnd().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 if(process.env.MARKDOWN_SHOW_DIFFERENCES)for(const diff of diffs)console.log(JSON.stringify(diff));
 const expected=JSON.parse(readFileSync(new URL('differences.json',fixtures),'utf8'));
 assert.deepEqual(Object.keys(expected).sort(),['commonmark-0.31.2','gfm-0.29']);
 for(const [suite,cases] of Object.entries(expected)){
   assert.deepEqual(diffs.filter(row=>row[0]===suite).map(row=>row[1]),Object.values(cases).flat().sort((a,b)=>a-b),suite);
 }
});

test('reviewed divergences retain their exact product tree, including attributes and code whitespace',()=>{
 const snapshots=readFileSync(new URL('reviewed-projections.jsonl',fixtures),'utf8').trimEnd().split('\n').map(JSON.parse);
 const differences=JSON.parse(readFileSync(new URL('differences.json',fixtures)));
 for(const [suite,groups] of Object.entries(differences)){
   const cases=readFileSync(new URL(suite+'.jsonl',fixtures),'utf8').trimEnd().split('\n').map(JSON.parse);
   const reviewed=new Set();
   for(const [name,number,expected] of snapshots){
     if(name!==suite)continue;
     assert(!reviewed.has(number));reviewed.add(number);
     assert.deepEqual(projectSource(cases[number-1][0]).doc,expected,suite+' #'+number);
   }
   for(const number of Object.values(groups).flat())assert(reviewed.has(number),suite+' #'+number);
 }
 assert.equal(snapshots.length,213);
});

test('edit visible text in representative official examples and reopen with exact surrounding bytes',async()=>{
 const {mapTextEdit}=await import('../lib/document-source-map.mjs');
 const {findDocumentText}=await import('../lib/document-find-view.mjs');
 const cases={
   'commonmark-0.31.2':[[62,'foo'],[80,'bar'],[228,'Foo'],[350,'foo'],[482,'link'],[633,'baz']],
   'gfm-0.29':[[198,'baz'],[200,'az'],[279,'bar'],[280,'bim'],[491,'Hi']],
 };
 for(const [suite,edits] of Object.entries(cases)){
   const rows=readFileSync(new URL(suite+'.jsonl',fixtures),'utf8').trimEnd().split('\n').map(JSON.parse);
   for(const [number,word] of edits){
     const source=rows[number-1][0].replaceAll('\n','\r\n'),label=suite+' #'+number;
     const doc=schema.nodeFromJSON(projectSource(source).doc);
     const hit=findDocumentText(doc,word).matches[0];assert.ok(hit&&!hit.preview,label);
     const change=mapTextEdit(source,{from:hit.from,to:hit.to,insert:'汉e\u0301😀'});
     assert.ok(change.ok,label);
     assert.equal(change.source,source.replace(word,'汉e\u0301😀'),label);
     const reopened=schema.nodeFromJSON(projectSource(change.source).doc);reopened.check();
     assert.equal(findDocumentText(reopened,'汉e\u0301😀').total,1,label);
     const undo=change.inverseSource??{from:change.change.from,to:change.change.from+change.change.insert.length,
       insert:source.slice(change.change.from,change.change.to)};
     assert.equal(change.source.slice(0,undo.from)+undo.insert+change.source.slice(undo.to),source,label);
   }
 }
});
