# 處理要點（w-knowledge-relate）

> 本套件之開發、驗收、維運要求與其處理流程。本檔為索引與要點；細節分檔如下表。
> **路徑基準**：原始碼在 `src/`，下文與分檔所列檔案路徑（`core/…`、`stages/…`、`createKnowledgeRelate.mjs` 等）除註明外皆相對 `src/`；測試在 `test/`（輔助件在 `test/tools/`，隨 npm 包發布供下游取用）。
> **用語**：「使用端」＝使用本套件之專案；「抓取套件」＝npm `w-knowledge-capture`；「摘要套件」＝npm `w-knowledge-summarize`；「下游」＝讀本套件產物之後續工作。

## 接手先讀

1. `../state/state.md`（現況：版本與佈局、最近驗證、已知缺口與待辦）——接續工作只讀此檔，不必翻經驗檔。
2. 規則查 `../rule/rulebook.md`（索引；條目分檔在同目錄）；業務要求與流程查本檔；踩過的坑在 `../exp/experience.md`。
3. 完成一項功能或結束一輪工作即更新 `state.md`（只記現況，過程寫入經驗檔）。

## 分檔

| 檔 | 內容 |
|---|---|
| `process_common.md` | 變更與驗收之共通要點：測試自套件根、改設定鍵須知、提示詞逐字相同檢查、模組英文名、設定結構與席位清單、語言設定 `cfg.lang` |
| `process_relate.md` | 關聯之開發與驗收（定位、邊界、衝突定義收斂、測試、免費 AI 能力評分）＋設定、維運與監看（子階段序、投影、刪除／撤銷／還原、內容變更、既有邊重評之開閘程序、待判、反向段、監看字樣） |
| `process_standards.md` | 檢定標準之維運：符合度掃描、存量處置與回退判準、AI 標準之開啟、容量、待判 |

## 已移出

屬使用端（宿主專案）之運維，不屬本套件之處理要點，原文由原出處保有：變更與驗收流程中之整點避開、使用端全套驗收、席位核對、執行殼接線與升版驗證、等下一輪（`process_common.md` 缺號 1、4、6、7），使用端設定檔對本套件設定之舊→新對照、使用端之領域設定位置、他套件之型別與提示詞設定，專案接點與切換之等價證據，使用端已開啟之 AI 標準與其容量數字、正式庫耗時與備份路徑、使用端之題組成績與席位換席史。

## 本套件之鐵則（細目見 `../rule/rulebook.md`）

- **邊界**：只 import 自己的檔案、`package.json` 所列套件，以及抓取與摘要兩套件（**各只經單一匯入點** `src/core/capturePackage.mjs`、`src/core/summarizePackage.mjs`，名單明列、埠之每一名須有非測試取用；測試橋接 `test/tools/{capture,summarize}ForTest.mjs` 之每一名須有測試取用——GEN-22）。下游套件經各自之埠，以 `w-knowledge-relate/src/…` 與 `w-knowledge-relate/test/tools/…` 深層路徑取本套件之件。
- **層序** `core ← stores ← standards ← { stages, ops }`，由 `test/unit-relate-package.test.mjs` 守門（REL-15）。
- **邊庫為真理、md 兩章為投影**；刪除只走明示（`deleteNote`）；撤銷（`undoDeleteNote`，不過閘）與重新收件（`restoreNote`，過閘）是兩種契約（REL-17）。
- **回退＝撤銷該次處置之效果、不覆寫其後之改動**（STD-25）；中止不計、失敗計；未判不記已審；使用者之裁示不被自動流程推翻（素材變了才重提）。
- **領域中立、只放新格式新工作流**（同抓取套件）。上游缺能力者於上游以 opt-in 擴充（預設不變、附測試），不在本套件另寫。
- **改本套件後**：跑本套件全套（`npm test`），再跑下游套件與使用端之全套；`src/` 內之檔路徑一改，下游埠與使用端轉接檔之指定詞同步。

## 結構與工具

- **佈局**：`src/`（主入口 `src/WKnowledgeRelate.mjs`；根層 5 檔＋`bench/ core/ domain/ ops/ stages/ standards/ stores/`）、`test/`（`*.test.mjs`＋`tools/`＋`golden/`）、`toolg/`（編譯與文件工具，依自有套件之標準寫法）、`g.mjs`（離線範例，輸出附檔末 `// =>`；README 之 Example 含其全文，改 `g.mjs` 須同步 README，`unit-relate-package` 守）、`模型評比.csv`（`bench` 命令列 `--board` 之輸出目標，程式不讀）。`dist/`、`docs/` 為發布流程產製物。
- **發布面**：`package.json` 之 `main` 指 `dist/w-knowledge-relate.umd.js`，**不設 `exports` 與 `files`**（設了即擋掉下游之 `…/src/…`、`…/test/tools/…` 深層路徑）；**不提供 `.npmignore`**，npm 包＝git 版控內容（依 `.gitignore`）：`sgud/`、`test/`（含 `test/tools/`）、`docs/` 皆隨包，`CLAUDE*.md`、`tmp`、`test/_tmp` 由 `.gitignore` 排除、不入包（`test/`、`docs/` 皆 <10MB，且無外部執行檔，故不須排除項；日後任一資料夾 ≥10MB 或加入外部執行檔才提供 `.npmignore`，且首段須完整抄錄 `.gitignore`）。發布流程見 `script.txt`；發布由使用者處理。
- **編譯**：`node toolg/gDistRollup.mjs`；`external`／`globals` 自 `src/WKnowledgeRelate.mjs` 靜態追蹤 import 圖（含經 `w-knowledge-capture`、`w-knowledge-summarize` 再引用之自有套件原始碼）盤點，原則見該檔檔頭；`opencc-js/dict/*` 須打包（列 external 則 `require(dist)` 即拋錯）。編譯 exit 0 不等於可載入——改清單後必以 `require` 載入 dist 並比對匯出鍵。
- **import 規範**：`lodash-es` 取單函數路徑；wsemi 取 `wsemi/src/<函數>.mjs`；其他自有套件走其 `src/` 深層路徑；node 內建模組在 `src/` 無前綴（`fs`、`path`、`url`）。
- **JSDoc**：`src/` 每個匯出函數皆有說明、`@param`、`@returns`、`@example`（`// =>` 為實跑輸出）；`node node_modules/jsdoc/jsdoc.js -c .jsdoc` 須成功。

## 測試

- 自套件根跑：`npm test`（＝`mocha --parallel "test/*.test.mjs" --timeout 180000`）；不建 `.mocharc.json`，`package.json` 之 scripts 為 `test` 與 `deploy`。單檔：自行編寫 mocha 指令（去 `--parallel`、換檔名）。
- 不連網、不呼叫真實 AI；真 AI 之案（`api-relate-bench-ai`）以 `WK_LIVE_AI=1` 才會跑（可另以 `WK_RELATE_MODELS`、`WK_RELATE_ROLES` 限模型與角色；燒免費額度，須使用者同意）。

## 要點（本套件）

- **詞彙由使用方給**：建 domain 前先 `pickRelateVocab(詞彙)`；`createRelateRuntime(cfg, settings, { vocab, domains })` 之 `domains` 須給物件。型別清單、衝突型、型別角色與領域句由使用端給——改任何一句即改提示詞（RS4／RS5／RS6 指紋隨之改變）。
- **AI 標準之開閘須使用者同意**：RS5 重評 `relate.reeval.apply`（先 `'additive'` 再 `'all'`；開閘後 `reevalRequeue`）、RS6 既有邊覆核；判定小組 first／second 須不同家、第一席不可為提案席。
- **免費 AI 能力評分**：`node src/bench/cli.mjs --role all --models free --runs 2 --out <專案外目錄> --env <.env> --board 模型評比.csv`（四角色：relate、reeval、conflict-check、edge-review）；`--out` 必放專案外；撞額度之模型停測、該角色不寫表，隔日 `--role <角色> --models <id>` 補；使用端自己之題組以 `--cases`＋`--vocab --vocab-pick` 跑且**不給 `--board`**（會覆蓋通用題組列）。命令列用法字串與題組路徑（四角色之 `command`、`casesHelp`、`cli.mjs` 之用法與錯誤訊息，以及 `--help` 首行〔抓取套件 1.0.2 起〕）皆為 `node src/bench/cli.mjs`／`src/bench/cases/…`，`unit-relate-bench` 以直接執行 `--help` 與失敗路徑守之。
- **正式席位 A/B 之做法**（REL-14；經驗 §28）：判準開跑前凍結於方案；以正式提示詞＋正式席位；證據留在使用端自己的證據夾（勿清）。

## 使用端須知

本套件對使用端之契約（只列套件側；各鍵之完整語意見 README，使用端之值、檔位置與排程不在本套件管轄）：

- **取用路徑與建構**：ESM 入口 `w-knowledge-relate/src/WKnowledgeRelate.mjs`（具名匯出與預設匯出為同一組）；`main` 指 UMD `dist`，不設 `exports`／`files`，故 `…/src/…`、`…/test/tools/…` 深層路徑可用；`src/` 內檔路徑一改，使用端與下游埠之指定詞須同步（GEN-18）。使用端宜在一處呼叫 `createKnowledgeRelate(cfg)` 組裝（僅 `workDir` 必填），並明傳 `scheduleLimitMin`（據以推導整輪預算與鎖陳舊期限）、`lock`、`envFile`、`aiWorkspace`；回傳 `{ run, openStores, closeStores, info }`；相對路徑之基準各鍵不同：`envFile` 以 `workDir`，`lock`（字串）與 `aiWorkspace` 以執行時之 cwd，`info()` 回報解析後之絕對路徑。隨包發布之測試件 `test/tools/*` 供下游測試橋接取用，改其名稱或簽名須同步下游。
- **設定**：頂層鍵以 `CFG_KEYS` 為準，設定只收 `ai`／`relate`／`relationIndexTitle` 三段（鍵與預設見 README §5、`RELATE_SCHEMA`／`RELATE_AI_SCHEMA`）。不認得之鍵、型別或值域不合、詞彙表或 domain 不合規格於建構期拋錯，不靜默回預設；給了而無效之 `scheduleLimitMin`／`deadlineMs`／`lockStaleMs` 例外，視同未給並入 `info().startupWarnings`。使用端原有多工作設定檔者：`relate` 段原樣給，`ai` 段只挑 `RELATE_AI_SCHEMA` 之鍵（`workspace`、`providerPick` 一律拒收：AI 工作目錄走頂層 `aiWorkspace`、供應商池走 `aiOptions`）。
- **詞彙、領域與語言**：領域句由使用端經 `cfg.data.vocab` 給（`kbLabel`、`domain`、`relationTypes`、`conflictType`、`fallbackType`、`relationTypeRoles`、`guide.relate`、`conceptRenames`／`conceptAliases`，README §6）；與他段共用一份詞彙表者先 `pickRelateVocab`。改任何一句領域句即改提示詞；`test/golden/prompts-default.json` 只守預設詞彙。`cfg.lang` 不給即 `zh-TW`；非繁體中文時 RS3 列「不適用」、不轉字形，提示詞本體仍為繁體中文（README §16）。
- **自組管線與每輪依賴**：他總組裝共用關聯件用 `createRelateRuntime(cfg, settings, { vocab, domains })`（詞彙取 `resolveRelateVocab(pickRelateVocab(整份詞彙))`——拒收他段之鍵，可重複套用；`domains` 只取鍵在 `RELATE_DOMAIN_KEYS` 者且**須給物件**）；與既有庫共用時以 `lmdb.db`／`lmdb.cls` 對齊庫名與集合名，既有庫有下游產物之集合者給 `cores: true`（筆記之明示刪除才列得出以該篇為出處者）；每輪依賴只需 `{ stores:{ notes, relations, holds?, checks?, cores? }, clock, dirs:{ state, relations }, settings, ai, domains:{ relate }, reserveMs? }`，`reserveMs` 為保留給同一輪後段之時間，由使用端給（正向段與各選配段皆扣之；扣後不足一次呼叫即不開工，正向段開工前即不足 → 本輪延後、新筆記留池中，report `forwardDeferred`；未給為 0，正向段行為同未扣保留）；衝突核對與既有邊覆核開啟時 `holds`／`checks` 必備。跨套件、跨行程判「內容已改」一律以記錄欄 `knowledgeChangedAt` 為準；ctx 旗標（`RELATE_CTX_FLAGS`、摘要套件之重標通知 `notesTagChanged`）**只在同一條管線內**有效。巡檢之字樣、報告鍵、容量說明取本套件之常數（`RELATE_LOG_KNOWN`／`RELATE_LOG_MUST_SEE`／`RELATE_LOG_PARSE`／`RELATE_REPORT_KEYS`、`relateWarningsOf`），不手寫；併入自己之已知字樣表時，須見字樣另列、不得被過寬之已知字樣吞掉。
- **維運 API**：`deleteNote`、`undoDeleteNote`、`restoreNote`、`restoreEdge`、`revertEdgeRevision`、`pruneDangling`、`projectAll`、`reevalBaseline`、`reevalRequeue` 為具名匯出（本套件不附命令列）；寫入者**不取執行鎖、不備份、不徵求同意**，由使用端負責：與管線互斥、一致備份（db、knowledge、state）、預演後呈報並取得使用者同意；預設只列出（`apply: true` 才寫；`deleteNote`／`restoreNote` 以 `dryRun: true` 預演，預演純讀）。寫入前一律檢核邊庫世代（舊世代邊庫拒寫，本套件不含遷移工具）與 `deps.domain`（缺即於任何寫入前拋）。`restoreNote` 是重新收件（過納入閘；筆記標準閘須由使用端注入摘要套件之 `createNoteRestoreGate({ stores, vocab, clock })` 為 `deps.noteGate`，未注入即 WARN 並原樣還原），`undoDeleteNote` 是回退專用（原樣放回、不過閘）；`restoreNote` 回傳 `std.contentChanged`／`titleChanged` 任一為真而該篇已被下游消化者，須請下游重設基準。
- **存量處置與檢定標準**：符合度掃描用 `auditRelateStandards`＋`relateScanOf`（每輪掃描以 `relate.standards.scanEachRun: true` 開啟，預設關）；存量處置 `planEdgeStockFix`（預演）／`applyEdgeStockFix`／`verifyEdgeStockChain`／`rollbackEdgeStockFix` 由使用端驅動：套用後重掃並斷言連鎖，不符依回退判準回退（`process_standards.md`）；以資料複本演練時，筆記記錄之 `file` 若指向原庫之 md，套用會寫回原 md，須先改指複本。待判之列表、逾期、要求重試、豁免（`listHolds`、`overdueHolds`、`requestRetry`、`waiveHold`）屬抓取套件，本套件不轉出。
- **AI 標準與選配段之開啟**：重評（`relate.reeval.perRun > 0`）須 `holds` 與 domain 之 `buildReevalPrompt`，閘門 `relate.reeval.apply` 預設 `false`；衝突核對（`relate.standards.conflictCheck.enabled`）、既有邊覆核（`relate.standards.edgeReview.enabled`）須 `holds`／`checks` 集合、`relate.standards.ai` 席位與 domain 之對應提示詞成員，缺即拋；開啟前宜以對應評分題組於正式席位逐案兩次全過，判定小組三席宜取不同家族（兩票之實際成交供應者須不同才成立）。反向段、輪巡、重評預設 0（停用），開啟前以 `relateCapacityOf`／`relateWarningsOf` 量進料與容量，不靠截斷或過期丟棄縮減。衝突核對與既有邊覆核開啟後之監看與回退建議：待判逾次轉使用者之件數增加（判定小組常不成立，例如第一席連續落遞補而與提案席同一供應者）、隔離（`rs4-quarantine`／`rs6-quarantine`）逐輪增加、或抽核發現撤出之邊屬誤撤時，先關閉對應之 `enabled`、再以 `restoreEdge` 還原；額度吃緊時先降 `perRun`。還原 `rs4-*`／`rs6-*` 撤出之邊即使用者對該標準之裁示，須有 `stores.checks`，缺即於任何寫入前拋。
- **AI 席位與調度層**：預設席位同屬 opencode 免費層（單一故障域），宜在 `fallback` 尾端加入非 opencode 家，並隨 `w-dispatch-ai` 升版核對席位 id（席位引用不可用的條目時建構即拋；注入 `cfg.aiAdapter` 時席位檢核屬注入方）；一批提示詞約 4 萬字元，超過命令列型供應商之字數上限者由內建調度層改派遞補，主力席若是命令列型宜降 `relate.candidatesPerNote`。注入自己的調度層（`cfg.aiAdapter`）須自行遵守「多段 JSON 取最後一段合格者」「`check` 只認嚴格 `true`」「每次呼叫皆給 `acceptTruncated:true`」。供應商整組失敗之偵測屬使用端巡檢（調度層以「供應商健康：」WARN 揭露）。
- **版本與單例**：本套件、抓取套件、摘要套件及其共同依賴（`wsemi`、`w-data-pipeline`、`w-dispatch-ai`、`w-orm-lmdb`）的版本範圍須有交集，使同一行程內每個套件只有一份模組實體——概念鍵折疊、執行鎖登記表、角色定義標記等為模組級單例，兩份安裝即互不相認（GEN-18）；上游升版後須自本套件根重跑全套。
- **下游交接**：下游判斷某條衝突邊非對立時以 `queueConflictCheck` 交回衝突核對；讀關聯者取 `isRelated`、投影章名 `RELATE_SECTION_TITLES`、撤出證據 `retiredEdgesOf`，衝突型之現名與舊名取 `domain.conflictTypeNames`、型別解析取 `domain.resolveType`；筆記記錄之 `extractedAt` 由下游寫、本套件只讀。

## 不列為待辦者

- 發布套件、`dist/` 由使用者處理；AI 標準之開閘（RS5 重評 apply、RS6 既有邊覆核）須使用者同意。
