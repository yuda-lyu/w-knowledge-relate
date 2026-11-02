// captureForTest.mjs — 測試專用之抓取橋接(只供測試;套件程式碼不得 import 本檔——邊界檢查只許本檔與 core/capturePackage.mjs 引用抓取套件,
//   且非測試檔一律不得引用 test/ 下之檔)
//
// 【為何需要】測試之環境需要抓取套件之若干件,而本套件之程式碼用不到,故不列入抓取埠(core/capturePackage.mjs 只列套件程式碼所需之名):
//   時鐘(測試自建 ctx.deps.clock)、概念鍵之折疊單例(關聯之候選比對經抓取埠之 normalizeConcept 讀抓取套件之單例,測試須設同一份)、
//   動作鏈之組裝(以單一 mw 驗其行為)、設定型別表(設定之邊界樣本以之篩選)、評分之驗證(題組之驗證、評比表之表頭、AI 調度層之
//   轉接器、報表之寫出、呼叫失敗之種類、題組之載入)、總組裝之測試環境(目錄之展開、執行鎖、交 resolveRuntime 之鍵)、
//   使用者對待判之重試要求、折疊之決定(conceptFoldsOf;套件程式碼經 applyConceptFold)。抓取埠只列套件程式碼所需之名
//   (unit-relate-package ① 自動驗),故測試另需之名一律經本檔。
// 【領域中立詞表】四套件之中立掃描共用抓取套件之測試詞表(其 test/tools/domainTerms;四套件同一份)。
// 【共用測試件】記憶體集合(memStore)、靜音日誌(nullLogger)、位置無關之共用件(testKit:日誌之替身、暫存根之工廠、子階段 report 與其整輪斷言、
//   集合之開關、AI 調度層之替身 stubAdapter、手寫替身之 check 包裝 withCheck、設定覆寫之深層合併 deepMerge、CSV 之解析 parseCsv…)、
//   原始碼之詞法器與原始檔之走訪(sourceScan)、假 OpenAI 相容伺服器(fakeRest)、提示詞標準檔之比對與重產(promptGolden)、舊名與沿革及
//   面向使用者字樣之判準(historyMarks)皆在抓取套件之 test/tools(四套件同一份;只定義於其家),本套件之測試經本檔取用。
// 【只轉出測試所需之名】新增前先確認抓取埠沒有、且確為測試所需;每一名須被本套件 test/ 下至少一檔具名匯入(尚無自動守門案,以規則帳本 GEN-22 之人工盤點代之)。
// 【指定詞】抓取套件為 npm 套件:主入口 'w-knowledge-capture/src/WKnowledgeCapture.mjs'(同抓取埠)、測試件 'w-knowledge-capture/test/tools/<檔>'(隨其 tarball 發布)。

export {
    genClockTZ, setConceptFold, composeChain, SETTING_TYPES,
    validateBenchCases, loadBenchCases, BENCH_BOARD_HEADER, createAiAdapter, writeBenchReport, BENCH_FAIL_KINDS,
    expandDirs, acquireLock, showSettingValue,
    requestRetry, STOCK_LEDGER_FILE, conceptFoldsOf, RUNTIME_CFG_KEYS, normalizeConcept,
    scriptProblems, toTwKeepLinks, SCRIPT_NONE,
} from 'w-knowledge-capture/src/WKnowledgeCapture.mjs'
export { DOMAIN_TERMS, DOMAIN_TERM_RE, domainTermsIn } from 'w-knowledge-capture/test/tools/domainTerms.mjs'
export { memStore } from 'w-knowledge-capture/test/tools/memStore.mjs'
export { nullLogger } from 'w-knowledge-capture/test/tools/nullLogger.mjs'
export {
    pkgRootOf, tmpRootsOf, removeRoots, silentLog, recLog, plainLog, logsOf, fileLogFactory, resetConceptFold, subReport, assertSubStagesOk, withStores, findFiles,
    readJsonFile, FIXED_CLOCK, msgOf, sleep, stubAdapter, withCheck, deepMerge, parseCsv,
} from 'w-knowledge-capture/test/tools/testKit.mjs'
export { lexSource, specifiersOf, exportedNamesOf, namedImportsOf, sourceFilesOf } from 'w-knowledge-capture/test/tools/sourceScan.mjs'
export { startServer } from 'w-knowledge-capture/test/tools/fakeRest.mjs'
export { runPromptGolden, goldenDiffOf } from 'w-knowledge-capture/test/tools/promptGolden.mjs'
export { HOST_CLI, historyHitsOf, userTextHitsOf, historyScanOf, userTextScanOf, benchCaseNotesOf } from 'w-knowledge-capture/test/tools/historyMarks.mjs'
