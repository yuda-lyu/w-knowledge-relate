// edgeCheckKit.mjs — 邊之覆核類判定(重評 RS5、衝突核對 RS4、既有邊覆核 RS6)共用之核對件(唯一一份;各標準之差異留在其判定模組):
//   合法裁決值、票之理由最短字數、單票驗證之共同前段、票之相同、一席回覆 → 逐項票、關聯型別定義之版本、檢核雜湊、決定性打亂、
//   兩層判定之第一層(類別)、存量檢核之掃描與排序
//
// 【為何獨立成檔】三個標準之判定模組各有專屬判準,但票之驗證前段、票之相同、檢核雜湊、打亂、兩層判定之第一層、存量之掃描與排序
//   是同一規則——放在任一標準之檔內會使他標準取用時誤讀為該標準專屬;規則一份、名稱不帶標準號。
// 【票】keep｜change(type、reason)｜retire(reason)｜unsure(材料不足;摘要套件之判定小組之 PANEL_UNSURE)。理由規則同正向理由具體率之判準:
//   change／retire ≥ EDGE_VERDICT_MIN_REASON 字。不合格之票(裁決值不明、型別無對映、理由過短)＝缺票(null;不是不確定):缺票者重試,不叫第三席。
//   change 而型別與理由皆同現行＝沒有改,三標準皆視同 keep(同一處境同一處置)。項編號須為整數(可轉數之小數或字串不認)。
// 【檢核雜湊】邊之型別＋理由＋兩端內容版本(knowledgeChangedAt‖createdAt)＋關聯型別定義之版本(relationTypesVersionOf——型別之生命週期
//   與筆記之分類法對稱:定義變更須重判)＋兩端判定所讀之素材(核對席所見之區塊——筆記之內容版本只隨標題／概念／一句話重點變,核心知識、
//   適用條件之改動不改版本,判定所讀之素材改了亦須重核):任一變即須重核(core/stores/checks.needsCheck)。型別清單或定義一變,全部 RS4／RS6
//   檢核紀錄之雜湊不符＝全數作廢、存量全量重排(依各段配額逐輪重核)。各段與還原路徑皆須以同一算法、同一型別版本、同一素材讀法
//   (stores/checkMaterial.createCheckHasher)計之,否則一律判須重核(安全側)。
// 【存量之掃描與排序】受檢對象＝兩端皆在之邊(懸空不核,由關聯維護處置),附雜湊與是否須(重)核;佇列先排觸及下游已處理筆記之邊——
//   下游處理時刻 extractedAt(摘要套件筆記記錄之資料契約;由讀筆記之下游寫入,非空＝已被下游使用):錯標在這些筆記上已有後果,先核——
//   再依邊時刻舊到新、邊 id。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { sha1, cmp, strictTextOf as str } from '../core/capturePackage.mjs'
import { PANEL_UNSURE, PANEL_WHY, decidePanel, needThird } from '../core/summarizePackage.mjs'
import { needsCheck } from '../core/stores/checks.mjs'
import { edgeTimeOf } from './edgeStore.mjs'

/** 合法裁決值(unsure＝材料不足以判斷;判定小組之合法裁決,不是 keep) */
export const EDGE_VERDICTS = Object.freeze(['keep', 'change', 'retire', PANEL_UNSURE])

/** 票之理由最短字數(change／retire;同正向理由具體率之判準) */
export const EDGE_VERDICT_MIN_REASON = 10

/**
 * 單票驗證之共同前段(檔頭【票】):裁決值正規化、理由去多餘空白、change 之型別解析(清單內原樣,或 resolveType 之對映)、
 *   change 而型別與理由皆同現行 → keep——各標準之差異(衝突型之判準、型別改正之封閉清單)由呼叫端接在其後
 *
 * @param {*} raw 輸入模型之單項 { verdict, type?, reason? }
 * @param {Object} [o={}] 輸入 { relationTypes:Array, resolveType?:(raw)=>清單內型別|'', current?:{ type, reason }(現行或被提議之邊;給了才判沒有改) }
 * @returns {Object|String|null} 回傳 { verdict:'keep'|'retire', reason }、{ verdict:'change', type, reason }、PANEL_UNSURE、或 null(不合格＝缺票)
 * @example
 * console.log(baseVerdictOf({ verdict: 'Change', type: '甲', reason: '乙為甲之演算法之程式實作' }, { relationTypes: ['甲'] }))
 * // => { verdict: 'change', type: '甲', reason: '乙為甲之演算法之程式實作' }
 * console.log(baseVerdictOf({ verdict: 'change', type: '甲', reason: '乙為甲之演算法之程式實作' }, { relationTypes: ['甲'], current: { type: '甲', reason: '乙為甲之演算法之程式實作' } }))
 * // => { verdict: 'keep', reason: '乙為甲之演算法之程式實作' }
 * console.log(baseVerdictOf({ verdict: 'retire', reason: '太短' }, {}))
 * // => null
 */
export function baseVerdictOf(raw, o = {}) {
    if (!raw || typeof raw !== 'object') return null
    const verdict = str(raw.verdict).toLowerCase()
    const reason = String(raw.reason ?? '').replace(/\s+/g, ' ').trim()
    if (verdict === PANEL_UNSURE) return PANEL_UNSURE
    if (verdict === 'keep') return { verdict: 'keep', reason }
    if (verdict === 'retire') return reason.length >= EDGE_VERDICT_MIN_REASON ? { verdict: 'retire', reason } : null
    if (verdict !== 'change') return null
    const types = isarr(o.relationTypes) ? o.relationTypes : []
    const type = isfun(o.resolveType) ? o.resolveType(raw.type) : (types.includes(str(raw.type)) ? str(raw.type) : '')
    if (!type || !types.includes(type) || reason.length < EDGE_VERDICT_MIN_REASON) return null
    if (isobj(o.current) && type === str(o.current.type) && reason === str(o.current.reason)) return { verdict: 'keep', reason }
    return { verdict: 'change', type, reason }
}

/**
 * 兩份邊裁決是否相同(裁決相同,且 change 之型別相同;理由可不同)——判定小組(摘要套件之 decidePanel 之 same)三標準共用
 *
 * @param {Object} x 輸入裁決 { verdict, type? }
 * @param {Object} y 輸入裁決 { verdict, type? }
 * @returns {Boolean} 回傳是否相同
 * @example
 * console.log(sameEdgeVerdict({ verdict: 'change', type: '甲', reason: 'a' }, { verdict: 'change', type: '甲', reason: 'b' }), sameEdgeVerdict({ verdict: 'change', type: '甲' }, { verdict: 'change', type: '乙' }))
 * // => true false
 */
export function sameEdgeVerdict(x, y) {
    return !!x && !!y && typeof x === 'object' && typeof y === 'object' && x.verdict === y.verdict && (x.verdict !== 'change' || x.type === y.type)
}

const sameVote = (a, b) => a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && sameEdgeVerdict(a, b))

/**
 * 一席之回覆 → 逐項票(以項編號對應;同一編號重複而矛盾者作廢為缺票)——衝突核對與既有邊覆核共用,單票驗證由呼叫端給
 *
 * @param {*} data 輸入模型回覆(陣列)
 * @param {Object} o 輸入 單票驗證之選項＋{ verdictOf:(raw, o)=>票(各標準之單票驗證;必給), indices:Set(本席所見之項編號), currentOf:(index)=>{ type, reason } }
 * @returns {Map} 回傳 Map(項編號 → 票|PANEL_UNSURE|null)(未回之編號不在 Map 內＝缺票)
 * @throws {Error} 未給 verdictOf 時拋出
 * @example
 * const data = [
 *     { index: 1, verdict: 'keep' },
 *     { index: 2, verdict: 'retire', reason: '太短' },
 *     { index: 3, verdict: 'keep' },
 *     { index: 3, verdict: 'retire', reason: '兩者並無知識上之關聯' },
 *     { index: 9, verdict: 'keep' },
 * ]
 * const votes = seatVotesOf(data, { verdictOf: baseVerdictOf, relationTypes: ['甲'], indices: new Set([1, 2, 3]) })
 * console.log(votes)
 * // => Map(3) { 1 => { verdict: 'keep', reason: '' }, 2 => null, 3 => null }
 * console.log(votes.has(9), votes.has(4))
 * // => false false
 */
export function seatVotesOf(data, o = {}) {
    if (!isfun(o.verdictOf)) throw new Error('seatVotesOf 需要 verdictOf（各標準之單票驗證）')
    const want = o.indices instanceof Set ? o.indices : null
    const out = new Map()
    const bad = new Set()
    for (const it of isarr(data) ? data : []) {
        const i = it?.index
        if (!Number.isInteger(i) || (want && !want.has(i))) continue
        const v = o.verdictOf(it, { ...o, current: isfun(o.currentOf) ? o.currentOf(i) : null })
        if (!out.has(i)) out.set(i, v)
        else if (!sameVote(out.get(i), v)) bad.add(i)
    }
    for (const i of bad) out.set(i, null)
    return out
}

/**
 * 關聯型別定義之版本(檢核雜湊之成分;檔頭【檢核雜湊】):型別清單之成員(排序——列序只決定合併時之型別序,非語意)、衝突型、
 *   型別之語意角色(既有邊覆核 RS6 之型別改正封閉清單與提示詞判準)。關聯 domain 之同名欄位即可傳入。
 *   不入版本:一般提示詞措辭(guide.relate 之空泛片語等;同分類法版本 SS9「一般提示詞措辭不入」之慣例)、別名表(只影響模型輸出之解析)、
 *   改名表(改名之邊由關聯段維護機械改寫,型別值改變即使該邊之雜湊改變)。
 *
 * @param {Object} [d={}] 輸入 { relationTypes:Array, conflictType:String, relationTypeRoles?:Object }(關聯 domain 或詞彙表)
 * @returns {String} 回傳 12 碼版本
 * @example
 * console.log(relationTypesVersionOf({ relationTypes: ['乙', '甲'], conflictType: '甲' }) === relationTypesVersionOf({ relationTypes: ['甲', '乙'], conflictType: '甲' }))
 * // => true
 */
export function relationTypesVersionOf(d = {}) {
    const types = [...new Set((isarr(d?.relationTypes) ? d.relationTypes : []).map(String))].sort(cmp)
    const roles = isobj(d?.relationTypeRoles) ? Object.keys(d.relationTypeRoles).sort(cmp).map((k) => `${k}=${str(d.relationTypeRoles[k])}`) : []
    return sha1(JSON.stringify({ types, conflict: str(d?.conflictType), roles })).slice(0, 12)
}

/**
 * 檢核雜湊(檔頭【檢核雜湊】):邊之型別＋理由＋兩端內容版本＋關聯型別定義之版本＋兩端判定所讀之素材
 *
 * @param {Object} edge 輸入邊(from／to／type／reason)
 * @param {Object} a 輸入 from 端筆記記錄
 * @param {Object} b 輸入 to 端筆記記錄
 * @param {String} [typesVer=''] 輸入關聯型別定義之版本(relationTypesVersionOf)
 * @param {String} [seenA=''] 輸入 from 端判定所讀之素材(核對席所見之區塊原文;stores/checkMaterial.createCheckHasher 之 seenOf)
 * @param {String} [seenB=''] 輸入 to 端判定所讀之素材
 * @returns {String} 回傳 16 碼雜湊
 * @example
 * const a = { id: 'a', createdAt: '2026-01-01' }
 * const b = { id: 'b', createdAt: '2026-01-02', knowledgeChangedAt: '2026-03-01' }
 * const edge = { from: 'a', to: 'b', type: '甲', reason: '理由' }
 * const h = edgeCheckHashOf(edge, a, b, 'v1', '甲之素材', '乙之素材')
 * console.log(h, h === edgeCheckHashOf(edge, a, b, 'v1', '甲之素材', '乙之素材'))
 * // => e92168eefc748e0c true
 * console.log(h === edgeCheckHashOf(edge, a, b, 'v2', '甲之素材', '乙之素材'), h === edgeCheckHashOf(edge, a, b, 'v1', '甲之素材', '乙之素材改'))
 * // => false false
 */
export function edgeCheckHashOf(edge, a, b, typesVer = '', seenA = '', seenB = '') {
    const ver = (n) => str(n?.knowledgeChangedAt) || str(n?.createdAt)
    return sha1(`${str(edge?.type)}\n${str(edge?.reason)}\n${ver(a)}\n${ver(b)}\n${str(typesVer)}\n${sha1(String(seenA ?? ''))}\n${sha1(String(seenB ?? ''))}`).slice(0, 16)
}

/**
 * 決定性之打亂(第二席所見之項序——兩席看到同一順序時,位置偏誤會讓兩票一起錯):以 seed 與各項 key 之雜湊排序,同輸入恆同輸出
 *
 * @param {Array} arr 輸入陣列
 * @param {String} seed 輸入種子
 * @param {Function} keyOf 輸入 (item) => 鍵字串
 * @returns {Array} 回傳打亂後之新陣列
 * @example
 * const items = ['a', 'b', 'c', 'd', 'e']
 * const x = shuffleStable(items, 'seed1', (s) => s)
 * console.log(x, shuffleStable(items, 'seed1', (s) => s).join() === x.join())
 * // => [ 'd', 'a', 'c', 'b', 'e' ] true
 * console.log(shuffleStable(items, 'seed2', (s) => s), items)
 * // => [ 'a', 'b', 'e', 'c', 'd' ] [ 'a', 'b', 'c', 'd', 'e' ]
 */
export function shuffleStable(arr, seed, keyOf) {
    return [...(isarr(arr) ? arr : [])].map((x) => ({ x, h: sha1(`${seed}|${keyOf(x)}`) })).sort((a, b) => cmp(a.h, b.h)).map((y) => y.x)
}

/**
 * 兩層判定之第一層(類別;衝突核對與既有邊覆核同一骨架):各票先映為類別交判定小組(摘要套件之 decidePanel);未成立 → retry(缺票、同一供應者
 *   ——不是真的判不了)／undetermined(不確定、不一致——判不了),並附第三席可否改變結果(needThird);成立 → 類別與成立類別內之票
 *
 * @param {Array} votes 輸入票 [{ seat, provider, verdict }]
 * @param {Function} classOf 輸入 (票) => 類別字串|PANEL_UNSURE|null(缺票)
 * @returns {Object} 回傳 { decided:false, action:'retry'|'undetermined', why, needThird } 或 { decided:true, cls, votes:Array(成立類別內之票;含 seat、provider) }
 * @example
 * const keep = { verdict: 'keep' }
 * const retire = { verdict: 'retire' }
 * const classOf = (v) => (v ? (v.verdict === 'retire' ? 'none' : 'related') : null)
 * const vote = (seat, provider, verdict) => ({ seat, provider, verdict })
 *
 * const d1 = classDecisionOf([vote('first', 'a', keep), vote('second', 'b', keep)], classOf)
 * console.log(d1.decided, d1.cls, d1.votes.length)
 * // => true related 2
 *
 * const d2 = classDecisionOf([vote('first', 'a', keep), vote('second', 'b', retire)], classOf)
 * console.log(d2.decided, d2.action, d2.why, d2.needThird)
 * // => false undetermined disagree true
 *
 * const d3 = classDecisionOf([vote('first', 'a', keep), vote('second', 'a', keep)], classOf)
 * console.log(d3.decided, d3.action, d3.why)
 * // => false retry same-provider
 *
 * const d4 = classDecisionOf([vote('first', 'a', keep), vote('second', 'b', null)], classOf)
 * console.log(d4.decided, d4.action, d4.why)
 * // => false retry missing
 */
export function classDecisionOf(votes, classOf) {
    const vs = (isarr(votes) ? votes : []).filter(Boolean)
    const asClass = vs.map((x) => {
        const c = classOf(x.verdict)
        return { seat: x.seat, provider: x.provider, verdict: c === null || c === PANEL_UNSURE ? c : { cls: c } }
    })
    const sameCls = (a, b) => a.cls === b.cls
    const d = decidePanel(asClass, { same: sameCls })
    if (d.status !== 'decided') {
        return { decided: false, action: [PANEL_WHY.MISSING, PANEL_WHY.SAME_PROVIDER].includes(d.why) ? 'retry' : 'undetermined', why: d.why, needThird: needThird(asClass, { same: sameCls }) }
    }
    const cls = d.verdict.cls
    return { decided: true, cls, votes: vs.filter((x) => classOf(x.verdict) === cls) }
}

/**
 * 存量檢核之掃描(檔頭【存量之掃描與排序】;佇列與進度之單一掃描):受檢對象之邊(keep 判;兩端皆在者)逐條附雜湊、是否須(重)核、是否觸及下游已處理筆記
 *
 * @param {Object} o 輸入 { edges:Array, keep:(邊)=>Boolean(受檢對象;未給＝全部), byId:Map(筆記), checkOf:(邊 id)=>檢核紀錄|null, extracted:(筆記 id)=>Boolean,
 *   typesVer:String, seenOf?:(筆記 id)=>String(判定所讀之素材;未給＝空), std:String(標準 ID), v:Number(標準版本) }
 * @returns {Array} 回傳 [{ edge, hash, due:Boolean, touch:Boolean }]
 * @example
 * const byId = new Map([['a', { id: 'a', createdAt: '2026-01-01' }], ['b', { id: 'b', createdAt: '2026-01-02' }]])
 * const edges = [
 *     { id: 'e1', from: 'a', to: 'b', type: '甲', reason: '理由' },
 *     { id: 'e2', from: 'a', to: 'x', type: '甲', reason: '理由' },
 *     { id: 'e3', from: 'a', to: 'b', type: '衝突', reason: '理由' },
 * ]
 * const scan = edgeCheckScanOf({ edges, keep: (e) => e.type === '甲', byId, extracted: (id) => id === 'b', typesVer: 'v1', std: 'RS6', v: 1 })
 * console.log(scan.map((x) => [x.edge.id, x.due, x.touch]))
 * // => [ [ 'e1', true, true ] ]
 *
 * const rec = { hash: scan[0].hash, results: { RS6: { v: 1 } } }
 * const again = edgeCheckScanOf({ edges, byId, checkOf: (id) => (id === 'e1' ? rec : null), typesVer: 'v1', std: 'RS6', v: 1 })
 * console.log(again.map((x) => [x.edge.id, x.due, x.touch]))
 * // => [ [ 'e1', false, false ], [ 'e3', true, false ] ]
 */
export function edgeCheckScanOf(o = {}) {
    const keep = isfun(o.keep) ? o.keep : () => true
    const checkOf = isfun(o.checkOf) ? o.checkOf : () => null
    const extracted = isfun(o.extracted) ? o.extracted : () => false
    const seenOf = isfun(o.seenOf) ? o.seenOf : () => ''
    const out = []
    for (const e of isarr(o.edges) ? o.edges : []) {
        if (!e || !keep(e)) continue
        const a = o.byId?.get(e.from)
        const b = o.byId?.get(e.to)
        if (!a || !b) continue // 懸空不核(由關聯維護處置)
        const hash = edgeCheckHashOf(e, a, b, o.typesVer, seenOf(e.from), seenOf(e.to))
        out.push({ edge: e, hash, due: needsCheck(checkOf(e.id), { hash, std: o.std, v: o.v }), touch: !!(extracted(e.from) || extracted(e.to)) })
    }
    return out
}

/**
 * 存量佇列之序(檔頭【存量之掃描與排序】):觸及下游已處理筆記者先、再依邊時刻舊到新、邊 id
 *
 * @param {Object} x 輸入掃描之一項 { edge, touch }
 * @param {Object} y 輸入掃描之一項
 * @returns {Number} 回傳比較值
 * @example
 * const list = [
 *     { edge: { id: 'e1', createdAt: '2026-02-01' }, touch: false },
 *     { edge: { id: 'e2', createdAt: '2026-03-01' }, touch: true },
 *     { edge: { id: 'e3', createdAt: '2026-01-01' }, touch: false },
 * ]
 * console.log(stockOrderOf(list[0], list[1]), stockOrderOf(list[0], list[2]) > 0)
 * // => 1 true
 * console.log([...list].sort(stockOrderOf).map((x) => x.edge.id))
 * // => [ 'e2', 'e3', 'e1' ]
 */
export function stockOrderOf(x, y) {
    return Number(y.touch) - Number(x.touch) || cmp(edgeTimeOf(x.edge), edgeTimeOf(y.edge)) || cmp(x.edge.id, y.edge.id)
}

export default { EDGE_VERDICTS, EDGE_VERDICT_MIN_REASON, baseVerdictOf, sameEdgeVerdict, seatVotesOf, relationTypesVersionOf, edgeCheckHashOf, shuffleStable, classDecisionOf, edgeCheckScanOf, stockOrderOf }
