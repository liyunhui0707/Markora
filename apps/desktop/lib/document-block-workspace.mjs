import {DOMSerializer} from '@tiptap/pm/model';
import {projectSource} from './document-source-map.mjs';
import {renderExtensions} from './document-render-extension.mjs';

function projectedRange(projection,index){
  const preview=projection.regions?.find(region=>region.index===index);
  if(preview)return preview;
  const block=projection.blocks[index]??projection.extended?.find(item=>item.index===index);
  return block&&{start:block.sourceFrom,end:block.sourceTo};
}

export function blockRange(source,index){
  return projectedRange(projectSource(source),index);
}

export function renderBlockPreview(box,fragment,schema,{source,start,end}){
  // Reparse the complete candidate so definitions, table delimiters and adjacent
  // blocks have exactly the context they will have after Apply.
  const candidate=source.slice(0,start)+fragment+source.slice(end);
  try{
    const projected=projectSource(candidate);
    const article=document.createElement('article');
    const serializer=DOMSerializer.fromSchema(schema);
    // Build one index of the irregular ranges for large documents.
    const ranges=new Map();
    for(const row of projected.regions||[])ranges.set(row.index,row);
    for(const row of projected.extended||[])ranges.set(row.index,{start:row.sourceFrom,end:row.sourceTo});
    projected.doc.content.forEach((node,index)=>{
      const block=projected.blocks[index];
      const range=ranges.get(index)||(block&&{start:block.sourceFrom,end:block.sourceTo});
      if(range&&range.start<start+fragment.length&&range.end>start)article.append(serializer.serializeNode(schema.nodeFromJSON(node)));
    });
    if(!article.childNodes.length)article.textContent='此块没有可见的正文内容。';
    box.replaceChildren(article);
    renderExtensions(article,()=>box.firstChild===article);
  }catch{box.textContent='此块暂时无法预览，源码仍可编辑。';}
}

const noteOrigins=new WeakMap();

export function followPreviewJump(button,root,report){
  const {previewJump:kind,previewTarget:key}=button.dataset;
  let target;
  if(kind==='note')target=[...root.querySelectorAll('[data-footnote]')].find(el=>el.dataset.footnote===key);
  if(kind==='note'&&target)noteOrigins.set(target,button);
  if(kind==='back')target=noteOrigins.get(button.closest('[data-footnote]'));
  if(kind==='back'&&!root.contains(target||null))target=[...root.querySelectorAll('[data-preview-jump="note"]')].find(el=>el.dataset.previewTarget===key);
  if(kind==='wiki'&&key.startsWith('#')){
    target=[...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(el=>el.textContent.trim()===key.slice(1).trim());
  }
  if(!target){report('当前文档中找不到此位置。',true);return;}
  target.scrollIntoView({block:'center'});
  const focus=target.matches('button')?target:target.querySelector('button')||target;
  if(!focus.matches('button,[tabindex]'))focus.tabIndex=-1;
  focus.focus({preventScroll:true});
}
