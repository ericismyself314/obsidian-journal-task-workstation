# Obsidian 日记与任务工作站

一张黑纸工作台，用来随手记灵感、勾掉待办，也能沿着工作链找回上次做到哪一步。「灵感」和「待办」并排放在两张便签上，沿用日记页的纸纹、斜胶带和卷角。纸面会随内容增减，窄窗口下自动调整布局。

![工作台的灵感和待办便签，使用示例内容](docs/images/workbench-memos.png)

## 功能

- 工作链从起点到当前进展按顺序显示，可以增删和修改步骤，也能链接笔记。
- 灵感和待办可以直接录入，拖到工作链区域即可开始跟进。
- 日记按日历浏览，标题、心情和天气都可手写输入。正文分为记录、学习和反思三段，纸面随输入增长。当天可新建日记，已有日记可继续编辑。

## 安装或升级

1. 从[最新发布](https://github.com/ericismyself314/obsidian-journal-task-workstation/releases/latest)下载工作站安装包并解压。
2. 将 `plugins/dandan-workstation-home` 放入你的仓库 `.obsidian/plugins/`。升级时只覆盖安装包中的程序文件，保留已有 `data.json`、`appearance-preferences.json` 和 `journal-drafts.json`。
3. 将 `snippets/` 中的 CSS 放入 `.obsidian/snippets/`，在「设置 → 外观 → CSS 代码片段」启用 `codex-homepage` 和 `beige-workstation`。
4. 在「设置 → 第三方插件」启用「Obsidian 日记与任务工作站」，重启或重新加载 Obsidian。

命令面板可打开工作台、纸张日记和日记日历。默认日记文件夹为 `日记`；可以在插件设置中修改。

插件 ID 保持 `dandan-workstation-home`，以便已有用户直接升级。不要用整个 `.obsidian` 文件夹覆盖个人仓库设置；仓库中的通用配置仅供新建仓库参考。

## 数据与旧日记

个人日记仍存为仓库中的 Markdown。项目不上传日记、灵感、待办、工作进展、运行缓存、草稿或工作区布局。

旧日记打开时不会被自动迁移。编辑保存后，自由记录和旧版收获／反思章节会映射到新结构，保留其他属性及正文内容。

## 开发与验证

```sh
npm install
npm run build
npm run check
npm test
npx playwright install chromium
npm run test:ui
```

当前源码位于 `.obsidian/plugins/dandan-workstation-home/`：

- `runtime-base.js`：保留原有工作台、日历和文档功能的运行基线。
- `journal-extension.js`：日记编辑、草稿保护、主题切换与项目名称。
- `home-paging.js`：自适应分页、展开编辑与输入状态保留。
- `build-paper-journal.cjs`：将以上文件合成为 `main.js`，无需 TypeScript 工具链。
- `paper-journal.css`、`home-paper.css`、`home-paging.css`：日记与工作台样式；运行样式分别合入 `styles.css` 和 `beige-workstation.css`。

测试使用独立的示例数据。工作台预览截自使用示例数据的 Obsidian 测试库；通过这些检查不代表所有 Obsidian 版本或第三方主题都已完成实际窗口验收。

## License

MIT
