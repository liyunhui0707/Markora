import test from 'node:test';
import assert from 'node:assert/strict';
import {getSchema} from '@tiptap/core';
import {documentEditorExtensions} from '../lib/document-editor-extensions.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';
import {findDocumentText} from '../lib/document-find-view.mjs';
import {documentHeadings} from '../lib/document-reading-view.mjs';

const schema=getSchema(documentEditorExtensions());
test('GFM preview uses the header width, alignment and header cells',()=>{
  const source='| 名称 | 数量 |\n| :--- | ---: |\n| 一个 |\n| 两个 | 3 | EXTRA |';
  const {tree}=projectSource(source).doc.content[0].attrs;
  const [head,body]=tree.children;
  assert.equal(head.tag,'thead');
  assert.deepEqual(head.children[0].children.map(n=>[n.tag,n.align]),[['th','left'],['th','right']]);
  assert.deepEqual(body.children.map(n=>n.children.length),[2,2]);
  assert.equal(body.children[0].children[1].children.length,0);
  assert(!JSON.stringify(tree).includes('EXTRA'));
});
test('rendered heading and preview text can be found and located',()=>{
  const doc=schema.nodeFromJSON(projectSource('项目说明\n====\n\n费用 &amp; 说明').doc);
  assert.equal(findDocumentText(doc,'说明').total,2);
  assert.equal(documentHeadings(doc)[0].title,'项目说明');
});
test('opening thematic rules around body prose do not imply YAML metadata',()=>{
  const p=projectSource('---\n\n正文\n\n---');
  assert.deepEqual(p.doc.content.map(n=>n.attrs?.kind||n.type),['horizontalRule','paragraph','horizontalRule']);
  for(const eol of ['\r\n','\n','\r']){
    const between=lines=>projectSource(['---',...lines,'---'].join(eol)).doc.content[0].attrs.kind;
    assert.equal(between(['','时间: 下午','','另一段','']),'horizontalRule');
    assert.equal(between(['# 属性','时间: 下午']),'metadata');
  }
});

test('edits in extended inline structures patch only the selected source text',()=>{
  for(const [raw,label] of [['前 &amp; 后','后'],['前 ~~旧文~~ 后','旧文'],['用 ``a`b`` 写','b'],['见 [说明][r]\n\n[r]: /doc','说明'],['标题\n====','标题'],['前 \\* 后','后']]){
    const projection=projectSource(raw), doc=schema.nodeFromJSON(projection.doc);
    let at;doc.descendants((n,pos)=>{if(n.isText && n.text.includes(label))at=pos+n.text.indexOf(label);});
    assert.ok(Number.isInteger(at),raw);
    const edit=mapTextEdit(raw,{from:at,to:at+label.length,insert:'新'});
    assert.equal(edit.ok,true,raw);
    assert.equal(edit.source,raw.replace(label,'新'));
  }
});

test('extensions expose inert previews with exact source regions',()=>{
  const raw='---\ntitle: 笔记\n---\n\n公式 $x^2$ 和 [[#标题|位置]]。\n\n引用[^a]\n\n[^a]: 注释\n\n> [!NOTE]\n> 留意\n\n```mermaid\ngraph LR\n A-->B\n```';
  const p=projectSource(raw);
  assert.deepEqual(p.regions.map(r=>r.kind),['metadata','paragraph','paragraph','footnote','alert','mermaid']);
  for(const r of p.regions)assert(raw.slice(r.start,r.end).length>0);
  assert(JSON.stringify(p.doc).includes('x^2'));
});

test('extended paragraph splits and plain paste preserve neighboring frames and CRLF',()=>{
 const source='段 &amp; 尾文 ~~保留~~\r\n\r\n末段';
 const p=projectSource(source),at=p.extended[0].leaves[0].from+'段 & 尾'.length;
 for(const insert of ['\n\n','一\n\n二']){
  const result=mapTextEdit(source,{from:at,to:at,insert});
  assert(result.ok);assert.equal(result.source,source.replace('尾文','尾'+insert.replaceAll('\n','\r\n')+'文'));
  const inv=result.inverseSource;
  assert.equal(result.source.slice(0,inv.from)+inv.insert+result.source.slice(inv.to),source);
 }
});

test('replacement sees decoded entity and escaped table-cell text while preserving other source',async()=>{
 const {planDocumentReplace}=await import('../lib/document-replace.mjs');
 const raw='| 列 | 列 |\n| --- | --- |\n| a\\|b | &amp; |\n\n正文 &amp;。';
 const doc=schema.nodeFromJSON(projectSource(raw).doc);
 for(const [needle,expected] of [['|',raw.replace('a\\|b','a新b')],['&',raw.replaceAll('&amp;','新')]]){
  const hits=findDocumentText(doc,needle);
  const r=planDocumentReplace(raw,doc,hits.matches,'新');
  assert(r.ok,needle);assert.equal(r.source,expected);
 }
});

test('multiline code and literal pipe insertion retain fence, indentation, and table shape',()=>{
 for(const raw of ['```js title=main\r\nfirst\r\n```','    first\r\n    second']){
  const p=projectSource(raw),leaf=p.extended[0].leaves[0];
  const r=mapTextEdit(raw,{from:leaf.from+1,to:leaf.from+1,insert:'A\nB'});
  assert(r.ok,raw);assert.equal(r.source,raw.replace('first','fA\r\n'+(raw.startsWith('    ')?'    ':'')+'Birst'));
 }
 const raw='| A | B |\n| --- | --- |\n| a\\|b | keep |';
 const p=projectSource(raw),leaf=p.extended[0].leaves.find(l=>raw.slice(l.start,l.start+1)==='a');
 const r=mapTextEdit(raw,{from:leaf.to,to:leaf.to,insert:'|c'});
 assert(r.ok);assert.equal(r.source,raw.replace('b | keep','b\\|c | keep'));
});

test('ordinary prose beside an inline extension remains exactly editable',()=>{
 for(const raw of ['前文 $x$ 尾文','前文 [[#章|位置]] 尾文','前文 [^n] 尾文\n\n[^n]: 注','前文 <span>字</span> 尾文']){
  const p=projectSource(raw),doc=schema.nodeFromJSON(p.doc);doc.check();
  assert.equal(doc.firstChild.type.name,'paragraph',raw);
  for(const word of ['前文','尾文']){
   const hit=findDocumentText(doc,word).matches[0];
   const plan=mapTextEdit(raw,{from:hit.from,to:hit.to,insert:'修订'});
   assert.ok(plan.ok);assert.equal(plan.source,raw.replace(word,'修订'));
  }
 }
});
test('outline includes nested rendered headings with real PM positions',()=>{
 const doc=schema.nodeFromJSON(projectSource('顶层\n====\n\n> ## 内标题').doc);
 const outline=documentHeadings(doc);assert.deepEqual(outline.map(h=>h.title),['顶层','内标题']);
 assert.equal(doc.nodeAt(outline[1].position).type.name,'heading');
});
