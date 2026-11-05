# 現況（w-knowledge-relate）— 2026-11-05

> 只記現況，不寫過程（過程在 `../exp/`）。接續工作先讀本檔；完成一項功能或結束一輪工作即更新。
> **路徑基準**：原始碼在 `src/`，本檔所列檔案路徑除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`。

## 身分與位置

- npm 套件 `w-knowledge-relate`（`package.json` 版本 1.0.0）；主入口 `src/WKnowledgeRelate.mjs`（具名匯出與預設匯出同一組，269 名）、總組裝 `createKnowledgeRelate`、執行期件 `createRelateRuntime`、物件 `relateObject.mjs`；`main` 指 `dist/w-knowledge-relate.umd.js`。
- 佈局：`src/`（根層 5 檔＋`bench/ core/ domain/ ops/ stages/ standards/ stores/`）、`test/`、`toolg/`、`g.mjs`（離線範例）、`模型評比.csv`；不設 `exports`／`files`、不提供 `.npmignore`（npm 包＝git 版控內容，`sgud/` 與 `test/tools/` 隨包）。
- 依賴：`w-knowledge-capture` ^1.0.2（經 `src/core/capturePackage.mjs`，124 名；指定詞 `w-knowledge-capture/src/WKnowledgeCapture.mjs`）、`w-knowledge-summarize` ^1.0.2（經 `src/core/summarizePackage.mjs`，33 名；指定詞 `w-knowledge-summarize/src/WKnowledgeSummarize.mjs`；測試橋接取其 `test/tools/`）、`wsemi` ^1.9.42；dev：`w-data-pipeline`、`w-dispatch-ai`、`w-orm-lmdb`（測試用）、`w-package-tools`（編譯與文件工具）。
- 被誰用：下游經各自之埠，以 `w-knowledge-relate/src/…` 與 `w-knowledge-relate/test/tools/…` 深層路徑取本套件之件。
- 發布狀態：尚未發布（發布由使用者）。

## 結構

| 項 | 狀態 |
|---|---|
| 層序 | `core ← stores ← standards ← { stages, ops }`（REL-15；`unit-relate-package` 守門） |
| 編譯 | `node toolg/gDistRollup.mjs` 產 `dist/w-knowledge-relate.umd.js`；external／globals 自 `src/WKnowledgeRelate.mjs` 之 import 圖盤點（原則見檔頭）；`require` 載入之具名匯出與主入口（ESM）同一組；兩條固有警告（主入口同時具名與預設匯出、UMD 依賴 node 內建模組）不處理 |
| 文件 | `jsdoc -c .jsdoc` 與 `toolg/gDocsExams.mjs`、`toolg/genDocsDist.mjs` 皆成功；`src/` 匯出函數 191 個，說明、`@param`、`@returns`、`@example` 皆 191/191，匯出常數 77/77 有 JSDoc |
| 發布面 | 無 `.npmignore`；`npm pack --dry-run` 清單含 `sgud/` 與 `test/tools/`、不含 `CLAUDE*.md`、`tmp/`、`test/_tmp/`（`unit-relate-package` ②〈發布面〉〈打包清單〉守） |
| 範例 | `g.mjs` 離線可執行（不連網、不呼叫真 AI），輸出與檔末 `// =>` 逐行相符，README 之 Example 含其全文（`unit-relate-package` ② 守） |

## 最近驗證

| 日期 | 項 | 結果 |
|---|---|---|
| 2026-11-02 | 結構整理後全套（`npm test`）：原始碼移入 `src/`、補根目錄檔與 `toolg/`、`package.json` 依賴對齊、JSDoc 補齊、README 標頭與 Example、命令列用法字串改實際路徑、`sgud/` 改套件角度 | **551 ✓、0 ✗、4 pending**（pending 皆為 `api-relate-bench-ai` 四角色，未設 `WK_LIVE_AI=1` 不發真實請求）；整理前 548 ✓、0 ✗、4 pending（新增〈打包清單〉〈範例 g.mjs〉〈命令列用法為實際路徑〉三案） |
| 2026-11-05 | 正向段亦扣保留時間（REL-18）後全套（`npm test`）；新增 `unit-relate-forward-reserve` 15 案，對正向段保留邏輯植入 19 個變異皆被殺；既有保留時間案 4 案之環境改為正向席首家逾時短於被測段之（斷言不變） | **567 ✓、0 ✗、4 pending**（pending 同上）；新測試首版 13 案對修前碼 12 紅、1 綠（未注入保留之行為不變案），後補 2 案（池空不報停止、`opt.rounds` 打錯不被吞）以變異驗證；`dist/`、`docs/` 未重產（發布時自動產製） |
| 2026-11-02 | 編譯與載入 | `toolg/gDistRollup.mjs` exit 0；`require(dist)` 具名匯出 269＝主入口 269，集合與型別同；`jsdoc`、`gDocsExams`、`genDocsDist` exit 0 |

## 功能現況（對應規則帳本）

| 功能 | 狀態 | 規則／測試 |
|---|---|---|
| 正向（新筆記、內容變更之筆記）、投影、總覽 | 落地 | REL-01～08；`unit-relate-stage`、`unit-flow-relate`、`unit-relate-projection` |
| 保留時間（`opt.reserveMs`／`deps.reserveMs`）：正向段與反向、輪巡、重評、既有邊覆核、衝突核對皆扣；正向段開工前與每輪開工前判，不足即少做幾輪（開工前即不足 → `forwardDeferred`，新筆記留池）；未注入（0）行為同未扣 | 落地 | REL-18；`unit-relate-forward-reserve` |
| 反向段 `relate.reverse.perRun`（預設 0）、候選輪巡 `relate.rotation`（預設 0） | 落地，預設停用 | STD-20；`unit-relate-rotation` |
| 重評 RS5（兩席；`relate.reeval.apply` 預設 false） | 落地；**開閘須使用者同意** | REL-13；`unit-relate-change`、`unit-relate-aicall`、`unit-relate-reeval` |
| 衝突核對 RS4（`relate.standards.conflictCheck`，預設關） | 落地；兩席段入項前預檢、twoSeat 票 | STD-11／27／29；`unit-relate-conflictcheck` |
| 既有邊覆核 RS6（`relate.standards.edgeReview`，預設關） | 落地 | STD-19；`unit-relate-edgereview` |
| 刪除墓碑、撤銷（`undoDeleteNote`）、重新收件（`restoreNote` 預演／續作）、`restoreEdge`、`revertEdgeRevision`、`pruneDangling` | 落地（具名匯出，不附命令列） | REL-09／16／17；`unit-relate-delete`、`unit-relate-edges` |
| 檢定標準 RS1～RS10 之掃描、存量處置（逐單位回退、resolvable 結案） | 落地 | STD-06／22／25／26／29；`unit-relate-standards`、`unit-relate-stockfix`、`unit-relate-holds`、`unit-relate-audit` |
| 衝突定義單一來源 `CONFLICT_DEFINITION` | 落地 | REL-14；`unit-relate-prompts`、`unit-relate-domain` |
| 免費 AI 能力評分（四角色；通用題組 15／15／15／16 案） | 落地；命令列 `node src/bench/cli.mjs` | GEN-15／16；`unit-relate-bench`、`api-relate-bench-ai` |

## 已知缺口與待辦

- **RS5 開閘**（須使用者同意）：逐條覆核影子期候選帳 → 先 `'additive'` 再 `'all'`；第二席需有逐案兩回全過之席位。
- **`模型評比.csv`** 含已不在 `w-dispatch-ai` 內建目錄之列（歷史記錄，不影響執行）；「AI 工作目錄」欄有兩種寫法（「套件外之工作目錄」「專案外之工作目錄」，抓取套件 1.0.2 起寫後者）。
- **已知限制**（README §17 餘者）：`restoreNote` 之 `noteGate` 未注入 → WARN 原樣還原；`netGuard` 未給＝不判斷。
- **疑似缺陷與遺留（只記，未修）**：
  - `stages/relateStage.mjs` `admitSurfaced`：`cfg.lang` 非繁體中文時 RS3 回「不適用」，`every(status===PASS)` 恆 false，合併時浮上之沿革條目永遠不升任（預設語言不受影響）。
  - README §9 稱「重評缺 `holds` 時判不了之邊不登錄待判（WARN）」，但 `stages/reevalSegment.mjs` 於 `reeval.perRun > 0` 缺 `holds` 即拋；`test/unit-relate-reeval.test.mjs` 有兩案之案名與斷言不一致（案名「未開 holds → WARN、下輪重評」，案內斷言開工即拋；另一案名「邊時刻 ≥ 版本」，實作為 `at > version` 才排除）。
  - `stores/reverseCandidates.mjs` `createReverseIndex`：K=1 時分數池含新筆記自身，反向段不產生任何待處理對（K≥2 才有效）。
  - `stores/noteProjection.mjs` `projectNotes`：`ids` 未做陣列防呆；`stages/conflictCheckSegment.mjs` `writeProposal` 直接讀 `rt.createdThisRun`／`rt.admitSurfaced` 無預設值；`stages/reevalSegment.mjs` `markNoteProgress`／`mwReevalApply` 對 `seg.coSelected` 為隱性依賴。
  - `ops/noteOps.mjs` `restoreNote` 預演時，`deps.noteGate` 未注入只發 WARN、不記 `refused`，預演看不出實跑缺閘之差別。
  - `stores/relateLedgers.mjs` `loadLedgerJson` 之 `quarantine:false` 於 `src/` 內無呼叫端（供下游與測試）；`stores/conflictCheckPolicy.mjs` `checkVerdictOf` 只轉呼叫 `baseVerdictOf`，JSDoc 列之 `o.conflictType` 未被讀取。
  - 公開文字殘留：`src/standards/stockFix.mjs`（處置帳說明）與 README §13 有「四工作與宿主同一本帳」字樣；`test/unit-relate-package.test.mjs`、`unit-relate-registry.test.mjs` 之偵測樣本含宿主本地目錄名（偵測用，非殘留）；部分測試註解仍帶審計代號（如 `unit-relate-conflictcheck`、`unit-relate-delete`、`unit-relate-stage` 之「終審 D…」）。
  - 規則 GEN-19／22 之橋接死轉出無自動守門案（`test/tools/captureForTest.mjs`、`summarizeForTest.mjs` 所轉出之 74 名皆有使用者，為人工盤點）。
  - 規則 GEN-01 限定「彙整」之用法與 `src/logContract.mjs` 等處一般動詞用法不符（無守門）。
- **`sgud/`** 於 2026-11-02 改為套件角度：宿主專屬之規則、流程與經驗已移出（缺號見 `../rule/rulebook.md`〈已移出〉、`../proc/process.md`〈已移出〉）。

## 需使用者決定者

- 無新項（RS5 開閘、RS6 開啟皆已記為須同意之既定程序）。
