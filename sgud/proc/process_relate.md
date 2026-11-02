# 處理要點 — 關聯之開發驗收、設定、維運與監看（w-knowledge-relate）

> **路徑基準**:原始碼在 `src/`,本檔所列檔案路徑除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`.
> 本檔記本套件之開發驗收（邊界、測試、衝突定義、免費 AI 能力評分）與關聯之設定、維運與監看（子階段序、投影、刪除與還原、內容變更與重評、待判、反向段、邊庫世代、日誌字樣）.現況以 `sgud/state/state.md` 與 README 為準;維運 API 之簽章與選項以 `src/ops/noteOps.mjs`、`src/ops/projectOps.mjs` 之檔頭與 README §12 為準;使用端（使用本套件之專案）之整合須知見 `process.md`〈使用端須知〉與 README §16.

## 本套件（關聯之獨立套件 w-knowledge-relate）之使用與驗收

**設計原則**:本套件為通用知識關聯之獨立套件——維持通用套件角度、不預設量化;設定與提示詞有預設、可由外部覆寫;除抓取套件（npm `w-knowledge-capture`）與摘要套件（npm `w-knowledge-summarize`）外不 import 其他處程式碼;內含完整測試、檢定標準與免費 AI 能力評分.**改關聯只改本套件**:改完跑本套件全套測試（見〈測試〉）,下游（讀本套件產物之後續工作）之測試亦宜跑.

- **題組項與正式提示詞同一形式**:衝突核對、既有邊覆核送審之項,「現行理由須改寫才能合格」者（違反 RS2、RS3、RS8）一律附 `reasonProblem`;評分與題組執行器組項經 `pairCheckItemOf`（`standards/edgeGate.mjs`;與正式兩段之 `checkPromptItemOf`、本套件之評分〔`bench/relateBench.mjs` 之 `pairItemOf`〕同一函數）,**題組不得自給 `reasonProblem`**（自給即與正式之提示詞形式分歧）.提示詞或項形式一改,評分之提示詞指紋（`planRelateBench(角色).promptFp`;評比表「提示詞指紋」欄）即變,指紋變了須以代表性模型逐案兩次全過重驗;重驗不符時先分辨是取樣變異還是題組應然不清（同一提示詞多次取樣,邊界案可能有幾回判為他類——此類案宜重審其應然）,再決定改題或換席.

- **「衝突」之定義為單一來源（規則帳本 REL-14）**:`CONFLICT_DEFINITION`（`domain/relateDomain.mjs`,具名匯出）為四支內建提示詞（正向、重評、衝突核對、既有邊覆核）同讀:對同一問題給出相反的結論、對同一參數給出互相矛盾的數值或方向、或適用條件互斥才是衝突;一方是另一方的特例、只是側重不同面向、或在不同條件下各自成立而條件並不互斥者不是衝突.**為何**:提案之段若比核對之段寬,提出之衝突即被核對撤回,故兩類段須同一判準.`test/unit-relate-domain.test.mjs` 斷言四支提示詞各恰含此二句各一次,`test/golden/prompts-default.json` 釘住提示詞逐字契約.
  - 盤點:`git grep -n -F "對同一個問題給出相反" -- src` 應只命中 `src/domain/relateDomain.mjs`（定義處;不得在他處另寫一份）;`git grep -n "CONFLICT_DEFINITION" -- src` 應只見 `src/domain/relateDomain.mjs`:檔頭註解、定義 1 處、四支提示詞（正向、重評、衝突核對、既有邊覆核）之組字處各至少一行.
  - 改此定義即改四支提示詞之字面:先 `node test/tools/genPromptGolden.mjs` 比對差異（不寫檔）,確認皆為刻意變更並取得同意才加 `--write` 重產標準檔,並依〈題組項與正式提示詞同一形式〉重驗評分.
  - 跨提示詞改判準之 A/B 做法（留給下次）:以正式提示詞＋正式席位比對,判準（指標、採用條件、持平與回退）於開跑前凍結,A/B 之題與結果留作回歸題組;依凍結判準判,回報分項列出並記下仍未解者,不讓「採用」讀成「解決」.回退判準見 REL-14.

- **邊界**:本套件只經兩個單一匯入點取上游之件:`core/capturePackage.mjs`（抓取套件;現況 125 名）與 `core/summarizePackage.mjs`（摘要套件;現況 33 名）,皆明列名稱,新增依賴先列於埠;埠之每一名須有非測試檔取用（`unit-relate-package` ① 守門）;測試另經 `test/tools/captureForTest.mjs`、`test/tools/summarizeForTest.mjs` 取上游之測試件,橋接之每一名須被 `test/` 下至少一檔取用（尚無自動守門案,維護時人工盤點;規則帳本 GEN-22）.本套件 `core/` 與兩套件之 `core/` 無同相對路徑之檔（兩埠檔除外;`unit-relate-package` ① 守門）.上游缺能力者在上游以 opt-in 擴充（預設行為不變、附測試）,本套件不繞道自寫.
  - 盤點:`git grep -n -E "from '(w-knowledge-capture|w-knowledge-summarize)" -- src test` 應只命中兩個埠檔（`src/core/`）與兩個橋接檔（`test/tools/`;橋接亦轉出上游 `test/tools/*` 之測試件）,他處不得直接 import 上游套件.
  - 結構測試:`test/unit-relate-package.test.mjs`.

- **測試（一律自套件根）**:`npm test`（＝`mocha --parallel "test/*.test.mjs" --timeout 180000`,見 `package.json`;現況 31 個測試檔:`unit-relate-*` 27、`unit-flow-relate`、`unit-settings`、`unit-vocab`、`api-relate-bench-ai`）;單檔:`node <mocha 路徑>/bin/mocha.js --timeout 180000 test/<檔名>`（去掉 `--parallel` 換檔名）;**真 AI 之案需 `WK_LIVE_AI=1`**（`test/api-relate-bench-ai.test.mjs`;燒免費額度,未設即整組略過〔pending〕;另可 `WK_RELATE_MODELS`〔條目 id,逗號分隔;未給用關聯預設席位〕、`WK_RELATE_ROLES`〔角色 id,逗號分隔;未給跑四角色〕限模型與角色,`WK_ENV_FILE` 給金鑰檔）.檢核紀錄（`core/stores/checks.mjs`）之逐案測試在 `test/unit-relate-checks.test.mjs`.改本套件後下游之測試亦宜跑;上游（抓取、摘要）套件升版或改動後亦跑本套件全套（兩者皆經埠被取用）.測試分層、暫存與固定埠等見 README §15.

- **免費 AI 能力評分**:`node src/bench/cli.mjs --role all --models free --runs 2 --out <專案外目錄> --env <金鑰檔> --board 模型評比.csv`（自套件根執行;`--board 模型評比.csv` 即套件根之評比表;`--help` 印出完整用法）.四角色:正向 `relate`、重評 `reeval`、衝突核對 `conflict-check`、既有邊覆核 `edge-review`;內建通用題組 `src/bench/cases/{relate,reeval,conflict-check,edge-review}-generic.json` 各 15、15、15、16 案,保留題（`holdout:true`,不得用於調提示詞）各 5.**`--out` 必放任何專案之外**（AI 子行程之工作目錄為 `<out>/ai-workspace`〔結束後移除,評比表「AI 工作目錄」欄記之〕,CLI 型模型會讀其上層之指示檔;預設 `./bench-out` 在 cwd 下,故須明給專案外目錄）.`--models free`（未給等同）＝核心之免費名單（抓取套件之 `DEFAULT_FREE_MODELS`,關聯預設席位排前;即 `RELATE_BENCH_MODELS`）.
  - 判準同正式:提示詞以正式 domain 組,逐案類別以正式判定函數算出;正向之項合格＝關聯清單為空或至少一條過納入閘（單一來源 `stages/relateChain.mjs` 之 `admitItemOf`,逐項鏈、批次單項驗證與評分共讀;不因單條不合而整篇拒收）.
  - 評比表 `模型評比.csv`（套件根）:一角色一模型一列,本次覆蓋同角色同模型之舊列,停測或有未呼叫回合者不寫;表頭同核心（不同即拒寫）;「題組」「提示詞指紋」欄可辨新舊.
  - 撞額度之模型以逾時停測、該角色不寫評比表（opencode 免費模型每日額度 UTC 0 時重置）,隔日以 `--role <角色> --models <id>` 補跑.
  - 用自己的題組跑（`--role <relate|reeval|conflict-check|edge-review> --cases <題組> [--vocab <詞彙 json> --vocab-pick]`;`--role all` 不可給 `--cases`）時**不給 `--board`**（一角色一模型一列,會覆蓋同角色之通用題組列）.使用端以自己凍結樣本算之代理指標與本評分之題組、判準、分母皆不同,**不可互比、也不可互相取代**.
  - 重評之多段 JSON 回覆:模型先回一段 JSON、再「更正如下」回一段時,調度層（抓取套件之 `pickJsonReply`）由後往前取第一段過 `check` 者,即取更正後之那段（若取第一段會缺項）;注入之調度層須自行遵守同一判準（README §17）.
  - 題組之案須使應然唯一:正向題若含對比陳述,在「結論相反即衝突」之定義下可讀為衝突而使 match 不明,宜改寫題材（內建題組已據此改寫）.
  - 重評失分集中在 `unsure`（材料不足）類:模型於材料不足時傾向判 keep／retire 而非 unsure（評比表「失分案」欄,內建題組之 `u1`、`h5` 為多數模型所失）,且免費模型偶有整頁回非 JSON 之格式失敗（正式管線由遞補鏈承接）.故以重評判定小組開閘前,覆核影子期候選須特別看 `unsure` 與撤銷類.

- **整合進多工作之使用端專案時之 cfg 對應**:逐項對應見 README §16 與 `process.md`〈使用端須知〉;易錯點:`createRelateDomain` 前先 `pickRelateVocab(詞彙)`（詞彙解析拒收他段之鍵）、`createRelateRuntime(cfg, settings, { vocab, domains })` 之 `domains` 須給物件（無注入給 `{}`,未給即退用整份 `cfg.domains` 而因含他工作之鍵拋錯）、`ai` 只取 `RELATE_AI_SCHEMA` 之鍵.

---

## 關聯(relate)之設定、維運與監看

維運 op 皆為 `ops/noteOps.mjs`、`ops/projectOps.mjs` 之具名匯出（依賴 `{ stores, dirs, clock, log?, domain, noteGate?, settings? }`,見 README §9、§12）;**寫入者由呼叫端取執行鎖（與管線互斥）、備份與同意**;預演（`dryRun`、未給 `opt.apply`）一律唯讀直讀,不開帳、不隔離、不建檔;需 domain 之 op 缺 `deps.domain` 即於任何寫入前拋.

- **子階段順序**:relate（開工前維護〔無 AI〕:邊庫世代檢核、型別改名之機械改寫與清單外型別告警、墓碑驅動之懸空清理、內容變更之反應 → 正向:新筆記＋內容變更之筆記 → 重評段〔內容變更之筆記其既有邊;`relate.reeval.perRun` 0 即不跑〕→ 反向段〔`relate.reverse.perRun` 0 即不跑〕→ 候選輪巡〔`relate.rotation.perRun` 0 即不跑〕→ 既有邊覆核〔`relate.standards.edgeReview.enabled` 預設關〕→ 衝突核對〔`relate.standards.conflictCheck.enabled` 預設關〕）→ project（待投影帳之筆記重算 md 兩章）→ relationIndex（有變化或待重建旗標才重建總覽）.順序見 `stages/relateStage.mjs` 檔頭;子階段鍵為 `RELATE_REPORT_KEYS.subStages`（`relate`、`project`、`relationIndex`）.

- **邊庫＝真理、md 兩章＝投影**:筆記 md（位置取自筆記記錄之 `file`）之「## 關聯」「## ⚠ 衝突與反例」兩章與 frontmatter `related`／`conflicts`／`related_at` 每次由邊庫重算（→ 本篇提出、← 對方提出）;**不要手改這兩章**——手改會在下次投影時另存到 `<dirs.state>/relate-manual/` 後被覆寫（WARN「關聯投影手改另存」）.要改關聯請改內容（下輪重判）或刪除筆記.

- **刪除一篇知識**:`deleteNote(deps, slug, { reason, dryRun, project })`.先 `dryRun: true`（唯讀:回邊數、鄰居、以之為出處之下游產物〔`cores`,須 `cfg.cores` 開啟該集合,未開即空清單〕）,再給 `reason`（**理由必填**,記入墓碑與封存）刪除:墓碑（`<state>/relate-tombstones.json`）→ 封存（`<state>/deleted-notes/`:記錄、理由、其邊、涉及該篇之反向待處理對、md 副本）→ 鄰居記待投影 → 其邊全數撤出並稽核（`<state>/relate-retired.jsonl`,先記再刪、刪後回驗;衝突邊另寫事件帳 `<state>/relate-conflict-events.jsonl`）→ 刪記錄 → 刪 md（與封存副本相同者）→ 清帳;鄰居當場重投（`project: false` 則只記帳留待下輪）、總覽下一輪重建.以之為出處之下游產物由下游處置（下游依刪除墓碑自行撤出處、還原後恢復;本套件只列出、不編入下游之知識）.
  - 誤刪 → 兩種契約（規則帳本 REL-17）:**撤銷** `undoDeleteNote(deps, slug, { project })`（原樣放回記錄、md、兩端仍在之邊與反向待處理對——不過檢定標準、不登錄新待判;現值已在而不同者不覆寫、列出〔`edgesKept`／`mdConflict`〕;刪到一半亦可撤）或**重新收件** `restoreNote(deps, slug, { dryRun, project, conflictCheck, withHolds })`（先 `dryRun: true` 預演;其邊須過檢定標準 RS1／RS2／RS3／RS8 才還原,不合格者列出〔`edgesRejected`〕不還原;**筆記本身亦過筆記標準**〔`deps.noteGate` 注入;未注入 → WARN 並原樣還原〕:可確定性修正者修正後還原,仍不合格者拒還原並列出——確認仍要還原者給 `withHolds: true`〔照還原並登錄待判,由使用者修 md 後同步重驗〕;回傳 `std.contentChanged`／`std.titleChanged`,已被下游消化而內容有修正者請下游重設基準）.
  - 刪除或還原中斷（日誌「關聯刪除或還原未完成」必看;墓碑在而記錄在、封存未歸檔、記錄已刪而 md 仍在）→ 重跑同一 op 續作完成（`deleteNote` 續刪;`undoDeleteNote`／`restoreNote` 續還原）.
  - **不要直接刪 md 或記錄**:md 消失只告警（「關聯投影：N 篇 md 讀不到」,已知常態字樣,留帳、下輪補投）、記錄消失之殘留邊只告警（「關聯懸空邊」必看）,確認後 `pruneDangling(deps, { apply: true })`（預設只列出;撤出可由 `restoreEdge` 還原）.

- **內容變更**:摘要套件之內容同步以記錄欄 `knowledgeChangedAt` 通知;本套件以「評估時記下之版本 `relatedChangeAt` ≠ `knowledgeChangedAt`」判待重判（`stores/relatedNotes.mjs` 之 `needsReeval`,不比時間先後）.開工前維護把變更之筆記與其鄰居記待投影、總覽待重建;關聯段把變更之筆記重入正向評估（同一 prompt、候選同規則）,**只增不刪**——可新增、可升為衝突;既有邊之改型／撤銷交重評段（下條）.

- **既有邊重評（規則帳本 REL-13）**:內容變更之筆記經正向評估後,其既有邊由兩席（`relate.reeval.ai.first`、`second`;前兩席判不成者叫 `third`）逐條裁決 keep／change／retire;兩評一致、**成交供應者不同**、且閘門允許才套用（**兩席首選須不同家**,同家則兩票恆為同一供應者而永遠判不成——啟動期警告〔`relateWarningsOf`〕會提示;席位以 `relateSeatsOf`／`relatePanelsOf` 檢核）.套件預設 `relate.reeval.perRun` 0（停用）、`relate.reeval.apply` **false（影子期:一律只記候選於 `<state>/relate-reeval.jsonl`）**;`apply` 取值 `false`｜`'additive'`｜`'all'`（README §5）.
  - **開閘程序**（建議使用端採用;須使用者同意,不得自行改 `apply`）:①重評題組（內建 `src/bench/cases/reeval-generic.json`,或使用端自己之 RS5 題組以 `--cases` 給）以**正式兩席**逐案兩次全過（`core/relateSettings.mjs` 之 `apply` 註解亦寫明:含標準答案之題組以正式兩席逐案達標前維持 false;**不以比率放行**;兩席用同一模型只驗流程、不作開閘依據）②主審逐條覆核影子期候選帳（`relate-reeval.jsonl` 之 `outcome:'candidate'` 列）之一致裁決③使用者同意後先開 `'additive'`（升衝突、非衝突改型、理由更新）、再議 `'all'`（撤銷與衝突降級——會連動下游重審）④開閘後跑 `reevalRequeue(deps, { apply: true })`（關閘期間之候選不回溯套用,重排後以新鮮評估確認）.
  - **運維**:批次改寫筆記（如格式腳本）致待重評逾 `relate.reeval.guard`（預設 20）篇 → WARN「關聯重評守門」（必看）、本輪不開工 → 確屬格式變動用 `reevalBaseline(deps, { apply: true, by, ruling })`（記為評完、不呼叫 AI;**未判而記評完是使用者之裁示,須給裁示者與內容**,每篇記重評帳〔`outcome:'baseline'`〕、該篇本版本之 RS5 待判以同一裁示豁免）,真實修訂則調高 `relate.reeval.guard`;被撤之邊可依稽核還原:`restoreEdge(deps, 邊id, { apply, reason })`（先不給 `apply` 預演;以該邊最後一筆稽核為準,撤出理由在 `RESTORABLE_REASONS`〔`note-deleted`、`prune-dangling`、`reeval-retire`、`std-retire`、`rs4-retire`、`rs4-quarantine`、`rs6-retire`、`rs6-quarantine`〕者可還原,須過檢定標準;撤出時之理由本身不合標準者以 `opt.reason` 給新理由;**還原衝突核對（RS4）或既有邊覆核（RS6）撤出／隔離之邊＝裁示「真衝突／關聯成立」**:該待判結案、記檢核〔seats `user`〕,不再自動核對此值;筆記刪除之邊以 `restoreNote` 還原）;被判定小組改寫之邊可撤回最後一筆改寫:`revertEdgeRevision(deps, 邊id, { apply })`（以重評／衝突核對／既有邊覆核三帳最後一筆改寫列為準,現值須仍為該次改寫之結果、改寫前之值須過檢定標準;撤回核對／覆核之改寫＝裁示、撤回重評之改寫 → 該邊 RS5 待判結案;新衝突之落地〔提案列〕不可撤回——以兩席段或刪除處理）.`reevalBaseline`、`reevalRequeue`、`restoreEdge`、`revertEdgeRevision`、`pruneDangling` 不給 `opt.apply` 皆唯讀.
  - **存量處置之已不再違反**:`planEdgeStockFix`（預演;`stds` 含 RS3）另列 `resolvable`（已不再違反之待判,套用時結案）——存量處置登錄之使用者待判 `edge:<邊id>:RS3` 而沿革已被他途改正者,`applyEdgeStockFix` 結案（處置帳記 `hold-resolved` 列,`rollbackEdgeStockFix` 回退復原）;兩席段（RS4／RS6）對存量排入之 pipeline 待判於入項前預檢（`stockSourceResolvedOf`）,來源標準現值已合格者結案不送兩席（run.json `rs4SourceResolved`／`rs6SourceResolved`）.
  - **重評之待判（RS5;判定小組化）**:兩席不確定或不一致之邊登錄待判（使用者）——`requestRetry(holds, id, { at })` 讓該篇本版本再評該邊、`waiveHold(holds, id, { by, ruling, at })` 本版本不再評;逾 `relate.reeval.maxTries` 次未評完之筆記亦登錄（物件 note）.重評開啟須 holds 集合（缺即該段拋錯「關聯重評(relate.reeval.perRun)需要 holds 集合」,無「未開 holds」之降級）.

- **待判登錄（檢定標準）**:未能判定或「不納入、待條件成立後重送」者登錄於集合 `holds`（與上游同一集合;期限一律 `RELATE_HOLD_DEADLINE_DAYS`＝30 天,`relateHoldDeadlineOf`,刻意不開放設定）;列出 `listHolds`、逾期 `overdueHolds`、使用者裁示豁免 `waiveHold`、要求重試 `requestRetry`——皆為上游（抓取套件）之待判處置 API,本套件不轉出（README §12 末段;寫入者由呼叫端取執行鎖）.本套件待判之下一步字樣見 `stores/relateHolds.mjs` 之 `RELATE_HOLD_NEXT`.
  - **監看**（重評）:INFO `關聯重評：<id> 既有邊評完（本版本 N 條）`、`關聯重評：[[a]] ⇄ [[b]] 撤銷|改為「型別」（理由）`（閘門開才有）、`關聯重評：N 篇之 md 讀不到…本輪不評`、`關聯：[[a]] ⇄ [[b]] 於重評撤銷後 30 天內再被正向段提出`（振盪觀察,`REEVAL_REPROPOSE_DAYS`;反向段、輪巡段提出者字樣換段名）;WARN `關聯重評：<id> 逾 3 次未評完（尚有 N 條未判），已登錄待判（RS5）`（`RELATE_LOG_KNOWN` 之已知常態;待判以 `listHolds(holds, { std: 'RS5' })` 取）;關聯段 summary 尾「｜重評 N 篇（改型 a、撤銷 b、候選 c）」;使用端巡檢可由 run.json 之 report 鍵取值（`reevalPending`、`reevalGaveUp`、`reevalCandidates`、`reevalReproposed` 等,見 `RELATE_REPORT_KEYS`）.

- **反向段（配額 `relate.reverse.perRun`,套件預設 0＝停用）**:開啟程序（建議使用端採用）:①以正式 prompt＋正式席位評比「反向形狀」（舊筆記為目標、候選只有少數新筆記;真實 AI,須使用者同意）②通過後設配額——依自己庫之回放（每輪反向目標數之均值、P90、最大）定,可參考關聯容量（`relateCapacityOf`:`rounds`×`ai.parallel`×`notesPerCall`）③可另給 `relate.reverse.ai`（免費家鏈;未給沿用 `relate.ai`）並以 `relateSeatsOf`／`relatePanelsOf` 檢核席位④寫回退判準（本套件不內建,由使用端巡檢自訂;可用 run.json 之 `reversePending`〔本輪結束時待處理對數〕與 `reverseQueued`〔本輪入隊數〕,例:連續一日待處理對只增不減即降配額或停用）.

- **邊庫世代**:本套件只認無序對雜湊 id（`sha1(min|max)`）之邊庫;遇未遷移之舊有序對庫一律 fail-closed:關聯段與投影子階段不寫（ERROR「關聯邊庫世代不符」,report `genMismatch`／`blocked`）、維運 op 於寫入前拋同訊息.遷移為使用端一次性之事（本套件不附遷移腳本）,遷移前宜先備份邊庫與筆記.

- **監看**（日誌與 report）:字樣與 report 鍵之唯一來源為 `src/logContract.mjs`（使用端巡檢勿自抄,字樣一改即失效）:`RELATE_LOG_KNOWN`（已知常態 WARN,不當未知警告;含「次未評完（尚有 N 條未判），已登錄待判（RS5）」「關聯投影：N 篇 md 讀不到」及批次機制、核心件之已知字樣）、`RELATE_LOG_MUST_SEE`（一律須見:「逐項鏈異常」「關聯邊庫世代不符」〔ERROR〕「關聯懸空邊」「關聯帳檔損壞」「關聯投影手改另存」「關聯型別不在現行清單」「關聯重評守門」「關聯刪除或還原未完成」及批次機制、核心件之須見字樣）、`RELATE_LOG_PARSE`（run.json 缺時之退路,依固定格式摘要「處理 N、關聯 N 條、衝突 N 組（AI N 次）」取 `targets`／`edges`／`conflicts`／`aiCalls`）、`RELATE_REPORT_KEYS`（段名「關聯」、子階段 `relate`／`project`／`relationIndex`、統一統計 `in`／`out`／`skip`／`fail`／`aiCalls`、各子階段 detail 鍵全集）、`RELATE_CTX_FLAGS`（`relateEdges`、`relateBlocked`）.其他常態 INFO:`關聯：<id> → N 條（內容變更重判）`、`關聯：[[a]] ⇄ [[b]] 升級為「<衝突型>」`、`關聯反向：…`、`關聯：清除已刪筆記之殘留邊 N 條`.關聯段 summary 尾「｜重判 N 篇｜反向 N 篇 N 條｜刪除 N 條｜投影失敗 N｜重評 N 篇（…）」（`relateObject.mjs` 之 `relateSummaryOf`）.單元測試以實際日誌與 report 驗證（`test/unit-relate-log-contract.test.mjs`、`test/unit-flow-relate.test.mjs`）:每條字樣皆須在實際日誌出現、每個 report 鍵皆須在實際 report 出現、實際 report 不得有未列之鍵.

---
