# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

在原 Zotero 条目中升级预印本、补全元数据并修正明确错误。

## 安装与使用

需要 Zotero 10。通过 **工具 → 插件 → 从文件安装插件** 安装 `dist/zotero-metadata-fixer.xpi`。选中文献，右键选择 **Metadata Fixer**。直接更新，不弹出候选或字段确认窗口。全局共用一个窗口，显示等待任务、处理结果和原生取消按钮。新增选择加入正在运行的队列，重复条目不会重复入队。队列结束后保留结果，手动关闭窗口。后续任务继续使用同一窗口；单篇失败不影响其他文献。取消或关闭窗口可停止尚未完成的更新。

## 更新行为

使用 DOI、PMID、arXiv ID、URL 及 Extra 中的标识符检索。优先使用已有发表标识符和官方论文页面，再查预印本发表关联及标题。来源包括 Zotero 翻译器、Google Scholar、Crossref、Semantic Scholar、DBLP、PubMed 和 OpenReview。经过验证的发表记录有无 DOI 都可更新；匹配冲突时跳过。来源被限制时，其他来源继续。

已发表条目只补空字段和修正明确错误。仅大小写、空格或排版不同的值保持原样，预印本升级也遵循此规则。保留条目身份、附件、批注、笔记、集合、标签及关系。空结果不清空已有值，旧预印本标识符保留在 Extra。并发修改会阻止过期结果写入；取消和退出 Zotero 会停止待处理更新。

## 设置

在 **设置 → Metadata Fixer** 中选择会议名称：**原名**、**标准全名** 或 **简洁缩写**。默认保留原名。格式化作用于 Proceedings Title，去掉届数和年份，保留论文日期及已有 Conference Name。可修正错放的论文集名称、条目类型和 editor；真正的期刊及次级会场受到保护。

会议规则包含 CCF 目录、补充会议及独立的 workshop 分会场。来源记录见 `data/conferences.json`、`data/conference-catalog.json` 和 `data/conference-supplements.json`。

## 当前限制

不提供自动扫描、定时更新、PDF 下载、标题大小写或标签管理。目前通过手动安装 XPI 更新；沿用原插件 ID 和偏好键以便覆盖升级。

## 开发

需要 Node.js 22.13+（22.x）或 24+。依次运行 `npm ci`、`npm run check`。

- `npm run build`：输入未变化时复用有效产物。
- `npm run build:force`：强制重建。
- `npm run check`：格式、测试和类型检查；复用有效 XPI。
- `npm run release`：完整检查后，在 `release/v<版本>/` 准备 XPI、`SHA256SUMS` 和 `updates.json`。

`npm run test:host` 使用临时配置及网络测试数据，检查取消本地 HTTP 请求和 Zotero 正常退出。真实在线检索仍需在测试文献库中验证。本地发布准备不创建 tag 或上传文件。共同开发规范见工作区根目录 `AGENTS.md`。

## 许可证

[AGPL-3.0-or-later](LICENSE)。参考项目和第三方许可证见 `THIRD-PARTY-NOTICES`。
