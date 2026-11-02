// promptFixtures.mjs — 關聯四支提示詞之固定輸入與一次產出(預設提示詞標準檔之產製、測試比對與他版實作之逐字差分共用)
// 不帶 .test. 中綴:共用層,避免被 runner 當測試檔抓取。
//
// 只經公開工廠(createRelateDomain)產出,工廠可換成他版實作(renderRelatePromptsWith),故同一份輸入可用於「凍結標準檔」與「逐字比對」。
// 輸入皆為中立假資料(型別取詞彙表之現行清單——換詞彙之案不因型別名而失效);slug 帶 8 碼雜湊尾碼(同正式之 slug 形式)。

import { createRelateDomain } from '../../src/domain/relateDomain.mjs'

/** 標準檔之兩組詞彙(無詞彙＝全用內建;domain＝只給主題範圍) */
export const PROMPT_VARIANTS = Object.freeze({ noDomain: null, domain: Object.freeze({ domain: '天文學' }) })

const note = (id, title, o = {}) => ({ id, title, category: '方法與技術', concepts: ['觀測方法', '誤差修正'], summary: `${title}之一句話重點`, evidenceLevel: '中', caveats: ['樣本小'], ...o })
const T1 = note('目標甲-1a2b3c4d', '目標甲')
const T2 = note('目標乙-2b3c4d5e', '目標乙', { evidenceLevel: '', caveats: [] })
const C1 = note('候選丙-3c4d5e6f', '候選丙')
const C2 = note('候選丁-4d5e6f70', '候選丁', { category: '原理與概念', concepts: ['觀測方法'] })

/**
 * 以指定之工廠與詞彙表產出四支提示詞(含各自之變體)
 *
 * @param {Object} f 輸入工廠物件 { createRelateDomain }
 * @param {Object} [vocab=null] 輸入詞彙表覆寫物件(交給 domain 工廠之 opt.vocab)
 * @returns {Object} 回傳 { relate, reeval, conflictCheck, conflictCheckReasonProblem, edgeReview, edgeReviewOffList }
 */
export function renderRelatePromptsWith(f, vocab = null) {
    const d = f.createRelateDomain({ vocab })
    const others = d.relationTypes.filter((t) => t !== d.conflictType)
    const [t0, t1] = [others[0], others[1] || others[0]]
    const ct = d.conflictType
    const side = (n, o = {}) => ({ note: n, extra: { summary: `${n.title}之一句話重點全文`, keyPoints: [`${n.title}之要點一`, `${n.title}之要點二`], conditions: [`${n.title}之適用條件`], ...o } })
    return {
        relate: d.buildPrompt([T1, T2], new Map([[T1.id, [C1, C2]], [T2.id, []]])),
        reeval: d.buildReevalPrompt([{ target: T1, summary: '目標甲之一句話重點全文(內容已更新)', neighbors: [{ note: C1, edge: { type: t0, reason: '目標甲延伸候選丙之觀測方法與誤差修正' } }, { note: C2, edge: { type: ct, reason: '甲說誤差可忽略；丁說誤差主導結果' } }] }]),
        conflictCheck: d.buildConflictCheckPrompt([{ index: 1, a: side(T1), b: side(C1), edge: { type: ct, reason: '甲說誤差可忽略；丙說誤差主導結果' } }]),
        conflictCheckReasonProblem: d.buildConflictCheckPrompt([{ index: 1, a: side(T1), b: side(C1), edge: { type: ct, reason: '看法不同', reasonProblem: 'RS2 去空泛片語與標點後只剩 4 字（須 ≥10）' } }, { index: 2, a: side(T2), b: side(C2), edge: { type: ct, reason: '乙說觀測需校正；丁說校正無益' } }]),
        edgeReview: d.buildEdgeReviewPrompt([{ index: 1, a: side(T1), b: side(C1), edge: { type: t0, reason: '目標甲延伸候選丙之觀測方法與誤差修正' } }, { index: 2, a: side(T2), b: side(C2), edge: { type: t1, reason: '目標乙與候選丁共用同一組觀測方法' } }]),
        edgeReviewOffList: d.buildEdgeReviewPrompt([{ index: 1, a: side(T1), b: side(C1), edge: { type: '已退役之型別', reason: '目標甲與候選丙共用同一組觀測方法' } }, { index: 2, a: side(T2), b: side(C2), edge: { type: t0, reason: '兩者相關', reasonProblem: 'RS2 去空泛片語與標點後只剩 4 字（須 ≥10）' } }]),
    }
}

/**
 * 以本套件之工廠產出四支提示詞
 *
 * @param {Object} [vocab=null] 輸入詞彙表覆寫物件
 * @returns {Object} 回傳同 renderRelatePromptsWith
 */
export function renderRelatePrompts(vocab = null) {
    return renderRelatePromptsWith({ createRelateDomain }, vocab)
}

/**
 * 兩組詞彙(PROMPT_VARIANTS)之全部提示詞(標準檔之內容形狀)
 *
 * @returns {Object} 回傳 { noDomain:{...}, domain:{...} }
 */
export function renderPromptGolden() {
    return Object.fromEntries(Object.entries(PROMPT_VARIANTS).map(([k, v]) => [k, renderRelatePrompts(v)]))
}

/**
 * 提示詞之固定輸入(他測試以之驗 AI 所見之區塊等)
 *
 * @type {Object}
 */
export const PROMPT_NOTES = Object.freeze({ T1, T2, C1, C2 })

export default renderRelatePrompts
