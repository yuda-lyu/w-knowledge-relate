// provenanceOps.mjs — 依邊之產出鏈選件之維運件(純讀;跨套件規格〈知識套件之產出鏈〉§6)
//
// 【用途】「該輪／該供應者／該時段產生之邊」成批列出,供使用端驅動:選件 → 撤出(走既有稽核撤出路徑 stores/edgeRetire 之 retireEdge,理由記
//   'reprocess' 等)→ 兩端重投、重關聯。本件只讀邊記錄之 produced／producedHistory,不新增任何寫入路徑;舊邊(無 produced)不回填、不出現。
// 【條件皆為「且」】stamp、stage、provider、seat 全等;since／until 比對 produced.at(含端點、依時刻先後,不依字串);只比對 produced(最後一筆);
//   history:true 時改比對 producedHistory,同一筆須同時滿足全部條件(「某輪某供應者寫過」之意,不是各條件各自在不同筆中出現)。
// 【條件之檢測】給了而無效者拒收(報錯),不改用預設(與一般 opt 之 K3 不同):篩選條件一旦被當成未給,結果會放寬成「全部有產出鏈之邊」,而選件之後
//   接的是撤出。未知之鍵亦拒收(誤拼之條件靜默忽略同樣會放寬)。stamp、seat、provider 可給 null——選「輪次外之寫入」與「無 AI 呼叫之寫入」。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'

/** edgesByProvenance 之查詢鍵(白名單) */
export const PROVENANCE_QUERY_KEYS = Object.freeze(['stamp', 'stage', 'provider', 'seat', 'since', 'until', 'history'])

const STAMP_RE = /^\d{14}$/
const STAGE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

/**
 * 檢核查詢條件並正規化(新物件;不改輸入)
 *
 * @param {*} q 輸入查詢條件(undefined、null 視為 {})
 * @returns {Object} 回傳 { stamp?, stage?, provider?, seat?, since?:毫秒, until?:毫秒, history:Boolean }(未給之條件不在物件內)
 * @throws {Error} q 非一般物件、含未知之鍵、任一條件給了而無效時拋出;訊息 `invalid <名稱>: must be <種類描述>`,不含輸入值
 */
function queryOf(q) {
    if (q === undefined || q === null) q = {}
    if (!isobj(q)) throw new Error('invalid query: must be a plain object')
    for (const k of Object.keys(q)) {
        if (!PROVENANCE_QUERY_KEYS.includes(k)) throw new Error(`invalid query.${k}: unknown key`)
    }
    const out = { history: false }
    if (q.stamp !== undefined) {
        if (q.stamp !== null && !(typeof q.stamp === 'string' && STAMP_RE.test(q.stamp))) throw new Error('invalid query.stamp: must be a 14-digit stamp string or null')
        out.stamp = q.stamp
    }
    if (q.stage !== undefined) {
        if (!(typeof q.stage === 'string' && STAGE_RE.test(q.stage))) throw new Error('invalid query.stage: must be a lowercase kebab-case name')
        out.stage = q.stage
    }
    for (const k of ['provider', 'seat']) {
        if (q[k] === undefined) continue
        if (q[k] !== null && !isestr(q[k])) throw new Error(`invalid query.${k}: must be a non-empty string or null`)
        out[k] = q[k]
    }
    for (const k of ['since', 'until']) {
        if (q[k] === undefined) continue
        const ms = typeof q[k] === 'string' && TIME_RE.test(q[k]) ? Date.parse(q[k]) : NaN
        if (!Number.isFinite(ms)) throw new Error(`invalid query.${k}: must be a time string YYYY-MM-DDTHH:mm:ss with Z or ±hh:mm`)
        out[k] = ms
    }
    if (out.since !== undefined && out.until !== undefined && out.since > out.until) throw new Error('invalid query.since: must not be later than query.until')
    if (q.history !== undefined) {
        if (typeof q.history !== 'boolean') throw new Error('invalid query.history: must be a boolean')
        out.history = q.history
    }
    return out
}

/**
 * 一筆產出者是否符合全部條件
 *
 * @param {*} p 輸入產出者
 * @param {Object} q 輸入 queryOf 之產物
 * @returns {Boolean} 回傳是否符合
 */
function matches(p, q) {
    if (!isobj(p)) return false
    for (const k of ['stamp', 'stage', 'provider', 'seat']) {
        if (q[k] !== undefined && p[k] !== q[k]) return false
    }
    if (q.since !== undefined || q.until !== undefined) {
        const at = typeof p.at === 'string' ? Date.parse(p.at) : NaN
        if (!Number.isFinite(at)) return false
        if (q.since !== undefined && at < q.since) return false
        if (q.until !== undefined && at > q.until) return false
    }
    return true
}

/**
 * 依邊之產出鏈選邊(純讀):回傳其產出者符合全部條件之邊;邊記錄無 produced 者(舊邊)不出現
 *
 * @param {Object} deps 輸入依賴物件，必給；{ stores:{ relations(select) } }(關聯邊集合)
 * @param {Object} [query={}] 輸入查詢條件(全部選填;皆為「且」;給了而無效者拒收,不改用預設——見檔頭【條件之檢測】)
 * @param {String|null} [query.stamp] 輸入輪次 stamp(14 位數字字串,對應該輪 run.json 之 stamp);null＝輪次外之寫入
 * @param {String} [query.stage] 輸入產出階段(小寫連字號名:relate、reverse、reeval、conflict-check、edge-review、standards-fix)
 * @param {String|null} [query.provider] 輸入實際成交條目(非空字串;null＝無 AI 呼叫之寫入)
 * @param {String|null} [query.seat] 輸入席位(非空字串,如 relate.ai、first、second、proposer;null＝無 AI 呼叫之寫入)
 * @param {String} [query.since] 輸入起(含;時間字串 YYYY-MM-DDTHH:mm:ss,須帶 Z 或 ±hh:mm,可帶毫秒),比對 produced.at
 * @param {String} [query.until] 輸入迄(含;格式同 since)
 * @param {Boolean} [query.history=false] 輸入 true 時改比對 producedHistory 之任一筆(同一筆須滿足全部條件)
 * @returns {Promise} 回傳 Promise，resolve 回傳 [{ edgeId, from, to, type, produced }](依 produced.at 先後、同刻依 edgeId;produced 為新物件:
 *   history 為 false 時為邊之 produced,true 時為符合條件之最近一筆〔不一定是邊目前之 produced〕);失敗為 reject(deps 無效、query 無效)
 * @throws {Error} 以 reject 呈現:deps 缺 stores.relations.select、query 非一般物件、含未知之鍵、或任一條件無效
 * @example
 * let edges = [
 *     { id: 'e1', from: 'a', to: 'b', type: '甲', reason: '理由', produced: { v: 1, stamp: '20261108100000', stage: 'relate', seat: 'relate.ai', provider: 'p1', pkg: 'w-demo@1.0.0', at: '2026-11-08T10:00:00+08:00' } },
 *     { id: 'e2', from: 'a', to: 'c', type: '乙', reason: '理由', produced: { v: 1, stamp: '20261108110000', stage: 'relate', seat: 'relate.ai', provider: 'p2', pkg: 'w-demo@1.0.0', at: '2026-11-08T11:00:00+08:00' } },
 *     { id: 'e3', from: 'b', to: 'c', type: '甲', reason: '舊邊無產出鏈' },
 * ]
 * let deps = { stores: { relations: { select: async () => edges } } }
 * let r = await edgesByProvenance(deps, { stamp: '20261108110000' })
 * console.log(r.map((x) => `${x.edgeId}:${x.produced.provider}`))
 * // => [ 'e2:p2' ]
 * console.log((await edgesByProvenance(deps, { stage: 'relate' })).map((x) => x.edgeId), (await edgesByProvenance(deps)).length)
 * // => [ 'e1', 'e2' ] 2
 * await edgesByProvenance(deps, { provder: 'p1' }).catch((e) => console.log(e.message))
 * // => invalid query.provder: unknown key
 */
export async function edgesByProvenance(deps, query = {}) {

    //check
    if (!isobj(deps) || !isobj(deps.stores) || !isfun(deps.stores.relations?.select)) throw new Error('invalid deps: must be an object with stores.relations (select)')
    const q = queryOf(query)

    const rows = []
    for (const e of await deps.stores.relations.select()) {
        if (!isobj(e) || !isobj(e.produced)) continue
        let hit = null
        if (q.history) {
            const hs = isarr(e.producedHistory) && e.producedHistory.length ? e.producedHistory : [e.produced]
            for (let i = hs.length - 1; i >= 0 && !hit; i--) if (matches(hs[i], q)) hit = hs[i]
        }
        else if (matches(e.produced, q)) hit = e.produced
        if (hit) rows.push({ edgeId: e.id, from: e.from, to: e.to, type: e.type, produced: structuredClone(hit) })
    }
    const atOf = (r) => Date.parse(r.produced.at)
    return rows.sort((a, b) => (atOf(a) - atOf(b)) || (a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0))
}

export default { PROVENANCE_QUERY_KEYS, edgesByProvenance }
