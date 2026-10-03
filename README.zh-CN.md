# Metadata Fixer

[English](README.md)

直接更新原 Zotero 条目。作者：Zhi Lu，支持 Zotero 10。版本以 `package.json` 为准。

## 使用

安装 `dist/zotero-metadata-fixer.xpi`，选中一篇或多篇文献，右键 → **Metadata Fixer**。

一个操作完成预印本升级、元数据补空与修错，无候选选择或字段确认弹窗。批量共用一个小窗口，只显示文献标题、简短状态和取消／关闭按钮。点“取消”或关闭窗口停止尚未完成的更新。

Zotero **设置 → Metadata Fixer** 只提供一个会议名称选项：**原名**、**标准全名**、**简洁缩写**。默认保留原名；后两种使用维护的全名或缩写，去掉届数和年份，论文日期不变。名称选项规范化 Proceedings Title，已有 Conference Name 保留。旧 Conference Name 中错放的论文集名称会修正到 Proceedings Title，检索成功或保留原名时也生效。标准全名参考 CCF、会议官网及出版信息；CVPR 使用 **Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition**。

## 更新行为

- 预印本先找正式发表版本，找到后升级原 item；没有候选时更新当前预印本。已发表条目缺少 DOI 时尝试补全；ICLR、NeurIPS 等没有 DOI 的论文也能更新。
- 自动选择可靠匹配。标题、作者或发表场所冲突时跳过；同一篇论文的不同来源合并使用。服务器关联 DOI 仍需验证翻译结果，不能绕过标题和作者校验。
- 自动读取 DOI、arXiv ID、PMID、URL 和 Extra 中的标识符。使用 Zotero 翻译器及 arXiv 官方 API。检索来源包括 Google Scholar、Semantic Scholar、Crossref、DBLP、PubMed、OpenReview。arXiv API 不可用时尝试论文页面的发表 DOI；Semantic Scholar ID 查找不命中时回退标题查询；Crossref 限定发表类型并扩大候选数量；已有发表版 DOI 直接用 Zotero 标识符翻译器；否则先通过预印本关联信息和 Google Scholar 标题查询寻找 DOI，其他来源补充查找。找到 DOI 后优先基于 DOI 检索；无 DOI 或 DOI 检索失败时使用官方论文页面（包括 IEEE）或 OpenReview BibTeX。Google Scholar 出现验证页面或限流时跳过该批次后续 Scholar 请求，其他来源继续。遇到 DBLP 反机器人页面或限流时，同一批次跳过后续 DBLP 请求，其他来源继续。
- 已发表条目只补空字段、修正明确的类型、会议归属、editor 和无效 DOI，保留已填写的标题、摘要、作者、页码、出版社等内容。所有字段若仅大小写、空格或常见排版不同，即使升级预印本也不改原值。
- 在原 item 中写入元数据，保留 ID、key、附件、批注、笔记、集合、标签、关系及原有 Extra。空的检索值不会清空已有值。类型转换中无法保留的字段、原预印本来源写入 Extra。发表版没有 DOI 时，旧 arXiv DOI 移入 Extra，不作为正式版 DOI。
- 批量顺序处理。条目在更新期间被其他操作修改时拒绝旧结果；写入失败回滚。取消、关闭所属主窗口或退出 Zotero 时立即停止任务并终止插件网络请求；不等待初始化或翻译器完成，迟到结果不会写入。

## 内部会议规则

内置 CCF 2026 年第七版目录的 **386 个会议、10 个领域**。多个名称和历史别名映射到同一会议，按规则处理条目类型、editor 和名称。规则由插件维护者修改 `data/conferences.json`，不向用户展示编辑、导入或导出界面。设置页仅提供名称样式选项；已有规则配置继续保留。

默认会议论文使用 `conferencePaper`，移除 editor，保留作者；真正的期刊文章与 Workshop、Findings 等次级会场不套用主会议规则。官方来源、校验和与页码见 `data/conference-catalog.json`。

## 开发

需要 Node.js 22.13+（22.x）或 24+。依次执行 `npm ci`、`npm run check`；`npm run build` 生成 `dist/<package.json 中的包名>.xpi`，`npm run release` 准备 `release/v<版本>/` 中的本地发布文件。

无改动时 `npm run build` 直接复用现有产物；`npm run build:force` 强制重建。`check` 和 `release` 仍运行完整验证。

共同开发规范集中在插件工作区根目录的 `AGENTS.md`。修改后构建并安装 XPI，再验证 Zotero 中的实际交互；本地打包不会创建 tag 或发布远端 Release。

`npm run test:host` 使用独立临时 Zotero 配置及网络测试数据；退出验收包括中止真实的本地 HTTP 请求和 Zotero 正常退出；真实在线检索仍需在测试文献库中验收预印本升级、标识符补全、IEEE 与无 DOI 论文、冲突候选跳过和覆盖安装保留配置。

当前发布脚本仅生成 XPI 与 `SHA256SUMS`，不生成 `updates.json`。

显示名改为 Metadata Fixer，但沿用原插件 ID 和偏好键，安装后替换旧版并保留会议配置。

当前不实现自动扫描、定时更新、自动 PDF 下载、标题大小写或标签管理。manifest 中的 GitHub 更新地址是规划地址，尚未建立远端仓库或发布更新文件，需手动安装 XPI 更新。

参考 [arXiv Workflow](https://github.com/AllanChain/zotero-arxiv-workflow)、[Linter](https://github.com/northword/zotero-format-metadata)、[Metadata Hunter](https://github.com/federicotorrielli/zotero-metadata-hunter)。版本与许可见 `THIRD-PARTY-NOTICES`；本项目采用 AGPL-3.0-or-later。
