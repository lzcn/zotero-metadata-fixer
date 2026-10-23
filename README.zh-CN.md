# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

[English](README.md) | **简体中文**

查找正式发表版本，在原 Zotero 条目中修复元数据。

## 安装与使用

需要 Zotero 10。从 [Releases](https://github.com/lzcn/zotero-metadata-fixer/releases/latest) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装。

选中条目，右键选择 **Metadata Fixer**。结果窗口显示进度和问题，点击行可选中对应条目；取消或关闭窗口会停止未完成的工作。

插件可查找正式版本、补全 DOI 和字段、修正条目类型、统一论文集名称，并按设置更新 PDF。更新保留附件、批注、笔记、集合、标签和关系。检索期间修改条目会停止其更新，空结果保留已有字段。

## 设置

- 论文集名称使用原名、标准全名或缩写。
- 在 Zotero 原生列显示出版物简称；请关闭 Zotero Style 的 Publication Column，避免冲突。
- 启用 PDF 更新后替换无批注的主 PDF，保留有批注的文件；需要出版社访问权限。
- 可选填 [Semantic Scholar API key](https://www.semanticscholar.org/product/api#api-key-form)，保存在本机，仅发送给 `api.semanticscholar.org`。

检索使用 Zotero 翻译器及学术元数据服务，跳过冲突或未核验的结果。手动运行更新，通过 XPI 安装插件更新。

## 开发

需要 Node.js 22.13+（22.x）或 24+。

```sh
npm ci
npm run check
npm run build
```

产物：`dist/zotero-metadata-fixer.xpi`。`npm run test:host` 使用临时 Zotero 目录；`npm run release` 在 `release/v<版本>/` 准备本地文件，不上传。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。代码借助 ChatGPT 和 DeepSeek 开发。
