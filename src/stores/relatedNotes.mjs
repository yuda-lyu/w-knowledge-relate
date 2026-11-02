// relatedNotes.mjs — 筆記之關聯狀態機:「已關聯」「待重判」「待重評既有邊」之判定之單一來源
//
// 【已關聯＝完成正向評估】筆記記錄之 relatedAt 非空(完成正向評估之時刻;零條關聯之評估亦寫)。新筆記之 relatedAt 為空字串(摘要套件之
//   資料契約),待正向評估;內容變更之重判不清 relatedAt(另以評估版本判,見下)。候選池、反向段之資格、輪巡之佇列與進度、報告之
//   待關聯篇數與外部巡檢同讀此處,不各自手寫欄位判斷。
// 【評估版本】正向評估完一篇即記 relatedChangeAt＝當時之 knowledgeChangedAt(摘要套件之內容同步偵測內容變更之時刻);兩者不同＝內容在上次
//   評估後又變過＝待重判(needsReeval)。以版本相等判斷,不以時間先後(同一秒內之偵測與評估、時鐘回撥皆不影響)。
// 【待重評既有邊】正向已評完此版本(relatedChangeAt＝版本)而既有邊尚未評完此版本(edgesReviewedChangeAt≠版本)——先正向、再重評(needsEdgeReview)。
// 【三態之序】未關聯 → 已關聯;內容變更 → 待重判(正向池:inRelatePool)→ 評完正向 → 待重評既有邊(重評段:needsEdgeReview)→ 評完(edgesReviewedOf)。
//   各段與維運(狀態、重評之基準與候選重排)同讀,不各自手寫欄位比對。

import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'

/**
 * 筆記是否已關聯(完成正向評估)
 *
 * @param {Object} note 輸入筆記記錄
 * @returns {Boolean} 回傳是否已關聯
 * @example
 * console.log(isRelated({ relatedAt: '2026-10-01T10:00:00+08:00' }), isRelated({ relatedAt: '' }), isRelated(null))
 * // => true false false
 */
export function isRelated(note) {
    return !!note?.relatedAt
}

/**
 * 待關聯(未完成正向評估)之篇數——關聯段報告之 pending 與外部巡檢同一口徑
 *
 * @param {Array} notes 輸入筆記記錄陣列，非陣列視為 []
 * @returns {Integer} 回傳篇數
 * @example
 * console.log(relatePendingOf([{ relatedAt: '' }, { relatedAt: 'x' }, {}]))
 * // => 2
 */
export function relatePendingOf(notes) {
    return (isarr(notes) ? notes : []).filter((n) => !isRelated(n)).length
}

/**
 * 筆記是否待重判:內容變更之時刻(knowledgeChangedAt)與上次評估時記下者(relatedChangeAt)不同(檔頭【評估版本】)
 *
 * @param {Object} n 輸入筆記記錄
 * @returns {Boolean} 回傳是否待重判
 * @example
 * console.log(needsReeval({ knowledgeChangedAt: 'v2', relatedChangeAt: 'v1' }), needsReeval({ knowledgeChangedAt: 'v1', relatedChangeAt: 'v1' }), needsReeval({}))
 * // => true false false
 */
export function needsReeval(n) {
    return isestr(n?.knowledgeChangedAt) && n.knowledgeChangedAt !== n.relatedChangeAt
}

/**
 * 筆記是否待重評既有邊(檔頭【待重評既有邊】):版本為字串、既有邊未評完此版本、且正向已評完此版本
 *
 * @param {Object} n 輸入筆記記錄
 * @returns {Boolean} 回傳是否待重評
 * @example
 * console.log(needsEdgeReview({ knowledgeChangedAt: 'v', relatedChangeAt: 'v' }), needsEdgeReview({ knowledgeChangedAt: 'v', relatedChangeAt: '' }), needsEdgeReview({ knowledgeChangedAt: 'v', relatedChangeAt: 'v', edgesReviewedChangeAt: 'v' }))
 * // => true false false
 */
export function needsEdgeReview(n) {
    const v = n?.knowledgeChangedAt
    return isestr(v) && v !== n.edgesReviewedChangeAt && n.relatedChangeAt === v
}

/**
 * 既有邊已評完此版本(重評段之收尾所記;要求重試、重評基準之重設與候選重排以之判「已評完者才清」)
 *
 * @param {Object} n 輸入筆記記錄
 * @returns {Boolean} 回傳是否已評完此版本
 * @example
 * console.log(edgesReviewedOf({ knowledgeChangedAt: 'v', edgesReviewedChangeAt: 'v' }), edgesReviewedOf({ knowledgeChangedAt: 'v' }), edgesReviewedOf({}))
 * // => true false false
 */
export function edgesReviewedOf(n) {
    const v = n?.knowledgeChangedAt
    return isestr(v) && n.edgesReviewedChangeAt === v
}

/**
 * 是否在正向池(未關聯 ∪ 待重判;關聯段之正向池、反向段之「等它評估完」、輪巡之排除同讀)
 *
 * @param {Object} n 輸入筆記記錄
 * @returns {Boolean} 回傳是否在正向池
 * @example
 * console.log(inRelatePool({ relatedAt: '' }), inRelatePool({ relatedAt: 'x', knowledgeChangedAt: 'v2', relatedChangeAt: 'v1' }), inRelatePool({ relatedAt: 'x' }))
 * // => true true false
 */
export function inRelatePool(n) {
    return !isRelated(n) || needsReeval(n)
}

export default { isRelated, relatePendingOf, needsReeval, needsEdgeReview, edgesReviewedOf, inRelatePool }
