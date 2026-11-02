// edgeQueue.mjs — 邊交判定小組之排入(待判之登錄件):RS2／RS3／RS8 等須重寫理由者與清單外型別排入既有邊覆核(RS6)之待判;既有衝突邊須經
//   衝突核對者排入 RS4 之待判;新衝突之提案於暫緩當下持久為 RS4 提案待判;存量之豁免之判定
//
// 【為何在 standards 層】排入是「標準判不合格 → 交兩席」之登錄,stages(各段、維護)、standards(存量處置、符合度掃描)、ops(還原)皆取用——
//   層序 stores ← standards ← { stages, ops },故落在 standards(不在 ops,否則 stages 與 standards 得反向依賴維運層)。
// 【RS2／RS3／RS8】理由佔位／過短、含兩端皆無之數字、或正體之確定性修正做不到:修正須重寫理由(AI),不在此猜——登錄 RS6 待判(owner pipeline,
//   ctx.stockStd 標來源),既有邊覆核開啟時待判優先(兩席判成立／改理由／改型／撤出)。兩席判「成立」而現行理由仍確定不合格者,RS6 段
//   無可用之改寫理由即撤出(std-retire,可以 restoreEdge 之 opt.reason 給新理由還原)——修不了即移除,不以「未能判定」讓違反之邊留在庫內。
// 【RS4 之排入(queueConflictCheck)】既有衝突邊須經兩席核對者(還原帶回、他段轉交、讀關聯之下游判其非對立而交回)一律經此登錄:
//   物件與標準取 RS4 常數、期限依 relateHoldDeadlineOf、下一步依 RELATE_HOLD_NEXT;已有未結者不重登(否則每次重登累加 tries)。
// 【提案之持久(queueConflictProposal)】衝突核對開啟時,正向／反向／輪巡、重評升級、既有邊覆核升級之新衝突不直接落地而交核對——提案於暫緩當下即登錄
//   RS4 提案待判(物件 edge-proposal;ctx 存提案之理由、截短原字數、提案席、來源段),來源記完成前已持久(中途被砍不遺失);已有未結者不重登
//   (同邊多提案由衝突核對之入口依提案全序取最優);使用者已豁免(提案不落地)而理由未變者不重提(值變了才重提)。
// 【豁免之守門(登錄件同一規則)】queueEdgeReview、queueConflictCheck 遇已豁免之同一登錄,其豁免之來源(stockWaiverKeyOf)即本次之問題
//   (`edge:<邊 id>:<來源標準>`)者不重開——使用者之裁示不被自動流程推翻;不同問題(或無來源)照登錄,前段之裁示留於待判之 history。
// 【存量之豁免(stockWaiverKeyOf)】既有違反經覆核待判(RS6;衝突型為 RS4,ctx.stockStd 標來源)處理者——存量處置之 RS2／RS3／RS8、
//   關聯段維護之清單外型別 RS1——使用者豁免該待判,即是對「該邊之該標準問題」之裁示:存量處置之登錄不重開同一問題之豁免(不同問題
//   ——如型別判不了之豁免——照登錄,前段之裁示由待判之 history 留存),符合度掃描把它記為該標準之已豁免。單一判定,存量處置、
//   既有邊覆核之轉交與掃描同讀此處。
// 【已不再違反之預檢(stockSourceResolvedOf)】經覆核待判處理之既有違反,其來源標準之違反已不在者(現值以 checkEdge 判合格——他途改寫了理由、
//   型別回到清單等)不送兩席:兩席段(RS4／RS6)於入項前對本輪會送兩席之待判(負責者 pipeline)判之,合格即結案(how 一處)、不呼叫 AI、不記檢核
//   (未經判定不記合格;存量佇列日後照核)。未能判定(RS8 材料不可得)、不適用、仍違反 → 照送;負責者 user(型別判不了、隔離、逾次改使用者——
//   其 ctx 仍帶 stockStd 而現行問題已非存量之來源)不預檢,使用者之要求重試照送兩席。判定用落庫原值(不正規化):RS3 可確定性修正者不算合格,
//   照送(兩席 keep 即記合格;字形交存量處置)。

import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { strOf, STATUS } from '../core/capturePackage.mjs'
import { putHold, holdKey } from '../core/capturePackage.mjs'
import { RS4 } from '../stores/conflictCheckPolicy.mjs'
import { RS6 } from '../stores/edgeReviewPolicy.mjs'
import { edgeId } from '../stores/edgeStore.mjs'
import { relateHoldDeadlineOf, RELATE_HOLD_NEXT } from '../stores/relateHolds.mjs'
import { REASON_REWRITE_STDS } from './edgeGate.mjs'
import { checkEdge } from './edgeStandards.mjs'

/** 排入 RS6 之存量標準 */
export const EDGE_REVIEW_STDS = Object.freeze(['RS2', 'RS8'])

/** 經覆核待判處理之既有違反之來源標準(ctx.stockStd 之值域):維護段之清單外型別 RS1、存量處置之須改寫理由者 */
export const REVIEW_SOURCE_STDS = Object.freeze(['RS1', ...REASON_REWRITE_STDS])

/**
 * 存量之豁免鍵(檔頭【存量之豁免】):已豁免之覆核待判(RS6;衝突型為 RS4)而其來源(ctx.stockStd)為 RS1／RS2／RS3／RS8 者,回
 *   `edge:<邊 id>:<該標準>`——即使用者對該邊之該標準問題之裁示;其餘(未豁免、他標準、無來源、提案之待判)回 null
 *
 * @param {Object|null} hold 輸入待判登錄
 * @returns {String|null} 回傳豁免鍵或 null
 * @example
 * console.log(stockWaiverKeyOf({ object: 'edge', oid: 'e1', std: 'RS6', status: 'waived', ctx: { stockStd: 'RS2' } }))
 * // => edge:e1:RS2
 *
 * console.log(stockWaiverKeyOf({ object: 'edge', oid: 'e1', std: 'RS6', status: 'waived', ctx: {} }))
 * // => null
 */
export function stockWaiverKeyOf(hold) {
    if (!isobj(hold) || hold.status !== 'waived' || hold.object !== RS6.objectEdge || ![RS4.std, RS6.std].includes(hold.std)) return null
    const s = hold.ctx?.stockStd
    return REVIEW_SOURCE_STDS.includes(s) ? holdKey(RS6.objectEdge, hold.oid, s) : null
}

/**
 * 經覆核待判處理之既有違反,其來源標準之違反是否已不在(檔頭【已不再違反之預檢】):待判為物件 edge 之 RS4／RS6 登錄、負責者 pipeline、
 *   ctx.stockStd 為 REVIEW_SOURCE_STDS 之一,且邊之現值以 checkEdge 判該標準合格(PASS;未能判定、不適用、違反皆不算)→ 回 { std, how };否則 null
 *
 * @param {Object|null} hold 輸入待判登錄
 * @param {Object|null} edge 輸入邊之現值
 * @param {Object} [ctx={}] 輸入 checkEdge 之 ctx(relationTypes、vague、hasNote、materialOf、locale;與兩席段送審之判定同一組)
 * @returns {Object|null} 回傳 { std:來源標準, how:結案方式 } 或 null
 * @example
 * console.log(stockSourceResolvedOf({ object: 'edge', std: 'RS6', owner: 'pipeline', ctx: { stockStd: 'RS2' } }, { from: 'a', to: 'b', type: '互補搭配', reason: '兩篇皆以近日點距離之量測方法比較軌道' }))
 * // => { std: 'RS2', how: '存量 RS2 之違反已不在（現值已合格），不送兩席' }
 *
 * console.log(stockSourceResolvedOf({ object: 'edge', std: 'RS6', owner: 'pipeline', ctx: { stockStd: 'RS2' } }, { from: 'a', to: 'b', type: '互補搭配', reason: 'placeholder' }))
 * // => null
 */
export function stockSourceResolvedOf(hold, edge, ctx = {}) {
    if (!isobj(hold) || !isobj(edge) || hold.object !== RS6.objectEdge || ![RS4.std, RS6.std].includes(hold.std) || hold.owner !== 'pipeline') return null
    const std = hold.ctx?.stockStd
    if (!REVIEW_SOURCE_STDS.includes(std)) return null
    const r = checkEdge(edge, isobj(ctx) ? ctx : {}).find((x) => x.std === std)
    if (r?.status !== STATUS.PASS) return null
    return { std, how: `存量 ${std} 之違反已不在（現值已合格），不送兩席` }
}

/**
 * 已豁免之登錄是否即本次問題之裁示(檔頭【豁免之守門】):豁免之來源鍵＝`edge:<邊 id>:<本次來源標準>`
 *
 * @param {Object|null} cur 輸入現有之登錄
 * @param {String} edgeIdOf 輸入邊 id
 * @param {String} std 輸入本次問題之來源標準(無則不守)
 * @returns {Boolean} 回傳是否已豁免同一問題
 */
const waivedSameProblem = (cur, edgeIdOf, std) => isestr(std) && stockWaiverKeyOf(cur) === holdKey(RS6.objectEdge, edgeIdOf, std)

/**
 * 登錄一條邊之 RS6 待判(存量 RS2／RS3／RS8 之修正入口;關聯段維護亦以之登錄清單外型別 RS1——型別退役而未宣告改名者交覆核重判;已有未結者不重登;
 *   使用者已豁免同一問題者不重開)
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {Object} edge 輸入邊
 * @param {Object} o 輸入 { std:'RS1'|'RS2'|'RS3'|'RS8', why:String, at:ISO, next?:String(下一步;未給用存量改寫理由之說明) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 'queued'｜'exists'｜'waived'(同一問題使用者已豁免)
 * @example
 * const rows = new Map()
 * const holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * const edge = { id: 'e1', from: 'a', to: 'b', type: '互補搭配' }
 * const o = { std: 'RS2', why: '理由為佔位字', at: '2026-10-05T10:00:00+08:00' }
 * console.log(await queueEdgeReview(holds, edge, o), await queueEdgeReview(holds, edge, o))
 * // => queued exists
 * const h = rows.get('edge:e1:RS6')
 * console.log(h.owner, h.status, h.reason, h.deadline)
 * // => pipeline open 存量 RS2：理由為佔位字 2026-11-04T02:00:00.000Z
 *
 * rows.set(h.id, { ...h, status: 'waived' })
 * console.log(await queueEdgeReview(holds, edge, o))
 * // => waived
 */
export async function queueEdgeReview(holds, edge, o) {
    const cur = await holds.get(holdKey(RS6.objectEdge, edge.id, RS6.std))
    if (cur?.status === 'open') return 'exists'
    if (waivedSameProblem(cur, edge.id, o.std)) return 'waived'
    await putHold(holds, {
        object: RS6.objectEdge, oid: edge.id, std: RS6.std,
        reason: `存量 ${o.std}：${String(o.why || '').slice(0, 160)}`,
        next: o.next || RELATE_HOLD_NEXT.edgeReviewStock,
        owner: 'pipeline',
        deadline: relateHoldDeadlineOf(o.at),
        ctx: { from: edge.from, to: edge.to, type: edge.type, stockStd: o.std },
    }, o.at)
    return 'queued'
}

/**
 * 登錄一條既有衝突邊之 RS4 待判(須經衝突核對兩席核對者之單一入口;已有未結者不重登;ctx.stockStd 給了而使用者已豁免同一問題者不重開)
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {Object} o 輸入 { edgeId:String, from:String, to:String, reason:String(登錄原因), next?:String(下一步;未給為 RELATE_HOLD_NEXT.conflictCheck),
 *   ctx?:Object(附帶之脈絡;值為字串;stockStd 為來源標準), owner?:'pipeline'|'user'(預設 'pipeline'), at:ISO(登錄時刻) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 'queued'｜'exists'(已有未結者)｜'waived'(同一問題使用者已豁免)
 * @throws {Error} edgeId、from、to、reason 非非空字串,或 holds 集合缺方法時拋出
 * @example
 * const rows = new Map()
 * const holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * const o = { edgeId: 'e1', from: 'a', to: 'b', reason: '既有衝突邊須兩席核對', at: '2026-10-05T10:00:00+08:00' }
 * console.log(await queueConflictCheck(holds, o), await queueConflictCheck(holds, o))
 * // => queued exists
 * console.log([...rows.keys()], rows.get('edge:e1:RS4').owner)
 * // => [ 'edge:e1:RS4' ] pipeline
 *
 * await queueConflictCheck(holds, { ...o, reason: '' }).catch((e) => console.log(e.message))
 * // => queueConflictCheck 需要 reason（非空字串）
 */
export async function queueConflictCheck(holds, o = {}) {
    for (const k of ['edgeId', 'from', 'to', 'reason']) {
        if (!isestr(o?.[k])) throw new Error(`queueConflictCheck 需要 ${k}（非空字串）`)
    }
    const cur = await holds.get(holdKey(RS4.objectEdge, o.edgeId, RS4.std))
    if (cur?.status === 'open') return 'exists'
    if (waivedSameProblem(cur, o.edgeId, o.ctx?.stockStd)) return 'waived'
    await putHold(holds, {
        object: RS4.objectEdge, oid: o.edgeId, std: RS4.std,
        reason: o.reason,
        next: isestr(o.next) ? o.next : RELATE_HOLD_NEXT.conflictCheck,
        owner: o.owner || 'pipeline',
        deadline: relateHoldDeadlineOf(o.at),
        ctx: { from: o.from, to: o.to, ...(isobj(o.ctx) ? o.ctx : {}) },
    }, o.at)
    return 'queued'
}

/**
 * 新衝突之提案於暫緩當下持久為 RS4 提案待判(檔頭【提案之持久】;物件 edge-proposal、負責者 pipeline、下一步「下輪衝突核對」)
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {Object} p 輸入 { from:String, to:String, reason:String(提案之理由), reasonCut?:Integer(納入閘截短之原字數), proposer?:String(提案之實際成交者),
 *   segment?:String(來源段:forward｜reverse｜rotation｜reeval｜edgeReview), proposedAt?:ISO(提案時刻), at:ISO(登錄時刻), holdReason?:String(登錄原因) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 'queued'｜'exists'(已有未結者)｜'waived'(使用者已豁免而提案理由未變)
 * @throws {Error} from、to、reason、at 非非空字串,或 holds 集合缺方法時拋出
 * @example
 * const rows = new Map()
 * const holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * const p = { from: 'a', to: 'b', reason: '甲說此條件下成立；乙說同一條件下結論相反', at: '2026-10-05T10:00:00+08:00' }
 * console.log(await queueConflictProposal(holds, p), await queueConflictProposal(holds, p))
 * // => queued exists
 * const [h] = rows.values()
 * console.log(h.object, h.std, h.owner, h.ctx.segment, h.ctx.proposedAt)
 * // => edge-proposal RS4 pipeline forward 2026-10-05T10:00:00+08:00
 */
export async function queueConflictProposal(holds, p = {}) {
    for (const k of ['from', 'to', 'reason', 'at']) {
        if (!isestr(p?.[k])) throw new Error(`queueConflictProposal 需要 ${k}（非空字串）`)
    }
    const id = edgeId(p.from, p.to)
    const cur = await holds.get(holdKey(RS4.objectProposal, id, RS4.std))
    if (cur?.status === 'open') return 'exists'
    if (cur?.status === 'waived' && strOf(cur.ctx?.reason) === strOf(p.reason)) return 'waived'
    await putHold(holds, {
        object: RS4.objectProposal, oid: id, std: RS4.std,
        reason: isestr(p.holdReason) ? p.holdReason : '新衝突之提案待兩席核對（衝突核對開啟）',
        next: RELATE_HOLD_NEXT.proposalPending,
        owner: 'pipeline',
        deadline: relateHoldDeadlineOf(p.at),
        ctx: {
            from: p.from, to: p.to, reason: p.reason, proposer: strOf(p.proposer), segment: strOf(p.segment) || 'forward', proposedAt: strOf(p.proposedAt) || p.at,
            ...(Number.isInteger(p.reasonCut) && p.reasonCut > 0 ? { reasonCut: p.reasonCut } : {}),
        },
    }, p.at)
    return 'queued'
}

export default { EDGE_REVIEW_STDS, REVIEW_SOURCE_STDS, stockWaiverKeyOf, stockSourceResolvedOf, queueEdgeReview, queueConflictCheck, queueConflictProposal }
