# Metadata Fixer

<img src="icons/icon-256.png" width="64" height="64" alt="Metadata Fixer" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

查找正式发表版本、补全 DOI 并修正文献信息，保留原 Zotero 条目。

## 安装与使用

需要 Zotero 10。通过 **工具 → 插件 → 从文件安装插件** 安装 XPI。选中文献后，右键选择 **Metadata Fixer**。

直接更新所选条目，进度和结果保留至关窗。运行期间可继续添加文献，重复条目会跳过；取消或关窗会停止待处理任务。

窗口使用 Zotero 原生表格，初始大小适配条目数和可用屏幕，列宽可拖动调整。问题列简短显示来源限流、请求超时等原因。点击列标题排序，再次点击反向排序，不改变处理顺序。悬停问题可查看详情；某个来源限流不会阻止其他来源查找正式版本。

进度更新合并到同一帧绘制。macOS 使用 Command-W 关闭窗口并取消待处理任务，输入法组合期间不触发快捷键。界面颜色和动态效果跟随系统偏好。响应复用仅限当前操作，缓存有容量上限，大响应不保留。

**出版物列使用简称**在原生列中显示简称，默认开启。关闭后恢复原生显示，条目字段和列设置不变。请关闭 Zotero Style 的 **Publication Column**，避免冲突。

期刊只使用本地目录中有来源的专用简称，例如 TMC、TPAMI、TGRS、JSTARS；其他期刊保留全名，包括 Nature Communications。条目“期刊简称”字段和 Zotero 提供的引用格式缩写仅用于识别目录中的期刊，不用作显示名称。会议使用现有会议目录，未知名称保留原名。Preprint 显示 Repository 原文，Report 显示 Institution，Book 显示 Publisher，Thesis 显示 University，均不缩写。仅当预印本缺少仓储字段时，才依据明确的标识与 URL 补充 arXiv 等名称。渲染不发起网络请求。期刊名称、别名和来源网址记录在 `data/journal-abbreviations.json`。

## 更新内容

- 为预印本和仓储记录查找正式发表版本。
- 找到可靠匹配后，补全缺失的 DOI。
- 补充缺失字段，修正明确的元数据错误。
- 将类型错置的 arXiv 记录修正为预印本、会议记录修正为会议论文；保留真正的期刊和带预印本来源链接的正式发表条目。
- 按所选规则统一论文集名称。
- 检查当前发表页面的 PDF，即使元数据没有变化也可更新附件。

插件先使用标识符和发表链接检索，再尝试按标题查找。 先并行查询 Crossref、DBLP 和 OpenReview；必要时再查询 PubMed、Semantic Scholar，最后用 Google Scholar 兜底。每层统一检查冲突。同一来源的请求串行并控制间隔；HTTP 429 根据 Retry-After 或递增退避进入会话内冷却。有效 JSON 跨批次缓存五分钟，限制内存占用。结果窗口显示具体限流来源，并标明无变更但检索未完成的条目。JSON 请求超时为 8 秒，文章页请求仍保留 20 秒。文章页的引用元数据包含题名、作者和刊名或论文集名时，即使出版网站未列入目录，也可读取其同站 BibTeX。BibTeX 明确给出的类型可纠正通用网页或不完整 DOI 元数据的分类；题名、作者或 DOI 存在冲突时拒绝合并。预印本修订可能晚于正式发表，因此不会仅凭条目日期排除较早的发表记录。更新前会核对标题、作者和发表状态，无法确认或存在冲突的记录会跳过；某个来源失败不会中断其他检索。检索来源包括 Zotero 翻译器、Crossref、PubMed、Semantic Scholar、DBLP、OpenReview 和 Google Scholar，出版社页面用于核实记录和补充字段。

元数据更新保留原条目及其附件、批注、笔记、集合、标签和关系。空结果不会清空已有字段，仅大小写或空格不同的值也会保留。预印本标识符留在 Extra 中；如果你在检索期间修改条目，过期结果不会覆盖这些改动。

设置中的**检查并更新正式版 PDF**默认开启。有 DOI 时仅检查 DOI 指向的发表页面；无 DOI 的记录使用条目 URL，通过匹配文章页的引用元数据或 Zotero 翻译器取得 PDF。新 PDF 保存成功后，被替代的旧主 PDF 如果没有 Zotero 批注或笔记，就移入 Zotero 回收站；有批注的 PDF 和补充附件保留。替换失败或取消时保留旧 PDF。

PDF 检查跨会话记录来源 URL、本地文件哈希及服务器文件标识。ETag 相同，或修改时间与文件大小均相同时，不再下载 PDF 正文；服务器不支持 HEAD 时，仍可通过条件 GET 的 304 响应跳过下载。服务器没有提供文件标识时，同一来源 URL 和未变化的本地文件在上次成功检查后 24 小时内复用结果，复用不会延长这一期限。本地文件缺失、被编辑或来源 URL 变化时重新获取。下载后仍按内容哈希去重。

出版社的文件标识可以判断文件是否变化，但并不统一对应论文的修订版号，也不能证明一定是最新修订版。能否下载取决于出版社及当前网络、机构访问权限；PDF 无法获取不影响已完成的元数据更新。

## 设置

在 **设置 → Metadata Fixer** 中选择 **原名**（默认）、**标准全名** 或 **缩写**。标准全名和缩写省略 Proceedings Title 中的届数、年份，论文日期和 Conference Name 不变。可修正错放的论文集名称、条目类型和 editor，保留真正的期刊及次级会场。

匹配时先清理年份、届次等变化，再依次尝试完整名称、主题词和缩写。未知或有歧义的名称保留原值；workshop 等分会场单独识别。OpenReview 的会议标识会保留所属会议和完整 workshop、track 层级，即使展示标签省略这些信息。未收录的子会场在所有命名方式下保留来源名称，无需新增专用目录项或编造简称。通用 workshop 别名不会替代具体子会场名称。经核验的会议身份信息可以修正错误会场，互相冲突的会议标识会被拒绝。

会议规则包含 CCF 目录、补充会议及独立的 workshop 分会场。来源记录见 `data/conferences.json`、`data/conference-catalog.json` 和 `data/conference-supplements.json`。

## 当前限制

不提供自动扫描、定时更新、标题大小写或标签管理。PDF 检查面向正式发表记录，需要可核验的文章页；保留的预印本 PDF 不作为正式版替代。插件更新需手动安装 XPI。

## 开发

匹配采用标识符校验、规范化题名／作者一致性和维护的会场别名，不使用向量或生成模型。`src/providers.ts` 发现候选，`src/metadata.ts` 校验元数据身份，`src/venues.ts` 匹配会场。Publication 显示直接使用 Zotero 原生列，不再导入旧自定义列偏好。

需要 Node.js 22.13+（22.x）或 24+。依次运行 `npm ci`、`npm run check`。

- `npm run build`：输入未变化时复用有效产物。在上级工作区运行同一命令，可统一构建并安装三个插件。
- `npm run clean`：清理构建产物，保留已下载工具、依赖、研究数据和发布文件。
- `npm run build:force`：强制重建。
- `npm run check`：格式、测试和类型检查；复用有效 XPI。
- `npm run release`：完整检查后，在 `release/v<版本>/` 准备 XPI、`SHA256SUMS` 和 `updates.json`。

`npm run test:host` 使用临时配置及网络测试数据，检查取消本地 HTTP 请求和 Zotero 正常退出。真实在线检索仍需在测试文献库中验证。本地发布准备不创建 tag 或上传文件。共同开发规范见工作区根目录 `AGENTS.md`。

`src/providers.ts` 负责发现正式版本，返回候选记录；`src/translate.ts` 通过 Zotero 翻译器取回记录，通用页面线索、字段映射及补全位于 `src/metadata.ts`；`src/venues.ts` 负责会议匹配与字段映射，`src/conferences.ts` 在取回后应用目录和命名规则。官方名称和约定俗成的简称写入 JSON 目录。新增会场特例仅用于常见顶会；长尾 workshop 和 track 使用来源证据并保留名称。来源适配负责提取标识与书目信息，通用规则负责判断身份和格式，不添加单篇文章专用分支。出版社专用检索作为兜底，不替代翻译器和名称规则。

## 许可证

[AGPL-3.0-or-later](LICENSE)。参考项目和第三方许可证见 `THIRD-PARTY-NOTICES`。
