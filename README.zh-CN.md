# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

[English](README.md) | **简体中文**

查找正式发表版本，在原 Zotero 条目中修复元数据。

## 安装与使用

需要 Zotero 10。从 [Releases](https://github.com/lzcn/zotero-metadata-fixer/releases/latest) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装。

选中条目，右键直接选择**补全元数据**、**修正元数据**或**更新 PDF**。三个操作使用原生图标，默认操作排在第一项，可在设置中更改。结果窗口分别显示元数据与 PDF 结果，鼠标悬停可查看详情，点击行可选中对应条目。取消或关闭窗口会停止未完成的工作。

**补全**只填写空字段和空作者列表，保留已有内容与条目类型。**修正**包含补全，并在确认是同一篇文献后修正来源提供的书目字段，包括作者、日期、出版物、卷期、页码、出版社和标识符；同时保留查找正式版本、修正条目类型和统一论文集名称的功能。来源缺失的值不会清空已有字段。**更新 PDF**只检查和更新 PDF。修正和补全均不更新 PDF。更新保留批注、笔记、集合、标签和关系。无批注的旧主 PDF 在成功替换后移入回收站。检索期间修改条目会停止其更新，空结果保留已有字段。

## 设置

- 选择默认操作：补全、修正或更新 PDF。

- 论文集名称使用原名、标准全名或缩写。
- 在 Zotero 原生列显示出版物简称。请关闭 Zotero Style 的 Publication Column，避免冲突。
  更新 PDF 时，有批注则跳过，否则保留最新版，正式发表版优先于 arXiv 版。需要出版社访问权限。

检索使用 Zotero 翻译器及学术元数据服务，跳过冲突或未核验的结果。手动运行更新，通过 XPI 安装插件更新。

## 更新流程

已有正式 DOI 时，先按 DOI 查询，再考虑标题检索。DOI 记录一致，且标题或作者能佐证身份时，可以修正错误元数据；仅大小写、标点不同则保留原样。没有标识符确认时，仍须通过标题匹配。若权威来源自身也有错误，不能仅靠该来源纠正。

已有正式 DOI 交由 Zotero 翻译器处理，并以 DOI 内容协商和 Crossref/OpenAlex/DataCite 单条记录补充作为回退。没有正式 DOI 时，按以下顺序检索：

1. 检查条目 URL，核验其正式发表记录。
2. 根据会议和年份线索（包括 Extra 中的 `Conference:`）查找官方论文列表。
3. 跟随预印本服务器的发表链接，并检查新发现的会议线索。
4. 依次检索 Crossref/OpenAlex、DBLP/OpenReview、Semantic Scholar/PubMed，最后尝试 Google Scholar 或出版社搜索。

找到可靠匹配后停止检索；来源不可访问或无法核验时继续回退，强匹配存在冲突时停止自动更新。每次检索只尝试一次同一会议的官方列表。请求跨批次共享缓存、限流和冷却，访问受限时暂停该来源。

候选 HTTP(S) 页面和单条 BibTeX 交由 Zotero 翻译器读取，并核对标题、作者、出版类型、出版物和发表状态。已核验索引提供 BibTeX 时，优先使用它，再按需请求页面。会议、期刊名称及出版社域名无需预先列入目录。OpenAlex 出版页面和 PubMed 记录不会因缺少 DOI 被丢弃。冲突或无法核验的匹配不改写条目。未提供的 DOI 和其他字段留空。

自动转为正式版本需要已完成的标识符核验、接收记录、官方论文集页面或索引明确提供的发表证据。仅有引用字段或作者提供的 BibTeX 不证明已经发表。作者核验比较名字或首字母。双方提供多位作者时交叉核对共同作者，同姓不能掩盖名字冲突。证据标记仅供本次核验，不写入文献库。

会议网站集成支持 NeurIPS（NIPS）、ICML 和 ICLR。线索仅用于定位记录，不证明已接收。OpenReview 投稿状态以及主会、workshop 身份分别核验。同一批次复用已接收的 OpenReview 记录，供论坛核验和元数据读取使用，保留存在冲突的会议身份。来源不可访问时尝试同一出版记录的公开来源。

```mermaid
flowchart LR
  A[选中条目] --> B[查找正式版本]
  B --> C[核验并修复原条目]
  A --> D{选择更新 PDF 且无批注?}
  D -->|arXiv| E[比较附件实际版本与 arXiv 版本]
  D -->|已发表| F[检查出版社 PDF 校验标记与哈希]
  E --> G[核验成功后替换旧主 PDF]
  F --> G
```

arXiv 版本来自附件首页或经过哈希核验的下载缓存，不根据条目元数据猜测。无法识别本地版本时下载并比较文件哈希。正式版 PDF 保留条件请求和文件去重。有批注时只跳过 PDF 更新，元数据仍可修复。核验成功的新版会替换旧主 PDF，包括从 arXiv 转为正式发表版的情况。原条目 ID 和补充文件均会保留。

结果窗口以 Bear 配色为基础，采用固定样式、紧凑表格和系统字体。颜色跟随系统的浅色或深色外观。设置页使用 Zotero 原生控件。

## 开发

需要 Node.js 22.13+（22.x）或 24+。

```sh
npm ci
npm run check
npm run build
```

产物：`dist/zotero-metadata-fixer.xpi`。`npm run test:host` 使用临时 Zotero 目录。`npm run release` 在 `release/v<版本>/` 准备本地文件，不上传。

## 致谢

感谢 [Federico Torrielli 及贡献者](https://github.com/federicotorrielli/zotero-metadata-hunter)（Metadata Hunter）、[AllanChain 及贡献者](https://github.com/AllanChain/zotero-arxiv-workflow)（arXiv Workflow）、[northword 及贡献者](https://github.com/northword/zotero-format-metadata)（Linter for Zotero）以及 [Zotero 翻译器贡献者](https://github.com/zotero/translators)。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。代码借助 ChatGPT 和 DeepSeek 开发。
