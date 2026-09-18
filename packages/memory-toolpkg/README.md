# Claude Local Memory ToolPkg

正式 ToolPkg 接入包。

## Runtime Behavior

- 注册 `before_send_to_model` prompt finalize hook。
- 初始化本地目录：`ToolPkg.getConfigDir("com.claude_capability_pack.memory")/memory/`。
- 从 `memory/buckets/**/*.md` 读取本地 Markdown buckets。
- 每轮注入 pinned core memory。
- 只在触发条件命中时注入普通 retrieval memory。
- 使用本地 BM25 与精确词法信号重排，不接入 Operit 原生记忆系统。
- 自动摘要只写入待审核候选，批准后才进入正式 Markdown buckets。
- 自动候选同时保留简短核心摘要和较完整的事件经过，召回时可恢复具体上下文。
- 待审核候选支持在设置页修改标题、核心摘要、详细记忆和重要度后再装订。
- 兼容 Operit 文件 API 的嵌套 `data.content` / `data.entries` 返回，并合并扫描当前与旧版记忆目录。
- 提供 `ingest_summary` 摘要摄取入口：宿主在对话摘要生成后调用它，工具包会从摘要中提取长期记忆并写入本地 Markdown buckets。
- 在工具箱和主侧边栏提供“本地记忆设置”页面。
- 设置保存在当前 ToolPkg 配置目录的 `memory/config.json`，下一轮消息读取最新值。

## Settings

页面可以调整：

- 启用/停用记忆注入。
- 启用/停用摘要后生成记忆。
- 控制候选在人工批准后是否默认钉选为核心记忆。
- pinned 核心记忆的条数、单条字符数和总字符预算。
- 普通召回的条数、单条字符数和总字符预算。
- 生成查询时读取的最近上下文轮数。

每个数值都会在保存时限制到合理范围，避免误填导致注入过大或失效。

## Exported Management Entrypoints

本包同时声明了一个 subpackage：

- `ccp_memory_admin`

工具：

- `add`
- `update`
- `pin`
- `unpin`
- `archive`
- `list_pinned`
- `stats`
- `search`
- `ingest_summary`
- `import_ombre_preview`
- `import_ombre_apply`

主入口也导出了同名管理函数，供后续 ToolPkg runtime 直接调用验证：

- `ccp_memory_add`
- `ccp_memory_update`
- `ccp_memory_pin`
- `ccp_memory_unpin`
- `ccp_memory_archive`
- `ccp_memory_list_pinned`
- `ccp_memory_ingest_summary`
- `ccp_memory_list_candidates`
- `ccp_memory_approve_candidate`
- `ccp_memory_reject_candidate`

`ingest_summary` 只接收摘要文本，不逐条审普通对话。它会先去除轮次号、即时状态和逐句复述，再把明确的偏好、关系承诺、决定与计划拆成可独立理解的原子记忆，生成稳定 id，并跳过已存在的同 id 或同 `core_summary` 记忆。真正全自动需要 Operit 宿主在摘要完成后调用该入口。

这些入口都返回 `{ success, data }` 或 `{ success: false, error }`。

## Build

先构建 `memory-core`，再构建本包，并复制 core runtime：

```text
tsc -p ../memory-core/tsconfig.json
tsc -p tsconfig.json
node scripts/copy-core.mjs
```

构建后 `dist/` 是自包含运行目录：

```text
dist/
  main.js
  localStore.js
  packages/memory_admin.js
  memory-core/*.js
```

打包输出：

```text
build/claude-local-memory.toolpkg
```
