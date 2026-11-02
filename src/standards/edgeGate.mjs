// edgeGate.mjs — 關聯之納入閘:邊提案寫入前之確定性修正與檢定(所有寫入點共用)
//
// 【寫入點】正向、反向、輪巡(stages/relateChain 之 buildEdges)、重評改型(reevalSegment 之 apply)、衝突核對與既有邊覆核之改寫、
//   還原筆記之邊與 restoreEdge(ops/noteOps)——同一函數。
// 【流程】正規化 → checkEdge(與符合度掃描同一判定:RS1、RS2、RS3、RS8)→ 任一不合格或未能判定 → 不納入(呼叫端計數、記錄理由)。
//   正規化只做確定性修正:型別經 resolveType(RS9 別名、RS1′ 改名;無對映 → 不納入,不落後備型別)、理由去多餘空白、正體(只改違規處)、
//   逾 REASON_MAX_CHARS 於句界截(句界前不足 REASON_MIN_CHARS 或無句界則不截——不靜默截斷:截了即於提案記 reasonCut＝原字數,隨現值落庫
//   (stores/edgeStore 檔頭【理由截短之明示】),符合度掃描以資訊數回報;呼叫端另記修正說明);history 之型別與理由同步。
// 【材料(RS8)】新進＝AI 所見(關聯 domain 之 seenTextOf);還原＝兩端筆記之存量材料(摘要套件之 noteMaterialText);
//   materialOf 回 null(材料不可得)而理由含數字 → 未能判定 → 不納入。未給 materialOf 即不檢 RS8(只有掃描以外之呼叫端不得省略)。
// 【現行理由須改寫者(reasonRewriteProblemsOf)】既有邊之現行理由經同一正規化後仍不合格之 RS2／RS3／RS8——只有改寫理由才能合格;
//   既有邊覆核與衝突核對送審時據以要求 change、兩席 keep 不記合格,存量修不了者據以決定去處(單一實作,各段不另寫)。
// 【核對類提示詞之項(checkPromptItemOf、pairCheckItemOf)】兩段送審之項與評分／題組執行器之項同一形式:現行理由須改寫者附 reasonProblem;
//   題組由評分依同一規則計算(題組不得自給),材料以兩方於提示詞中之區塊代之。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { STATUS } from '../core/capturePackage.mjs'
import { scriptOf } from '../core/capturePackage.mjs'
import { cutAtBoundary } from '../core/capturePackage.mjs'
import { oneline } from '../core/capturePackage.mjs'
import { REASON_MIN_CHARS, checkEdge } from './edgeStandards.mjs'

/** 理由之長度上限(字;逾此者於句界截) */
export const REASON_MAX_CHARS = 200

const SENTENCE_END_RE = /[。！？；!?;]/g

/**
 * 理由之長度處置:去多餘空白;逾上限者截至上限內最後一個句界(句界前之有效字數不足 REASON_MIN_CHARS 或無句界 → 不截)——
 *   演算法與筆記欄位共用抓取套件之 cutAtBoundary(不靜默截斷之單一實作)
 *
 * @param {*} reason 輸入理由
 * @param {Integer} [max=REASON_MAX_CHARS] 輸入上限
 * @returns {Object} 回傳 { reason, cut:Boolean, from(原字數) }
 * @example
 * console.log(cutReason('甲說方法在某地長期有效。乙說扣除成本後無效。', 14))
 * // => { reason: '甲說方法在某地長期有效。', cut: true, from: 22 }
 */
export function cutReason(reason, max = REASON_MAX_CHARS) {
    const r = cutAtBoundary(reason, max, { boundaryRe: SENTENCE_END_RE, minMeaningful: REASON_MIN_CHARS })
    return { reason: r.text, cut: r.cut, from: r.from }
}

/**
 * 邊提案之正規化(確定性修正;不判定)。理由之正體修正只改違規處;[[連結]] 與網址原樣——與 RS3 之判定同一範圍(字形政策之 fixKeepLinks;
 *   語言設定非繁體中文時為恆等)
 *
 * @param {Object} p 輸入提案 { id, from, to, type, reason, createdAt, updatedAt, history?, reasonCut? }
 * @param {Object} [ctx={}] 輸入 { resolveType:(raw)=>型別|''(未給即原樣), locale:語言設定或字形政策(未給＝臺灣正體) }
 * @returns {Object} 回傳 { edge(正規化後之提案;本次於句界截短者 reasonCut＝原字數,未截而原有者保留), fixes:Array(修正說明), problems:Array(無法修正之問題) }
 * @throws {Error} ctx.locale 不合時拋出
 * @example
 * const resolveType = (t) => ({ 互補: '互補搭配' })[t] || ''
 * const r = normalizeEdgeProposal({ id: 'e1', from: 'a', to: 'b', type: '互補', reason: '两篇皆以近日点距离之量测方法比较轨道' }, { resolveType })
 * console.log(r.edge.type, r.edge.reason, r.fixes, r.problems)
 * // => 互補搭配 兩篇皆以近日點距離之量測方法比較軌道 [ '型別「互補」→「互補搭配」', '理由轉正體' ] []
 *
 * const bad = normalizeEdgeProposal({ from: 'a', to: 'b', type: '未知型', reason: '理由' }, { resolveType })
 * console.log(bad.problems)
 * // => [ '型別「未知型」不在清單、亦無改名或別名對映' ]
 *
 * const long = '甲說方法在某地長期有效。乙說扣除成本後無效。'.repeat(12)
 * const cut = normalizeEdgeProposal({ from: 'a', to: 'b', type: '互補搭配', reason: long })
 * console.log(cut.edge.reasonCut, [...cut.edge.reason].length, cut.fixes)
 * // => 264 198 [ '理由 264 字逾 200，於句界截為 198 字' ]
 */
export function normalizeEdgeProposal(p, ctx = {}) {
    const src = isobj(p) ? p : {}
    const resolve = isfun(ctx.resolveType) ? ctx.resolveType : (t) => String(t ?? '').trim()
    const script = scriptOf(ctx.locale, 'normalizeEdgeProposal 之 ctx.locale')
    const fixes = []
    const problems = []
    const raw = String(src.type ?? '').trim()
    const type = resolve(raw)
    if (!type) problems.push(`型別「${raw.slice(0, 30)}」不在清單、亦無改名或別名對映`)
    else if (type !== raw) fixes.push(`型別「${raw}」→「${type}」`)
    const r0 = String(src.reason ?? '').replace(/\s+/g, ' ').trim()
    const r1 = script.fixKeepLinks(r0)
    if (r1 !== r0) fixes.push('理由轉正體')
    const c = cutReason(r1)
    if (c.cut) fixes.push(`理由 ${c.from} 字逾 ${REASON_MAX_CHARS}，於句界截為 ${[...c.reason].length} 字`)
    // 截短之明示(檢定標準 RS2):邊上記原字數(整數)——只進修正說明與日誌,存量即看不出哪些理由被截過
    const edge = { ...src, type: type || raw, reason: c.reason, ...(c.cut ? { reasonCut: c.from } : {}) }
    if (isarr(src.history)) {
        const hs = scriptFixHistory(src.history.filter(isobj), (s) => script.fixKeepLinks(s), { resolve })
        edge.history = hs.history
        if (hs.fixed) fixes.push(`history ${hs.fixed} 筆之型別或理由已正規化`)
    }
    return { edge, fixes, problems }
}

/**
 * 沿革(history)之字形修正(一份;納入閘之正規化與存量 RS3 修正同用):逐筆以 fix 改理由,型別經 resolve(未給即原樣);非物件之筆原樣保留、不計。
 *   理由非字串之筆:納入閘之正規化(未給 stringOnly)以字串化後之值修(缺理由者以空字串計);存量 RS3 修正(stringOnly)原樣保留、不計——
 *   確定性修正只改字形,不改形狀,修不了者交使用者
 *
 * @param {Array} history 輸入沿革陣列(非陣列視為 [])
 * @param {Function} fix 輸入 (理由) => 修正後之理由(字形政策之 fixKeepLinks)
 * @param {Object} [o={}] 輸入 { resolve:(型別)=>現行型別名|''(未給即型別原樣), stringOnly:Boolean(只修理由為字串之筆) }
 * @returns {Object} 回傳 { history:Array(修正後;同長), fixed:Integer(型別或理由有改之筆數) }
 * @example
 * console.log(scriptFixHistory([{ type: 'T', reason: '两篇' }, { type: 'T', reason: '兩篇' }], (s) => s.replace('两', '兩')))
 * // => { history: [ { type: 'T', reason: '兩篇' }, { type: 'T', reason: '兩篇' } ], fixed: 1 }
 *
 * console.log(scriptFixHistory([{ type: 'T', reason: ['两篇'] }], (s) => s.replace('两', '兩'), { stringOnly: true }))
 * // => { history: [ { type: 'T', reason: [ '两篇' ] } ], fixed: 0 }
 */
export function scriptFixHistory(history, fix, o = {}) {
    const resolve = isfun(o?.resolve) ? o.resolve : null
    const stringOnly = o?.stringOnly === true
    let fixed = 0
    const out = (isarr(history) ? history : []).map((h) => {
        if (!isobj(h)) return h
        if (stringOnly && typeof h.reason !== 'string') return h
        const ht = resolve ? (resolve(h.type) || String(h.type ?? '')) : h.type
        const hr = fix(String(h.reason ?? ''))
        if (ht !== h.type || hr !== h.reason) fixed++
        return { ...h, type: ht, reason: hr }
    })
    return { history: out, fixed }
}

/**
 * 納入閘之 ctx(一份;domain 之成員 ＋ 呼叫端之筆記存在判定、材料與語言設定):gateEdgeProposal、reasonRewriteProblemsOf、checkEdge 同用,
 *   各站點不再逐欄手建
 *
 * @param {Object} domain 輸入關聯 domain(取 resolveType、relationTypes、vagueReasons)
 * @param {Object} [o={}] 輸入 { hasNote:(id)=>Boolean, materialOf:(id)=>String|null(RS8 之材料;未給不判 RS8), locale:語言設定或字形政策 }
 * @returns {Object} 回傳 { resolveType, relationTypes, vague, hasNote, materialOf, locale }
 * @example
 * const ctx = gateCtxOf({ resolveType: (t) => t, relationTypes: ['前置概念'], vagueReasons: ['都與某主題有關'] }, { hasNote: () => true })
 * console.log(Object.keys(ctx), ctx.vague)
 * // => [ 'resolveType', 'relationTypes', 'vague', 'hasNote', 'materialOf', 'locale' ] [ '都與某主題有關' ]
 */
export function gateCtxOf(domain, o = {}) {
    const d = isobj(domain) ? domain : {}
    const c = isobj(o) ? o : {}
    return { resolveType: d.resolveType, relationTypes: d.relationTypes, vague: d.vagueReasons, hasNote: c.hasNote, materialOf: c.materialOf, locale: c.locale }
}

/**
 * 納入閘:正規化 → checkEdge(RS1、RS2、RS3、RS8)
 *
 * @param {Object} p 輸入提案(makeEdge 之產物,或稽核／封存之邊)
 * @param {Object} [ctx={}] 輸入 { resolveType, relationTypes:Array, vague:Array(空泛片語), hasNote:(id)=>Boolean,
 *        materialOf:(noteId)=>String|null(RS8 之材料), locale:語言設定或字形政策(正規化之正體修正與 RS3 之適用依之;未給＝臺灣正體) }
 * @returns {Object} 回傳 { ok:Boolean, edge(正規化後), fixes:Array, reasons:Array(不納入之理由) }
 * @example
 * const ctx = { resolveType: (t) => t, relationTypes: ['互補搭配'], vague: [], hasNote: () => true }
 * const ok = gateEdgeProposal({ from: 'a', to: 'b', type: '互補搭配', reason: '兩篇皆以近日點距離之量測方法比較軌道' }, ctx)
 * console.log(ok.ok, ok.reasons)
 * // => true []
 *
 * const fixed = gateEdgeProposal({ from: 'a', to: 'b', type: '互補搭配', reason: '两篇皆以近日点距离之量测方法比较轨道' }, ctx)
 * console.log(fixed.ok, fixed.edge.reason, fixed.fixes)
 * // => true 兩篇皆以近日點距離之量測方法比較軌道 [ '理由轉正體' ]
 *
 * const bad = gateEdgeProposal({ from: 'a', to: 'b', type: '互補搭配', reason: 'placeholder' }, ctx)
 * console.log(bad.ok, bad.reasons)
 * // => false [ 'RS2 佔位理由「placeholder」' ]
 */
export function gateEdgeProposal(p, ctx = {}) {
    const n = normalizeEdgeProposal(p, ctx)
    const reasons = [...n.problems]
    if (!reasons.length) {
        for (const r of checkEdge(n.edge, { relationTypes: ctx.relationTypes, vague: ctx.vague, hasNote: ctx.hasNote, materialOf: ctx.materialOf, locale: ctx.locale })) {
            if (r.status === STATUS.VIOLATION) reasons.push(`${r.std} ${r.detail}`)
            else if (r.status === STATUS.UNDETERMINED) reasons.push(`${r.std} 未能判定（${r.detail}）`)
        }
    }
    return { ok: reasons.length === 0, edge: n.edge, fixes: n.fixes, reasons }
}

/** 現行理由須改寫才能合格之標準(兩席改寫之對象;依此序回報) */
export const REASON_REWRITE_STDS = Object.freeze(['RS2', 'RS3', 'RS8'])

/**
 * 現行理由須改寫才能合格之違反:先確定性正規化(normalizeEdgeProposal:型別解析、去多餘空白、正體只改違規處、逾長於句界截——
 *   確定性可修者不算)→ 只判現行理由(沿革 history 不在此列:改寫理由修不了沿革)→ checkEdge 之 RS2／RS3／RS8 之「不合格」
 *   (材料不可得之未能判定不在此列;未給 ctx.materialOf 即不判 RS8)。
 *   【與符合度掃描之分工】掃描判落庫之原值(不正規化——否則 RS1／RS3 之違反被蓋掉);本函數判「須改寫理由才能合格者」:既有邊覆核與
 *   衝突核對送審時據以要求 change 改寫、兩席 keep 不記合格,存量修不了者據以決定去處(現行理由之問題交兩席改寫)。
 *
 * @param {Object} edge 輸入邊之現值 { from, to, type, reason, history? }
 * @param {Object} [ctx={}] 輸入 { resolveType, relationTypes, vague, hasNote, materialOf, locale }(同 gateEdgeProposal)
 * @returns {Array} 回傳 ['<標準> <說明>', …](依 REASON_REWRITE_STDS 之序;無則空陣列)
 * @example
 * console.log(reasonRewriteProblemsOf({ from: 'a', to: 'b', type: '互補搭配', reason: 'placeholder' }))
 * // => [ 'RS2 佔位理由「placeholder」' ]
 *
 * console.log(reasonRewriteProblemsOf({ from: 'a', to: 'b', type: '互補搭配', reason: '两篇都讨论轨道之量测方法与误差' }))
 * // => [](正體可確定性修正者不算)
 */
export function reasonRewriteProblemsOf(edge, ctx = {}) {
    const c = isobj(ctx) ? ctx : {}
    const { history: _h, ...cur } = normalizeEdgeProposal(edge, { resolveType: c.resolveType, locale: c.locale }).edge
    const rs = checkEdge(cur, { relationTypes: c.relationTypes, vague: c.vague, hasNote: c.hasNote, materialOf: c.materialOf, locale: c.locale })
    return REASON_REWRITE_STDS.flatMap((s) => rs.filter((r) => r.std === s && r.status === STATUS.VIOLATION).map((r) => `${r.std} ${r.detail}`))
}

/** 核對類提示詞之 reasonProblem 之字數上限(單行) */
const REASON_PROBLEM_CHARS = 120

/**
 * 核對類提示詞(衝突核對 RS4、既有邊覆核 RS6)之一項:現行理由須改寫才能合格者(reasonRewriteProblemsOf 之結果)於邊附 reasonProblem
 *   (問題以「；」接、單行至多 REASON_PROBLEM_CHARS 字)——提示詞據以要求該項 change 改寫、不可 keep。正式之兩段、評分與安裝端之
 *   題組執行器同讀此函數(提示詞之項只有一種形式)
 *
 * @param {Object} item 輸入 { index, a, b, edge:{ type?, reason } }(a、b 為提示詞之兩方區塊 { note, extra })
 * @param {Array} [problems=[]] 輸入 reasonRewriteProblemsOf 之結果
 * @returns {Object} 回傳 { index, a, b, edge:{ type, reason, reasonProblem? } }
 * @example
 * console.log(checkPromptItemOf({ index: 1, a: {}, b: {}, edge: { type: '互補搭配', reason: 'placeholder' } }, ['RS2 佔位理由「placeholder」']).edge.reasonProblem)
 * // => RS2 佔位理由「placeholder」
 */
export function checkPromptItemOf(item, problems = []) {
    const e = isobj(item?.edge) ? item.edge : {}
    const bad = isarr(problems) ? problems : []
    return { index: item?.index, a: item?.a, b: item?.b, edge: { type: e.type, reason: e.reason, ...(bad.length ? { reasonProblem: oneline(bad.join('；'), REASON_PROBLEM_CHARS) } : {}) } }
}

/**
 * 一對筆記之核對項(無筆記 md 之題組用——評分與安裝端之檢定標準題組執行器):兩方區塊取題組之同一物件;現行理由須改寫才能合格之判定
 *   同正式(reasonRewriteProblemsOf),材料以兩方於提示詞中之 checkSide 區塊代之(正式為兩端筆記之原文標題＋內容章);題組未給現行型別者
 *   (衝突核對之題組可不給,提示詞以衝突型代之)以衝突型判定,提示詞之項照題組原樣
 *
 * @param {Object} input 輸入題組之 input { a:筆記, b:筆記, edge:{ type?, reason } }
 * @param {Integer} index 輸入項編號
 * @param {Object} domain 輸入關聯 domain(seenTextOf、resolveType、relationTypes、vagueReasons、conflictType)
 * @returns {Object} 回傳 checkPromptItemOf 之產物
 * @example
 * const domain = { seenTextOf: (note) => note.title, resolveType: (t) => t, relationTypes: ['互補搭配', '衝突或反例'], vagueReasons: [], conflictType: '衝突或反例' }
 * const bad = pairCheckItemOf({ a: { title: '甲法' }, b: { title: '乙法' }, edge: { type: '互補搭配', reason: 'placeholder' } }, 1, domain)
 * console.log(bad.index, bad.edge.reasonProblem)
 * // => 1 RS2 佔位理由「placeholder」
 *
 * const ok = pairCheckItemOf({ a: { title: '甲法' }, b: { title: '乙法' }, edge: { reason: '甲說此條件下成立；乙說同一條件下結論相反' } }, 2, domain)
 * console.log(ok.index, ok.edge.type, ok.edge.reasonProblem)
 * // => 2 undefined undefined
 */
export function pairCheckItemOf(input, index, domain) {
    const sides = { a: input?.a, b: input?.b }
    const material = { a: domain.seenTextOf(sides.a, 'checkSide', sides.a), b: domain.seenTextOf(sides.b, 'checkSide', sides.b) }
    const e = isobj(input?.edge) ? input.edge : {}
    const problems = reasonRewriteProblemsOf({ from: 'a', to: 'b', type: e.type || domain.conflictType, reason: e.reason }, gateCtxOf(domain, {
        hasNote: (id) => Object.hasOwn(sides, id), materialOf: (id) => (Object.hasOwn(material, id) ? material[id] : null),
    }))
    return checkPromptItemOf({ index, a: { note: sides.a, extra: sides.a }, b: { note: sides.b, extra: sides.b }, edge: e }, problems)
}

export default { REASON_MAX_CHARS, REASON_REWRITE_STDS, cutReason, normalizeEdgeProposal, scriptFixHistory, gateCtxOf, gateEdgeProposal, reasonRewriteProblemsOf, checkPromptItemOf, pairCheckItemOf }
