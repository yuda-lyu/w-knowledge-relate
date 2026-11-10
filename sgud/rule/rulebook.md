# 規則帳本（w-knowledge-relate）

> **藍圖**：以規則為單位記程式碼須長成什麼樣。本檔為索引與本套件之鐵則；條目分檔如下表。與現況比對看 `../state/state.md`。
> 規則 ID 沿用最初編號（GEN／REL／STD）；缺號者見〈已移出〉；新規則在本檔新增節並編號。分檔內提到之他套件規則（抓取套件、摘要套件）見各該套件之 `sgud/rule/`，不在本套件分檔。
> **路徑基準**：原始碼在 `src/`，分檔所列檔案路徑（`core/…`、`stages/…` 等）除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`；盤點指令在套件根重跑（`git grep` 只搜追蹤檔）。
> **用語**：「使用端」＝使用本套件之專案；「抓取套件」＝npm `w-knowledge-capture`；「摘要套件」＝npm `w-knowledge-summarize`；「下游」＝讀本套件產物之後續工作。

## 分檔

| 檔 | 內容 |
|---|---|
| `rulebook_general.md` | GEN-01 英文名唯一、02 領域中立、03 設定分段與驗證、04 只放新格式、06 模組邊界（含兩個單一匯入點）、07 hook 錨點全集、09 測試以檔案位置定根、10 抓取之知識取自抓取套件、11 摘要之知識取自摘要套件、13 只依賴抓取與摘要兩套件且領域中立、15 評比總表在套件根、16 評分命令列與角色小件各一份、18 自有套件匯入指定詞（含測試件發布面、模組私有標記之單例）、19 共用件之歸屬、20 泛用開源套件與語言設定、21 跨套件收斂之共用件、22 測試件之共用與守門、24 取抓取套件只經 npm 套件、25 取摘要套件只經 npm 套件 |
| `rulebook_relate.md` | REL-01～20（扣保留之 AI 呼叫進門與遞補鏈內分開判、經抓取套件之包裝、判定小組第三席之逐次進門門檻 REL-20、邊之產出鏈 REL-19、正向段亦扣保留時間 REL-18、邊庫為真理、正向／反向／輪巡／重評、投影、刪除墓碑、衝突定義單一來源 REL-14、`relateStage` 拆分與層序 REL-15、AI 改寫之逆 REL-16、撤銷與重新收件兩契約 REL-17） |
| `rulebook_standards.md` | STD-00 框架、01 正體、02 數字紮根、04 標準表、06 關聯納入閘與撤出、07 待判登錄與檢核紀錄、10 判定小組與題組、11 衝突核對 RS4、14 品質測試逐案化（本套件之評分器與內建題組）、19 既有邊覆核 RS6、20 候選輪巡 RS10、22 存量處置、24 只告警／計數之現象須歸類、25 存量處置之回退、26 持久檔語意、27 覆核類判定之核對件、28 判定小組之單頁執行器、29 已不再違反之存量待判結案 |

## 已移出

規則 ID 不重新編號；下列缺號之條目不屬本套件之程式碼要求，原文由原出處保有。

| ID | 原標題 | 去處 |
|---|---|---|
| GEN-05 | 執行端只有一個組裝點 | 已移出（宿主專屬：使用端之組裝入口）；套件側之取用須知已濃縮進 `../proc/process.md`〈使用端須知〉 |
| GEN-08 | 階段要求 | 已移出（宿主專屬：宿主專案之開發階段要求） |
| GEN-12 | 使用端之摘要一律取自摘要套件、不自行實作 | 已移出（宿主專屬）；套件側之取用契約已濃縮進 `../proc/process.md`〈使用端須知〉 |
| GEN-14 | 使用端之關聯一律取自本套件、不自行實作 | 已移出（宿主專屬）；套件側之取用契約已濃縮進 `../proc/process.md`〈使用端須知〉 |
| GEN-17 | 宿主解體後之結構：執行殼與各套件各自獨立 | 已移出（宿主專屬：宿主專案之目錄結構）；版本與單例須知已濃縮進 `../proc/process.md`〈使用端須知〉 |
| STD-03 | 文件原文另存 | 已移出（抓取套件專屬：其 sgud 保有） |

GEN-23 為使用端之派工規範，本套件不收（無此號）；STD-05、13、16、17 為摘要套件之規則、STD-08、09、12、15、18、21、23 等其餘缺號為他處之規則，皆不在本套件帳本。

## 本套件之鐵則

1. **邊界**（GEN-06／11／13／18／22）：只 import 自己、`package.json` 所列套件與抓取、摘要兩套件（各經 `src/core/capturePackage.mjs`、`src/core/summarizePackage.mjs`；埠之每一名須有非測試取用、測試橋接 `test/tools/{capture,summarize}ForTest.mjs` 之每一名須有測試取用）；core 與上游之 core 無同相對路徑之檔。import 規範：`lodash-es` 取單函數路徑、wsemi 取 `wsemi/src/<函數>.mjs`、其他自有套件走其 `src/` 深層路徑、node 內建模組在 `src/` 無前綴（與 `toolg/gDistRollup.mjs` 之 external 清單一致）。守門：`test/unit-relate-package.test.mjs` ①②。
2. **層序**（REL-15）：`core ← stores ← standards ← { stages, ops }`，含 core／葉／根檔／logContract；`relateStage.mjs` 只剩編排。守門：`unit-relate-package` 層序案。
3. **邊庫為真理、md 兩章為投影**（REL-01～04）：一對筆記至多一條邊（id＝兩端排序後之雜湊）；寫邊只走 `rewriteEdge`／撤出之單一實作、帳簿 `touch` 成對記 dirty＋indexDirty；手改兩章會被另存後覆寫。**邊記錄恆帶產出鏈**（REL-19）：新建與可見欄位改變之寫入追加一筆 `produced`（組出取抓取套件之 `makeProduced`／`appendProduced`，本套件不自拼）；`graph.json` 預設不帶（`relate.graphProduced`）。
4. **刪除只走明示**（REL-09／17）：`deleteNote`（續作可補齊）；**撤銷** `undoDeleteNote`（原樣、不過閘、不登錄新待判）與**重新收件** `restoreNote`（過閘、可預演）是兩種契約；`restoreEdge`／`pruneDangling` 同一投影預設。
5. **衝突定義單一來源**（REL-14）：`CONFLICT_DEFINITION` 四支同讀（正向、反向／輪巡、重評、RS4／RS6）；改定義＝改提示詞指紋，須以正式席位 A/B 驗過。
6. **判定類段之同一處境同一處置**（STD-27／28；REL-16）：核對件為中性模組 `stores/edgeCheckKit.mjs`；單頁執行器取摘要套件之 `runPanelPage`；兩席段入項前預檢（來源標準現值已合格者結案不送）；中止不計、失敗計、陳舊不判、未能判定不記已審；使用者之裁示不被推翻；AI 改寫可撤回（`revertEdgeRevision`）。
7. **先記後寫、回退＝撤銷、持久檔語意**（STD-22／25／26）：帳列記實際修改之單位；回退現值≠after 報衝突（`acceptCurrent` 明示才取代）；JSON 帳逐帳驗結構（shape／critical）、JSONL 只一份（抓取套件 `core/util/jsonl`）、預演純讀；半狀態每輪偵測（必看字樣）。
8. **概念鍵與 slug**：概念鍵取抓取套件 `noteConceptsOf`（空鍵不計）；slug 尾碼取抓取套件 `slugSuffixOf`，同尾碼多候選不猜。
9. **發布面**：`main` 指 `dist/w-knowledge-relate.umd.js`、**不設 `exports` 與 `files`**（下游以 `…/src/…`、`…/test/tools/…` 深層路徑取用）；**不提供 `.npmignore`**（npm 包＝git 版控內容，依 `.gitignore`；本套件無外部執行檔，`test/` 與 `docs/` 皆 <10MB）——`sgud/`、`test/`（含 `test/tools/`、`golden/`）、`docs/` 皆隨包，`CLAUDE*.md`、`tmp`、`test/_tmp` 由 `.gitignore` 排除、不入包（以 `npm pack --dry-run` 清單驗：含 `sgud/` 與 `test/tools/`、不含 `CLAUDE*.md`）。範例 `g.mjs` 離線可執行、輸出與檔末 `// =>` 相符、README 之 Example 含其全文。守門：`unit-relate-package` ②〈發布面〉（無 `.npmignore`、`.gitignore` 規則）、〈打包清單〉（`npm pack --dry-run`）與 `g.mjs` 案。
10. **編譯清單與 JSDoc**：`toolg/gDistRollup.mjs` 之 external／globals 自 `src/WKnowledgeRelate.mjs` 之 import 圖（含經抓取、摘要套件再引用之自有套件原始碼）盤點，`opencc-js/dict/*` 須打包；`src/` 每個匯出函數皆有說明、`@param`、`@returns`、`@example`（範例之 `// =>` 為實跑輸出）。盤點指令見下表。
11. **命令列用法字串為實際路徑**：`src/bench/cli.mjs` 與四角色之 `cli.command`／`cli.casesHelp` 印出之用法為套件佈局下可執行之路徑（`node src/bench/cli.mjs`、`src/bench/cases/…`）；守門：`unit-relate-bench`〈印出之命令列用法〉案（直接執行 `--help` 與失敗路徑）。

## 盤點指令與判準

| 項 | 指令 | 判準 |
|---|---|---|
| 全套測試 | `npm test`（＝`mocha --parallel "test/*.test.mjs" --timeout 180000`） | 0 失敗；pending 只有真 AI 之案 |
| 結構與守門 | `unit-relate-package`（邊界、層序、中立、發布面、打包清單、範例、舊名與沿革）、`unit-relate-registry`、`unit-relate-contract`、`unit-relate-log-contract`、`unit-relate-entry` | 皆綠 |
| 提示詞基準 | `node test/tools/genPromptGolden.mjs`（比對模式「與標準檔逐字相同」） | exit 0；0 差 |
| 指紋 | `planRelateBench(role).promptFp`（同評分報告 `meta.promptFp`）；`模型評比.csv`「提示詞指紋」欄 | 提示詞或題組改了而未重跑即不符；本套件不存放「已驗指紋」記錄，使用端自記者自行比對 |
| 按需引入 | `git grep -nE "from 'lodash-es'" -- src toolg g.mjs`、`git grep -nE "from 'wsemi'" -- src toolg g.mjs`、`git grep -nE "from 'node:" -- src toolg g.mjs` | 三條皆無輸出 |
| 編譯 | `node toolg/gDistRollup.mjs` 後以 `require` 載入 `dist/w-knowledge-relate.umd.js`，具名匯出鍵與型別須同主入口（ESM）之具名匯出 | exit 0；載入不拋；鍵集相同 |
| 文件 | `node node_modules/jsdoc/jsdoc.js -c .jsdoc`、`node toolg/gDocsExams.mjs`、`node toolg/genDocsDist.mjs` | 皆 exit 0；JSDoc 覆蓋 100%（匯出函數之說明、`@param`、`@returns`、`@example`） |
| 下游回歸 | 下游套件全套＋使用端全套 | 0 失敗 |

## 測試清單（`test/`）

- 結構與契約：`unit-relate-package`、`unit-relate-registry`、`unit-relate-contract`、`unit-relate-log-contract`、`unit-relate-locale`、`unit-settings`、`unit-vocab`、`unit-relate-prompts`、`unit-relate-object`、`unit-relate-entry`、`unit-relate-assembly`
- 邊與段：`unit-relate-edges`、`unit-relate-gate`、`unit-relate-stage`、`unit-relate-change`、`unit-relate-rotation`、`unit-relate-forward-reserve`、`unit-relate-aicall`、`unit-relate-chain`、`unit-flow-relate`、`unit-relate-conflictcheck`、`unit-relate-edgereview`、`unit-relate-reeval`、`unit-relate-standards`、`unit-relate-checks`、`unit-relate-delete`、`unit-relate-projection`、`unit-relate-stockfix`、`unit-relate-holds`、`unit-relate-audit`、`unit-relate-domain`、`unit-flow-provenance`、`unit-relate-provenance`（REL-19）
- 評分：`unit-relate-bench`；真 AI：`api-relate-bench-ai`（`WK_LIVE_AI=1` 才跑）
