# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

[English](README.md) | **简体中文**

查找正式发表版本，在原 Zotero 条目中修复元数据。

## 安装与使用

需要 Zotero 10。从 [Releases](https://github.com/lzcn/zotero-metadata-fixer/releases/latest) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装。

选中条目，右键选择 **Metadata Fixer**。结果窗口显示进度和状态，鼠标悬停可查看详情，点击行可选中对应条目；取消或关闭窗口会停止未完成的工作。

插件可查找正式版本、补全 DOI 和字段、修正条目类型、统一论文集名称，并按设置更新 PDF。更新保留批注、笔记、集合、标签和关系；无批注的旧主 PDF 在成功替换后移入回收站。检索期间修改条目会停止其更新，空结果保留已有字段。

## 设置

- 论文集名称使用原名、标准全名或缩写。
- 在 Zotero 原生列显示出版物简称；请关闭 Zotero Style 的 Publication Column，避免冲突。
- PDF 更新默认开启：有批注则跳过，否则保留最新版，正式发表版优先于 arXiv 版；需要出版社访问权限。
- 可选填 [Semantic Scholar API key](https://www.semanticscholar.org/product/api#api-key-form)，保存在本机，仅发送给 `api.semanticscholar.org`。

检索使用 Zotero 翻译器及学术元数据服务，跳过冲突或未核验的结果。手动运行更新，通过 XPI 安装插件更新。

## 更新流程

优先使用标识符及正式发表页面。标题检索从 Crossref/OpenAlex 开始，仅在需要时扩展到 DBLP/OpenReview 和后续来源。可靠匹配会停止继续搜索，候选冲突会停止自动更新。Semantic Scholar 保持可选。请求跨批次共享缓存、限流和冷却，访问受限时暂停该来源。

```mermaid
flowchart LR
  A[选中条目] --> B[查找正式版本]
  B --> C[核验并修复原条目]
  C --> D{已开启 PDF 更新且无批注?}
  D -->|arXiv| E[比较附件实际版本与 arXiv 版本]
  D -->|已发表| F[检查出版社 PDF 校验标记与哈希]
  E --> G[核验成功后替换旧主 PDF]
  F --> G
```

arXiv 版本来自附件首页或经过哈希核验的下载缓存，不根据条目元数据猜测；无法识别本地版本时下载并比较文件哈希。正式版 PDF 保留条件请求和文件去重。有批注时只跳过 PDF 更新，元数据仍可修复。核验成功的新版会替换旧主 PDF，包括从 arXiv 转为正式发表版的情况。原条目 ID 和补充文件均会保留。

结果窗口以 Bear 配色为基础，采用固定样式、紧凑表格和系统字体。颜色跟随系统的浅色或深色外观；设置页使用 Zotero 原生控件。

## 开发

需要 Node.js 22.13+（22.x）或 24+。

```sh
npm ci
npm run check
npm run build
```

产物：`dist/zotero-metadata-fixer.xpi`。`npm run test:host` 使用临时 Zotero 目录；`npm run release` 在 `release/v<版本>/` 准备本地文件，不上传。

## 致谢

感谢 [Federico Torrielli 及贡献者](https://github.com/federicotorrielli/zotero-metadata-hunter)（Metadata Hunter）、[AllanChain 及贡献者](https://github.com/AllanChain/zotero-arxiv-workflow)（arXiv Workflow）、[northword 及贡献者](https://github.com/northword/zotero-format-metadata)（Linter for Zotero）以及 [Zotero 翻译器贡献者](https://github.com/zotero/translators)。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。代码借助 ChatGPT 和 DeepSeek 开发。
