const {clickWorkspaceControl} = require('./helpers/document-workspace-control.cjs');
const {test,expect,_electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createSaveFolderFixture}=require('../test/helpers/save-folder-fixture.cjs');
const {stopOwnedElectron}=require('./helpers/document-owned-stop.cjs');

test('markora quality workflow: typed delimiters, precise preview hits and byte-exact reopen',async({},info)=>{
  test.setTimeout(120000);
  const executablePath=process.env.E2E_ELECTRON_EXECUTABLE;
  if(!executablePath)throw Error('Isolated Electron required');
  await fs.mkdir(info.outputDir,{recursive:true});
  const fixture=createSaveFolderFixture(info.outputDir),file=path.join(fixture.dir,'Markdown 验收.md');
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-typed-')));
  const source=['航行说明','========','','费用 &amp; 说明','','| 名称 | 数量 |','| :--- | ---: |',
    '| 缺格 |','| 复核点复核点 | 42 | 仅源码可见 |','','| A | B |','| --- | --- |','| 1 | 2 |',
    '','> 引用','','> - 甲乙','> - 尾','','写作位置：'].join('\r\n');
  const bytes=text=>Buffer.from('\ufeff'+text,'utf8');
  await fs.writeFile(file,bytes(source),{flag:'wx',mode:0o600});
  let app,exit;
  try{
    for(const writing of [false,true]){
      app=await _electron.launch({executablePath,cwd:root,chromiumSandbox:true,
        args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy',
          ...(writing?['--document-writing-open']:[]),'--document-drafts-test-root='+path.join(root,'drafts'),
          '--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],
        env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()}});
      exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));
      const page=await app.firstWindow(),editor=page.locator('#editor .tiptap');
      const snapshot=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({
        sessionId:document.querySelector('#documents').value})).snapshot);
      await app.evaluate(({dialog,BrowserWindow},file)=>{
        dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
        dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;
        BrowserWindow.getAllWindows()[0].show();
      },file);
      await page.locator('#empty-open').click();
      await expect.poll(async()=>(await snapshot())?.source).toBe(source);
      expect((await snapshot()).readOnly).toBe(!writing);
      const table=editor.locator('table').first();
      await expect(table.locator('th')).toHaveCount(2);
      await expect(table.locator('td')).toHaveCount(4);
      await expect(table.locator('td').nth(1)).toHaveText('');
      await expect(table.locator('th').nth(1)).toHaveAttribute('data-align','right');
      await expect(table).not.toContainText('仅源码可见');
      await page.keyboard.press('Meta+f');await page.locator('#find-query').fill('说明');
      await expect(page.locator('#find-count')).toHaveText('1 / 2');
      await page.locator('#find-query').fill('复核点');
      const offset=()=>page.evaluate(()=>[...CSS.highlights.get('markora-current-preview')][0].startOffset);
      await expect.poll(offset).toBe(0);await page.locator('#find-next').click();await expect.poll(offset).toBe(3);
      await page.locator('#find-close').click();
      if(writing){
        const place=async(locator,offset)=>locator.evaluate((element,offset)=>{
          const view=element.closest('.tiptap').editor.view;
          const pos=view.posAtDOM(element.firstChild,offset);view.focus();
          view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc,pos)));
        },offset);
        const lastRow=editor.locator(':scope > p').last();
        await place(lastRow,'写作位置：'.length);
        await page.keyboard.type(' https://e');await expect.poll(async()=>(await snapshot())?.source).toBe(source+' https://e');
        await page.keyboard.press('Backspace');await expect.poll(async()=>(await snapshot())?.source).toBe(source+' https://');
        await page.keyboard.type('e');await expect.poll(async()=>(await snapshot())?.source).toBe(source+' https://e');
        for(let i=0;i<14;i++){
          const before=(await snapshot()).source;
          if(before===source)break;
          await page.keyboard.press('Meta+z');
          await expect.poll(async()=>(await snapshot()).source).not.toBe(before);
        }
        await expect.poll(async()=>(await snapshot())?.source).toBe(source);
        const cell=editor.locator('table').nth(1).locator('td p').first();
        await place(cell,1);
        await cell.evaluate(element=>{
          const data=new DataTransfer();data.setData('text/plain','三\t四');
          element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
        });
        await expect.poll(async()=>(await snapshot())?.source).toBe(source.replace('| 1 | 2 |','| 三 | 四 |'));
        await page.keyboard.press('Meta+z');
        await expect.poll(async()=>(await snapshot())?.source).toBe(source);
        const quoted=editor.locator('blockquote li p').filter({hasText:'甲乙'});
        await place(quoted,1);await page.keyboard.press('Enter');
        await expect.poll(async()=>(await snapshot())?.source).toBe(source.replace('甲乙','甲\r\n> - 乙'));
        await page.keyboard.press('Backspace');
        await expect.poll(async()=>(await snapshot())?.source).toBe(source);
        const last=editor.locator(':scope > p').last();
        await place(last,'写作位置：'.length);
        let expected=source;
        for(const [raw,tag,value] of [['~~old~~','s','old'],['**bold**','strong','bold'],['*italic*','em','italic'],['`code`','code','code'],['[link](https://example.com)','[data-document-link]','link']]){
          await page.keyboard.type(raw);
          expected+=raw;
          await expect.poll(async()=>(await snapshot())?.source).toBe(expected);
          await expect(last.locator(tag)).toHaveText(value);
          await page.keyboard.type('!');
          await expect.poll(async()=>(await snapshot())?.source).toBe(expected+'!');
          await expect(last.locator(tag)).toHaveText(value);
          await page.keyboard.press('Meta+z');
          await expect.poll(async()=>(await snapshot())?.source).toBe(expected);
          await page.keyboard.press('Meta+Shift+z');
          expected+='!';
          await expect.poll(async()=>(await snapshot())?.source).toBe(expected);
          await page.keyboard.type(' ');expected+=' ';
          await expect.poll(async()=>(await snapshot())?.source).toBe(expected);
        }
        await page.keyboard.press('Meta+s');
        await expect.poll(async()=>(await snapshot())?.dirty).toBe(false);
        expect(await fs.readFile(file)).toEqual(bytes(expected));
        await clickWorkspaceControl(page,'close-current-document');
        await page.locator('#empty-open').click();
        await expect.poll(async()=>(await snapshot())?.source).toBe(expected);
        await expect(table).not.toContainText('仅源码可见');
        await expect(editor.locator('s')).toHaveText('old');
      }else expect(await fs.readFile(file)).toEqual(bytes(source));
      const outcome=await stopOwnedElectron({app,exit});app=null;
      expect(outcome).toEqual({code:0,signal:null,forced:false});
    }
  }finally{
    if(app)await stopOwnedElectron({app,exit});
    fixture.archive({quiescent:true});
  }
});

test('markora quality workflow: semantic preview, heading range, quiet status, source save and reopen',async({},info)=>{
 test.setTimeout(120000);if(!process.env.E2E_ELECTRON_EXECUTABLE)throw Error('Isolated Electron required');
 await fs.mkdir(info.outputDir,{recursive:true});const folder=createSaveFolderFixture(info.outputDir),file=path.join(folder.dir,'markora synthetic.md');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'document-safe-create-markora-')));
 const appendix=['## 科目','前 ~~旧文~~ 后','公式 $x^2$，跳到 [[#科目|目标]]。','参考[^a]','[^a]: 注释','```mermaid\ngraph LR\n A-->B\n```','```mermaid\n???\n```','> [!NOTE]\n> 提示'].join('\n\n').replaceAll('\n','\r\n');
 const source='# Title **bold**\r\n\r\nOther *text*\r\n\r\n---\r\n\r\nEscaped \\*star\\* &amp;.\r\n\r\n[Reference][id]\r\n\r\n> Outer\r\n>\r\n> - child\r\n\r\n[id]: https://example.test "Keep"\r\n\r\n'+appendix;
 await fs.writeFile(file,source,{flag:'wx',mode:0o600});let app,page,exit,passed=false;const errors=[],network=[],exits=[];
 const snap=()=>page.evaluate(async()=>(await window.documentDemo.snapshot({sessionId:document.querySelector('#documents').value})).snapshot);
 const idle=()=>expect.poll(()=>page.locator('#status').textContent().then(JSON.parse).then(s=>!s.pending&&!s.historyPending&&!s.locked)).toBe(true);
 try{
  app=await _electron.launch({executablePath:process.env.E2E_ELECTRON_EXECUTABLE,args:[path.resolve(__dirname,'../main.js'),'--document-readonly','--document-persistent-copy','--document-writing-open',
   '--document-drafts-test-root='+path.join(root,'drafts'),'--document-recents-test-root='+path.join(root,'recents'),'--document-original-saves-test-root='+path.join(root,'versions')],cwd:root,
   env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',TMPDIR:os.tmpdir()},chromiumSandbox:true});
  exit=new Promise(resolve=>app.process().once('close',(code,signal)=>resolve({code,signal})));page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await app.evaluate(({dialog,BrowserWindow},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>1;const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1280,850);w.show();},file);
  await expect(page.locator('.sidebar-brand strong')).toHaveText('Markora');await page.locator('#empty-open').click();await expect.poll(async()=>(await snap())?.source).toBe(source);
  await expect(page.locator('#editor .document-preview hr')).toHaveCount(1);await expect(page.locator('#editor')).toContainText('Escaped *star* &.');await expect(page.locator('#editor [data-document-link]')).toHaveText('Reference');await expect(page.locator('#editor blockquote').first()).toContainText('Outer');
  expect(await page.locator('#editor .document-preview [href], #editor .document-preview img:not([alt="Mermaid 图表"])').count()).toBe(0);
  const strike=page.locator('#editor s');
  await strike.evaluate(element=>{
    const view=element.closest('.tiptap').editor.view,inside=view.posAtDOM(element.firstChild,1);
    view.focus();view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc,inside)));
  });
  await page.keyboard.insertText('新');
  await expect.poll(async()=>(await snap()).source).toBe(source.replace('~~旧文~~','~~旧新文~~'));
  await clickWorkspaceControl(page,'format-undo');await expect.poll(async()=>(await snap()).source).toBe(source);
  const formula=page.locator('#editor [data-formula]');
  await expect(formula.locator('math')).toHaveCount(1);
  await page.keyboard.press('Meta+f');await page.locator('#find-query').fill('x2');
  await expect(page.locator('#find-count')).toContainText('1 / 1');
  await page.locator('#find-close').click();
  await expect(page.locator('#editor [data-diagram] img')).toHaveCount(1);
  await expect(page.locator('#editor [data-diagram] small')).toHaveCount(1);
  await page.locator('#editor [data-preview-jump="note"]').click();
  await expect(page.locator('#editor [data-preview-jump="back"]')).toBeFocused();
  await page.locator('#editor [data-preview-jump="back"]').click();
  await expect(page.locator('#editor [data-preview-jump="note"]')).toBeFocused();
  await page.locator('#editor [data-preview-jump="wiki"]').click();
  await expect(page.getByRole('heading',{name:'科目',exact:true})).toBeFocused();
  await formula.dblclick();
  await expect(page.locator('#source-dialog')).toBeVisible();
  await expect(page.locator('#source-editor')).toContainText('公式 $x^2$');
  await page.locator('#source-editor .cm-content').focus();
  await page.keyboard.press('Meta+a');await page.keyboard.insertText('公式 $x^3$。');
  await expect(page.locator('#source-block-preview math')).toContainText('3');
  await page.locator('#apply-source').click();
  await expect.poll(async()=>(await snap()).source).toBe(source.replace('公式 $x^2$，跳到 [[#科目|目标]]。','公式 $x^3$。'));
  await clickWorkspaceControl(page,'format-undo');await expect.poll(async()=>(await snap()).source).toBe(source);
  await expect(page.locator('#document-outline')).toBeHidden();
  await expect(page.locator('#session-filter')).toBeHidden();
  await expect(page.locator('#writing-toolbar')).toBeHidden();
  const canvas = await page.locator('#document-scroll').boundingBox();
  await page.screenshot({path:info.outputPath('writing-workspace.png')});
  const beforeTitle=await page.title();await page.locator('#editor h1').click();
  await page.locator('#editor .tiptap').dispatchEvent('compositionstart',{data:''});await expect(page).toHaveTitle(beforeTitle);
  await page.locator('#editor .tiptap').dispatchEvent('compositionend',{data:''});await idle();
  const {projectSource,mapTextEdit}=await import('../lib/document-source-map.mjs');const p=projectSource(source),a=p.spans.find(s=>s.bold),b=p.spans.find(s=>s.italic),from=a.from+1,to=b.to-1;
  const mapped=mapTextEdit(source,{from,to,insert:'中文😀'});expect(mapped.ok).toBe(true);
  await page.evaluate(({from,to})=>{const v=document.querySelector('#editor .tiptap').editor.view;v.focus();v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc,from,to)));},{from,to});
  await expect(page.locator('#format-bold')).toBeVisible();
  expect(await page.locator('#document-scroll').boundingBox()).toEqual(canvas);
  await page.keyboard.insertText('中文😀');await idle();expect((await snap()).source).toBe(mapped.source);await expect(page).toHaveTitle(beforeTitle);
  await clickWorkspaceControl(page,'format-undo');await expect.poll(async()=>(await snap()).source).toBe(source);await clickWorkspaceControl(page,'format-redo');await expect.poll(async()=>(await snap()).source).toBe(mapped.source);
  await page.keyboard.press('Meta+s');await expect.poll(async()=>(await snap())?.dirty).toBe(false);expect(await fs.readFile(file,'utf8')).toBe(mapped.source);
  const refused=await snap();await page.evaluate(()=>{const v=document.querySelector('#editor .tiptap').editor.view;let at;v.state.doc.descendants((n,pos)=>{if(at===undefined&&n.type.name==='documentPreview')at=pos;});v.dispatch(v.state.tr.delete(at,at+1));});
  expect((await snap()).source).toBe(refused.source);await expect(page.locator('#viewer-status')).toContainText('内容已保留');await expect(page.locator('#viewer-edit-source')).toBeVisible();
  await page.screenshot({path:info.outputPath('semantic-writing.png')});await page.locator('#viewer-edit-source').click();await expect(page.locator('#source-dialog')).toBeVisible();
  await page.locator('#source-editor .cm-content').click();await page.keyboard.press('Meta+End');await page.keyboard.insertText('\n\nContinued after preview.');await page.keyboard.press('Meta+s');await expect(page.locator('#source-dialog')).not.toBeVisible();
  await expect.poll(async()=>(await snap())?.dirty).toBe(false);const saved=await snap();expect(await fs.readFile(file,'utf8')).toBe(saved.source);expect(saved.source).toContain('Continued after preview.');
  await clickWorkspaceControl(page,'close-current-document');await expect(page.locator('#empty-open')).toBeVisible();await page.locator('#empty-open').click();await expect.poll(async()=>(await snap())?.source).toBe(saved.source);
  await page.screenshot({path:info.outputPath('reopened-markora.png')});expect(errors).toEqual([]);expect(network).toEqual([]);passed=true;
 }finally{
  if(!passed&&page&&!page.isClosed()){
   await page.screenshot({path:info.outputPath('failure.png')}).catch(()=>{});
   const state=await page.evaluate(()=>({status:document.querySelector('#status')?.textContent,notice:document.querySelector('#viewer-status')?.textContent,save:document.querySelector('#original-save-status')?.textContent})).catch(()=>null);
   await fs.writeFile(info.outputPath('failure-state.json'),JSON.stringify(state,null,2));
  }
  if(app){exits.push(await stopOwnedElectron({app,exit}));app=null;}
  await fs.writeFile(info.outputPath('evidence.json'),JSON.stringify({passed,root,errors,network,exits,archive:folder.archive({quiescent:!app}),physicalIME:'NOT VERIFIED; controlled composition only'},null,2));
  if(passed)expect(exits).toEqual([{code:0,signal:null,forced:false}]);
 }
});
