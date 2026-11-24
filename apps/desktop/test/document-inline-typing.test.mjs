import test from 'node:test';
import assert from 'node:assert/strict';
import {mapFormatEdit} from '../lib/document-format-edit.mjs';
import {projectSource,mapTextEdit} from '../lib/document-source-map.mjs';

for(const [raw,type] of [['~~old~~','strike'],['**粗体**','bold'],['*斜体*','italic'],['`code`','code'],['[说明](notes.md)','link']]){
  test('type '+raw+' one character at a time',()=>{
    let source='',caret=1;
    for(const char of raw){
      const command={action:'inline-close',from:caret,to:caret,insert:char};
      let plan=mapFormatEdit(source,command);
      if(!plan.ok)plan=mapTextEdit(source,{from:caret,to:caret,insert:char});
      assert.ok(plan.ok,source+' + '+char);
      assert.equal(plan.source,source+char);
      if(plan.inverseSource){
        const undo=plan.inverseSource;
        assert.equal(plan.source.slice(0,undo.from)+undo.insert+plan.source.slice(undo.to),source);
      }
      source=plan.source;
      caret=plan.selection?.to??caret+char.length;
    }
    const [line]=projectSource(source).doc.content;
    assert.equal(line.content.length,1);
    assert.equal(line.content[0].marks[0].type,type);
    assert.equal(caret,1+line.content[0].text.length);
  });
}

test('a plain rectangular paste preserves CRLF, neighboring formatting, alignment and the exact inverse',()=>{
  const source='| A | B | C |\r\n| :--- | ---: | --- |\r\n| 1 | 2 | **keep** |\r\n| 3 | 4 | end |';
  const from=projectSource(source).blocks[0].cells[1][0].from;
  const paste=insert=>mapFormatEdit(source,{action:'table-paste',from,to:from,insert});
  const plan=paste('甲\t乙\r\n丙\t丁');
  assert.ok(plan.ok);
  assert.equal(plan.source,source.replace(' 1 | 2 ',' 甲 | 乙 ').replace(' 3 | 4 ',' 丙 | 丁 '));
  const {from:a,to:b,insert}=plan.inverseSource;
  assert.equal(plan.source.slice(0,a)+insert+plan.source.slice(b),source);
  for(const invalid of ['x\ty\tz','x\ty\nx','x\ty\nx\ty\nx\ty','x\t**y**','x\t\u0000'])assert.equal(paste(invalid).ok,false);
});

test('split and join a leaf item inside a quote without changing its siblings',()=>{
  const source='> 引用\r\n>\r\n> - 甲乙\r\n> - 尾';
  const before=projectSource(source),leaf=before.extended[0].leaves.find(l=>source.slice(l.start,l.start+2)==='甲乙');
  const from=leaf.from+1;
  const split=mapFormatEdit(source,{action:'split-list',from,to:from});
  assert.ok(split.ok);assert.equal(split.source,source.replace('甲乙','甲\r\n> - 乙'));
  const join=mapFormatEdit(split.source,{action:'join-list',...split.selection});
  assert.ok(join.ok);assert.equal(join.source,source);
});

test('delimiters cannot cross a selected range, an opaque block or the capacity limit',()=>{
  const command={action:'inline-close',from:5,to:5,insert:'*'};
  assert.equal(mapFormatEdit('*abc',{...command,from:1}).ok,false);
  assert.equal(mapFormatEdit('*abc',{...command,insert:'**'}).ok,false);
  assert.equal(mapFormatEdit('<pre>*abc</pre>',command).ok,false);
  assert.equal(mapFormatEdit('*abc'+' '.repeat(524284),command).ok,false);
});

test('open partial www and type inline addresses through every intermediate spelling',()=>{
  assert.deepEqual(projectSource('www.').doc.content[0].content,[{type:'text',text:'www.'}]);
  for(const raw of ['www.example.com','https://example.com','a@example.com','[说明](https://example.com)']){
    let source='',caret=1;
    for(const insert of raw){
      const change={from:caret,to:caret,insert};
      const plan=[()=>mapFormatEdit(source,{action:'inline-close',...change}),
        ()=>mapFormatEdit(source,{action:'autolink-input',...change}),()=>mapTextEdit(source,change)]
        .map(run=>run()).find(result=>result.ok);
      assert.ok(plan,source+' + '+insert);assert.equal(plan.source,source+insert);
      source=plan.source;caret=plan.selection?.to??caret+insert.length;
    }
    assert.equal(projectSource(source).doc.content[0].content[0].marks[0].type,'link');
  }
  const back=mapFormatEdit('https://e',{action:'autolink-input',from:10,to:10,insert:''});
  assert.ok(back.ok);assert.equal(back.source,'https://');
});

test('close formatting before a suffix in headings, lists, quotes and prose',()=>{
 for(const prefix of ['','# ','- ','> ']){
  for(const [pending,insert,mark] of [['**题*','*','bold'],['*题','*','italic'],['~~题~','~','strike'],['`题','`','code'],['[题](n.md',')','link']]){
   const source=prefix+'前 '+pending+' 后';
   const p=projectSource(source),end=p.spans.find(s=>s.text.includes(' 后'))??p.extended?.[0]?.leaves.at(-1);
   const caret=end.to-2;
   const plan=mapFormatEdit(source,{action:'inline-close',from:caret,to:caret,insert});
   assert.ok(plan.ok,source);assert.equal(plan.source,prefix+'前 '+pending+insert+' 后');
   assert.ok(JSON.stringify(plan.projection.doc).includes('"type":"'+mark+'"'));
  }
 }
});

test('every URL prefix beside Unicode and CRLF can reopen and each accepted step has an exact inverse',()=>{
 for(const token of ['https://example.test/路径','www.example.com','a@example.test','[说明](https://example.test)']){
  for(let i=0;i<=token.length;i++){
   const base='## 文档\r\n\r\n组合 e\u0301 👩‍💻 '+token.slice(0,i);
   const p=projectSource(base),last=p.doc.content.at(-1);
   assert.equal(last.type,'paragraph');if(i===token.length)continue;
   const caret=(p.blocks.at(-1)??p.extended.at(-1)).to-1, change={from:caret,to:caret,insert:token[i]};
   const plans=[mapFormatEdit(base,{action:'inline-close',...change}),mapFormatEdit(base,{action:'autolink-input',...change}),mapTextEdit(base,change)];
   const plan=plans.find(p=>p.ok);assert.ok(plan,base);assert.equal(plan.source,base+change.insert);
   const undo=plan.inverseSource??{from:plan.change.from,to:plan.change.from+plan.change.insert.length,insert:base.slice(plan.change.from,plan.change.to)};assert.equal(plan.source.slice(0,undo.from)+undo.insert+plan.source.slice(undo.to),base);
  }
 }
});
