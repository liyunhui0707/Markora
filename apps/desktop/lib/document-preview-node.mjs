import {DOMSerializer} from '@tiptap/pm/model';
import {renderExtensions} from './document-render-extension.mjs';
import {Node} from '@tiptap/core';
import {previewDOMSpec} from './document-semantic-preview.mjs';

export const DocumentPreview=Node.create({
 name:'documentPreview',group:'block',atom:true,selectable:true,draggable:false,
 addAttributes(){return {kind:{default:'paragraph',rendered:false},tree:{default:null,rendered:false}};},
 addNodeView(){return ({node})=>{
  const dom=DOMSerializer.renderSpec(document,this.type.spec.toDOM(node)).dom;
  let live=true;
  renderExtensions(dom,()=>live);
  return {dom,ignoreMutation:mutation=>mutation.type!=='selection',destroy(){live=false;}};
 };},
 renderHTML({node}){return ['section',{'data-document-preview':'',class:'document-preview',contenteditable:'false',
  role:'group','aria-readonly':'true','aria-label':'Markdown 预览；通过源码编辑',title:'双击预览或按 Option+Enter 编辑此处源码。'},previewDOMSpec(node.attrs.tree)];},
});
