# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

查找正式发表版本、补全 DOI 并修正文献信息，保留原 Zotero 条目。

## 安装与使用

需要 Zotero 10。通过 **工具 → 插件 → 从文件安装插件** 安装 XPI。选中文献后，右键选择 **Metadata Fixer**。

插件直接更新所选条目，并在同一个窗口中显示进度和结果。处理结束后，结果会保留，直到你关闭窗口。运行期间可以继续添加文献，重复条目不会重复处理；取消或关闭窗口会停止待处理任务。

## 更新内容

- 为预印本和仓储记录查找正式发表版本。
- 找到可靠匹配后，补全缺失的 DOI。
- 补充缺失字段，修正明确的元数据错误。
- 按所选规则统一论文集名称。

插件先使用标识符和发表链接检索，再尝试按标题查找。更新前会核对标题、作者和发表状态，无法确认或存在冲突的记录会跳过；某个来源失败不会中断其他检索。检索来源包括 Zotero 翻译器、Crossref、PubMed、Semantic Scholar、DBLP、OpenReview 和 Google Scholar，出版社页面用于核实记录和补充字段。

更新保留原条目及其附件、批注、笔记、集合、标签和关系。空结果不会清空已有字段，仅大小写或空格不同的值也会保留。预印本标识符留在 Extra 中；如果你在检索期间修改条目，过期结果不会覆盖这些改动。

## 设置

在 **设置 → Metadata Fixer** 中选择论文集名称的写法：**原名**、**标准全名** 或 **缩写**。默认保留原名。格式化作用于 Proceedings Title，去掉届数和年份，保留论文日期，不新增或改写 Conference Name。可修正错放的论文集名称、条目类型和 editor；真正的期刊及次级会场受到保护。

匹配时先清理年份、届次等变化，再依次尝试完整名称、主题词和缩写。未知或有歧义的名称保留原值；workshop 等分会场单独识别。

会议规则包含 CCF 目录、补充会议及独立的 workshop 分会场。来源记录见 `data/conferences.json`、`data/conference-catalog.json` 和 `data/conference-supplements.json`。

## 当前限制

不提供自动扫描、定时更新、PDF 下载、标题大小写或标签管理。插件更新需手动安装 XPI。

## 开发

需要 Node.js 22.13+（22.x）或 24+。依次运行 `npm ci`、`npm run check`。

- `npm run build`：输入未变化时复用有效产物。
- `npm run build:force`：强制重建。
- `npm run check`：格式、测试和类型检查；复用有效 XPI。
- `npm run release`：完整检查后，在 `release/v<版本>/` 准备 XPI、`SHA256SUMS` 和 `updates.json`。

`npm run test:host` 使用临时配置及网络测试数据，检查取消本地 HTTP 请求和 Zotero 正常退出。真实在线检索仍需在测试文献库中验证。本地发布准备不创建 tag 或上传文件。共同开发规范见工作区根目录 `AGENTS.md`。

`src/providers.ts` 负责发现正式版本，返回候选记录；`src/translate.ts` 通过 Zotero 翻译器取回记录，通用页面线索、字段映射及补全位于 `src/metadata.ts`；`src/venues.ts` 负责会议匹配与字段映射，`src/conferences.ts` 在取回后应用目录和命名规则。特定会议的名称和别名写入 JSON 目录，不在任务流程中新增分支。出版社专用检索作为兜底，不替代翻译器和名称规则。

## 许可证

[AGPL-3.0-or-later](LICENSE)。参考项目和第三方许可证见 `THIRD-PARTY-NOTICES`。
