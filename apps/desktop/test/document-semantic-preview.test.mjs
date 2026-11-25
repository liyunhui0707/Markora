import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';

const schema=getSchema(documentEditorExtensions());
test('a leading rule is displayed unless a complete frontmatter frame is present',()=>{
 const source='---\n\nAfter';
 const p=projectSource(source);assert.equal(p.doc.content[0].type,'documentPreview');
 assert.equal(p.doc.content[0].attrs.kind,'horizontalRule');assert(p.spans.some(s=>s.text==='After'));
 const frontmatter=projectSource('---\ntitle: Keep\n---\n\nAfter');
 assert.equal(frontmatter.doc.content[0].attrs.kind,'metadata');
 assert.match(JSON.stringify(frontmatter.doc.content[0].attrs.tree),/title: Keep/);
});
test('rules, decoded text, autolinks and reference links display semantically with protected structural boundaries',()=>{
 const cases=[['---','horizontalRule'],['Escaped \\*star\\* and &amp; entity.','paragraph'],
  ['Visit <https://example.test> or www.example.test.','paragraph'],
  ['[Label][ref]\n\n[ref]: https://example.test "Keep"','paragraph'],
  ['> Outer\n>\n> > Nested\n>\n> - child','blockquote']];
 for(const [source,kind] of cases){
  const p=projectSource(source),node=p.doc.content[0];
  assert.equal(node.attrs?.kind||node.type,kind);
  schema.nodeFromJSON(p.doc).check();
  assert.equal(mapTextEdit(source,{from:0,to:1,insert:'replace'}).ok,false);
 }
 const escaped=projectSource(cases[1][0]).doc.content[0];
 assert.match(JSON.stringify(escaped),/Escaped \*star\* and & entity/);
 const ref=projectSource(cases[3][0]);assert.equal(ref.doc.content.length,1);
 assert.match(JSON.stringify(ref.doc),/https:\/\/example.test/);
});
test('references resolve definitions inside containers without displaying definition syntax',()=>{
 const p=projectSource('[Label][id]\n\n> [id]: https://example.test/nested\n>\n> Quote');
 const reference=p.doc.content[0];assert.equal(reference.type,'paragraph');
 assert.match(JSON.stringify(reference),/https:\/\/example.test\/nested/);
 assert(!JSON.stringify(p.doc).includes('[id]:'));
});
test('semantic previews retain neighboring exact edits and never execute HTML or fetch images',()=>{
 const source='Before\r\n\r\nEscaped \\*text\\* &amp;.\r\n\r\nAfter';
 const p=projectSource(source),span=p.spans.find(s=>s.text==='After');
 const r=mapTextEdit(source,{from:span.to,to:span.to,insert:'!'});
 assert(r.ok);assert.equal(r.source,source+'!');
 assert.deepEqual(r.projection.doc.content[1],p.doc.content[1]);
 const html=projectSource('<script>alert(1)</script>').doc.content[0];
 assert.equal(html.type,'codeBlock');
 const nested=projectSource('> [text](javascript:alert(1))\n>\n> - ![remote](https://example.test/x.png)').doc;
 const text=JSON.stringify(nested);assert(!text.includes('"type":"image"'));
 const preview=nested.content.find(n=>n.type==='documentPreview');assert(preview);
 const spec=JSON.stringify(schema.nodes.documentPreview.spec.toDOM(schema.nodeFromJSON(preview)));
 assert.doesNotMatch(spec,/"(?:href|src|onclick)":/);
 assert.doesNotMatch(spec,/\["(?:script|img|iframe)"/);
});

test('find joins visible inline math with adjacent prose without granting replacement authority',async()=>{
 const {findDocumentText}=await import('../lib/document-find-view.mjs');
 const doc=schema.nodeFromJSON(projectSource('总量x。\n\n总量$x$。\n\n总量\n\nx。').doc);
 const hits=findDocumentText(doc,'总量x。').matches;
 assert.equal(hits.length,2);
 assert(!hits[0].preview);
 assert.equal(hits[1].preview,true);
});

test('wiki spelling survives neighboring entities while escaped or encoded brackets stay literal',()=>{
 const source=String.raw`甲 &amp; \* 到 [[#小结|结论]] 后 &amp; 尾。\[[#小结]] &#91;&#91;#小结]]`;
 const projection=projectSource(source);
 const atoms=projection.doc.content[0].content.filter(n=>n.type==='inlineDocumentPreview');
 assert.equal(atoms.length,1);
 assert.equal(atoms[0].attrs.tree.target,'#小结');
 const leaf=projection.extended[0].leaves.at(-1);
 const edit=mapTextEdit(source,{from:leaf.from+5,to:leaf.from+6,insert:'改'});
 assert.equal(edit.source,source.replace('尾','改'));
});

test('editable leaves inside mixed tables, lists and quotes preserve neighboring previews and exact source',async()=>{
 const {findDocumentText}=await import('../lib/document-find-view.mjs');
 for(const source of [
   '| 项目 | 数额 |\r\n| :--- | ---: |\r\n| 普通 | $x$ |',
   '> 普通 与 $x$', '- 普通 与 [[#小结|结论]]',
   '> - 普通 与 [^a]\r\n\r\n[^a]: 注释'
 ]){
   const doc=schema.nodeFromJSON(projectSource(source).doc);doc.check();
   const hit=findDocumentText(doc,'普通').matches[0];
   assert.ok(hit&&!hit.preview,source);
   const edit=mapTextEdit(source,{from:hit.from,to:hit.to,insert:'中文e\u0301👩‍💻'});
   assert.equal(edit.source,source.replace('普通','中文e\u0301👩‍💻'));
   const inverse=edit.inverseSource;
   assert.equal(edit.source.slice(0,inverse.from)+inverse.insert+edit.source.slice(inverse.to),source);
 }
});

test('a cleared ordinary cell next to a formula can receive fresh input',async()=>{
 const {findDocumentText}=await import('../lib/document-find-view.mjs');
 const source='| 名称 | 值 |\n|---|---|\n| 旧 | $x$ |';
 const hit=findDocumentText(schema.nodeFromJSON(projectSource(source).doc),'旧').matches[0];
 const cleared=mapTextEdit(source,{...hit,insert:''});
 assert.equal(cleared.source,source.replace('旧',''));
 assert.equal(mapTextEdit(cleared.source,{...cleared.selection,insert:'新'}).source,source.replace('旧','新'));
});
