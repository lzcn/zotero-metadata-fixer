# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

大部分代码由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

查找正式发表版本，补全 DOI 和文献信息，不替换原条目。

## 安装

需要 Zotero 10。通过 **工具 → 插件 → 从文件安装插件** 安装 XPI，选中条目后右键选择 **Metadata Fixer**。

确认退出 Zotero 时取消未完成的检索和排队更新，清理计时器及界面资源，不等待远端请求返回。

## 功能

- 查找预印本或仓库记录的正式发表版本。
- 在匹配可靠时补全 DOI。
- 补全缺失字段，修正常见错误。
- 修正误标的 arXiv 和会议记录。
- 统一论文集名称：原名、标准全名或缩写。
- 检查并更新正式版 PDF。

更新保留原条目、附件、批注、笔记、集合、标签和关系；空结果不会清空已有字段；检索期间修改条目会停止该条目的更新。

## 结果窗口

- 条目原地更新，进度和结果保持显示。
- 点击结果行可在 Zotero 中选中对应条目。
- 点击列标题排序；排序不改变处理顺序。
- Problem 列显示简短原因，悬停查看详情。
- 取消或关闭窗口会停止未完成的工作。

## 设置

- **论文集名称**：原名、标准全名或缩写。
- **出版物列使用简称**：在 Zotero 原生列中显示简称。请关闭 Zotero Style 的 Publication Column，避免冲突。
- **更新正式版 PDF**：替换无批注的主 PDF，保留有批注的。
- **Semantic Scholar API key**（可选）：在 [semanticscholar.org](https://www.semanticscholar.org/product/api#api-key-form) 申请；key 保存在本机，只发送给 `api.semanticscholar.org`。

## 检索行为

- 来源：Zotero 翻译器、Crossref、OpenAlex、DBLP（官方 SPARQL 兜底）、OpenReview、PubMed、Semantic Scholar 和 Google Scholar。
- 优先使用标识符和发表链接，标题检索作为兜底。
- 单个来源失败不影响其他来源；冲突或未核验的记录会跳过。
- 请求按来源限速；被限流的来源会冷却。

## 限制

- 不提供自动扫描、定时更新、标题大小写或标签管理。
- PDF 检查需要可核验的文章页和出版社访问权限。
- 插件更新需手动安装 XPI。

## 开发

使用 Node.js 22.13+（22.x）或 24+。

- `npm ci`，然后 `npm run check`
- `npm run build`；在根目录运行 `make` 可构建全部插件
- `npm run build:force`、`npm run clean`、`npm run release`

`npm run test:host` 使用临时配置；真实检索仍需测试文献库。统一规范见工作区根目录 `AGENTS.md`。

## 许可证

[AGPL-3.0-or-later](LICENSE)。来源和第三方许可证见 `THIRD-PARTY-NOTICES`。
