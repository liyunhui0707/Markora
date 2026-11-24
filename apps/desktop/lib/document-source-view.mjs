// Read-only originals and explicit source editing of independent drafts.
export function sourceSummary({ source, bom }) {
  const endings = source.match(/\r\n|\r|\n/g) || [];
  const kinds = ['\r\n','\n','\r'].filter(value => endings.includes(value));
  const names = kinds.map(value => ({ '\r\n':'CRLF', '\n':'LF', '\r':'CR' })[value]);
  return `${endings.length + 1} 行 · ${names.join(' / ') || '无换行'} · ${bom ? 'UTF-8 BOM' : '无 BOM'}`;
}
export function createSourceView({byId,context,createEditor,run,renderPreview,saveFile=async()=>false}) {
 const button=byId('show-source'),dialog=byId('source-dialog'),text=byId('source-text'),doc=dialog.ownerDocument;
 let enabled=false,snapshot=null,wrapped=true,buffer=null,inFlight=false,stale=false,discarding=false;
 let region=null,previewTimer;
 const initial=()=>region?snapshot.source.slice(region.start,region.end):snapshot?.source;
 const dirty=()=>buffer&&buffer.source!==initial();
 function preview(){
  if(!region||!renderPreview)return;
  const box=byId('source-block-preview');
  clearTimeout(previewTimer);
  previewTimer=setTimeout(()=>{if(region&&dialog.open)renderPreview(box,buffer?.source??initial(),{source:snapshot.source,...region});},100);
 }
 const ready=()=>{
  const {state:s,editor,loading,invalid}=context();
  return enabled&&!!s?.confirmed&&!!editor&&!loading&&!invalid&&!s.locked&&!s.pending&&!s.historyPending
   &&!s.composing&&!s.compositionInvalid&&!s.recoveryRecords?.length&&!editor.view.composing&&s.source===s.confirmed.source;
 };
 function controls() {
  const editing=!!buffer;
  byId('apply-source').hidden=!editing;byId('source-undo').hidden=!editing;byId('source-redo').hidden=!editing;
  byId('apply-source').disabled=!editing||inFlight||stale||buffer.composing;
  byId('source-undo').disabled=!editing||inFlight||buffer.composing||!buffer.canUndo;
  byId('source-redo').disabled=!editing||inFlight||buffer.composing||!buffer.canRedo;
  byId('close-source').disabled=inFlight||!!buffer?.composing;
  byId('source-discard').hidden=!discarding;
  byId('source-note').textContent=editing?'编辑完整 Markdown。应用并返回仅更新正文；⌘S 会应用并保存文件。未应用修改暂留在此窗口。':'原文只读，可选择并复制。请先创建编辑副本，再修改源码。';
  if(region)byId('source-note').textContent=editing?'当前块源码与即时预览。应用后可在正文中撤销。':'此块为只读，可选择并复制源码。';
  if(editing)byId('source-metadata').textContent=sourceSummary({source:buffer.source,bom:snapshot.bom})+(dirty()?' · 尚未应用':'');
 }
 function close() {
  if(!dialog.open||inFlight||buffer?.composing)return;
  if(dirty()){discarding=true;controls();return;}
  dialog.close();
 }
 function sync() {
  button.disabled=!ready();
  const c=context(),s=c.state;
  if(run&&s?.confirmed&&!c.loading&&!c.invalid&&!s.locked&&!s.historyPending&&!s.compositionInvalid&&!s.recoveryRecords?.length)button.disabled=false;
  const current=context().state?.confirmed;
  if(dialog.open&&(!ready()||current?.sessionId!==snapshot?.sessionId||current?.revision!==snapshot.revision||current?.source!==snapshot.source)) {
   if(!buffer)dialog.close();
   else if(!inFlight){stale=true;byId('source-status').textContent='文档状态已变化，源码仍保留在此窗口。请复制需要保留的修改，再关闭并重新打开源码。';}
  }
  if(dialog.open)controls();
 }
 async function apply({save=false}={}) {
  if(!buffer||inFlight||stale||buffer.composing||!ready())return;
  const {controller}=context(),expected=snapshot,caret=(region?.start||0)+buffer.selection;
  const candidate=region?expected.source.slice(0,region.start)+buffer.source+expected.source.slice(region.end):buffer.source;
  if(!controller||controller.state().confirmed.sessionId!==expected.sessionId)return;
  inFlight=true;buffer.setLocked(true);controls();byId('source-status').textContent='正在应用…';
  let ok=false;
  try {ok=await controller.applySource(candidate);}catch { /* Keep the entire buffer on transport or rendering failure. */ }
  inFlight=false;buffer?.setLocked(false);
  if(ok&&context().controller===controller&&controller.state().confirmed.source===candidate) {
   context().restoreSelection?.(caret);dialog.close();
   if(save)return await saveFile();
   return true;
  } else {
   byId('source-status').textContent='修改未确认应用，源码仍保留在此窗口。请勿重复提交未知结果；可以全选复制后检查草稿。';
   sync();
  }
  controls();
 }
 function selectAll() {
  if(!dialog.open)return;
  if(buffer){buffer.selectAll();return;}
  const range=doc.createRange();range.selectNodeContents(text);const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);text.focus({preventScroll:true});
 }
 button.onpointerdown=event=>{if(!ready())event.preventDefault();};
 function open(range=null){
  if(!ready()||doc.querySelector('dialog[open]'))return;
  region=range;
  snapshot={...context().state.confirmed};stale=false;discarding=false;
  byId('source-name').textContent=snapshot.label;byId('source-metadata').textContent=sourceSummary(snapshot);byId('source-status').textContent='';
  const editing=snapshot.temporary===true&&snapshot.readOnly===false&&typeof createEditor==='function';
  text.hidden=editing;byId('source-editor').hidden=!editing;
  text.textContent=editing?'':initial();
  byId('source-block-preview').hidden=!region;
  dialog.showModal();button.setAttribute('aria-expanded','true');
  if(editing) {
   buffer=createEditor({parent:byId('source-editor'),source:initial(),selection:region?0:context().sourceSelection?.()||0,
    changed:documentChanged=>{if(buffer){if(documentChanged){discarding=false;preview();}controls();}},rejected:()=>{byId('source-status').textContent='本次输入超过当前文本限制或包含无效字符，未应用；之前的内容已保留。';},apply,save:()=>apply({save:true})});
   buffer.setWrap(wrapped);buffer.focus();
  } else {text.scrollTop=0;text.scrollLeft=0;text.focus({preventScroll:true});}
  controls();preview();
 }
 button.onclick=()=>run?run('打开源码',()=>open()):open();
 byId('close-source').onclick=close;byId('apply-source').onclick=apply;
 byId('apply-source').onpointerdown=event=>{if(buffer?.composing)event.preventDefault();};
 byId('source-undo').onclick=()=>{if(!inFlight&&!buffer?.composing){buffer?.undo();buffer?.focus();}};
 byId('source-redo').onclick=()=>{if(!inFlight&&!buffer?.composing){buffer?.redo();buffer?.focus();}};
 byId('discard-source').onclick=()=>{if(!inFlight&&!buffer?.composing&&discarding)dialog.close();};
 byId('keep-source').onclick=()=>{discarding=false;controls();buffer?.focus();};
 byId('select-source').onclick=selectAll;
 byId('source-wrap').onclick=()=>{wrapped=!wrapped;text.dataset.wrap=String(wrapped);buffer?.setWrap(wrapped);byId('source-wrap').setAttribute('aria-pressed',String(wrapped));};
 text.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='a'){event.preventDefault();selectAll();}});
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>{
  if(dialog.open)return;
  clearTimeout(previewTimer);region=null;byId('source-block-preview').replaceChildren?.();byId('source-block-preview').hidden=true;
  buffer?.destroy();buffer=null;snapshot=null;stale=false;discarding=false;text.textContent='';byId('source-name').textContent='';byId('source-metadata').textContent='';button.setAttribute('aria-expanded','false');
  if(!button.disabled)button.focus({preventScroll:true});
 });
 return {sync,close,openRegion(range){
  if(doc.querySelector('dialog[open]')||!ready()||!range||!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<=range.start||range.end>context().state.confirmed.source.length)return false;
  open(range);return dialog.open;
 },save:()=>apply({save:true}),isOpen:()=>dialog.open,configure(){enabled=true;sync();}};
}
