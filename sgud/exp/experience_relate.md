# 累積經驗 — 關聯之設計與審計教訓（w-knowledge-relate）

> 本套件設計與審計中累積之教訓（待判去處與評分自洽、JSON 抽取、正式席位 A/B、泛用開源套件之界定、持久檔語意、核對件落點、判定小組執行器收斂、`relateStage` 拆分、跨套件收斂、測試件與守門、驗收）。節號沿用最初編號，與 `experience_general.md` 同一編號空間。日期一律絕對日期。
> **路徑基準**：原始碼在 `src/`，本檔所列檔案路徑除已標 `src/`、`test/`、`toolg/` 者外皆相對 `src/`；盤點指令在套件根重跑（`git grep` 只搜追蹤檔）。
> **用語**：「使用端」＝使用本套件之專案；「抓取套件」＝npm `w-knowledge-capture`；「摘要套件」＝npm `w-knowledge-summarize`；「下游」＝讀本套件產物之後續工作。

## 26. 待判去處、題組應然與評分自洽(2026-10-08～09)

- **改「去處」要沿鏈驗到終點**:為修「修不了之 RS3 交使用者、下一步寫『重掃即結案』而掃描唯讀」之承諾未兌現,改把修不了者交管線(RS6／RS4)——但兩核對段判「現行理由之確定性違反」只看 RS2／RS8,判 keep 即記合格結案、違反留庫、下次存量處置再登錄 → 空轉。半套修補比不修更糟(原本至少有負責者)。改去處時逐段問「接手之處對這一類真的會處置嗎」,並把該段之判定收斂為單一函數讓兩處同讀(今為 `standards/edgeGate` 之 `reasonRewriteProblemsOf`,`REASON_REWRITE_STDS`＝RS2／RS3／RS8;衝突核對、既有邊覆核與存量處置同讀)。
- **使用者之裁示要被每一個讀者承認**:豁免只認 `edge:<id>:<標準>` 鍵,而存量問題經覆核待判(RS6／RS4,`ctx.stockStd` 標來源)處理——使用者豁免該待判後掃描仍記不合格、存量處置又重開。修時同類一併:來源除存量之 RS2／RS3／RS8,還有維護段登錄之清單外型別 RS1(當時只修了被點名之三種,RS1 漏了)。今為 `standards/edgeQueue` 之 `stockWaiverKeyOf` 單一判定,掃描、存量處置與兩個登錄件(`queueEdgeReview`、`queueConflictCheck`)同讀。
- **題組之應然要以「正式提示詞之字面」判得清楚**:冒煙時 sonnet 對正向題組 r02(理想拋體 45 度 vs 有阻力小於 45 度)、r05(合併 vs 快速排序之穩定性與複雜度)兩回皆判衝突——當時正向提示詞之規則寫「兩篇結論相反、參數矛盾、或適用條件互斥時,務必選為衝突」,對比陳述在此字面下可讀為衝突。強模型兩回一致「答錯」先查題目與提示詞之規則是否衝突;改寫題組(去對比陳述)後 15/15。同族四支提示詞對「衝突」之定義精確度當時不一(核對與覆核有「同一問題、特例不算」,正向與重評沒有)——其後經正式席位 A/B 收斂為單一來源(`CONFLICT_DEFINITION`,見 §28、REL-14)。
- **抓模型原始回覆:經正式調度層、以條目之 validate 攔 stdout**:評分報表只留逐案欄位(理由截短至 120 字)、調度層之失敗預覽(`preview`)只留回覆前 120 字,看不出「第 3 項 verdicts 非陣列、其後全缺」之成因。直接打 CLI 三次皆正常(不經寬鬆抽取);改以 `createAiAdapter({ ai, workspace, catalogue })` 把 claude:sonnet 條目之 `validate` 換成「存 stdout、回 true」(調度層對條目自帶之 validate 與本層驗證取交集,故每一次回覆都攔得到,含本層隨後判不合格者)跑同一角色,6 呼叫抓到 1 次:模型先回一段只含第 1 項之 JSON,再寫「等等…更正如下」回完整一段;當時調度層取第一段 → 其後缺項(今已改取最後一段合格者,見 §27)。屬模型格式違規,正式管線下輪重試、評分計不合契約,處置一致。
- **被中斷之工作續做前,先重跑整套定位斷點**:執行中之子工作被額度中斷後續派,先重跑全套找出斷點(當時僅 1 紅)。紅燈是字樣檢查把 `openStores` 一律當執行端指令名——它是本套件總組裝之自有 API(`createKnowledgeRelate` 之回傳)。**禁用詞掃描要附範圍與理由**:`unit-relate-holds` ④ 只在總組裝 `createKnowledgeRelate.mjs` 與主入口 `WKnowledgeRelate.mjs` 以外禁 `openStores`,不做全域黑名單。另:交辦叫子工作「把理由寫進套件檔頭」時若寫成沿革(「此前…」),`unit-relate-package` ④ 之沿革檢查會擋——交辦就要寫成設計陳述。
- **差分比對之兩側產物要同批重產,且用結構化比對**:比對腳本一改(例如多納入一篇輸入),舊側產物即過期(差了數十秒之時刻),新舊比出上千條假差異。**比對腳本一改,兩側產物都重產**;輸出多一個鍵之後逐行比對會整段錯位,改以結構化比對(JSON 逐鍵、jsonl 逐列、日誌以行集合)再逐條歸類到刻意差異表。
- **多工具共用之總表,寫入者只能動自己那幾列**:評比表 `模型評比.csv`(套件根;`--board` 之目標)經抓取套件之 `mergeBenchBoard` 併入——一角色一模型一列,本次覆蓋同角色同模型之舊列、他列與欄逐格保留,停測或有未呼叫回合者不寫,既有檔表頭與本版不同即拋、不覆寫。曾有「整份改寫」型之重出指令,把另一個工具併入之列與欄(數十列、數十欄)刪掉,而它自己的錯誤訊息還叫人「以 report 重出」。**凡「重出／重建」類指令,先問它寫的檔還有誰在寫**;改為只替換本次有結果之列後,以總表之複本真跑、與手動合併逐格比對才收。
- **評分要自己算正式管線會附的東西,不收題組自給**:核對兩角色之提示詞項,正式管線依現行理由自動附「須改寫」之註;評分原本只收題組自給之 `reasonProblem`——題組作者漏給即與正式形式分歧。收斂為 `standards/edgeGate` 之 `pairCheckItemOf`(題組 → 項,同正式之判定,經 `checkPromptItemOf` 組項)並拒收自給(`bench/relateBench` 驗題組時對 `input.edge.reasonProblem` 報錯),正式兩段與評分讀同一組函數;三個指紋不變即證收斂未改提示詞。


## 27. 調度層之 JSON 抽取改「取最後一段合格者」(2026-10-09)

- **改調度層之行為、說「誰在用」前,先追到組裝點**:本套件之調度層是抓取套件之 `createAiAdapter`(總組裝 `createKnowledgeRelate.mjs` 以 `buildAiAdapter` 建,`cfg.aiAdapter` 可整組置換),JSON 抽取為其 `pickJsonReply`;改其行為在抓取套件、不在本套件,注入之調度層須自行遵守同一判準(README §17)。調度層曾有多份並存,憑印象說「某處之調度層服務哪些工作」會不精確——先追到組裝點(該 `buildAiAdapter` 由哪個檔匯入)。
- **取最後一段時,check 是唯一之篩選**:取第一段時前言之 `[3]` 會被取走;取最後一段時尾隨說明之 `[3]` 會被取走——兩種錯是對稱的,真正的防線是 check 要驗到項目之形狀(至少一項帶整數 `index` 等)。本套件各段皆如此:正向／反向／輪巡之 `checkResult`(陣列且至少一項合格)、重評之 `checkSingle`(另須 `verdicts` 陣列)、衝突核對與既有邊覆核之 `checkJson`(帶整數 `index`)。改規則時逐一盤點傳給調度層之 check。check 之語意也要一致:調度層只認嚴格 `=== true`(回「不合格原因」字串即不合格),以 `!!check(d)` 判合格會把原因字串當合格。
- **驗收用實錄回覆重放正式路徑**:先前以「條目 validate 攔 stdout」抓到之真實回覆(先回一段只含部分項、再「更正如下」回完整一段)正好是最好的驗收材料——假 REST(`startServer`,固定埠 8862)回這段原文,走正式調度層與各段,比對舊作法(取第一段,1 項)與新作法(取最後一段,5 項)。比只跑自己寫的單元測試更接近使用者會遇到的情形。
- **「誰傳 check」要盤到評分與真 AI 測試**:第一輪盤點只掃生產碼之 `callJson(…, check)`,漏了評分核心之預設 `() => true` 與真 AI 測試只驗陣列之 check——它們也走同一調度層、也受「取最後一段」影響,且評分須與正式取同一段才量得準(今評分角色之 check 與正式同形:`bench/relateBench` 之重評單評 check、`pairCheck`,真 AI 測試 `api-relate-bench-ai` 經 `runRelateBench` 走同一組)。盤點式樣要含 `() => true` 與角色定義之 check,不只 `Array.isArray`。


## 28. 正式席位 A/B 之做法(2026-10-09 衝突定義;規則帳本 REL-14)

- **判準與應然先凍結再開跑**:方案檔寫死指標(FC／MC 以數量)、採用條件、持平時之處置與回退判準;新增題之應然與理由先寫進題組檔。跑完只照判準判,不看結果改判準或題(「勿據短時間觀察改題組」)。A/B 之證據(兩臂之逐回結果、方案、回歸題組)留存,日後改定義或換席時以之為基準比較。
- **兩臂只差一句、可證**:B 臂以「正式提示詞上之字串替換」產生,斷言被替換句恰出現一次、兩臂長度差＝句差;採用後以同一組題重組提示詞,與受測之 B 臂逐字比對全同——上線的正是測過的那份。
- **提示詞改動先查誰綁它**:提示詞有逐字契約(`test/golden/prompts-default.json`,以 `test/tools/genPromptGolden.mjs` 比對;重產前須確認差異皆為刻意變更並取得同意)與評分之提示詞指紋(`promptFp`,評比表帶「提示詞指紋」欄)。重評提示詞一改,其題組須以正式席位重跑(每案兩回皆等於應然才算過)再據以換席;衝突核對與覆核以共用常數(`CONFLICT_DEFINITION`)重組而字面不變,指紋不動——收斂成單一來源時保留既驗證者之字面,範圍就只剩被改的兩支(正向與重評)。
- **合併判準會掩蓋分項**:合計 FC 降主要來自正向(26 → 18);重評 FC 5 → 7 全是某一席之單回翻轉、另一席反而 2 → 1。依凍結判準採用,但回報須分項列出,並把「仍未解」(不重疊期間、不同策略之參數仍多被標衝突)記下,不讓「採用」讀成「解決」。
- **抓原始回覆分辨「模型漏項」與「取最後一段取到部分更正」**:A/B 中一次重評回覆缺兩項;以條目 validate 攔 stdout 重送 6 次(做法見 §26),皆無「部分更正」之段,反而抓到一次完整之自我更正(「Wait — … Corrected output:」)——取最後一段在真實流量中確有發生且取對。


## 33. 泛用開源套件視角之審計:預設不變之證據與語言設定(2026-10-28;規則帳本 GEN-20)

- **先寫界定再審,審的是「違反哪一條原則」而非「哪裡可以更好」**:各原則附判準(Grep 樣式或測試名)與現況(符合／刻意／違反),矩陣逐站點判定後才定處置;否則審計會滑成無盡的改善清單。「刻意」與「違反」要分開列——刻意者只進 README 已知限制(§17)。
- **每一步都要「預設行為逐字不變」的證據,不是口頭保證**:golden(`test/golden/prompts-default.json`)、契約測試(`unit-relate-contract` 等)、改前改後之差分夾具三者缺一即無從證明 opt-in 沒改到既有安裝。把提示詞中寫死之「繁體中文」改成語言設定時,預設語言之輸出須與改前逐字相同——`unit-relate-locale` ① 斷言「只換語言句、其餘逐字相同」(預設提示詞 `replaceAll('繁體中文','英文')` 後與 `lang: 'en'` 者全同);golden 與評分之提示詞指紋所依之字面一變,既有的 A/B 證據即失效。
- **加一個回傳欄位會打到十幾處「鍵集恰為」之斷言**:`locale` 進入 runtime 回傳、每輪依賴、`info()`、domain 成員後,全套跑出十幾個失敗,全是 `deepEqual(Object.keys(...))`——這類斷言是刻意的契約守門(漏列即失敗),改契約時一律先 `git grep -n 'Object\.keys(' -- test` 盤出期望清單再跑,比逐一等失敗省一輪全套。`CFG_KEYS` 與實際讀取者一致之守門(`unit-relate-assembly`)亦同:執行期件新讀 `cfg.lang`,`CFG_KEYS` 不補即失敗;自己組裝而把整份 cfg 交給 `createRelateRuntime` 者,新鍵也要補。
- **「字形標準不適用」要列為 NA、不能變 0**:正體標準(RS3)於非繁體中文時若直接不判,掃描總量歸 0 與「全部合格」在報表上無法區分;逐件列不適用(受檢總量不變、違反 0)才看得出是語言設定關掉的(`unit-relate-locale`:`[total, violation, na]` 由 `[1, 1, 0]` 變 `[1, 0, 1]`)。不適用字樣只一份(`SCRIPT_NA_DETAIL`,取自抓取套件)。
- **語言設定要在最底層解析一次、以物件傳遞,不在各處重解析字串**:`resolveLocale`(抓取套件)回凍結物件 `{ code, label, han, script, slug }`,執行期件(`createRelateRuntime`)解析後放 `deps.locale`,純函數(`checkEdge`、`gateEdgeProposal`、`edgeFixOf` 等)經 `scriptOf(ctx.locale)` 取字形政策(未給即預設正體)——既避免各呼叫點各自判語言,也讓測試能以字形政策物件(如 `SCRIPT_NONE`)直接注入。`Intl.getCanonicalLocales` 驗代碼、`Intl.DisplayNames` 取表外語言之稱呼,不手列全部語言。


## 34. 持久檔語意與小件收斂(2026-10-28;規則帳本 STD-26)

- **共用件抽出後,每個改用站點都要確認 import,不能只跑「直接相關」的測試檔**:`gateCtxOf`(今在 `standards/edgeGate`)抽出後 `reevalSegment` 漏了 import,ReferenceError 被逐項鏈之例外處理吞成「逐項鏈異常」WARN、該篇不套用——選跑的幾支測試檔全綠,整套才紅,而且失敗訊息是「甲撤銷 expected true」這種結果層的斷言,看不出是 ReferenceError。判準:新名字出現在幾個檔,就有幾行 import 要核;改完一律跑整套,不以選檔代替。
- **要看被吞掉的例外,複製測試檔到同目錄加 console.log 最快**:測試之 log 收在記憶體,mocha 不印;把測試檔複製為 `test/zz-dbg.test.mjs`(同目錄相對 import 才對)、在斷言前印 `e.log.lines` 與帳之 outcome、`--grep` 只跑該案,一次看到「note:gateCtxOf is not defined」;用完即刪(不留在 `test/`,否則被 `test/*.test.mjs` 之 glob 抓進全套)。
- **「一份」要保留各站點刻意不同之語意,用選項而非換掉行為**:RS3 之沿革修正與納入閘之正規化合成 `scriptFixHistory` 時,存量修正對「理由非字串之筆」原本刻意不動(修不了者交使用者,`unit-relate-stockfix` 釘住),正規化則字串化後修——合成時以 `stringOnly` 區分,否則存量測試紅;同理 `edgeFixOf` 之非物件筆原樣保留,正規化之 `filter(isobj)` 留在呼叫端。
- **預演純讀要連「開帳」都不做**:關聯帳之開帳會隔離壞檔(rename 為 `.corrupt-*`)並告警,`deleteNote` 之 `dryRun` 與 `restoreEdge` 之預演原本經 `openChecked` 開帳,「只看看」卻改了檔;改為墓碑以 `openDeletions` 唯讀讀(為此補 `reasonOf`)、稽核直讀,測試以壞 dirty 帳＋目錄清單釘住「不隔離、不建檔、不告警」(`unit-relate-delete`、`unit-relate-reeval`)。
- **隔離失敗之測試用「同名目錄佔住隔離檔名」**:`fs.renameSync(file, file.corrupt-S3)` 在目標已是目錄時必失敗(Windows EPERM、POSIX EISDIR),不需 mock fs;墓碑(關鍵帳)拒寫、非關鍵帳如實回報 `movedTo:null`＋`quarantineError` 兩案皆以此法(`unit-relate-projection`);第二次開帳要用同一時戳(`stamp`)才會再撞到目錄(第一版測試換了時戳,rename 成功而規則式不符)。
- **JSONL 共用件之 append 先補尾換行,寫入形狀逐字不變、只在半行時多一個換行**:稽核帳、事件帳、裁決紀錄與存量處置帳改用抓取套件之 `appendJsonlRow`／`readJsonlRows` 後,既有測試以 `split('\n').map(JSON.parse)` 讀檔者全過;壞行回報 `{ line, error }` 形狀與原訊息(存量處置帳 `stockLedgerRowsOf` 之「第 N 行：不是物件」)不變,故其拒收字樣與測試不動。JSDoc 範例不可裸寫日期字面(`2026-01-05`,不在引號內者):沿革指標掃描(`unit-relate-package` ④,判準取抓取套件之 `historyMarks` 之「日期」)會抓,改用 `T1`／`T2` 一類佔位;帶引號之 ISO 時刻不誤判。


## 35. 核對件落點與兄弟段統一(2026-10-29;規則帳本 STD-27)

- **採納審計建議之條目要再核一次前提,不是照單落地**:「檢核雜湊改含素材」在落地前查了摘要套件之內容同步(`ops/syncNotes` 檔頭):版本雜湊只算標題／概念／一句話重點,核心知識、適用條件改了不改 `knowledgeChangedAt`——前提成立才改(今為 `stores/checkMaterial` 之 `createCheckHasher`,雜湊含兩端判定所讀之素材);若同步已涵蓋,改雜湊只是多讀 md。結論與證據寫進設計紀錄,日後有人質疑成本時有據可查。
- **「交核對」要先問提案席是誰**:覆核與重評之升級改交衝突核對後,提案席＝覆核首席＝核對首席,舊票組 [提案席, 第一席] 恆為同一供應者而永遠判不成(重試到逾次轉使用者)——寫測試時才撞到。既有邊之升級提案改以核對第一、二席投票;判準:凡把 A 段之結論交 B 段再判,先列 A、B 之席位是否同一小組(啟動期亦對「任一投票組合首兩票首選同家且無不同首選之第三席」警告,README §5)。
- **持久化提案後 tries 之語意要重定**:提案於暫緩當下即登錄,待判之 `tries` 由「失敗 −1」變成「失敗次數」(`putHold` 每次再登錄 +1);逾次判準改以失敗次數算,並把「本輪暫緩當下持久之提案」排除於前次失敗之外(`stages/conflictCheckSegment` 之 `prevFailures`),否則第一次失敗就逾次。既有測試之 tries 期望跟著改(0 → 1),字面不是真理,語意才是。
- **衝突核對段之入口序會改第三席之頁**:把待判迴圈改到提案之前時,頁內項序變了(既有邊先於提案),第三席中止之測試算出之「已判數」跟著變;收口時把序明寫成「提案(本輪者先)→ 既有邊之待判 → 存量」並以註解釘住(`conflictCheckSegment` 之 `entries`)。
- **陳舊之測試用「包住 callAI 於呼叫時改寫邊」最省**:在第一席之呼叫前 `relations.replace` 改理由,互斥內回讀即判陳舊;不需 mock 互斥或時序(`unit-relate-conflictcheck` 陳舊案)。keep 路徑無寫入故無陳舊檢查(記的是所判之舊值之雜湊,下輪照常重核),測試要用撤出類之裁決才走到陳舊分支。
- **先記後寫之序以 store 包裝記 ops 序列驗**:包 `holds.replace`、`checks.replace`、`relations.del` 推入 ops,斷言首次出現序為 hold → check → del;比讀日誌或比時刻可靠(同一時鐘同一秒)。
- **只有委派邊之篇要走收尾,不可即時評完**:原碼把「無待裁之邊」直接評完,委派邊(交 id 小者之頁)未判就記已審;改為 `markNoteProgress` 只記承辦頁已判者、批次結束後收尾補記,測試以承辦頁缺項(不評完)與承辦頁排後(收尾補記、日誌含「含委派承辦頁判定者」)兩案釘住(`unit-relate-reeval`)——承辦頁之先後以 `reevalTries` 排序控制。


## 36. 判定小組執行器收斂為摘要套件之一份(2026-10-29;規則帳本 STD-28)

- **「預設不變」要以消費者之全套驗,不是只驗新案**:共用執行器(摘要套件之 `runPanelPage`,本套件經摘要埠取用)加 opt-in 時差點把「空頁照叫第二席」改掉(`secondOf` 未給而 local 為空 → 原本仍叫第二席、calls 2);摘要既有案「空頁照骨架呼叫」立刻抓到。判準:`askSecond＝有第二席 ∧ (未給 secondOf ∨ 子集非空)`——只有呼叫端明示子集時才略過。
- **執行器之中止語意不要回「哪一席中止」,以產物判**:分頁迴圈(`stages/checkPanelPages`)分辨前兩席中止與第三席中止,不加新回傳欄,而是看 opt-in 之 `needThirdOf`／`decideOf` 有無被呼叫(前兩席中止時票未取、各項無 `votes`);中止之錯誤字樣由呼叫端在正規化 `call` 時自己留住(`stopErr`),執行器不帶 error。
- **第三席耗盡後其後之頁「照判但需第三席者不判」要在迴圈層做**:執行器不知前頁之中止;迴圈以 `thirdExhausted` 把後頁 `needThird` 為真之裁定改為 null 並計入送第三席之數,測試以既有邊覆核三頁(第三席中止於第一頁、第三頁仍不一致)釘住 `rs6Third 3、rs6Checked 0`(`unit-relate-edgereview`)。
- **刻意改打亂法時先確認無測試釘舊序**:關聯原無第二席項序之測試,改法只動第二席所見之序、不動編號;補一案以 `sha1(rs6|<邊 id>)` 算期望序並斷言與原序不同(前提斷言,避免四條恰好同序而空過)。


## 37. relateStage 拆分與層向(2026-10-29;規則帳本 REL-15)

- **拆檔先畫層,再搬件;件的新落點由「誰用它」決定,不由「它像什麼」決定**:`queue*`／`stockWaiverKeyOf` 直覺屬維運(`ops/`),但 stages 與 standards 都用,放 ops 就逼上層反向依賴——落 standards 才能讓 `core ← stores ← standards ← { stages, ops }` 成立;`projectNotes` 同理落 stores。層序以 import 掃描守門(`unit-relate-package` 層序案,README §18),不靠口頭約定。
- **共用執行器要在「items 算出之前」建立**:反向／輪巡之 `sub`／`firstMs` 原本都在各段算 items 之前求值,執行器若等 items 算完才建,時間守門之判定時點就變;故執行器建於前、`run(items)` 在後(`stages/relateQueueSegment` 之 `createRelateQueueRunner`),兩段原碼之時序不動。
- **埠只列套件程式碼所需之名,測試之名走橋接**:候選改用 `noteConceptsOf` 後 `normalizeConcept` 在套件程式碼 0 引用,`unit-relate-package` ① 立刻抓到「只供測試之名改列 `test/tools/captureForTest.mjs`」——埠的名單就是依賴面,搬家要同步刪。
- **搬家而名不變者,測試只改匯入路徑;改名者才列「改名」**:`needsEdgeReview`、`projectNotes`、`edgeFixOf` 皆搬家不改名,入口匯出名集合只增(`coveredItemOf`、`maintainRelations`、`createRelateQueueRunner`、`relateSeatOf`、`REVIEW_SOURCE_STDS`)不減;registry 之 `檔:函數` 與測試之字串須同步改,否則 registry 測試(`unit-relate-registry`)先紅。
- **行為變更要以案釘住並寫成「刻意」**:概念鍵空標籤不再計分、同尾碼多候選不猜——各補一案(前者以三候選之分數序驗、後者以同尾碼兩候選驗),並記於規則帳本 REL-15。
- **差分夾具之 0 差只證明它走到的路徑**:用真時鐘建筆記時,同分候選之序隨「是否跨秒」而變,第一版夾具報出之差其實是夾具自己的非決定性——舊筆記之建立時刻要固定且互異,只有須晚於舊篇 relatedAt 之新筆記取真時鐘。另:反向資格之門檻是「score > kth(o) 且 o 不在新筆記之前 K 名」(`stores/reverseCandidates`),同概念集之候選永遠 tie 而過不了,要以類別加分或多一組候選拉開差距才能讓反向段真的跑到。
- **拆出並匯出之私有函數就是新的公開寫邊入口**:`maintain` 在 relateStage 內時由 `stageRelate` 代表即可;拆成 `maintainRelations` 匯出後,registry「未列之寫邊入口即缺陷」的規則立刻適用——複審抓到,自審沒抓到。判準:凡搬出且匯出者,先問它寫不寫邊、登不登錄,寫就進 `enforcedAt` 與不經閘入口表(`RELATE_UNGATED_WRITE_ENTRIES`)。
- **獨立複審重構值得**:一次獨立複審找出 20 項,採納 16 項,含兩項中度缺陷(registry 漏入口、層序守門不含 core／葉／根檔)與一項文件錯歸(REL-15 插進 REL-14 中段)。提示詞要給:舊快照路徑、新檔清單、刻意之差清單、「每一引用附 file:line 且須實際讀到」、報告落檔之路徑;驗收看報告首行之 READ／WRITE 標記。收回後仍逐條對原始碼核過才採納——本次 20 項全屬實,但「屬實」與「採納」仍分兩步。


## 38. 已不再違反之結案與 AI 改寫之逆(2026-10-29;規則帳本 STD-29、REL-16)

- **「已不再違反」要先問「待判之現行問題是不是還是那個來源」**:覆核／核對之待判在重試、型別判不了、隔離時以 `holdOf` 合併 prev.ctx 再登錄,`ctx.stockStd` 會一路留著——若預檢只看 stockStd,型別判不了之使用者待判在來源 RS2 被他途改好後會被當「已不再違反」結案,使用者要判的型別問題就無聲消失。判準定為「負責者 pipeline」而非「有 stockStd」(`standards/edgeQueue` 之 `stockSourceResolvedOf`):pipeline 之待判(存量登錄與其重試)其問題確為來源;使用者負責者一律不預檢,要求重試者照送兩席。
- **預檢用原值 `checkEdge`、不用送審之 `reasonRewriteProblemsOf`**:後者先做確定性正規化(正體可修者不算違反),拿它判「已合格」會把仍含簡體之理由當合格結案而存量處置從此看不到該待判;原值判定保守——可修者照送兩席(兩席 keep 即記合格),字形留給存量處置之 RS3 修正。
- **逆操作之對象由帳列是否帶「改寫前之現值」決定,不由 outcome 名決定**:核對帳之 `written*` 列看似也是寫入,但其 `edge` 是提案本身(新衝突之落地,含重評／覆核升級交核對者);對之做逆等於憑空造舊值。三段帳中只有 `edge`＝改寫前現值且 `written`＝寫入值之列可逆;撤銷列(重評 applied 無 written)亦不在列——那是 `restoreEdge` 之事。
- **撤回之裁示標準隨帳而非隨型別,但裁示之對象隨型別**:核對帳之撤回一定回復衝突型(reason 不改型、downgrade 之逆回衝突)故恆為 RS4 裁示;覆核帳之撤回恆回非衝突型故恆為 RS6;重評帳之撤回可回任一型別——RS5 無檢核紀錄,改以「該邊 RS5 待判結案＋`updatedAt`＝現在使本版本不再重評」表達裁示,回復之衝突型邊再依「非裁示之還原」登錄 RS4。`restoredStandards` 只加 `o.std`／`o.how` 兩個覆寫,不另寫一份裁示邏輯(`ops/noteOps`)。
- **同方向同型別之理由撤回不入 history**:`reviseEdge` 之身分集合語意使 AI 寫入之理由不留在 history(與重評帳留存變更前值同一設計),測試要釘「history 無 AI 之理由」而非「history 有 AI 之理由」——先讀 `reviseEdge` 檔頭再寫斷言,否則期望反了。
- **守門先紅再改字樣**:JSDoc 寫了 `'RS5'` 字面、檔頭寫了他工作(下游)之名,都被盤點型守門抓到(`unit-relate-holds` ④:字面 `'RS5'` 只准在 `stores/relateHolds` 之定義與 `core/relateSettings` 之判定小組顯示標籤;`unit-relate-package` ④:不得提他工作之名)。盤點型守門之價值正在此——改完立刻知道哪句話越界,不必記規則。


## 39. 跨套件收斂(2026-10-29;規則帳本 GEN-21)

- **動工前先逐條核實「哪些已被前步收掉」**:全盤清單中組裝共用件、累計器、slug 尾碼、JSONL 等已於先前步驟落地;不核實就會把已收斂之件再做一次。設計紀錄先列「現況／本步」表,再動工。
- **淺層共用之預設是潛伏缺陷**:`resolveVocab({})` 回 `{ ...VOCAB_DEFAULT, ...o }` 時,各套件 spread 後其 `conceptRenames` 與抓取之預設常數為同一物件——下游就地改預設即汙染抓取。測試「各次取得之物件互不共用參照」(`unit-vocab`)一跑即紅;共用預設一律回複本(`cloneSettingsDefault`;`core/vocab/relateVocab` 取預設之複本),比對 `notEqual` 參照釘住。
- **WeakMap 側通道換成核心契約**:評分核心把頁基數 `base`、案編號 `seq`、該頁 `domain` 交給掛點後,各評分角色以案物件為鍵之 WeakMap 編號(各約 40 行)全刪;代價是測試中手組之 `at`／`ctx` 須補 `seq`／`domain`——改掛點契約前先 `git grep -n -E '\bat = \{|\.check\(|\.promptOf\(' -- test`,逐處補。
- **可覆寫成員之通用化要看公開簽名是否等於內建簽名**:把「未覆寫即內建本身」通用化前,先比公開簽名與內建簽名——公開版比內建多一個參數(例如多一個詞彙參數)者,直接回傳內建會把該參數當成選項物件而錯位;只有簽名相同者才能「未覆寫即內建本身」,否則留一層薄包裝。本套件四支提示詞經 `overridablePrompt(custom, key, builtin, { ctxOf, norm })` 取用(`domain/relateDomain`),內建與公開簽名同形,覆寫函數另收末參數 ctx(README §7)。
- **埠之「每名皆有非測試取用」守門在收斂後立即紅**:某評分件自埠移除後,測試另需者改經橋接(`test/tools/captureForTest.mjs`、`summarizeForTest.mjs`)。收斂一件就要回頭看埠與橋接兩邊。
- **委派函數要 `async` 才能把同步拋錯變 rejection**:`runRelateBench`／`runRelateBenchCli` 皆為 `async` 函數,委派 `CLI.run`／`CLI.runCli`——角色 id 不認得之同步例外若不包 `async`,`assert.rejects` 抓不到(拋在呼叫端而非 Promise 內)。
- **差分夾具之範圍跟著檢查點條文走**:檢查點列「info()、提示詞 golden、詞彙、掃描、席位檢核」,夾具就逐項算(零設定組裝之 `info()`、詞彙解析、golden、評分角色之規劃含指紋〔`planRelateBench`〕、掃描三形)——逐鍵 0 差才算「行為不變」;只跑測試全綠不夠(測試不釘 `promptFp`)。


## 40. 測試件與守門(2026-10-29;規則帳本 GEN-22)

- **橋接「每一名皆有使用者」之守門(目前以人工盤點代之)若要自動化,須把測試件之 `export … from` 算成使用**:橋接(`test/tools/captureForTest.mjs`、`summarizeForTest.mjs`)轉出之名須被本套件 `test/` 下至少一檔取用,檔頭註明尚無自動守門案;若只算 `import { } from`,以 `export { … } from` 轉出給他檔用之名會全被判死——轉出是另一種取用。守門之自檢案要含「轉出(含別名)」之合成檔,否則漏算不會被抓。
- **題組 JSON 不能整檔逐行掃沿革**:材料天然會寫「程式碼審查」「SHA-256」「溫室氣體排放之盤查」「此前提」,逐行字樣判準把題材當沿革。界線是「說明(`note`、`why`)屬原始碼、材料與應然屬題材」——以 `benchCaseNotesOf` 只取說明;`why` 可改字(不入提示詞、不改題目識別),材料不可改。
- **新增共用測試件之名先 Grep 測試有無同名區域件**:經橋接新轉出一個共用名(如 `withCheck`)前,先 Grep `test/` 有無同名之區域函數或變數;同名異義一律改名(如 `withCheckStd`、`checked`),不靠放寬守門過關。
- **手寫 AI 替身包 `withCheck` 後全套仍綠**:既有替身之資料本來就合格;包裝之價值在今後——替身形狀一不合即以 `OUTPUT_VALIDATION_FAILED` 可見失敗,不再靜默繞過正式 check(注入之 `callAI` 契約本就要求自驗,README §15)。
- **模組層 `const TMP = path.resolve('test/_tmp/…')` 綁 cwd 且載入即算**:改 `let TMP` 於 `before` 內 `tmpRoot(名)`(`test/tools/relateTestKit.mjs`;以套件根定位、先清後建、帶 pid 使並行互不干擾),`after` 以 `removeRoots` 回驗;改完後 `path`／`fs` 之 import 多半成孤兒,逐檔 Grep 清掉。
- **ctx 袋改 Map 後斷言要改讀法**:手寫袋以 `e.bag[k]` 物件取值,`bagCtx` 之 bag 為 Map 須 `e.bag.get(k)`;旗標名一律取 `RELATE_CTX_FLAGS`(`edgesChanged` → `relateEdges`、`blocked` → `relateBlocked`),不寫 `relateEdges` 字面(reeval 測試原寫字面,改時補 import)。
- **兩席段之斷網案要同時備齊三種工作**:RS4 待判(`queueConflictCheck`)、RS6 待判(`putHold` 帶 `ctx.stockStd`)、內容變更之筆記(reeval);席位三家皆指死埠、`netGuard` 確認不通,判準看 `checkPanelPages` 之「前兩席中止」(`rs4Stopped`／`rs6Stopped`)與帳面不動(tries、checks、`reevalTries`),不看呼叫次數(`unit-relate-assembly` 斷網案)。
- **文件之失效引用掃描要先定判讀規則再看數字,字樣契約改字必同改測試**:若以工具掃 README／sgud 之檔案引用,路徑以套件相對路徑寫者(`test/tools/historyMarks`)、規則帳本之 `檔.函式` 錨點(`stages/reevalSegment.runReevalSegment`)與標明之歷史敘述(「審計前另有…」)都會命中,非失效;先定判讀規則,逐一判讀後再看數字,新增者改全名即消(本套件目前無此掃描工具,規則留此備用)。字樣隨行為改之處(`RELATE_API_HINT.restoreNote`、`RELATE_HOLD_NEXT.stockHistoryScript`)皆被測試逐字釘住(`unit-relate-holds`),改字樣必同改測試——這正是字樣契約該有的樣子。


## 41. 驗收與評比實務(2026-10-29)

- **存量處置回退:「回退當下之保真」與「其後之改動」要分開驗**:回退當下之保真＝回退後與套用前之傾印逐筆同(集合逐筆、狀態檔、md 內容);其後之改動＝現值已非該次處置之結果者,回退報 `conflicts`、不覆寫、不復活,`acceptCurrent` 才記取代列(`rollbackEdgeStockFix`,`unit-relate-stockfix`)。與舊作法(無條件覆寫)逐階段做差分表,比單元測試更直接——每一差都要對得上刻意變更,對不上即回歸。
- **md 之 sha1 異不等於內容異**:回退後有數篇 md 雜湊不同,逐檔核是 frontmatter 鍵序(舊投影程式所寫者於鄰居重投時依現行鍵序重寫),鍵集與正文逐字同。比 md 要以解析後之 front＋body 比,sha1 只當第一層篩。
- **套件註解不寫日期**:套件原始碼之註解不寫日期與演練敘述(沿革指標守門會把註解內「2026-10-29 … 演練」抓出);演練之紀錄寫經驗檔與驗收文件,套件只留規則句。
- **免費池會漂,評比前先以 `opencode models` 對名單**:本套件受測名單＝`relate.ai` 之 use／fallback 加抓取套件之 `DEFAULT_FREE_MODELS`(`bench/relateBench` 之 `RELATE_BENCH_MODELS`);名單隨 w-dispatch-ai 之目錄而漂(抓取套件有漂移守門,使用端實裝之 opencode 所列仍可能再異):實測曾有數條名單內之免費 id 已不在 `opencode models` 之輸出,bench 連續 2 回(`stopAfterFails` 預設 2)`Exit code 1` 即停測。停測之 id 不計入席位容量;名單落後由抓取套件修正,本套件不另抄一份。
- **評比板只覆蓋本次有跑之 id**:已下架 id 之舊列留在板上,讀板時以目錄現況過濾;換池後四角色都要重評,板面再清舊列。
- **RS5 免費席重跑之結果形狀**:一次「回覆非 JSON」會使整頁(一頁 10 案)無裁決——某免費席第 1 回 0／10、第 2 回 15／15;判讀供應端波動與模型能力要看兩回之分布,不看總分。
