/* 可维护的日记与外观扩展；构建时接在现有稳定运行版本后。 */
const JOURNAL_VIEW = 'dandan-paper-journal';
const journalOb = require('obsidian');
const JOURNAL_HEADINGS = ['今天有什么要写的', '今天学到的东西', '今天有什么要反思的'];
function journalSection(line) {
  const h = line.replace(/^##\s+/, '').replace(/[？?：:]\s*$/, '').trim();
  if (['今天有什么要写的', '今天发生了什么'].includes(h)) return 0;
  if (['今天学到的东西', '今天最大的收获是什么', '今天最大的收获'].includes(h)) return 1;
  if (['今天有什么要反思的', '有什么需要反思的', '今天有什么需要反思的'].includes(h)) return 2;
  return -1;
}
function parseJournal(source) {
  const fm = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const meta = fm ? journalOb.parseYaml(fm[1]) || {} : {};
  if (typeof meta !== 'object' || Array.isArray(meta)) throw new Error('日记属性格式无法识别，请用原文编辑');
  const body = fm ? source.slice(fm[0].length) : source;
  const parts = ['', '', ''];
  let active = 0, fence = null;
  for (const line of body.split(/\r?\n/)) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      parts[active] += line + '\n'; continue;
    }
    const section = !fence && /^##\s+/.test(line) ? journalSection(line) : -1;
    if (section >= 0) { active = section; continue; }
    parts[active] += line + '\n';
  }
  return { meta, title: String(meta['标题'] ?? ''), mood: String(meta['心情'] ?? ''), weather: String(meta['天气'] ?? ''), parts: parts.map(p => p.replace(/^\n+|\n+$/g, '')) };
}
function serializeJournal(model, date) {
  const meta = { ...model.meta, '日期': model.meta['日期'] ?? date, '标题': model.title, '心情': model.mood, '天气': model.weather };
  return '---\n' + journalOb.stringifyYaml(meta).trimEnd() + '\n---\n\n' + JOURNAL_HEADINGS.map((h, i) => '## ' + h + '\n\n' + model.parts[i].replace(/^\n+|\n+$/g, '') + '\n').join('\n') + '\n';
}
function journalNewContent(date) {
  const ds = formatLocalDate(date);
  return serializeJournal({ meta: { '星期': WEEKDAYS_ZH[weekdayOf(date)].replace('周', '星期') }, title: '', mood: '', weather: '', parts: ['', '', ''] }, ds);
}
function journalEl(parent, tag, cls, text) {
  const el = parent.createEl(tag, { cls, text }); return el;
}
function journalButton(parent, text, callback, cls = '') {
  const el = journalEl(parent, 'button', 'dwh-btn ' + cls, text);
  el.type = 'button';
  el.addEventListener('click', () => Promise.resolve(callback()).catch(e => { console.error(e); new journalOb.Notice(e.message || '操作失败'); }));
  return el;
}
class JournalSearchModal extends journalOb.SuggestModal {
  constructor(view) {
    super(view.app);
    this.view = view;
    this.setPlaceholder('按日期或标题查找日记');
    this.emptyStateText = '没有找到日记';
    this.modalEl.classList.add('journal-search-paper');
    this.rows = view.plugin.repo.listAll().sort((a,b) => b.date.localeCompare(a.date)).map(ref => {
      const file = view.app.vault.getAbstractFileByPath(ref.path);
      const meta = file && view.app.metadataCache.getFileCache(file)?.frontmatter;
      const title = ref.path === view.path ? view.model.title : String(meta?.['标题'] || '');
      return {ref, title};
    });
  }
  getSuggestions(input) {
    const query = input.trim().toLowerCase();
    return this.rows.filter(({ref,title}) => (ref.date + ' ' + title).toLowerCase().includes(query));
  }
  renderSuggestion({ref,title}, el) {
    el.createEl('strong', {text:ref.date});
    if (title) el.createSpan({text:'　' + title});
  }
  async onChooseSuggestion({ref}) { await this.view.openPath(ref.path); }
}
class PaperJournalView extends journalOb.ItemView {
  constructor(leaf, plugin) {
    super(leaf); this.plugin = plugin; this.path = ''; this.source = ''; this.dirty = false; this.revision = 0; this.savePromise = null; this.timer = null; this.navigating = false; this.loadToken = 0;
  }
  getViewType() { return JOURNAL_VIEW; }
  getDisplayText() { return '我的日记'; }
  getIcon() { return 'notebook-pen'; }
  getState() { return { path: this.path }; }
  async setState(state, result) {
    if (state && typeof state.path === 'string' && state.path) await this.openPath(state.path);
    if (super.setState) await super.setState(state, result);
  }
  async onOpen() {
    const root = this.contentEl || this.containerEl.children[1];
    this.paperSizes = new Map();
    this.paperObserver = new ResizeObserver(entries => {
      for (const {target, contentRect} of entries) {
        const entry = this.paperSizes.get(target);
        if (entry && entry.width !== contentRect.width) {
          entry.width = contentRect.width;
          entry.fit();
        }
      }
    });
    this.register(() => this.paperObserver.disconnect());
    this.registerDomEvent(root.ownerDocument.fonts, 'loadingdone', () => {
      for (const entry of this.paperSizes.values()) entry.fit();
    });
    this.registerEvent(this.app.vault.on('modify', file => {
      if (file.path === this.path && !this.savePromise) {
        if (!this.dirty) void this.loadPath(this.path);
        else if (this.status) this.status.textContent = '原文已变化，请先保存或处理冲突';
      }
    }));
    for (const event of ['create', 'delete', 'rename']) this.registerEvent(this.app.vault.on(event, () => { void this.renderStack(); }));
    this.register(() => { clearTimeout(this.timer); });
    if (this.path) await this.loadPath(this.path);
    else {
      const ref = this.plugin.repo.listAll().sort((a,b) => b.date.localeCompare(a.date))[0];
      if (ref) await this.loadPath(ref.path);
      else { const f = await this.plugin.repo.createOrOpen(todayLocalDate()); await this.loadPath(f.path); }
    }
  }
  async onClose() { clearTimeout(this.timer); await this.flush(); }
  async openPath(path) {
    if (this.navigating) return;
    this.navigating = true;
    try { if (await this.flush()) await this.loadPath(path); }
    finally { this.navigating = false; }
  }
  async loadPath(path) {
    const token = ++this.loadToken;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof journalOb.TFile)) throw new Error('找不到这篇日记');
    const source = await this.app.vault.read(file);
    const model = parseJournal(source);
    if (token !== this.loadToken) return;
    this.path = path; this.source = source; this.model = model; this.dirty = false;
    const draft = this.plugin.journalDrafts[path];
    if (draft) {
      this.model = draft.model; this.dirty = true; this.revision++;
      this.source = draft.source;
      new journalOb.Notice(draft.source === source ? '已恢复未保存的日记草稿' : '已恢复草稿；原文有变化，可另存草稿后处理');
    }
    this.render(); await this.renderStack();
  }
  render() {
    const root = this.contentEl || this.containerEl.children[1]; root.empty(); root.addClass('dwh-journal');
    this.paperObserver?.disconnect();
    this.paperSizes?.clear();
    const layout = root.createDiv({ cls: 'dwh-journal__layout' });
    const aside = layout.createEl('aside', { cls: 'dwh-journal__aside' });
    const calendar=aside.createDiv({cls:'paper-journal-calendar'});
    void renderHomeDiaryCard(calendar,this.plugin,async()=>{if(await this.flush())await this.plugin.activateCalendar();}).catch(e=>new journalOb.Notice(e.message));
    this.stack = aside.createDiv({ cls: 'dwh-journal__stack' });
    const paper = layout.createDiv({ cls: 'dwh-journal__paper' });
    const date = this.path.split('/').pop().replace(/\.md$/, '');
    const parsed = parseDateFromName(date, this.plugin.getSettings().diaryDateFormat);
    journalEl(paper, 'div', 'dwh-journal__date', parsed ? `${parsed.year}年${parsed.month}月${parsed.day}日  ${WEEKDAYS_ZH[weekdayOf(parsed)].replace('周', '星期')}` : date);
    const pageActions = paper.createDiv({cls:'journal-page-actions'});
    const home = journalButton(pageActions, '', async () => {
      if (await this.flush()) await this.plugin.activateHome();
    }, 'journal-home-icon');
    home.title = '回到工作台';
    home.setAttribute('aria-label', home.title);
    journalOb.setIcon(home, 'home');
    const search = journalButton(pageActions, '', () => new JournalSearchModal(this).open(), 'journal-search-icon');
    search.title = '搜索日记';
    search.setAttribute('aria-label', '搜索日记');
    journalOb.setIcon(search, 'search');
    const titleLabel = paper.createEl('label', { cls: 'dwh-journal__title-label' });
    const title = titleLabel.createEl('input', { cls: 'dwh-journal__title', attr: { placeholder: '给今天起个标题', 'aria-label': '标题' } }); title.value = this.model.title;
    title.addEventListener('input', () => this.edit(() => { this.model.title = title.value; }));
    const meta = paper.createDiv({ cls: 'dwh-journal__meta' });
    for (const [key, name, hint] of [['mood', '心情', '写下心情'], ['weather', '天气', '写下天气']]) {
      const label = meta.createEl('label');
      label.createSpan({ cls: 'dwh-journal__meta-name', text: name + '：' });
      const input = label.createEl('input', { attr: { placeholder: hint, 'aria-label': name } }); input.value = this.model[key];
      input.addEventListener('input', () => this.edit(() => { this.model[key] = input.value; }));
    }
    JOURNAL_HEADINGS.forEach((heading, i) => {
      const block = paper.createEl('section', { cls: 'dwh-journal__section' });
      const head = block.createDiv({cls:'journal-segment-heading'});
      head.createEl('span', {cls:'journal-segment-tab', text:heading});
      const edit = journalButton(head, '编辑本段', () => this.openBlocks(i), 'ink-section-edit');
      edit.setAttribute('aria-label', '编辑' + heading);
      edit.title = '编辑本段';
      const field = block.createDiv({cls:'journal-writing-field'});
      const area = field.createEl('textarea', {cls:'dwh-journal__writing', attr:{
        rows:'1', 'aria-label':heading, placeholder:'在这里写下……', spellcheck:'false'
      }});
      area.value = this.model.parts[i];
      // The hidden copy wraps exactly like the editor, without collapsing the active input to measure it.
      const measure = area.cloneNode(false);
      measure.classList.add('journal-writing-measure');
      measure.removeAttribute('aria-label');
      measure.setAttribute('aria-hidden','true');
      measure.inert = true;
      field.appendChild(measure);
      const fit = () => {
        if (!field.clientWidth) return;
        measure.value = area.value;
        const height = measure.scrollHeight;
        if (height > 0 && area.style.height !== height + 'px') area.style.setProperty('height', height + 'px', 'important');
      };
      fit();
      this.paperSizes?.set(field, {width:field.clientWidth,fit});
      this.paperObserver?.observe(field);
      area.addEventListener('input', () => {
        fit();
        this.edit(() => { this.model.parts[i] = area.value; });
      });
    });
    const foot = paper.createDiv({ cls: 'dwh-journal__footer' });
    this.prev = journalButton(foot, '‹ 上一篇', () => this.adjacent(1));
    this.status = journalEl(foot, 'span', 'dwh-journal__status', this.dirty ? '已恢复草稿，等待保存' : '已保存');
    this.next = journalButton(foot, '下一篇 ›', () => this.adjacent(-1));
    const tools = root.createDiv({ cls: 'dwh-journal__tools' });
    journalButton(tools, '保存', () => this.flush());
    journalButton(tools, '另存草稿', () => this.saveDraftAsFile());
  }
  async openBlocks(section=0) {
    if (!await this.flush()) return;
    const file=this.app.vault.getAbstractFileByPath(this.path);
    if (!(file instanceof journalOb.TFile)) return;
    const ws=this.app.workspace;
    const leaf=ws.getLeavesOfType('markdown').find(l=>l.view.file?.path===file.path)||ws.getLeaf('tab');
    await leaf.openFile(file,{active:true,state:{mode:'source',source:false}});
    await ws.revealLeaf(leaf);
    const editor=leaf.view.editor;
    if (!editor) return;
    const lines=editor.getValue().split(/\r?\n/);
    const at=lines.findIndex(line=>/^##\s+/.test(line)&&journalSection(line)===section);
    if(at>=0){const pos={line:Math.min(at+1,lines.length-1),ch:0};editor.setCursor(pos);editor.scrollIntoView({from:pos,to:pos},true);}
    editor.focus();
  }
  async renderStack() {
    if (!this.stack || !this.path) return;
    const token = this.stackToken = (this.stackToken || 0) + 1;
    const entries = this.plugin.repo.listAll().sort((a,b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path));
    this.entries = entries;
    const models = await Promise.all(entries.map(async ref => {
      const file = this.app.vault.getAbstractFileByPath(ref.path);
      if (!file) return null;
      try { const content = await this.app.vault.cachedRead(file); const model = parseJournal(content); return {ref, model, excerpt: extractExcerpt(content)}; } catch { return {ref, model: {title: ''}, excerpt: '点击在日记中查看'}; }
    }));
    if (token !== this.stackToken) return;
    this.stack.empty();
    const shown = models.filter(Boolean);
    const count = Math.max(7, this.plugin.getSettings().recentDiaryCount || 7);
    for (const { ref, model, excerpt } of shown.slice(0, count)) {
      const card = journalButton(this.stack, '', () => this.openPath(ref.path), 'dwh-journal__sheet' + (ref.path === this.path ? ' is-selected' : ''));
      card.setAttribute('aria-current', ref.path === this.path ? 'page' : 'false');
      journalEl(card, 'strong', 'dwh-journal__sheet-date', ref.date);
      if (model.title) journalEl(card, 'span', 'dwh-journal__sheet-title', model.title);
      journalEl(card, 'span', 'dwh-journal__sheet-excerpt', excerpt || '还没有写下内容');
    }
    if (!shown.length) journalEl(this.stack, 'p', '', '没有找到日记');
    const index = entries.findIndex(x => x.path === this.path);
    if (this.prev) this.prev.disabled = index < 0 || index >= entries.length - 1;
    if (this.next) this.next.disabled = index <= 0;
  }
  async adjacent(delta) { const i = this.entries.findIndex(x => x.path === this.path); const ref = this.entries[i + delta]; if (ref) await this.openPath(ref.path); }
  edit(change) {
    change(); this.dirty = true; this.revision++;
    this.status.textContent = '未保存'; clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 800);
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.savePromise) { const result = await this.savePromise; if (!result) return false; }
    if (!this.dirty || !this.path) return true;
    const path = this.path, source = this.source, revision = this.revision;
    const model = JSON.parse(JSON.stringify(this.model));
    this.status.textContent = '保存中…';
    this.savePromise = (async () => {
      try {
        this.plugin.journalDrafts[path] = { source, model };
        await this.plugin.saveJournalDrafts();
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof journalOb.TFile)) throw new Error('原文件已移除，草稿已保留');
        const date = model.meta['日期'] || path.split('/').pop().replace(/\.md$/, '');
        const output = serializeJournal(model, date);
        await this.app.vault.process(file, current => {
          if (current !== source) throw new Error('原文已被其他窗口修改，草稿已保留；请另存草稿后处理');
          return output;
        });
        this.source = output;
        if (revision === this.revision) this.dirty = false;
        delete this.plugin.journalDrafts[path]; await this.plugin.saveJournalDrafts();
        this.status.textContent = this.dirty ? '未保存' : '已保存 ' + new Date().toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
        return true;
      } catch (e) { this.status.textContent = e.message; new journalOb.Notice(e.message); return false; }
    })();
    const ok = await this.savePromise; this.savePromise = null;
    if (ok && this.dirty) return this.flush();
    if (ok) void this.renderStack();
    return ok;
  }
  async saveDraftAsFile() {
    const base = this.path.replace(/\.md$/, '') + '-草稿-' + Date.now() + '.md';
    await this.app.vault.create(base, serializeJournal(this.model, this.model.meta['日期'] || this.path.split('/').pop().replace(/\.md$/, '')));
    new journalOb.Notice('草稿已另存为 ' + base);
  }
}
async function installPaperJournal(plugin) {
  const base = plugin.manifest.dir || plugin.app.vault.configDir + '/plugins/' + plugin.manifest.id;
  const readJson = async (name, fallback) => { try { return JSON.parse(await plugin.app.vault.adapter.read(base + '/' + name)); } catch { return fallback; } };
  plugin.journalDrafts = await readJson('journal-drafts.json', {});
  plugin.saveJournalDrafts = () => plugin.app.vault.adapter.write(base + '/journal-drafts.json', JSON.stringify(plugin.journalDrafts, null, 2));
  document.body.dataset.dwhMode = 'dark';
  delete document.body.dataset.dwhPalette;
  const markDiaryEditors=()=>{
    const folder=plugin.repo.folderPath()+'/';
    for(const leaf of plugin.app.workspace.getLeavesOfType('markdown')){
      const v=leaf.view, file=v.file;
      const isDiary=!!file && file.path.startsWith(folder) && !!parseDateFromName(file.basename,plugin.getSettings().diaryDateFormat);
      v.containerEl?.classList.toggle('ink-diary-editor',isDiary);
    }
  };
  for(const event of ['file-open','layout-change','active-leaf-change'])plugin.registerEvent(plugin.app.workspace.on(event,markDiaryEditors));
  plugin.app.workspace.onLayoutReady(markDiaryEditors);
  plugin.register(()=>document.querySelectorAll('.ink-diary-editor').forEach(el=>el.classList.remove('ink-diary-editor')));
  plugin.register(() => { delete document.body.dataset.dwhMode; delete document.body.dataset.dwhPalette; });
  plugin.registerView(JOURNAL_VIEW, leaf => new PaperJournalView(leaf, plugin));
  plugin.activateJournal = async path => {
    let leaf = plugin.app.workspace.getLeavesOfType(JOURNAL_VIEW)[0];
    if (!leaf) { leaf = plugin.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: JOURNAL_VIEW, active: true }); }
    await plugin.app.workspace.revealLeaf(leaf); plugin.app.workspace.setActiveLeaf(leaf, {focus:true}); await leaf.loadIfDeferred?.(); if(path) await leaf.view.openPath(path);
  };
  plugin.repo.openDiary = async ref => plugin.activateJournal(ref.path);
  plugin.addCommand({ id: 'open-paper-journal', name: '打开纸张日记', callback: async () => { const f = await plugin.repo.createOrOpen(todayLocalDate()); await plugin.activateJournal(f.path); } });
  plugin.addRibbonIcon('notebook-pen', '打开纸张日记', async () => { const f = await plugin.repo.createOrOpen(todayLocalDate()); await plugin.activateJournal(f.path); });
  plugin.register(() => plugin.app.workspace.detachLeavesOfType(JOURNAL_VIEW));
  plugin.refreshHomeViews();
}
const originalJournalOnload = WorkstationHomePlugin.prototype.onload;
WorkstationHomePlugin.prototype.onload = async function () { await originalJournalOnload.call(this); await installPaperJournal(this); };
const originalPaperHomeDiary = renderHomeDiaryCard;
renderHomeDiaryCard = async function (container, api, onOpenCalendar) {
  await originalPaperHomeDiary(container, api, onOpenCalendar);
  const title = container.querySelector('.dwh-panel__title');
  if (title) title.textContent = '日记';
  const today = container.querySelector('.dwh-diary__today');
  const preview = container.querySelector('.dwh-diary__preview');
  const calendar = container.querySelector('.dwh-diary__mini-cal');
  const foot = container.querySelector('.dwh-diary__foot');
  if (!today || !preview || !calendar) return;
  const body = container.createDiv({ cls: 'dwh-home-diary-body' });
  body.appendChild(calendar);
  const sheet = body.createDiv({ cls: 'dwh-home-journal-preview' });
  sheet.appendChild(today); sheet.appendChild(preview);
  if (container.classList.contains('paper-journal-calendar')) {
    foot?.remove();
    return;
  }
  if (foot) {
    const write=today.querySelector('.dwh-diary__write');
    if (write) foot.prepend(write);
    container.appendChild(foot);
  }
};
buildDefaultDiaryContent = date => journalNewContent(date);

WorkstationHomeView.prototype.getDisplayText = function () { return "工作台"; };

