# Metadata Fixer

[English](README.md)

直接更新原 Zotero 条目。作者：Zhi Lu，支持 Zotero 10。版本以 `package.json` 为准。

## 使用

安装 `dist/zotero-metadata-fixer.xpi`，选中文献，右键 → **Metadata Fixer**。

一个操作完成预印本升级、元数据补空与修错，无候选选择或字段确认弹窗。进度窗口显示结果；点“取消”或关闭窗口停止尚未完成的更新。

Zotero **设置 → Metadata Fixer** 只提供一个会议名称选项：**原名**、**标准全名**、**简洁缩写**。默认保留原名；后两种使用 CCF 全名或缩写，去掉届数和年份，论文日期不变。

## 更新行为

- 预印本先找正式发表版本，找到后升级原 item；没有候选时更新当前预印本。已发表条目缺少 DOI 时尝试补全；ICLR、NeurIPS 等没有 DOI 的论文也能更新。
- 自动选择可靠匹配。标题、作者或发表场所冲突时跳过；同一篇论文的不同来源合并使用。服务器关联 DOI 仍需验证翻译结果，不能绕过标题和作者校验。
- 自动读取 DOI、arXiv ID、PMID、URL 和 Extra 中的标识符。使用 Zotero 翻译器及 arXiv 官方 API。检索来源包括 Semantic Scholar、Crossref、DBLP、PubMed、OpenReview。arXiv API 不可用时尝试论文页面的发表 DOI；Semantic Scholar ID 查找不命中时回退标题查询；Crossref 限定发表类型并扩大候选数量；DBLP 返回 IEEE 文章链接时优先用 IEEE 翻译器。
- 已发表条目只补空字段、修正明确的类型、会议归属、editor 和无效 DOI，保留已填写的标题、摘要、作者、页码、出版社等内容。所有字段若仅大小写、空格或常见排版不同，即使升级预印本也不改原值。
- 在原 item 中写入元数据，保留 ID、key、附件、批注、笔记、集合、标签、关系及原有 Extra。空的检索值不会清空已有值。类型转换中无法保留的字段、原预印本来源写入 Extra。发表版没有 DOI 时，旧 arXiv DOI 移入 Extra，不作为正式版 DOI。
- 批量顺序处理。条目在更新期间被其他操作修改时拒绝旧结果；写入失败回滚。网络警告在“详情”中查看。取消、关闭所属主窗口或退出 Zotero 时立即停止任务并终止插件网络请求；不等待初始化或翻译器完成，迟到结果不会写入。

## 会议配置

内置 [CCF 2026 年第七版目录](https://www.ccf.org.cn/Academic_Evaluation/By_category/)全部 **386 个会议、10 个领域**，包括 ICLR、NeurIPS、CVPR、ICCV、ECCV、ICML、ACL。支持名称搜索、领域和等级筛选。

每个会议的“配置”可修改别名、排除条件、条目类型、editor 处理、期刊保留策略、自定义 Publication 名称；可查看官方来源、恢复单个会议或添加自定义规则。导入和导出放在“备份”中。编辑配置不会修改文献。

默认会议论文使用 `conferencePaper`，移除 editor，保留论文作者。默认保留检索到的期刊文章信息，避免把 PACMPL、PACMMOD、PVLDB 等期刊记录转成会议论文。Workshop、Findings、Companion 等不会套用主会议规则；FSE、SEC 等重名缩写需有足够具体的会议名称。

CCF 提供名称与分级依据；条目类型和 editor 策略由插件维护。更新版本时自动补入新增规则，保留已有修改、禁用状态、自定义规则和删除记录。维护时保持规则 ID 稳定，将历史名称加入别名，核对重名冲突；官方 PDF 地址、校验和、页码与数量保存在 `data/conference-catalog.json` 和 `data/conferences.json`。

## 开发

需要 Node.js 22.13+（22.x）或 24+。依次执行 `npm ci`、`npm run check`；`npm run build` 生成 `dist/<package.json 中的包名>.xpi`，`npm run release` 准备 `release/v<版本>/` 中的本地发布文件。

无改动时 `npm run build` 直接复用现有产物；`npm run build:force` 强制重建。`check` 和 `release` 仍运行完整验证。

共同开发规范集中在插件工作区根目录的 `AGENTS.md`。修改后构建并安装 XPI，再验证 Zotero 中的实际交互；本地打包不会创建 tag 或发布远端 Release。

`npm run test:host` 使用独立临时 Zotero 配置及网络测试数据；退出验收包括中止真实的本地 HTTP 请求和 Zotero 正常退出；真实在线检索仍需在测试文献库中验收预印本升级、标识符补全、IEEE 与无 DOI 论文、冲突候选跳过和覆盖安装保留配置。

当前发布脚本仅生成 XPI 与 `SHA256SUMS`，不生成 `updates.json`。

显示名改为 Metadata Fixer，但沿用原插件 ID 和偏好键，安装后替换旧版并保留会议配置。

当前不实现自动扫描、定时更新、自动 PDF 下载、标题大小写或标签管理。manifest 中的 GitHub 更新地址是规划地址，尚未建立远端仓库或发布更新文件，需手动安装 XPI 更新。

参考 [arXiv Workflow](https://github.com/AllanChain/zotero-arxiv-workflow)、[Linter](https://github.com/northword/zotero-format-metadata)、[Metadata Hunter](https://github.com/federicotorrielli/zotero-metadata-hunter)。版本与许可见 `THIRD-PARTY-NOTICES`；本项目采用 AGPL-3.0-or-later。
