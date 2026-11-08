// edgeProvenance.mjs — 邊記錄之產出鏈(produced;跨套件規格〈知識套件之產出鏈〉)
//
// 【記什麼】邊記錄每次「新建、改型、判定小組改寫、標準修正」時追加一筆產出者(produced):哪一輪(stamp)、哪個階段(stage)、哪個席位(seat)、
//   實際由哪個條目成交(provider)、提示詞指紋(promptFp)、套件版(pkg)、寫入時刻(at)。邊記錄帶三欄:produced(最後一筆)、producedHistory(至多
//   最近 50 筆;超出捨最舊並於 producedHistoryDropped 累計)、producedHistoryDropped。舊邊(無 produced)不回填。結構、鍵序與檢核一律取抓取套件之
//   makeProduced／appendProduced(本套件不自行拼物件)。邊既有之 createdAt／updatedAt 不動、不另加 at——produced.at 即寫入時刻。
// 【只在可見內容改變時追加】產出者追加於「新建」與「可見欄位(from／to／type／reason)改變」之寫入。跨輪再現之提案落敗而只入 history、或理由以外之
//   欄位變動者,邊之內容仍是前一位產出者所出,不追加(否則「撤回某輪之邊」會誤傷只是被再提案之舊邊)。
// 【席位與成交者】單一呼叫點(正向、反向、輪巡)之席位為設定路徑(relate.ai、relate.reverse.ai;relateSeatPathOf),provider 為該批呼叫結果之 providerId
//   (遞補時為遞補者);判定小組(重評、衝突核對、既有邊覆核)改寫邊時,seat／provider 為「採用其改寫值之那一票」之席位與供應者,與該段稽核列
//   votes[{ seat, provider }] 同名同值(採用＝其裁決值經納入閘後成為邊之新型別與理由者;多票皆合格取票序最前者;voteOfVerdict 由裁決值回找該票)。
//   衝突核對之新提案原樣落地者(keep)為提案席('proposer'),provider 為提案之實際成交者。不呼叫 AI 之寫入(型別改名、存量處置)seat 與 provider 同時為 null。
//   provider 為空字串(調度層未回成交者)者不寫產出鏈——無從記實,不以占位字樣代之。
// 【提示詞指紋】由組裝者注入 promptFpOf(評比角色 id → 16 碼指紋｜null;每輪一個快取實例,見 createKnowledgeRelate);角色對應:正向、反向、輪巡 → relate,
//   重評 → reeval,衝突核對 → conflict-check,既有邊覆核 → edge-review;無指紋(未注入、角色無題組、算不出)者省略該欄。不呼叫 AI 者無指紋。
//   語意為「角色內建題組＋現行詞彙」組出之提示詞之指紋(提示詞版本),不含 cfg.prompts 之覆寫,不是該次呼叫實際送出內容之指紋。
// 【stamp】輪次內為該輪之 stamp(各段 ctx.stamp,與 run.json 之 stamp 同值);輪次外(手動維運件)為 null。
// 【撤銷而非追加(回退、撤回)】produced＝現行可見內容之產出者。回退與撤回把可見內容換回改寫前之值,故不追加「無人產出」之新紀錄,而是撤銷該次改寫所留之產出鏈:
//   存量處置之回退(standards/stockFix)與撤回判定小組之改寫(ops/noteOps 之 revertEdgeRevision)同一規則。撤回之改寫前產出鏈取自(producedUndoPlanOf):
//   ①段稽核列之改寫列 edge 帶改寫前之 produced／producedHistory／producedHistoryDropped(producedFieldsOf;新增欄位,改寫前無產出鏈者不帶)→ 原樣換回(how 'row');
//   ②列無此欄(舊帳列,或改寫前本無產出鏈)→ 由現行邊判:現行 produced 為歷史末筆、階段＝該段、寫入時刻不晚於該列之 at(即「該次改寫所留」)時退一筆
//   (歷史只有一筆且無捨去者＝改寫前無產出鏈,三欄移除)(how 'history');判不了則不動,並於回傳帶可辨識之原因字樣(PRODUCED_UNDO_WHY)。
//   歷史滿 50 筆後之改寫已捨去最舊一筆,退一筆時 producedHistoryDropped 不減(捨去者無從復原)。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { makeProduced, appendProduced, pkgIdOf } from '../core/capturePackage.mjs'

/** 產出階段(produced.stage 之值;規格 §4 relate 列)——正向與輪巡記為 relate(輪巡以正向提示詞比對候選之後段,規格未另列) */
export const EDGE_PRODUCED_STAGES = Object.freeze({
    relate: 'relate',
    reverse: 'reverse',
    reeval: 'reeval',
    conflictCheck: 'conflict-check',
    edgeReview: 'edge-review',
    standardsFix: 'standards-fix',
})

/** 提案(衝突核對之提案席)依來源段之提示詞角色(評比角色 id;promptFp 之取得) */
export const PROPOSER_ROLE_OF_SEGMENT = Object.freeze({
    forward: 'relate',
    reverse: 'relate',
    rotation: 'relate',
    reeval: 'reeval',
    edgeReview: 'edge-review',
})

/** 寫入時刻之格式(同抓取套件時鐘之 iso8:秒級、帶偏移、無 Z 與毫秒) */
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/

/**
 * 建一個邊產出鏈之產出者工廠(一個實例＝一輪之一個寫入脈絡;輪次外之維運件傳 stamp null)
 *
 * @param {Object} [o={}] 輸入設定物件，非物件視為{}
 * @param {String|null} [o.stamp=null] 輸入輪次 stamp(14 碼;取自各段 ctx.stamp;輪次外為 null);給了而格式不符，於 make 時依 makeProduced 拋錯
 * @param {Function} [o.nowIso] 輸入 () => 本地時區 ISO 字串(時鐘之 iso8);未給或回傳格式不符(非 YYYY-MM-DDTHH:mm:ss±hh:mm)者 at 取機器本地現在
 * @param {Function} [o.promptFpOf] 輸入 (角色 id) => 16 碼指紋｜null;未給即無指紋;回傳非 16 碼小寫十六進位者視為無
 * @returns {Object} 回傳 { stamp, make(p) }:make({ stage, seat, provider, role? }) 回傳 produced(makeProduced 之產物)或 null(provider 為空字串、或查不到套件版者
 *   不寫產出鏈);不呼叫 AI 之寫入 seat 與 provider 須同時給 null(只其一為 null 依 makeProduced 拋錯)
 * @example
 * let prov = createEdgeProvenance({ stamp: '20261108200009', nowIso: () => '2026-11-08T20:12:31+08:00', promptFpOf: (role) => (role === 'relate' ? '5118f8f40bf0dc40' : null) })
 * let p = prov.make({ stage: 'relate', seat: 'relate.ai', provider: 'codex:gpt-6.1-terra', role: 'relate' })
 * console.log(p.stage, p.seat, p.provider, p.promptFp, p.at, p.pkg.split('@')[0])
 * // => relate relate.ai codex:gpt-6.1-terra 5118f8f40bf0dc40 2026-11-08T20:12:31+08:00 w-knowledge-relate
 * console.log(prov.make({ stage: 'relate', seat: 'relate.ai', provider: '', role: 'relate' }))
 * // => null
 * let n = prov.make({ stage: 'standards-fix', seat: null, provider: null })
 * console.log(n.seat, n.provider, 'promptFp' in n)
 * // => null null false
 */
export function createEdgeProvenance(o = {}) {

    //check
    if (!isobj(o)) {
        o = {}
    }

    const stamp = o.stamp === undefined ? null : o.stamp
    const nowIso = isfun(o.nowIso) ? o.nowIso : null
    const promptFpOf = isfun(o.promptFpOf) ? o.promptFpOf : null

    const make = (p) => {
        const seat = p?.seat
        const provider = p?.provider
        const noAi = seat === null && provider === null
        // 成交者無從得知(空字串):不寫產出鏈,不以占位字樣代之;只其一為 null 等無效組合交 makeProduced 拋
        if (!noAi && seat !== null && provider !== null && !(isestr(seat) && isestr(provider))) return null
        const pkg = pkgIdOf(import.meta.url)
        if (!pkg) return null
        const at = nowIso ? nowIso() : undefined
        const fp = !noAi && promptFpOf && isestr(p.role) ? promptFpOf(p.role) : null
        return makeProduced({
            stamp,
            stage: p?.stage,
            seat,
            provider,
            ...(typeof fp === 'string' && /^[0-9a-f]{16}$/.test(fp) ? { promptFp: fp } : {}),
            pkg,
            ...(typeof at === 'string' && LOCAL_ISO.test(at) ? { at } : {}),
        })
    }

    return { stamp, make }
}

/**
 * 邊值加上本次之產出者(produced、producedHistory、producedHistoryDropped;不改輸入)
 *
 * @param {Object} edge 輸入將寫入之邊值(合併或改寫之結果;可已帶舊產出鏈之三欄,以 stored 為準重算)
 * @param {Object|null} stored 輸入寫入前庫內之邊(新建者給 null);其 producedHistory 為歷史之基底
 * @param {Object|null} produced 輸入本次之產出者(createEdgeProvenance 之 make 之產物);null 即原樣回傳 edge(不寫產出鏈)
 * @returns {Object} 回傳新邊值(produced 為本次、producedHistory 追加一筆、producedHistoryDropped 累計捨去數)
 * @throws {Error} stored 之 producedHistory 非陣列或含非物件、producedHistoryDropped 非非負整數、produced 不合結構時拋出(依 appendProduced)
 * @example
 * let prov = createEdgeProvenance({ stamp: null, nowIso: () => '2026-11-08T20:12:31+08:00' })
 * let p1 = prov.make({ stage: 'standards-fix', seat: null, provider: null })
 * let e1 = stampEdge({ id: 'e', type: '甲' }, null, p1)
 * let e2 = stampEdge({ ...e1, type: '乙' }, e1, p1)
 * console.log(e1.producedHistory.length, e2.producedHistory.length, e2.produced.stage, e2.producedHistoryDropped)
 * // => 1 2 standards-fix 0
 * console.log(stampEdge({ id: 'e' }, null, null))
 * // => { id: 'e' }
 */
export function stampEdge(edge, stored, produced) {
    if (!produced) return edge
    const { produced: p, producedHistory, producedHistoryDropped } = appendProduced(isobj(stored) ? stored : {}, produced)
    return { ...edge, produced: p, producedHistory, producedHistoryDropped }
}

/** 邊記錄之產出鏈三欄(鍵名) */
export const PRODUCED_FIELD_KEYS = Object.freeze(['produced', 'producedHistory', 'producedHistoryDropped'])

/** 撤銷產出鏈(producedUndoPlanOf)判不了時之原因字樣(固定詞彙,供呼叫端與測試辨識) */
export const PRODUCED_UNDO_WHY = Object.freeze({
    historyMismatch: 'history-mismatch', // 現行 produced 不是歷史之末筆(或無歷史)
    stageMismatch: 'stage-mismatch', // 現行 produced 之階段不是該段(非該次改寫所留)
    atUnverifiable: 'at-unverifiable', // produced.at 或稽核列 at 不可解析,無從比先後
    newerThanRow: 'newer-than-row', // 現行 produced 晚於稽核列(非該次改寫所留)
    historyDropped: 'history-dropped', // 歷史只有一筆而已捨去過更舊者:無從判改寫前有無產出鏈
})

/** 鍵序無關之 JSON 正規化字串(歷史各筆皆為純 JSON;比對用) */
const canon = (v) => JSON.stringify(v, (k, x) => (isobj(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x))

/**
 * 取邊記錄之產出鏈三欄(只含邊上有者;新物件,不與輸入共用參考)
 *
 * @param {Object} edge 輸入邊(非物件視為無)
 * @returns {Object} 回傳 { produced?, producedHistory?, producedHistoryDropped? }
 * @example
 * console.log(JSON.stringify(producedFieldsOf({ id: 'e', produced: { v: 1 }, producedHistory: [{ v: 1 }], producedHistoryDropped: 0, type: '甲' })))
 * // => {"produced":{"v":1},"producedHistory":[{"v":1}],"producedHistoryDropped":0}
 * console.log(producedFieldsOf({ id: 'e' }), producedFieldsOf(null))
 * // => {} {}
 */
export function producedFieldsOf(edge) {
    const src = isobj(edge) ? edge : {}
    return Object.fromEntries(PRODUCED_FIELD_KEYS.filter((k) => Object.hasOwn(src, k) && src[k] !== undefined).map((k) => [k, structuredClone(src[k])]))
}

/**
 * 邊值之產出鏈三欄換成給定之值(先移除邊上三欄,再放入 restore 所有者;restore 為 {}＝移除三欄;不改輸入)
 *
 * @param {Object} edge 輸入邊值
 * @param {Object} restore 輸入 { produced?, producedHistory?, producedHistoryDropped? }(producedUndoPlanOf 之 restore 或 producedFieldsOf 之產物)
 * @returns {Object} 回傳新邊值
 * @example
 * let e = { id: 'e', produced: { v: 1, stage: 'reeval' }, producedHistory: [{ v: 1 }, { v: 1, stage: 'reeval' }], producedHistoryDropped: 0 }
 * console.log(withProducedRestored(e, { produced: { v: 1 }, producedHistory: [{ v: 1 }], producedHistoryDropped: 0 }).producedHistory.length)
 * // => 1
 * console.log(withProducedRestored(e, {}))
 * // => { id: 'e' }
 */
export function withProducedRestored(edge, restore) {
    const rest = Object.fromEntries(Object.entries(edge).filter(([k]) => !PRODUCED_FIELD_KEYS.includes(k)))
    return { ...rest, ...producedFieldsOf(restore) }
}

/**
 * 撤回判定小組之改寫時,產出鏈之撤銷計畫(檔頭【撤銷而非追加】;純函數、不寫)
 *
 * @param {Object} cur 輸入庫內之現行邊(其值即該次改寫之結果)
 * @param {Object} row 輸入段稽核之改寫列 { at, edge:改寫前之邊值(新帳列帶產出鏈三欄) }
 * @param {String} stage 輸入該段之產出階段(EDGE_PRODUCED_STAGES 之值;判「現行 produced 為該次改寫所留」用)
 * @returns {Object} 回傳 { done:Boolean(撤銷已定:換回或確知無須動),how:'row'｜'history'｜'none',why?:PRODUCED_UNDO_WHY 之一(done 為 false 時),
 *   restore:Object|null(null＝不動;{}＝三欄移除;否則為換回之三欄) }
 * @example
 * let p = (n) => ({ v: 1, stamp: null, stage: 'edge-review', seat: 'first', provider: `p${n}`, pkg: 'w-demo@1.0.0', at: '2026-11-08T10:00:00+08:00' })
 * let cur = { produced: p(2), producedHistory: [p(1), p(2)], producedHistoryDropped: 0 }
 * let row = { at: '2026-11-08T10:00:01+08:00', edge: {} }
 * console.log(producedUndoPlanOf(cur, row, 'edge-review').how, producedUndoPlanOf(cur, row, 'edge-review').restore.produced.provider)
 * // => history p1
 * console.log(producedUndoPlanOf(cur, { ...row, edge: { produced: p(1), producedHistory: [p(1)], producedHistoryDropped: 0 } }, 'edge-review').how)
 * // => row
 * console.log(producedUndoPlanOf(cur, row, 'reeval').why)
 * // => stage-mismatch
 */
export function producedUndoPlanOf(cur, row, stage) {
    const exact = producedFieldsOf(isobj(row) ? row.edge : null)
    if (isobj(exact.produced)) return { done: true, how: 'row', restore: exact }
    const p = isobj(cur) ? cur.produced : null
    const hs = isobj(cur) ? cur.producedHistory : null
    // 現行邊無產出鏈、列亦無:無須動
    if (!isobj(p) && !isarr(hs)) return { done: true, how: 'none', restore: null }
    const no = (why) => ({ done: false, how: 'none', why, restore: null })
    if (!isobj(p) || !isarr(hs) || hs.length === 0 || canon(hs[hs.length - 1]) !== canon(p)) return no(PRODUCED_UNDO_WHY.historyMismatch)
    if (p.stage !== stage) return no(PRODUCED_UNDO_WHY.stageMismatch)
    const t = Date.parse(p.at)
    const r = Date.parse(isobj(row) ? row.at : '')
    if (!Number.isFinite(t) || !Number.isFinite(r)) return no(PRODUCED_UNDO_WHY.atUnverifiable)
    if (t > r) return no(PRODUCED_UNDO_WHY.newerThanRow)
    const dropped = Number.isInteger(cur.producedHistoryDropped) && cur.producedHistoryDropped > 0 ? cur.producedHistoryDropped : 0
    if (hs.length >= 2) return { done: true, how: 'history', restore: { produced: structuredClone(hs[hs.length - 2]), producedHistory: structuredClone(hs.slice(0, -1)), producedHistoryDropped: dropped } }
    if (dropped > 0) return no(PRODUCED_UNDO_WHY.historyDropped)
    return { done: true, how: 'history', restore: {} }
}

/**
 * 由「被採用之裁決值」回找判定小組之該票(以參照比對:兩層判定與重評之判定回傳之票皆為各席票之裁決值本身;找不到再以型別與理由比對)
 *
 * @param {Array} votes 輸入票 [{ seat, provider, verdict }]
 * @param {*} verdict 輸入被採用之裁決值
 * @returns {Object|null} 回傳該票 { seat, provider, verdict };找不到回 null(呼叫端不寫產出鏈)
 * @example
 * let a = { verdict: 'change', type: '甲', reason: '理由一' }
 * let b = { verdict: 'change', type: '甲', reason: '理由二' }
 * let votes = [{ seat: 'first', provider: 'p1', verdict: a }, { seat: 'second', provider: 'p2', verdict: b }]
 * console.log(voteOfVerdict(votes, b).seat, voteOfVerdict(votes, { ...a }).provider, voteOfVerdict(votes, null))
 * // => second p1 null
 */
export function voteOfVerdict(votes, verdict) {
    const vs = (isarr(votes) ? votes : []).filter((v) => isobj(v) && isobj(v.verdict))
    if (!isobj(verdict)) return null
    return vs.find((v) => v.verdict === verdict) || vs.find((v) => v.verdict.type === verdict.type && v.verdict.reason === verdict.reason && v.verdict.verdict === verdict.verdict) || null
}

export default { PRODUCED_FIELD_KEYS, PRODUCED_UNDO_WHY, producedFieldsOf, withProducedRestored, producedUndoPlanOf, EDGE_PRODUCED_STAGES, PROPOSER_ROLE_OF_SEGMENT, createEdgeProvenance, stampEdge, voteOfVerdict }
