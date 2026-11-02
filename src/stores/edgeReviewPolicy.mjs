// edgeReviewPolicy.mjs — 檢定標準 RS6(內容未變之既有邊:仍成立、型別正確——含漏標之衝突——、理由具體)之純函數:單票驗證、票之類別、
//   兩層判定、存量佇列——內容未變之邊不經重評(RS5 只管內容變更),須另行覆核:另有覆核提示詞、逐邊檢核紀錄、配額與完成期限;
//   漏標(真衝突標成非衝突)與理由具體與否併入裁決選項;判不了之邊以隔離理由撤出、可還原
//   (共用之核對件——一席回覆 → 票、票之相同、檢核雜湊、型別定義版本、兩層判定之第一層、存量掃描與排序——在 stores/edgeCheckKit)
//
// 【對象】非衝突型之既有邊(衝突型之核對屬 RS4 之存量佇列;內容變更後之邊另有 RS5 重評——兩者皆以同一檢核雜湊判重核,不互相取代)。
// 【票】keep(成立、型別正確、理由具體)｜change(type:改正之型別,與現行同型＝只改理由;衝突型＝漏標之衝突;reason 具體)｜retire(無知識關聯)｜
//   unsure(材料不足)。理由規則同 RS4(change／retire ≥10 字);不合格之票＝缺票(重試,不叫第三席)。與現行同型同理由之 change 視同 keep;
//   不屬型別改正封閉清單(retypeAllowed:同類／互補 → 實作／延伸)之非衝突改型視為同型改理由(型別由標準決定,不由模型自由選)。
// 【兩層判定(rs6DecisionOf)】①類別:related(keep、change 非衝突型)｜conflict(change 衝突型)｜none(retire)交判定小組;未成立 → retry(缺票、
//   同一供應者)／undetermined(不確定、不一致)。②類別成立後:none → retire;conflict → upgrade;related → 以型別再交判定小組(keep 之型別＝現行):
//   成立且同現行 → 有一票改理由即 reason、否則 keep;成立而異於現行 → retype;未成立 → type-split(關聯成立、型別判不了;叫第三席)。
// 【檢核雜湊】與 RS4 同一函數(edgeCheckKit.edgeCheckHashOf:型別＋理由＋兩端內容版本＋關聯型別定義之版本)——同一邊之檢核紀錄跨標準共用,
//   雜湊不同即整筆重建(core/stores/checks);型別清單或定義變更 → 全部作廢、存量重排。
// 【清單外之現行型別(型別退役而未宣告改名)】由關聯段維護登錄 RS6 待判交本標準重判型別:型別改正之封閉清單只約束
//   「清單內型別之間」之改正——現行型別已不在清單者,任一清單內型別之 change 皆屬改正;keep(未給清單內型別)於型別層視同不確定
//   (不可把清單外型別判為合格),兩席皆如此 → type-split(關聯成立、型別判不了 → 使用者)。

import isarr from 'wsemi/src/isarr.mjs'
import { strictTextOf as str } from '../core/capturePackage.mjs'
import { PANEL_UNSURE, decidePanel, needThird } from '../core/summarizePackage.mjs'
import { baseVerdictOf, classDecisionOf, edgeCheckScanOf, stockOrderOf } from './edgeCheckKit.mjs'

/** 標準識別:ID、版本(檢核紀錄據以判重核)、待判登錄之物件種類 */
export const RS6 = Object.freeze({ std: 'RS6', v: 1, objectEdge: 'edge' })

/**
 * 型別改正是否在封閉清單內(檢定標準 RS6;型別無定義、多型別常可並存——模型改寫籠統理由時常順手換成另一個也說得通之型別):
 *   現行為同類或互補、改為實作或延伸者才算型別改正;角色不全(詞彙表無對應)時不設限(由提示詞之「明顯不符」判)
 *
 * @param {String} from 輸入現行型別
 * @param {String} to 輸入改正之型別(非衝突型)
 * @param {Object} [roles={}] 輸入 vocab.relationTypeRoles { implementation, extension, sibling, complement }
 * @returns {Boolean} 回傳是否允許
 * @example
 * const roles = { implementation: '實作範例', extension: '延伸應用', sibling: '同類方法', complement: '互補搭配' }
 * console.log(retypeAllowed('同類方法', '實作範例', roles), retypeAllowed('實作範例', '同類方法', roles))
 * // => true false
 * console.log(retypeAllowed('甲', '乙', {}))
 * // => true
 */
export function retypeAllowed(from, to, roles = {}) {
    const r = roles || {}
    if (!r.implementation || !r.extension || !(r.sibling || r.complement)) return true
    return [r.sibling, r.complement].filter(Boolean).includes(from) && [r.implementation, r.extension].includes(to)
}

/**
 * 單票驗證(RS6):共同前段(edgeCheckKit.baseVerdictOf;含「與現行同型同理由＝沒有改,視同 keep」)後——不屬封閉清單之非衝突改型 → 視為同型改理由
 *   (型別依標準維持現行,保留該席改寫之理由;標記 normalized)
 *
 * @param {*} raw 輸入模型之單項 { verdict, type?, reason? }
 * @param {Object} [o={}] 輸入 { relationTypes:Array, resolveType?:(raw)=>清單內型別|'', current?:{ type, reason }(現行之邊), conflictType?, roles?(vocab.relationTypeRoles) }
 * @returns {Object|String|null} 回傳 { verdict, type?, reason, normalized? }、PANEL_UNSURE、或 null(不合格＝缺票)
 * @example
 * const roles = { implementation: '實作範例', extension: '延伸應用', sibling: '同類方法', complement: '互補搭配' }
 * const o = { relationTypes: ['同類方法', '互補搭配', '實作範例', '延伸應用', '衝突或反例'], conflictType: '衝突或反例', current: { type: '同類方法', reason: '兩者皆以優先佇列取出最近之節點' }, roles }
 * console.log(reviewVerdictOf({ verdict: 'change', type: '實作範例', reason: '乙為甲之演算法之程式實作與應用實例' }, o))
 * // => { verdict: 'change', type: '實作範例', reason: '乙為甲之演算法之程式實作與應用實例' }
 * console.log(reviewVerdictOf({ verdict: 'change', type: '互補搭配', reason: '乙為甲之演算法之程式實作與應用實例' }, o).normalized)
 * // => true
 * console.log(reviewVerdictOf({ verdict: 'keep' }, o), reviewVerdictOf({ verdict: 'retire', reason: '太短' }, o))
 * // => { verdict: 'keep', reason: '' } null
 */
export function reviewVerdictOf(raw, o = {}) {
    const v = baseVerdictOf(raw, o)
    if (!v || typeof v !== 'object' || v.verdict !== 'change') return v
    const types = isarr(o.relationTypes) ? o.relationTypes : []
    const cur = str(o.current?.type)
    // 封閉清單只約束清單內型別之間之改正;現行型別已不在清單者(檔頭【清單外之現行型別】)任一清單內型別皆屬改正
    if (cur && types.includes(cur) && v.type !== cur && v.type !== str(o.conflictType) && !retypeAllowed(cur, v.type, o.roles)) return { verdict: 'change', type: cur, reason: v.reason, normalized: true }
    return v
}

/**
 * 票之類別:related(keep、change 非衝突型)｜conflict(change 衝突型)｜none(retire)｜unsure｜null(缺票)
 *
 * @param {*} v 輸入票
 * @param {String} conflictType 輸入衝突型之名
 * @returns {String|null} 回傳類別
 * @example
 * console.log(rs6ClassOf({ verdict: 'keep' }, '衝突或反例'), rs6ClassOf({ verdict: 'change', type: '實作範例' }, '衝突或反例'))
 * // => related related
 * console.log(rs6ClassOf({ verdict: 'change', type: '衝突或反例' }, '衝突或反例'), rs6ClassOf({ verdict: 'retire' }, '衝突或反例'))
 * // => conflict none
 * console.log(rs6ClassOf('unsure', '衝突或反例'), rs6ClassOf(null, '衝突或反例'))
 * // => unsure null
 */
export function rs6ClassOf(v, conflictType) {
    if (v === null || v === undefined) return null
    if (v === PANEL_UNSURE) return PANEL_UNSURE
    if (v.verdict === 'retire') return 'none'
    return v.verdict === 'change' && v.type === conflictType ? 'conflict' : 'related'
}

/**
 * 兩層判定(見檔頭)
 *
 * @param {Array} votes 輸入票 [{ seat, provider, verdict }]
 * @param {Object} o 輸入 { conflictType, current:{ type, reason }(現行之邊), relationTypes?:Array(給了才判「現行型別已不在清單」;檔頭【清單外之現行型別】) }
 * @returns {Object} 回傳 { action:'keep'|'reason'|'retype'|'upgrade'|'retire'|'type-split'|'retry'|'undetermined', why, cls, type(成立之型別), verdicts:Array(依據之票), needThird:Boolean }
 * @example
 * const o = { conflictType: '衝突或反例', current: { type: '同類方法', reason: '兩者皆以優先佇列取出最近之節點' } }
 * const keep = { verdict: 'keep', reason: '' }
 * const retype = { verdict: 'change', type: '實作範例', reason: '乙為甲之演算法之程式實作與應用實例' }
 * const upgrade = { verdict: 'change', type: '衝突或反例', reason: '甲說有效；乙說無效，兩者結論相反' }
 * const retire = { verdict: 'retire', reason: '兩者並無知識上之關聯' }
 * const vote = (seat, provider, verdict) => ({ seat, provider, verdict })
 *
 * const d1 = rs6DecisionOf([vote('first', 'a', keep), vote('second', 'b', keep)], o)
 * console.log(d1.action, d1.cls, d1.type)
 * // => keep related 同類方法
 *
 * const d2 = rs6DecisionOf([vote('first', 'a', retype), vote('second', 'b', retype)], o)
 * console.log(d2.action, d2.cls, d2.type)
 * // => retype related 實作範例
 *
 * const d3 = rs6DecisionOf([vote('first', 'a', upgrade), vote('second', 'b', upgrade)], o)
 * console.log(d3.action, d3.cls, d3.type)
 * // => upgrade conflict 衝突或反例
 *
 * const d4 = rs6DecisionOf([vote('first', 'a', retire), vote('second', 'b', retire)], o)
 * console.log(d4.action, d4.cls)
 * // => retire none
 *
 * const d5 = rs6DecisionOf([vote('first', 'a', retype), vote('second', 'b', keep)], o)
 * console.log(d5.action, d5.why, d5.needThird)
 * // => type-split 關聯成立而型別各席不一致 true
 */
export function rs6DecisionOf(votes, o = {}) {
    const conflictType = str(o.conflictType)
    const curType = str(o.current?.type)
    const listed = isarr(o.relationTypes) ? (t) => o.relationTypes.includes(t) : () => true
    const d = classDecisionOf(votes, (v) => rs6ClassOf(v, conflictType))
    if (!d.decided) return { action: d.action, why: d.why, cls: '', type: '', verdicts: [], needThird: d.needThird }
    const { cls, votes: inCls } = d
    if (cls === 'none') return { action: 'retire', why: '', cls, type: '', verdicts: inCls.map((x) => x.verdict), needThird: false }
    if (cls === 'conflict') return { action: 'upgrade', why: '', cls, type: conflictType, verdicts: inCls.map((x) => x.verdict), needThird: false }
    // related:以型別再交判定小組(keep 之型別＝現行;現行已不在清單者之 keep 未給清單內型別 → 型別層視同不確定)
    const typeOf = (v) => (v.verdict === 'keep' ? curType : v.type)
    const asType = inCls.map((x) => ({ seat: x.seat, provider: x.provider, verdict: listed(typeOf(x.verdict)) ? { type: typeOf(x.verdict) } : PANEL_UNSURE }))
    const sameType = (a, b) => a.type === b.type
    const t = decidePanel(asType, { same: sameType })
    if (t.status !== 'decided') {
        const why = listed(curType) ? '關聯成立而型別各席不一致' : `關聯成立而未得清單內之型別（現行「${curType}」已不在清單）`
        return { action: 'type-split', why, cls, type: '', verdicts: inCls.map((x) => x.verdict), needThird: needThird(asType, { same: sameType }) }
    }
    const type = t.verdict.type
    const same = inCls.filter((x) => typeOf(x.verdict) === type).map((x) => x.verdict)
    if (type !== curType) return { action: 'retype', why: '', cls, type, verdicts: same.filter((v) => v.verdict === 'change'), needThird: false }
    const fix = same.filter((v) => v.verdict === 'change')
    return fix.length ? { action: 'reason', why: '', cls, type, verdicts: fix, needThird: false } : { action: 'keep', why: '', cls, type, verdicts: same, needThird: false }
}

/**
 * 單票之處置:兩席(不同供應者)投同一票時兩層判定之處置——評分與檢定標準題組之執行器以單票研判應然時用之,
 *   由 rs6DecisionOf 推導(與正式判定同一規則,不另寫一份「票 → 處置」之對照)
 *
 * @param {Object|String|null} v 輸入票(reviewVerdictOf 之產物:{ verdict, type?, reason, normalized? }、PANEL_UNSURE 或 null)
 * @param {Object} [o={}] 輸入同 rs6DecisionOf 之 o { conflictType, current:{ type, reason }, relationTypes? }
 * @returns {Object} 回傳 { action:'keep'|'reason'|'retype'|'upgrade'|'retire'|'type-split'|'retry'|'undetermined', type:String(成立之型別;無則 '') }
 * @example
 * const o = { conflictType: '衝突或反例', current: { type: '同類方法', reason: '兩者皆以優先佇列取出最近之節點' } }
 * console.log(rs6VoteActionOf({ verdict: 'change', type: '實作範例', reason: '乙為甲之演算法之程式實作與應用實例' }, o))
 * // => { action: 'retype', type: '實作範例' }
 * console.log(rs6VoteActionOf({ verdict: 'change', type: '衝突或反例', reason: '甲說此條件下成立；乙說同一條件下結論相反' }, o).action)
 * // => upgrade
 */
export function rs6VoteActionOf(v, o = {}) {
    const d = rs6DecisionOf([{ seat: 'first', provider: 'a', verdict: v }, { seat: 'second', provider: 'b', verdict: v }], o)
    return { action: d.action, type: d.type }
}

/**
 * 存量佇列:非衝突型之既有邊中檢核紀錄須(重)核者(RS6);觸及下游已處理筆記者先(與 RS4 之存量佇列同一規則;edgeCheckKit.stockOrderOf)、
 *   再依邊時刻舊到新;取 quota 條
 *
 * @param {Object} o 輸入 { edges:Array, conflictType, byId:Map(筆記), checkOf:(邊 id)=>檢核紀錄|null, extracted:(筆記 id)=>Boolean(下游已處理), exclude:Set(邊 id), quota:Integer,
 *   typesVer:String(關聯型別定義之版本;edgeCheckKit.relationTypesVersionOf), seenOf?:(筆記 id)=>String(判定所讀之素材,檢核雜湊成分;未給＝空) }
 * @returns {Object} 回傳 { queue:[{ edge, hash, touch }], total:Integer(受檢對象數), done:Integer(檢核紀錄有效者) }
 * @example
 * const byId = new Map(['a', 'b', 'c'].map((id) => [id, { id, createdAt: '2026-01-01' }]))
 * const edges = [
 *     { id: 'e1', from: 'a', to: 'b', type: '互補搭配', reason: '互相補足', createdAt: '2026-02-01' },
 *     { id: 'e2', from: 'b', to: 'c', type: '同類方法', reason: '同為排序法', createdAt: '2026-01-01' },
 *     { id: 'e3', from: 'a', to: 'c', type: '衝突或反例', reason: '結論相反', createdAt: '2026-01-01' },
 * ]
 * const o = { edges, conflictType: '衝突或反例', byId, checkOf: () => null, extracted: (id) => id === 'a', exclude: new Set(), quota: 1, typesVer: 'v1' }
 * const r = reviewQueueOf(o)
 * console.log(r.queue.map((x) => x.edge.id), r.total, r.done)
 * // => [ 'e1' ] 2 0
 *
 * console.log(reviewQueueOf({ ...o, quota: 5, exclude: new Set(['e1']) }).queue.map((x) => x.edge.id), reviewQueueOf({ ...o, quota: 0 }).queue)
 * // => [ 'e2' ] []
 */
export function reviewQueueOf(o = {}) {
    const quota = Number.isInteger(o.quota) && o.quota > 0 ? o.quota : 0
    const exclude = o.exclude instanceof Set ? o.exclude : new Set()
    const all = edgeCheckScanOf({ ...o, keep: (e) => e.type !== o.conflictType, std: RS6.std, v: RS6.v })
    const due = all.filter((x) => x.due)
    const queue = quota ? due.filter((x) => !exclude.has(x.edge.id)).map(({ edge, hash, touch }) => ({ edge, hash, touch })).sort(stockOrderOf).slice(0, quota) : []
    return { queue, total: all.length, done: all.length - due.length }
}

export default { RS6, retypeAllowed, reviewVerdictOf, rs6ClassOf, rs6DecisionOf, rs6VoteActionOf, reviewQueueOf }
