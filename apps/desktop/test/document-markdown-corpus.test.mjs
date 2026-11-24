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
