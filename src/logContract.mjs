// logContract.mjs — 關聯之日誌與報告契約:外部巡檢判讀關聯段之日誌字樣與正則、執行摘要(run.json)中關聯段之 report 鍵,
//   及同一管線內交下游之 ctx 旗標(唯一來源;隨本套件之訊息與 report 一起改)
//
// 【為何在關聯套件】關聯各子階段(及其所用之批次 AI 機制、總組裝共用件)之訊息字樣與 report 之鍵由本套件之碼產生;巡檢若自寫一份,
//   本套件改字即失效——字樣對不上時,常態訊息被當未知警告洗版、或須見之訊息被已知字樣吞掉。
// 【三類字樣】
//   RELATE_LOG_KNOWN:已知常態之 WARN 字樣(各有機制兜底、或有 report 鍵之專屬判準)——巡檢不當未知警告;
//   RELATE_LOG_MUST_SEE:一律須見之字樣(行內即使含已知字樣或筆記標題,亦須列出;他工作之已知字樣過寬時亦不被吞);
//   RELATE_LOG_PARSE:逐輪數字之正則(執行摘要 run.json 缺時之退路;group 1 為數字;依 relateSummaryOf 之固定句)。
//   前兩類為正則片段字串,巡檢以「|」併入其總表(與其他工作之字樣合併)。
// 【字樣由發出者宣告、本檔以聯集組成】關聯各段專屬者列於本檔;摘要套件之批次 AI 機制所發者取其 AI_BATCH_*(本套件之批次不給套用前覆核,
//   故不收其覆核之字樣);總組裝共用件與抓取套件之核心件所發者取抓取套件之 CORE_LOG_*——不另抄一份。
// 【字樣取該行特有之片語】已知字樣若是常見詞,會連帶吞掉同段之須見訊息;不再有發出者之字樣不列(列著只會吞掉日後碰巧含之之新訊息)。
//   須見之行多含筆記 slug(標題),標題可能含他工作之已知字樣——故須見字樣另列,不靠「不在已知之列」。
// 【report 鍵】RELATE_REPORT_KEYS:階段名、子階段鍵、統一統計之鍵、各子階段 detail 之鍵(全集;部分鍵只在條件下出現,見各列註解)——
//   巡檢讀 run.json 之 stages[].sub 依此取值,固定格式摘要(relateObject 之 relateSummaryOf)讀同一組鍵。
// 【ctx 旗標】RELATE_CTX_FLAGS:旗標名是跨子階段、跨套件之契約(關聯總覽之重建、投影子階段之略過、同一管線內之下游讀之);名稱只定義一次,
//   設與讀皆取本檔之常數,不寫字面。
// 【以實際訊息驗證】單元測試以真實之子階段與總組裝產出之日誌與 report 驗證(test/unit-relate-log-contract、unit-flow-relate):
//   每條字樣皆須在實際日誌出現、每個 report 鍵皆須在實際 report 出現,實際 report 亦不得有未列之鍵。

import { CORE_LOG_KNOWN, CORE_LOG_MUST_SEE } from './core/capturePackage.mjs'
import { AI_BATCH_LOG_KNOWN, AI_BATCH_LOG_MUST_SEE } from './core/summarizePackage.mjs'
import { RS5 } from './stores/relateHolds.mjs'

/**
 * 關聯段之已知常態 WARN 字樣(正則片段;關聯專屬者＋批次機制＋核心件之字樣)
 *
 * @type {Array}
 */
export const RELATE_LOG_KNOWN = Object.freeze([
    // 重評逾次未評完 → 已登錄待判(設計機制;待判由巡檢之待判彙整)。重評之逐項鏈異常與守門不在此列——須被看見
    `次未評完（尚有 \\d+ 條未判），已登錄待判（${RS5.std}）`,
    // 投影之 md 讀不到(留帳、下輪補投;project 之 failed／backlog 由巡檢之專屬判準列示)
    '關聯投影：\\d+ 篇 md 讀不到',
    // 批次 AI 機制所發者(正向、反向、輪巡、重評用之:全鏈失敗——免費模型之輸出截斷是常態,失敗者記 tries 排隊尾、永不丟,真的大量發生時
    //   由待關聯積壓等判準反映;批次例外;時間預算守門)
    ...AI_BATCH_LOG_KNOWN,
    // 核心件所發者(管線秩序、AI 調度層之事件)
    ...CORE_LOG_KNOWN,
])

/**
 * 關聯段之一律須見字樣(正則片段;純文字;關聯專屬者＋批次機制＋核心件之字樣)
 *
 * @type {Array}
 */
export const RELATE_LOG_MUST_SEE = Object.freeze([
    // 逐項鏈異常(正向、反向、輪巡、重評之逐項動作鏈拋錯＝程式或寫入問題;不標終態、每次 WARN;行內含 slug)
    '逐項鏈異常',
    // 邊庫之完整性與手改:世代不符(本段與投影停寫)、懸空邊(端點不在筆記庫亦無刪除紀錄)、帳檔損壞(已隔離)、投影之手改另存、
    //   型別不在現行清單(未宣告之改名或移除)——行內含 slug 或型別名
    '關聯邊庫世代不符', '關聯懸空邊', '關聯帳檔損壞', '關聯投影手改另存', '關聯型別不在現行清單',
    // 重評守門(待重評篇數逾門檻而本輪不開工;須使用者確認後重設基準)
    '關聯重評守門',
    // 刪除、還原、撤銷停在中途(墓碑在而記錄在、封存未歸檔、記錄已刪而 md 仍在;須使用者續作——行內含 slug)
    '關聯刪除或還原未完成',
    // 批次 AI 機制所發者(批次例外之落帳失敗)
    ...AI_BATCH_LOG_MUST_SEE,
    // 核心件所發者(本機網路不通;行首為已知之「批次 AI 失敗」)
    ...CORE_LOG_MUST_SEE,
])

/**
 * 逐輪數字之正則(執行摘要缺時之退路;group 1 為數字):管線執行器之段落完成行(「步驟N 關聯 完成：」＋relateSummaryOf 之固定格式摘要
 *   「處理 N、關聯 N 條、衝突 N 組（AI N 次）」;aiCalls 取第一個「（AI N 次）」＝關聯子階段之呼叫數)
 *
 * @type {Object}
 */
export const RELATE_LOG_PARSE = Object.freeze({
    targets: /步驟\d+ 關聯 完成：處理 (\d+)/,
    edges: /步驟\d+ 關聯 完成：.*?關聯 (\d+) 條/,
    conflicts: /步驟\d+ 關聯 完成：.*?衝突 (\d+) 組/,
    aiCalls: /步驟\d+ 關聯 完成：.*?（AI (\d+) 次）/,
})

/**
 * 執行摘要(run.json)中關聯段之 report 鍵:stages[] 中 name 為 stage 之段,其 sub 為子階段名 → 子階段 report({ ok, stats, detail, summary })
 *
 * @type {Object}
 */
export const RELATE_REPORT_KEYS = Object.freeze({
    // 物件之階段名(relateObject 之預設 name)
    stage: '關聯',
    // 子階段之鍵(依執行順序;relationIndex 只在本輪邊有異動、有重標或總覽待重建時執行——未執行者不在 sub)
    subStages: Object.freeze(['relate', 'project', 'relationIndex']),
    // 各子階段與物件之統一統計
    stats: Object.freeze(['in', 'out', 'skip', 'fail', 'aiCalls']),
    detail: Object.freeze({
        relate: Object.freeze([
            // 邊庫世代不符(本段不寫;只有此二鍵與 targets／edges／conflicts／pending)
            'genMismatch', 'blocked',
            // 開工前之維護(無 AI):型別改名、清單外型別(另登錄既有邊覆核待判者)、墓碑驅動之清理、懸空、內容變更之反應
            'typeRenamed', 'typeOffList', 'typeOffListQueued', 'retired', 'dangling', 'changedSeen', 'changedTouchExtracted',
            // 正向與合計(筆記不足 2 篇時只有維護之鍵與 targets／edges／conflicts／pending;forwardDeferred＝扣保留時間後不足一次呼叫而正向段本輪延後)
            'forwardDeferred', 'targets', 'reTargets', 'edges', 'edgeStdRejected', 'edgeStdFixed', 'relateCapDropped', 'relateDupDropped', 'edgeSurfaceRejected',
            'conflicts', 'edgesChanged', 'conflictTouchExtracted',
            // 重評(relate.reeval.perRun > 0 時;reevalReproposed 另於重評停用而有再提出者出現)
            'reevalPending', 'reevalTargets', 'reevalPages', 'reevalCompleted', 'reevalZero', 'reevalChanged', 'reevalRetired', 'reevalUpgraded',
            'reevalDowngraded', 'reevalCandidates', 'reevalDisagree', 'reevalUnsure', 'reevalSameProvider', 'reevalThird', 'reevalHolds',
            'reevalHoldsResolved', 'reevalHoldsStale', 'reevalRetried', 'reevalStale', 'reevalStdRejected', 'reevalVetoed',
            'reevalInvalid', 'reevalMissing', 'reevalGaveUp', 'reevalBlocked', 'reevalMdMissing', 'reevalDeferred', 'reevalReproposed',
            // 衝突核對(relate.standards.conflictCheck.enabled 時;檢定標準 RS4;rs4Deferred 含重評與既有邊覆核之升級、rs4Waived＝豁免不重提之提案、
            //   rs4SourceResolved＝存量排入之來源違反已不在而入項前結案者)
            'rs4Proposals', 'rs4Holds', 'rs4HoldsNoSecond', 'rs4SourceResolved', 'rs4Stock', 'rs4Checked', 'rs4Kept', 'rs4ReasonFixed', 'rs4Downgraded', 'rs4NotSplit',
            'rs4Retired', 'rs4Undetermined', 'rs4Quarantined', 'rs4Retry', 'rs4StdRejected', 'rs4StdFixed', 'rs4StdRetired', 'rs4SurfaceRejected',
            'rs4Stale', 'rs4Third', 'rs4Written', 'rs4TimeDeferred', 'rs4Aborted', 'rs4Stopped', 'rs4MdMissing', 'rs4Pending', 'rs4Done', 'rs4Total', 'rs4Deferred', 'rs4Waived',
            // 既有邊覆核(relate.standards.edgeReview.enabled 時;檢定標準 RS6;rs6Deadline 只在設了完成期限時;rs6SourceResolved＝存量排入之來源違反已不在而入項前結案者)
            'rs6Holds', 'rs6SourceResolved', 'rs6Stock', 'rs6Checked', 'rs6Kept', 'rs6ReasonFixed', 'rs6StdFixed', 'rs6Retyped', 'rs6Upgraded', 'rs6Retired', 'rs6StdRetired',
            'rs6TypeSplit', 'rs6Undetermined', 'rs6Quarantined', 'rs6Retry', 'rs6StdRejected', 'rs6Stale', 'rs6Third', 'rs6Deferred', 'rs6Aborted', 'rs6Stopped',
            'rs6MdMissing', 'rs6Pending', 'rs6Done', 'rs6Total', 'rs6Deadline',
            // 候選輪巡(relate.rotation.perRun > 0 時;檢定標準 RS10)
            'rotationTargets', 'rotationEdges', 'rotationExhausted', 'rotationDeferred', 'rotationDone', 'rotationTotal',
            // 反向段、批次之統計、待關聯與待投影之積壓
            'reverseQueued', 'reverseTargets', 'reverseEdges', 'reverseDropped', 'reverseDeferred', 'reversePending',
            'aborted', 'stopped', 'failedBatches', 'missed', 'chainFailed', 'aiAttempts', 'pending', 'changedPending', 'dirtyBacklog',
        ]),
        // 投影:blocked(邊庫世代不符而不投影;關聯段已判定者只有此鍵,投影段自判者另有 backlog);待投影帳空者 projected～manual 皆 0
        project: Object.freeze(['projected', 'changed', 'failed', 'gone', 'manual', 'backlog', 'blocked']),
        // 總覽重建:無 detail
        relationIndex: Object.freeze([]),
    }),
})

/**
 * 同一管線內交下游之 ctx 旗標:edgesChanged＝本輪邊之實際異動數(新增、可見欄位改變、撤出;每筆寫入只計一次——關聯總覽之重建據以觸發)、
 *   blocked＝邊庫世代不符而本輪不寫(投影子階段據以略過)。跨輪、跨行程之讀者改讀邊庫與關聯帳
 *
 * @type {Object}
 */
export const RELATE_CTX_FLAGS = Object.freeze({ edgesChanged: 'relateEdges', blocked: 'relateBlocked' })

export default { RELATE_LOG_KNOWN, RELATE_LOG_MUST_SEE, RELATE_LOG_PARSE, RELATE_REPORT_KEYS, RELATE_CTX_FLAGS }
