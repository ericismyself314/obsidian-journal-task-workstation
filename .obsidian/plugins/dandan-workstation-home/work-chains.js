/* One chain is one ordinary Markdown note. Its progress follows the list order. */
const chainFolders = { '灵感': '工作链/灵感', '待办': '工作链/待办', '原有工作链': '工作链/原有工作链', '独立工作链': '工作链/独立工作链' };

function chainName(text) {
  let name = text.split(/\r?\n/)[0].replace(/[<>:"/\\|?*#^[\]\x00-\x1f]/g, ' ').replace(/\s+/g,' ').trim().slice(0,72).replace(/[ .]+$/g,'');
  if (!name) name = '未命名工作链';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = '_' + name;
  return name;
}
function chainBullet(text) {
  return '- ' + text.trim().replace(/\r?\n/g, '\n  ');
}
function chainNote(text, steps = [], links = [], archived = false) {
  const sections = ['---', '收起: ' + archived, '---', ''];
  if (chainName(text) !== text) sections.push('## 起点', '', text, '');
  sections.push('## 进展', '', ...steps.map(chainBullet), '');
  if (links.length) sections.push('## 关联', '', ...links.map(chainBullet), '');
  return sections.join('\n') + '\n';
}
function chainSection(source, name) {
  const heading = new RegExp('^## ' + name + '[ \\t]*\\r?$', 'm').exec(source);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const tail = source.slice(start);
  const next = /^#{1,2}[ \t]+/m.exec(tail);
  return {start, end: next ? start + next.index : source.length};
}
function chainSteps(source) {
  const section = chainSection(source,'进展');
  if (!section) return [];
  return [...source.slice(section.start,section.end).matchAll(/^[-*+] (.*)(?:\r?\n[ \t]+[^\r\n]*)*/gm)].map(m => ({
    start: section.start + m.index, raw: m[0], text: m[0].slice(2).replace(/\r?\n {1,2}/g,'\n')
  }));
}
function chainAppend(source, sectionName, text) {
  const section = chainSection(source, sectionName);
  const entry = chainBullet(text);
  if (!section) return source.trimEnd() + '\n\n## ' + sectionName + '\n\n' + entry + '\n';
  const before = source.slice(0,section.end).trimEnd();
  return before + (before.endsWith('## ' + sectionName) ? '\n\n' : '\n') + entry + '\n\n' + source.slice(section.end);
}
function changeChainStep(source, snapshot, step, value) {
  if (source !== snapshot) throw Error('笔记已有新改动，请重新打开这条进展。');
  const end = step.start + step.raw.length;
  if (value === null) return source.slice(0,step.start) + source.slice(end).replace(/^\r?\n/,'');
  return source.slice(0,step.start) + chainBullet(value) + source.slice(end);
}
function chainKind(file) {
  return Object.keys(chainFolders).find(kind => file.parent?.path === chainFolders[kind]);
}
function chainFreePath(vault, folder, name, current) {
  const stem = chainName(name);
  for (let i = 1; ; i++) {
    const path = folder + '/' + stem + (i === 1 ? '' : ' (' + i + ')') + '.md';
    const found = vault.getAbstractFileByPathInsensitive?.(path) ?? vault.getAbstractFileByPath(path);
    if (!found || found === current) return path;
  }
}
function chainAction(parent,label,fn) {
  const b = journalButton(parent,label,async () => { if (b.disabled) return; b.disabled=true; try { await fn(); } finally { b.disabled=false; } });
  return b;
}
function chainDialog(view,title,initial,save,confirmOnly=false) {
  const modal = new journalOb.Modal(view.app);
  modal.setTitle(title);
  let input;
  if (!confirmOnly) {
    input = modal.contentEl.createEl('textarea',{cls:'dwh-chain-editor',attr:{'aria-label':title,rows:'3'}});
    input.value = initial;
  } else if (initial) {
    modal.contentEl.createEl('p', {text: initial});
  }
  const actions = modal.contentEl.createDiv({cls:'dwh-chain-actions'});
  chainAction(actions,'取消',()=>modal.close());
  const commit = chainAction(actions,confirmOnly ? '确认移除' : '保存', async () => {
    const value = input?.value.trim();
    if (input && !value) { input.focus(); return; }
    await save(value); modal.close();
  });
  input?.addEventListener('keydown',e=>{ if (!e.isComposing && e.keyCode!==229 && e.key==='Enter' && !e.shiftKey) {e.preventDefault();commit.click();} });
  modal.open(); input?.focus();
  return {modal, actions};
}
function addProgressButton(view,parent,model) {
  return chainAction(parent,'＋进展',()=>chainDialog(view,'记录目前做到哪一步','',async value=>{
    await view.app.vault.process(model.file,s=>chainAppend(s,'进展',value));
    inkMotion(view,model.file.path,model.started?'write':'note');
    view.api.refreshHomeViews();
  }));
}
function renderChainRow(view,parent,model,allowDrag=false) {
  const {file,steps,archived}=model;
  const row=parent.createDiv({cls:'dwh-chain-row'});
  row.dataset.file=file.path;
  const line=row.createDiv({cls:'ink-row-head'});
  if(allowDrag){
    row.title='拖到工作链开始推进';
    row.draggable=true;
    row.addEventListener('dragstart',e=>{
      if(e.target.closest('details,input,textarea')){e.preventDefault();return;}
      view.paperDrag=file;e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData(paperDragType,file.path);
      const slip=row.createSpan({cls:'ledger-drag-slip',text:file.basename,attr:{'aria-hidden':'true'}});
      e.dataTransfer.setDragImage(slip,Math.min(30,slip.offsetWidth/2),12);
      row.ownerDocument.defaultView.requestAnimationFrame(()=>slip.remove());
      row.classList.add('ink-lift');view.contentEl.classList.add('ink-dragging');
    });
    row.addEventListener('dragend',()=>{
      row.classList.remove('ink-lift');view.paperDrag=null;view.contentEl.classList.remove('ink-dragging');
      view.contentEl.querySelector('.ink-over')?.classList.remove('ink-over');
    });
  }
  if(model.kind==='待办'){
    const label=line.createEl('label',{cls:'ledger-tick',attr:{title:'切换完成状态'}});
    const check=label.createEl('input',{type:'checkbox',attr:{'aria-label':file.basename+'，完成状态'}});
    check.defaultChecked=model.completed;
    const mark=label.createSvg('svg',{cls:'ledger-check-ink',attr:{viewBox:'0 0 18 18','aria-hidden':'true'}});
    mark.createSvg('path',{attr:{d:'M2.5 9.2 Q4.8 11.5 6.6 13.2 Q10.2 8.3 16 3.5',pathLength:'1'}});
    let saving=false;
    row.addEventListener('pointerdown',event=>{row.draggable=allowDrag&&!label.contains(event.target);},true);
    check.addEventListener('change',async()=>{
      if(saving) return;
      const desired=check.checked;
      saving=true;
      try{
        await view.app.fileManager.processFrontMatter(file,fm=>{fm['已完成']=desired;});
        view.api.refreshHomeViews();
      }catch(error){
        check.checked=model.completed;
        new journalOb.Notice('待办状态保存失败：'+error.message);
      }finally{saving=false;}
    });
    check.addEventListener('click',event=>{if(saving) event.preventDefault();});
  }
  const title=chainAction(line,'',()=>view.openFile(file));title.classList.add('dwh-chain-title');
  title.createSpan({cls:'ink-item-text',text:file.basename});
  if(archived)line.createSpan({cls:'dwh-chain-muted',text:'已收起'});
  const actions=line.createDiv({cls:'ink-row-actions'});
  if(!allowDrag) addProgressButton(view,actions,model);
  const more=chainAction(actions,'•••',()=>paperManage(view,model));more.title='管理'+model.kind;more.setAttribute('aria-label',more.title+'：'+file.basename);
  if(steps.length)row.createDiv({cls:'dwh-chain-latest',text:steps.at(-1).text});
  playInkMotion(view,row,file,'note');
  return row;
}
function confirmProgressRemoval(view,model,step,index){
  chainDialog(view,'删除第 '+(index+1)+' 步进展？',step.text,async ()=>{
    await view.app.vault.process(model.file,current=>changeChainStep(current,model.source,step,null));
    view.api.refreshHomeViews();
  },true);
}
function editProgressStep(view,model,step,index){
  const {modal,actions}=chainDialog(view,'修改第 '+(index+1)+' 步进展',step.text,async value=>{
    if(value===step.text) return;
    await view.app.vault.process(model.file,source=>changeChainStep(source,model.source,step,value));
    view.api.refreshHomeViews();
  });
  const remove=chainAction(actions,'删除这一步',()=>{
    modal.close();
    confirmProgressRemoval(view,model,step,index);
  });
  actions.prepend(remove);
}
function addChainManagement(view,detail,model) {
  const {file,source,steps,archived}=model;
  const vault=view.app.vault;

  const menu=detail.createDiv({cls:'dwh-chain-actions'});
  chainAction(menu,'改名',()=>chainDialog(view,'工作链名称',file.basename,async name=>{
    if (name!==file.basename) await view.app.fileManager.renameFile(file,chainFreePath(vault,file.parent.path,name,file));
  }));
  if(!model.started&&!archived) chainAction(menu,'开始推进',()=>startPaperChain(view,model));
  chainAction(menu,'连接笔记',()=>new MarkdownFileSuggestModal(view.app,async target=>{
    if (target===file) return;
    try { const link=view.app.fileManager.generateMarkdownLink(target,file.path); await vault.process(file,s=>chainAppend(s,'关联',link)); }
    catch(error){new journalOb.Notice(error.message);}
  }).open());
  chainAction(menu,archived?'恢复':'收起',()=>view.app.fileManager.processFrontMatter(file,fm=>{fm['收起']=!archived;}));
  if(model.started&&!archived&&['灵感','待办'].includes(model.kind))chainAction(menu,'移回'+model.kind,()=>view.app.fileManager.processFrontMatter(file,fm=>{delete fm['推进中'];}));
  chainAction(menu,'删除',()=>chainDialog(view,'将「'+file.basename+'」移到废纸篓？','',()=>vault.trash(file,false),true));
  for (const [index,step] of steps.entries()) {
    const item=detail.createDiv({cls:'dwh-chain-history'});
    item.createSpan({text:step.text});
    chainAction(item,'关联笔记',()=>new MarkdownFileSuggestModal(view.app,async target=>{
      try{
        const link=view.app.fileManager.generateMarkdownLink(target,file.path);
        if(step.text.includes(link)) return;
        await vault.process(file,current=>changeChainStep(current,source,step,step.text+' '+link));
        view.api.refreshHomeViews();
      }catch(error){new journalOb.Notice(error.message);}
    }).open());
    chainAction(item,'编辑',()=>editProgressStep(view,model,step,index));
    chainAction(item,'删除',()=>confirmProgressRemoval(view,model,step,index));
  }
}

function ledgerLine(view,parent,key,placeholder,save,onSaved) {
  const form=parent.createEl('form',{cls:'ledger-entry'});
  const input=form.createEl('input',{type:'text',attr:{placeholder,'aria-label':key.startsWith('工作链/') ? key.split('/').at(-1).replace(/\.md$/,'')+'：续写进展' : placeholder,autocomplete:'off'}});
  const drafts=view.ledgerDrafts ||= new Map();
  const pending=view.ledgerPending ||= new Set();
  input.value=drafts.get(key)||'';
  function updateWidth(){
    if(key==='灵感'||key==='待办') form.classList.toggle('ledger-growing',Array.from(input.value).length>=4);
  }
  updateWidth();
  input.addEventListener('input',()=>{
    if(input.value) drafts.set(key,input.value); else drafts.delete(key);
    updateWidth();
  });
  const enter=form.createEl('button',{type:'submit',text:'↵',attr:{title:'保存','aria-label':'保存'+placeholder.replace('…','')}});
  input.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.isComposing||e.keyCode===229) return;
    e.preventDefault();form.requestSubmit();
  });
  let composing=false;
  input.addEventListener('compositionstart',()=>{composing=true;});
  input.addEventListener('compositionend',()=>{composing=false;});
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(composing) return;
    const original=input.value,text=original.trim();
    if(!text||pending.has(key)){input.focus();return;}
    pending.add(key);enter.disabled=true;
    try{
      await save(text);
      if(drafts.get(key)===original) drafts.delete(key);
      if(input.value===original){
        input.value='';
        updateWidth();
        onSaved?.();
      }
      view.api.refreshHomeViews();
    }catch(error){new journalOb.Notice(error.message||String(error));}
    finally{pending.delete(key);enter.disabled=false;}
  });
  return form;
}
const paperDragType = 'application/x-dwh-paper-chain';

function inkMotion(view, path, role) {
  view.paperPulse={path,role,until:Date.now()+1600};
}
function playInkMotion(view,el,file,role) {
  const pulse=view.paperPulse;
  if(pulse?.path!==file.path || pulse.role!==role || pulse.until<Date.now()) return;
  el.classList.add('ink-'+role);
  view.paperPulse=null;
}
async function startPaperChain(view,model) {
  const {file}=model;
  if(view.inkingFile) return;
  view.inkingFile=file;
  try {
    await view.app.fileManager.processFrontMatter(file,fm=>{
      if(fm['收起']===true) throw Error('请先恢复已收起的工作链');
      fm['推进中']=true;
    });
    inkMotion(view,file.path,'land');
    view.api.refreshHomeViews();
  } finally {view.inkingFile=null;view.paperDrag=null;view.contentEl.classList.remove('ink-dragging');}
}
function drawChainResults(view,panel,models,empty,allowDrag=false) {
  const signature=JSON.stringify(models.map(m=>[m.file.path,m.source]));
  if(panel.ledgerSignature===signature) return;
  panel.ledgerSignature=signature;
  const active=panel.ownerDocument.activeElement;
  const focused=panel.contains(active)&&active.matches('.ledger-tick input')?active.closest('[data-file]').dataset.file:null;
  const newlyChecked=new Set(Array.from(panel.querySelectorAll('.ledger-tick input:checked:not([checked])'),
    input=>input.closest('[data-file]').dataset.file));
  panel.empty();
  if (!models.length && empty) panel.createDiv({cls:'dwh-empty',text:empty});
  for(const model of models){
    const row=renderChainRow(view,panel,model,allowDrag);
    if(model.completed && newlyChecked.has(model.file.path)) row.classList.add('ledger-fresh-check');
  }
  if(focused) panel.querySelector('[data-file="'+CSS.escape(focused)+'"] .ledger-tick input')?.focus({preventScroll:true});
}
function bindPaperDrop(view,target,models) {
  const valid=e=>view.paperDrag && Array.from(e.dataTransfer?.types || []).includes(paperDragType);
  target.addEventListener('dragover',e=>{
    if(!valid(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect='move'; target.classList.add('ink-over');
  });
  target.addEventListener('dragleave',e=>{if(!target.contains(e.relatedTarget instanceof Node ? e.relatedTarget : null))target.classList.remove('ink-over');});
  target.addEventListener('drop',async e=>{
    target.classList.remove('ink-over');
    if(!valid(e)) return;
    e.preventDefault();
    const file=view.paperDrag;
    const model=models().find(m=>m.file===file && !m.archived);
    if(model && e.dataTransfer.getData(paperDragType)===file.path){
      try{await startPaperChain(view,model);}catch(error){new journalOb.Notice(error.message);}
    }
  });
}
function chainListPanel(view,panel,kind) {
  panel.createEl('h2',{cls:'dwh-panel__title',text:kind});
  const list=panel.createDiv({cls:'dwh-chain-list'});
  (view.chainLists ||= {})[kind]=list;
  ledgerLine(view,panel,kind,'写下'+kind+'…',async text=>{
    const folder=chainFolders[kind];
    await ensureFolderPath(view.app,folder);
    const file=await view.app.vault.create(chainFreePath(view.app.vault,folder,text),chainNote(text));
    inkMotion(view,file.path,'note');
  });
}
WorkstationHomeView.prototype.renderInspirations=function(panel){chainListPanel(this,panel,'灵感');};
WorkstationHomeView.prototype.renderTodos=function(panel){chainListPanel(this,panel,'待办');};

function paperManage(view,model){
  const modal=new journalOb.Modal(view.app);
  modal.setTitle(model.file.basename);
  addChainManagement(view,modal.contentEl,model);
  // The next action owns its dialog and will re-read the file after edits.
  modal.contentEl.addEventListener('click',e=>{if(e.target.closest('button'))modal.close();});
  modal.open();
}

function paperSearch(view,models){
  const dlg=new journalOb.Modal(view.app);dlg.setTitle('查找工作链');
  const box=dlg.contentEl.createEl('input',{type:'search',cls:'paper-search-field',attr:{placeholder:'搜标题或进展（含已收起）','aria-label':'查找工作链'}});
  const only=dlg.contentEl.createEl('label',{cls:'paper-search-filter'});
  const check=only.createEl('input',{type:'checkbox'});only.appendText(' 只看已收起');
  const list=dlg.contentEl.createDiv({cls:'paper-search-results'});
  const draw=()=>{
    list.empty();const q=box.value.trim().toLocaleLowerCase();
    for(const m of models.filter(m=>(!check.checked||m.archived)&&(m.file.basename+'\n'+m.source).toLocaleLowerCase().includes(q))){
      const item=list.createDiv({cls:'paper-search-item'});
      chainAction(item,(m.archived?'已收起 · ':'')+m.file.basename,()=>{dlg.close();return view.openFile(m.file);});
      chainAction(item,'管理',()=>{dlg.close();paperManage(view,m);});
    }
    if(!list.childElementCount)list.createDiv({cls:'dwh-empty',text:'没有匹配的工作链'});
  };
  box.addEventListener('input',draw);check.addEventListener('change',draw);draw();dlg.open();box.focus();
}

function releaseTrail(view,trail){
  if(!trail.renderer) return;
  view.removeChild(trail.renderer);
  view.trailRenderers.delete(trail.renderer);
  trail.renderer=null;
}
function drawTrail(view,trail,model){
  trail.empty();
  trail.source=model.source;
  if(!model.steps.length){
    trail.setAttribute('aria-label','尚未记录进展');
    return;
  }
  trail.setAttribute('aria-label',model.file.basename+'的全部进展');
  model.steps.forEach((step,index)=>{
    const item=trail.createEl('li',{cls:'ledger-trail-step'});
    const last=index===model.steps.length-1;
    if(last) item.setAttribute('aria-current','step');
    const edit=()=>editProgressStep(view,model,step,index);
    const hasMarkup=step.text.includes('[');
    if(!hasMarkup){
      const text=item.createEl('button',{type:'button',cls:'ledger-step-text ledger-editable',attr:{title:'点击修改或删除这一步'}});
      text.createSpan({cls:'ledger-ink-words',text:step.text});
      text.addEventListener('click',edit);
      return;
    }
    const content=item.createSpan({cls:'ledger-step-text',attr:{title:'点击文字修改，点击链接打开笔记'}});
    content.addEventListener('click',event=>{
      if(!event.target.closest('a,button,input,textarea')&&!view.contentEl.ownerDocument.getSelection()?.toString()) edit();
    });
    const editLinkStep=item.createEl('button',{type:'button',cls:'ledger-link-edit',text:'修改',attr:{'aria-label':'修改这一步进展'}});
    editLinkStep.addEventListener('click',edit);
    if(!trail.renderer){
      trail.renderer=view.addChild(new journalOb.Component());
      view.trailRenderers.add(trail.renderer);
    }
    journalOb.MarkdownRenderer.render(view.app,step.text,content,model.file.path,trail.renderer)
      .catch(()=>content.setText(step.text));
    content.addEventListener('click',e=>{
      const link=e.target.closest?.('a.internal-link');
      if(!link) return;
      e.preventDefault();e.stopPropagation();
      view.app.workspace.openLinkText(link.dataset.href||link.getAttribute('href'),model.file.path,e.ctrlKey||e.metaKey);
    },true);
  });
}
function drawPaperBoard(view,host,active){
  if(!host.querySelector('.paper-board-head')){
    const head=host.createDiv({cls:'paper-board-head'});
    for(const label of ['工作链','进展过程','续写进展']) head.createSpan({text:label});
  }
  const rows=new Map([...host.querySelectorAll('.paper-chain-line')].map(r=>[r.dataset.file,r]));
  host.querySelector('.paper-board-empty')?.remove();
  for(const model of active){
    const {file,steps}=model;
    let row=rows.get(file.path);
    if(!row){
      row=host.createDiv({cls:'paper-chain-line'});row.dataset.file=file.path;
      const name=chainAction(row,file.basename,()=>view.openFile(file));
      name.classList.add('paper-chain-name');
      const sequence=row.createDiv({cls:'ledger-sequence'});
      sequence.createEl('ol',{cls:'ledger-trail',attr:{'aria-label':file.basename+'的全部进展'}});
      ledgerLine(view,sequence,file.path,'接着写…',async text=>{
        await view.app.vault.process(file,source=>chainAppend(source,'进展',text));
        inkMotion(view,file.path,'write');
      });
      const manage=chainAction(row,'•••',()=>paperManage(view,row.ledgerModel));
      manage.classList.add('ledger-more');manage.title='管理工作链';manage.setAttribute('aria-label','管理或删除 '+file.basename);
    }
    rows.delete(file.path);
    row.ledgerModel=model;
    const trail=row.querySelector('.ledger-trail');
    if(trail.source!==model.source){
      releaseTrail(view,trail);
      drawTrail(view,trail,model);
    }
    playInkMotion(view,row,file,'land');
    if(trail.lastElementChild) playInkMotion(view,trail.lastElementChild,file,'write');
  }
  for(const row of rows.values()){
    releaseTrail(view,row.querySelector('.ledger-trail'));
    row.remove();
  }
  if(!active.length) host.createDiv({cls:'paper-board-empty',text:'把灵感或待办拖到这里，或新建一条工作链。'});
}
WorkstationHomeView.prototype.renderDocumentLines=function(panel) {
  const root=this.contentEl||this.containerEl.children[1];root.classList.add('ink-home','paper-overview');
  root.classList.add('ink-ledger');
  for(const renderer of this.trailRenderers||[]) this.removeChild(renderer);
  this.trailRenderers=new Set();
  const bar=panel.createDiv({cls:'ink-work-heading'});
  bar.createEl('h2',{cls:'dwh-panel__title',text:'工作链'});
  let models=[];

  const add=chainAction(bar,'＋',()=>chainDialog(this,'新建工作链','',async value=>{
    const folder=chainFolders['独立工作链'];
    await ensureFolderPath(this.app,folder);
    const file=await this.app.vault.create(chainFreePath(this.app.vault,folder,value),chainNote(value));
    inkMotion(this,file.path,'land');this.api.refreshHomeViews();
  }));
  add.classList.add('ledger-add');
  add.title='新建工作链';
  add.setAttribute('aria-label',add.title);
  const find=chainAction(bar,'查找',()=>paperSearch(this,models));
  find.classList.add('ledger-search');find.title='查找工作链';find.setAttribute('aria-label',find.title);
  const diary=chainAction(bar,'日记',()=>this.api.activateJournal());
  diary.classList.add('ledger-diary');
  diary.title='打开日记';
  diary.setAttribute('aria-label',diary.title);
  const graph=chainAction(bar,'',async()=>{
    const ws=this.app.workspace;let leaf=ws.getLeavesOfType('graph')[0];
    if(!leaf){leaf=ws.getLeaf('tab');await leaf.setViewState({type:'graph',active:true});}
    await ws.revealLeaf(leaf);ws.setActiveLeaf(leaf,{focus:true});
  });
  graph.classList.add('ink-graph');graph.title='打开关系图';graph.setAttribute('aria-label','打开关系图');
  const divider=panel.createDiv({cls:'ledger-divider',attr:{'aria-hidden':'true'}});
  const board=panel.createDiv({cls:'paper-board'});
  panel.append(divider);
  bindPaperDrop(this,panel,()=>models);
  let revision=0;
  this.reloadLedger=async()=>{
    const ticket=++revision;
    const vault=this.app.vault;
    const loaded=await Promise.all(vault.getMarkdownFiles().filter(chainKind).map(async file=>{
      const source=await vault.cachedRead(file);
      const head=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
      const fm=head?journalOb.parseYaml(head[1]):{};
      const kind=chainKind(file);
      const standalone=kind==='原有工作链'||kind==='独立工作链';
      return {file,source,steps:chainSteps(source),kind,completed:fm?.['已完成']===true,archived:fm?.['收起']===true,started:standalone||fm?.['推进中']===true};
    }));
    if(!panel.isConnected||ticket!==revision)return;
    models=loaded;
    models.sort((a,b)=>b.file.stat.mtime-a.file.stat.mtime||a.file.path.localeCompare(b.file.path));
    drawPaperBoard(this,board,models.filter(m=>m.started&&!m.archived));
    for(const kind of ['灵感','待办']){
      const items=models.filter(m=>m.kind===kind&&!m.archived&&!m.started);
      if(kind==='待办') items.sort((a,b)=>b.file.stat.ctime-a.file.stat.ctime||a.file.path.localeCompare(b.file.path));
      drawChainResults(this,this.chainLists[kind],items,'还没有'+kind,true);
    }
  };
  this.chainLoad=this.reloadLedger().catch(e=>new journalOb.Notice('工作链读取失败：'+e.message));
  if(!this.ledgerWatching){
    this.ledgerWatching=true;
    const changed=(file,oldPath='')=>{
      if(!chainKind(file)&&!String(oldPath).startsWith('工作链/')) return;
      clearTimeout(this.ledgerTimer);
      this.ledgerTimer=setTimeout(()=>this.api.refreshHomeViews(),180);
    };
    for(const event of ['create','modify','delete','rename']) this.registerEvent(this.app.vault.on(event,changed));
    this.register(()=>clearTimeout(this.ledgerTimer));
  }
};




