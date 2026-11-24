// Renderer-only. Load pinned local distributions on first use. Diagram output
// is displayed in image context, never attached as an interactive SVG subtree.
const assets={
  katex:'../node_modules/katex/dist/katex.min.js',
  mermaid:'../node_modules/mermaid/dist/mermaid.min.js',
};
const loading=new Map();
let diagramId=0;
function library(name){
 if(!loading.has(name)){
  const ready=new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src=assets[name];
   script.onload=()=>{
    const lib=globalThis[name];
    if(!lib){reject(Error('本地渲染组件不可用'));return;}
    if(name==='mermaid')lib.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,
      flowchart:{htmlLabels:false},maxTextSize:8192,maxEdges:200,suppressErrorRendering:true});
    resolve(lib);
   };
   script.onerror=()=>reject(Error('本地渲染组件未加载'));
   document.head.append(script);
  });
  loading.set(name,ready);
 }
 return loading.get(name);
}
async function render(element,isCurrent){
 const formula=element.dataset.formula,source=formula??element.dataset.diagram;
 try{
  if(source.length>8192)throw Error('超出预览长度');
  if(formula!==undefined){
   const katex=await library('katex');if(!isCurrent())return;
   const box=document.createElement('span');
   katex.render(formula,box,{output:'mathml',displayMode:element.dataset.mathDisplay==='true',
     throwOnError:true,trust:false,maxSize:32,maxExpand:500,strict:'error'});
   element.replaceChildren(box);
  }else{
   // Embedded directives, links and external resources are outside this viewer.
   if(/^\s*---|%%\s*\{|<\s*\/?[a-z]|(?:https?:|file:|data:|javascript:|url\s*\(|\bclick\s+|@\{)/im.test(source))
     throw Error('图中含配置、交互或外部资源');
   const mermaid=await library('mermaid');if(!isCurrent())return;
   const rendered=await mermaid.render('document-diagram-'+(++diagramId),source);
   if(!isCurrent())return;
   const img=document.createElement('img');img.alt='Mermaid 图表';img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(rendered.svg);
   element.replaceChildren(img);
  }
 }catch{
  if(!isCurrent())return;
  const error=document.createElement('small');error.textContent='预览不可用，可编辑此处源码。';
  const code=document.createElement('code');code.textContent=source;element.replaceChildren(error,code);
 }finally{
  if(isCurrent())element.dispatchEvent(new Event('markora-preview-rendered',{bubbles:true}));
 }
}
export function renderExtensions(root,isCurrent=()=>true){
 for(const element of root.querySelectorAll('[data-formula],[data-diagram]'))void render(element,isCurrent);
}
