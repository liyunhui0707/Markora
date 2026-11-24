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
