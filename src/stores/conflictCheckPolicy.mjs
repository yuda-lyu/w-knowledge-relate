// conflictCheckPolicy.mjs — 檢定標準 RS4(衝突型之邊須為真衝突且理由陳述雙方)之純函數:單票驗證、存量佇列、處置分類
//   (共用之核對件——一席回覆 → 票、票之相同、檢核雜湊、型別定義版本、兩層判定之第一層、存量掃描與排序——在 stores/edgeCheckKit)
//
// 【票】keep(真衝突且現行理由陳述雙方)｜change(type＝衝突型:真衝突但理由未陳述雙方 → 新理由;type＝非衝突型:非衝突但有知識關聯)｜
//   retire(無知識關聯)｜unsure(材料不足;摘要套件之判定小組之 PANEL_UNSURE)。理由規則同重評(change／retire ≥10 字)。
//   不合格之票(裁決值不明、型別無對映、理由過短)＝缺票(不是不確定):缺票者重試,不叫第三席。
// 【兩層判定(rs4DecisionOf)】①是否真衝突:票之類別(conflict＝keep、change 衝突型;not＝change 非衝突型、retire)交判定小組;
//   ②類別成立後之處置:conflict → keep(或有一票要求改寫理由 → reason);not → 兩票(供應者不同)裁決完全相同(edgeCheckKit.sameEdgeVerdict)
//   才 downgrade／retire,否則 not-split(非衝突已定、改正之型別判不了)。未成立:retry(缺票、同一供應者——不是真的判不了)、
//   undetermined(不確定、不一致——判不了是否衝突)。
// 【下游已處理者先】存量佇列先排觸及下游已處理筆記之邊(edgeCheckKit.stockOrderOf)。

import { PANEL_UNSURE, decidePanel } from '../core/summarizePackage.mjs'
import { baseVerdictOf, sameEdgeVerdict, classDecisionOf, edgeCheckScanOf, stockOrderOf } from './edgeCheckKit.mjs'

/** 標準識別:ID、版本(檢核紀錄據以判重核)、待判登錄之物件種類 */
export const RS4 = Object.freeze({ std: 'RS4', v: 1, objectEdge: 'edge', objectProposal: 'edge-proposal' })

/**
 * 單票驗證(RS4):共同前段(edgeCheckKit.baseVerdictOf;含「型別與理由皆同現行＝沒有改,視同 keep」——受檢者皆衝突型,即衝突型且理由同現行)
 *
 * @param {*} raw 輸入模型之單項 { verdict, type?, reason? }
 * @param {Object} [o={}] 輸入 { relationTypes:Array, resolveType?:(raw)=>清單內型別|'', conflictType:String, current?:{ type, reason }(現行或被提議之邊) }
 * @returns {Object|String|null} 回傳 { verdict, type?, reason }、PANEL_UNSURE、或 null(不合格＝缺票)
 * @example
 * const o = { relationTypes: ['互補搭配', '衝突或反例'], conflictType: '衝突或反例', current: { type: '衝突或反例', reason: '甲說有效；乙說無效，兩者結論相反' } }
 * console.log(checkVerdictOf({ verdict: 'keep' }, o))
 * // => { verdict: 'keep', reason: '' }
 * console.log(checkVerdictOf({ verdict: 'change', type: '互補搭配', reason: '兩者各補足對方缺少之條件' }, o))
 * // => { verdict: 'change', type: '互補搭配', reason: '兩者各補足對方缺少之條件' }
 * console.log(checkVerdictOf({ verdict: 'unsure' }, o))
 * // => unsure
 * console.log(checkVerdictOf({ verdict: 'retire', reason: '太短' }, o))
 * // => null
 */
export function checkVerdictOf(raw, o = {}) {
    return baseVerdictOf(raw, o)
}

/**
 * 存量之衝突邊逐條之檢核狀態(stockQueueOf 與 stockProgressOf 之單一掃描;edgeCheckKit.edgeCheckScanOf):兩端皆在之衝突邊
 *
 * @param {Object} o 輸入 { edges, conflictType, byId, checkOf, extracted, typesVer }
 * @returns {Array} 回傳 [{ edge, hash, due:Boolean, touch:Boolean }]
 */
function scanConflictEdges(o = {}) {
    return edgeCheckScanOf({ ...o, keep: (e) => e.type === o.conflictType, std: RS4.std, v: RS4.v })
}

/**
 * 存量佇列:衝突邊中檢核紀錄須(重)核者;觸及下游已處理筆記者先(檔頭【下游已處理者先】)、再依邊時刻舊到新;取 quota 條
 *
 * @param {Object} o 輸入 { edges:Array, conflictType, byId:Map(筆記), checkOf:(邊 id)=>檢核紀錄|null, extracted:(筆記 id)=>Boolean(下游已處理:
 *   extractedAt 非空), exclude:Set(邊 id), quota:Integer, typesVer, seenOf?:(筆記 id)=>String(判定所讀之素材,檢核雜湊成分;未給＝空) }
 * @returns {Array} 回傳 [{ edge, hash, touch }]
 * @example
 * const byId = new Map(['a', 'b', 'c'].map((id) => [id, { id, createdAt: '2026-01-01' }]))
 * const edges = [
 *     { id: 'e1', from: 'a', to: 'b', type: '衝突或反例', reason: '甲說有效；乙說無效', createdAt: '2026-02-01' },
 *     { id: 'e2', from: 'b', to: 'c', type: '衝突或反例', reason: '甲說有效；乙說無效', createdAt: '2026-01-01' },
 *     { id: 'e3', from: 'a', to: 'c', type: '互補搭配', reason: '互相補足', createdAt: '2026-01-01' },
 * ]
 * const o = { edges, conflictType: '衝突或反例', byId, checkOf: () => null, extracted: (id) => id === 'a', quota: 5, typesVer: 'v1' }
 * const q = stockQueueOf(o)
 * console.log(q.map((x) => x.edge.id), q.map((x) => x.touch))
 * // => [ 'e1', 'e2' ] [ true, false ]
 *
 * console.log(stockQueueOf({ ...o, exclude: new Set(['e1']) }).map((x) => x.edge.id), stockQueueOf({ ...o, quota: 0 }))
 * // => [ 'e2' ] []
 */
export function stockQueueOf(o = {}) {
    const quota = Number.isInteger(o.quota) && o.quota > 0 ? o.quota : 0
    if (!quota) return []
    const exclude = o.exclude instanceof Set ? o.exclude : new Set()
    return scanConflictEdges(o)
        .filter((x) => x.due && !exclude.has(x.edge.id))
        .map(({ edge, hash, touch }) => ({ edge, hash, touch }))
        .sort(stockOrderOf)
        .slice(0, quota)
}

/**
 * 存量進度(檢定標準 RS4;與既有邊覆核 RS6 之 rs6Done／rs6Total 同口徑,外部巡檢據以列示):受檢總數＝兩端皆在之衝突邊,
 *   已核＝檢核紀錄有效(雜湊與版本相符)者
 *
 * @param {Object} o 輸入 { edges, conflictType, byId, checkOf, typesVer, seenOf?:(筆記 id)=>String(判定所讀之素材,檢核雜湊成分;未給＝空) }
 * @returns {Object} 回傳 { total:Integer, done:Integer }
 * @example
 * const byId = new Map(['a', 'b', 'c'].map((id) => [id, { id, createdAt: '2026-01-01' }]))
 * const edges = [
 *     { id: 'e1', from: 'a', to: 'b', type: '衝突或反例', reason: '甲說有效；乙說無效', createdAt: '2026-02-01' },
 *     { id: 'e2', from: 'b', to: 'c', type: '衝突或反例', reason: '甲說有效；乙說無效', createdAt: '2026-01-01' },
 *     { id: 'e3', from: 'a', to: 'c', type: '互補搭配', reason: '互相補足', createdAt: '2026-01-01' },
 * ]
 * const o = { edges, conflictType: '衝突或反例', byId, checkOf: () => null, typesVer: 'v1' }
 * console.log(stockProgressOf(o))
 * // => { total: 2, done: 0 }
 *
 * const hash = edgeCheckHashOf(edges[0], byId.get('a'), byId.get('b'), 'v1')
 * const rec = { id: 'edge:e1', hash, results: { RS4: { v: 1, status: 'pass' } } }
 * console.log(stockProgressOf({ ...o, checkOf: (id) => (id === 'e1' ? rec : null) }))
 * // => { total: 2, done: 1 }
 */
export function stockProgressOf(o = {}) {
    const all = scanConflictEdges(o)
    return { total: all.length, done: all.filter((x) => !x.due).length }
}

/**
 * 票之類別:conflict(keep、change 衝突型)｜not(change 非衝突型、retire)｜unsure｜null(缺票)
 *
 * @param {*} v 輸入票
 * @param {String} conflictType 輸入衝突型之名
 * @returns {String|null} 回傳類別
 * @example
 * console.log(rs4ClassOf({ verdict: 'keep' }, '衝突或反例'), rs4ClassOf({ verdict: 'change', type: '衝突或反例' }, '衝突或反例'))
 * // => conflict conflict
 * console.log(rs4ClassOf({ verdict: 'change', type: '互補搭配' }, '衝突或反例'), rs4ClassOf({ verdict: 'retire' }, '衝突或反例'))
 * // => not not
 * console.log(rs4ClassOf('unsure', '衝突或反例'), rs4ClassOf(null, '衝突或反例'))
 * // => unsure null
 */
export function rs4ClassOf(v, conflictType) {
    if (v === null || v === undefined) return null
    if (v === PANEL_UNSURE) return PANEL_UNSURE
    return v.verdict === 'keep' || (v.verdict === 'change' && v.type === conflictType) ? 'conflict' : 'not'
}

/**
 * 兩層判定(兩家皆判非衝突而建議之型別不同,是「改正之型別判不了」,不是「判不了是否衝突」):
 *   ①是否真衝突——以類別(conflict／not)交判定小組(edgeCheckKit.classDecisionOf);未成立 → retry(缺票、同一供應者)／undetermined(不確定、不一致)。
 *   ②類別成立後之處置——conflict:成立之票中有 change 衝突型者 → reason(採其新理由;過不了納入閘由呼叫端維持原理由),否則 keep;
 *     not:須有兩票(供應者不同)裁決完全相同(同一非衝突型或同為 retire)→ downgrade／retire;否則 not-split(非衝突已定、改正之型別判不了)。
 *
 * @param {Array} votes 輸入票 [{ seat, provider, verdict }]
 * @param {String} conflictType 輸入衝突型之名
 * @returns {Object} 回傳 { action:'keep'|'reason'|'downgrade'|'retire'|'not-split'|'retry'|'undetermined', why, cls, verdicts:Array(依據之票), needThird:Boolean(第三席可能改變結果) }
 * @example
 * const keep = { verdict: 'keep', reason: '' }
 * const down = { verdict: 'change', type: '互補搭配', reason: '兩者各補足對方缺少之條件' }
 * const other = { verdict: 'change', type: '前置概念', reason: '兩者各補足對方缺少之條件' }
 * const vote = (seat, provider, verdict) => ({ seat, provider, verdict })
 *
 * const d1 = rs4DecisionOf([vote('first', 'a', keep), vote('second', 'b', keep)], '衝突或反例')
 * console.log(d1.action, d1.cls, d1.needThird)
 * // => keep conflict false
 *
 * const d2 = rs4DecisionOf([vote('first', 'a', down), vote('second', 'b', down)], '衝突或反例')
 * console.log(d2.action, d2.cls, d2.verdicts.length)
 * // => downgrade not 2
 *
 * const d3 = rs4DecisionOf([vote('first', 'a', down), vote('second', 'b', other)], '衝突或反例')
 * console.log(d3.action, d3.why, d3.needThird)
 * // => not-split 改正之型別各席不一致 true
 *
 * const d4 = rs4DecisionOf([vote('first', 'a', keep), vote('second', 'b', { verdict: 'retire', reason: '兩者並無知識上之關聯' })], '衝突或反例')
 * console.log(d4.action, d4.why, d4.needThird)
 * // => undetermined disagree true
 *
 * const d5 = rs4DecisionOf([vote('first', 'a', keep), vote('second', 'b', null)], '衝突或反例')
 * console.log(d5.action, d5.why)
 * // => retry missing
 */
export function rs4DecisionOf(votes, conflictType) {
    const d = classDecisionOf(votes, (v) => rs4ClassOf(v, conflictType))
    if (!d.decided) return { action: d.action, why: d.why, cls: '', verdicts: [], needThird: d.needThird }
    const { cls, votes: inCls } = d
    if (cls === 'conflict') {
        const fix = inCls.filter((x) => x.verdict.verdict === 'change')
        return fix.length ? { action: 'reason', why: '', cls, verdicts: fix.map((x) => x.verdict), needThird: false } : { action: 'keep', why: '', cls, verdicts: inCls.map((x) => x.verdict), needThird: false }
    }
    const exact = decidePanel(inCls, { same: sameEdgeVerdict })
    if (exact.status === 'decided') {
        const same = inCls.filter((x) => sameEdgeVerdict(x.verdict, exact.verdict)).map((x) => x.verdict)
        return { action: exact.verdict.verdict === 'retire' ? 'retire' : 'downgrade', why: '', cls, verdicts: same, needThird: false }
    }
    return { action: 'not-split', why: '改正之型別各席不一致', cls, verdicts: inCls.map((x) => x.verdict), needThird: true }
}

export default { RS4, checkVerdictOf, stockQueueOf, stockProgressOf, rs4ClassOf, rs4DecisionOf }
