// summarizePackage.mjs — 摘要套件(npm 套件 w-knowledge-summarize)之單一匯入點
//
// 【為何單一匯入點】本套件除抓取套件與摘要套件外不 import 任何其他專案程式碼;取摘要套件之件一律經本檔——摘要套件之指定詞只在本檔
//   ('w-knowledge-summarize/src/WKnowledgeSummarize.mjs';同抓取埠之說明)。
// 【明列名稱＝摘要埠】本套件依賴摘要套件之哪些件一目瞭然;新增依賴先列於此,不在他檔直接 import 摘要套件。只列套件程式碼所需之名
//   (測試另需者經測試專用之橋接 test/tools/summarizeForTest.mjs)。
// 【摘要之知識只在摘要套件】筆記 md 之讀寫與章節、內容章與原文標題之讀法、筆記欄位之缺值字樣、同一管線內之重標旗標——本套件只讀
//   摘要之產物,不另寫一份(讀筆記之版型前先找摘要套件之 API)。
// 【核心件同一實作】判定小組、數字紮根、批次 AI 之調度(aiBatchStage)、AI 調度層之設定段取自摘要套件(待判登錄屬抓取套件,經抓取埠);
//   本套件之 core/ 不得與其 core/ 有同相對路徑之模組(本檔為各套件各自之匯入點,不在此限)。

export {
    // ── ① 筆記 md:讀寫、章節、一句話重點、frontmatter ──
    readMd, writeMd, mdText, sectionOf, dropSection, summaryTextOf, renderFrontmatter,
    // ── ② 筆記之內容章與材料(關聯以外之章,RS4／RS6／RS8 之材料讀法);版型之章名(材料讀法與提示詞之標籤取之)與投影章之章名(跨套件之資料契約,
    //   定義於摘要——本套件以 RELATE_SECTION_TITLES 轉出同一實體)──
    sectionItemsOf, noteMaterialText, NOTE_SECTION_TITLES, PROJECTION_SECTION_TITLES,
    // ── ③ 判定小組(判定、未成立原因之字樣表、單頁執行器與其第三席中止語意;設定面:席位之 schema、小組之組成、同家之警告、席位表之列)──
    PANEL_UNSURE, PANEL_WHY, PANEL_WHY_LABELS, decidePanel, needThird, panelSeats, runPanelPage, PANEL_THIRD_STOP,
    PANEL_SCHEMA, panelGroupOf, panelSameProviderWarnings, panelSeatRowsOf,
    // ── ④ 數字紮根、批次 AI 之調度(與其所發之日誌字樣;本套件之日誌契約以之組成——本套件之批次不給套用前覆核,不取其覆核之字樣)──
    ungroundedNumbers, outputNumbers,
    runAiBatchStage, AI_BATCH_LOG_KNOWN, AI_BATCH_LOG_MUST_SEE,
    // ── ⑤ 摘要之產物之契約(筆記欄位之缺值字樣、同一管線內之 ctx 旗標)──
    NOTE_PLACEHOLDERS, SUMMARIZE_CTX_FLAGS,
    // ── ⑥ AI 調度層之設定段(抓取套件之 ai 段＋parallel＋健康降序,本套件之 ai 段即此);筆記進料上界之形狀(容量警告之 opt.inflow 之判準)──
    SUMMARIZE_AI_DEFAULT, SUMMARIZE_AI_SCHEMA, notesInflowProblem,
} from 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'
