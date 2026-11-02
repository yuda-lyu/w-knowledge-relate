// summarizeForTest.mjs — 測試專用之摘要橋接(只供測試;套件程式碼不得 import 本檔——邊界檢查只許本檔與 core/summarizePackage.mjs 引用摘要套件,
//   且非測試檔一律不得引用 test/ 下之檔)
//
// 【為何需要】摘要 → 關聯之介面(筆記組裝寫出之 md 與記錄、內容同步寫回之 knowledgeChangedAt、同一管線內重標設之 ctx 旗標、筆記還原之標準閘、
//   摘要不算內容章之章名)須以摘要套件之真實件驗兩側讀寫之欄位一致;這些件(筆記組裝、內容同步、重標子階段與其 domain、還原閘、同步雜湊、
//   摘要詞彙之解析、frontmatter 之解析、非內容章之章名表)是摘要之積木,本套件之程式碼用不到,故不列入摘要埠
//   (core/summarizePackage.mjs 只列套件程式碼所需之名)。
// 【筆記之測試件】落筆記之工廠(landNoteOf;以摘要之真實組裝寫 md 與記錄)在摘要套件之 test/tools/noteKit(關聯、提煉同一份),經本檔取用。
// 【子階段之 ctx】以 Map 為底之 get／set 之 ctx(bagCtx;旗標可於 bag 斷言)在摘要套件之 test/tools/stageKit(各段測試之手寫 ctx 袋改用之),經本檔取用。
// 【只轉出測試所需之名】新增前先確認摘要埠沒有、且確為測試所需;每一名須被本套件 test/ 下至少一檔具名匯入(尚無自動守門案,以規則帳本 GEN-22 之人工盤點代之)。
// 【指定詞】摘要套件為 npm 套件:主入口 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'(同摘要埠)、測試件 'w-knowledge-summarize/test/tools/<檔>'(隨其 tarball 發布)。

export {
    buildNote, createSummarizeDomain, syncNotes, stageRetag, createRetagDomain, createNoteRestoreGate, syncFieldsOf, syncHashOf, resolveSummarizeVocab,
    parseFrontmatter, NON_CONTENT_SECTIONS,
} from 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'
export { landNoteOf } from 'w-knowledge-summarize/test/tools/noteKit.mjs'
export { bagCtx } from 'w-knowledge-summarize/test/tools/stageKit.mjs'
