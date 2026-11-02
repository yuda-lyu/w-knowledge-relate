// checks.mjs — 檢核紀錄(AI 標準之逐物件結果)
//
// 【為何要記】確定性標準每輪全量重掃(便宜、結果只依內容);AI 標準每次判定要花額度且非決定性,須記下「這個物件的這個內容版本,
//   已被哪條標準的哪一版、哪些席位判過、結果為何」——內容雜湊或標準版本變了才重檢(needsCheck),不重複燒額度,也不漏判變更後之內容。
// 【鍵】`<物件>:<id>`(checkKey);{ id, object, oid, hash(受檢內容雜湊), results:{ <標準>: { v, at, status, seats, reason } } }。
//   內容雜湊變了 → 全部結果作廢(以新雜湊重建);只換標準版本 → 該標準須重檢,其餘結果保留。
// 【狀態】status 沿用 core/standards/verdict.STATUS(pass／violation／undetermined／na／waived);seats 為「供應者|供應者」字串。
// 【AI 標準列】符合度掃描之 AI 標準列(aiStandardRowOf):以檢核紀錄計已檢、四態、版本過時(紀錄之 v ≠ 現版),以待判登錄計未結與已豁免——
//   紀錄之形狀只在本檔,計法亦只此一份(各工作之掃描同用;下游經其埠取用);來源集合未給者其欄為 null(無從計,不報為零),皆未給者列為 null。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { STATUS, strOf } from '../capturePackage.mjs'

/** 檢核紀錄之結果依此四態計數(其餘值只計已檢) */
export const CHECK_STATES = Object.freeze([STATUS.PASS, STATUS.VIOLATION, STATUS.UNDETERMINED, STATUS.NA])

/**
 * 檢核紀錄之鍵
 *
 * @param {String} object 輸入物件種類
 * @param {String} oid 輸入物件 id
 * @returns {String} 回傳 `<物件>:<id>`
 * @example
 * console.log(checkKey('edge', 'e1'))
 * // => edge:e1
 */
export function checkKey(object, oid) {
    return `${strOf(object)}:${strOf(oid)}`
}

/**
 * 是否須(重)檢:無紀錄、內容雜湊不同、無該標準之結果、或標準版本不同
 *
 * @param {Object|null} rec 輸入檢核紀錄
 * @param {Object} o 輸入 { hash, std, v }
 * @returns {Boolean} 回傳是否須檢
 * @example
 * let rec = { hash: 'h1', results: { RS4: { v: 1 } } }
 * console.log(needsCheck(rec, { hash: 'h1', std: 'RS4', v: 1 }), needsCheck(rec, { hash: 'h2', std: 'RS4', v: 1 }), needsCheck(rec, { hash: 'h1', std: 'RS4', v: 2 }), needsCheck(null, { hash: 'h1', std: 'RS4', v: 1 }))
 * // => false true true true
 */
export function needsCheck(rec, o = {}) {
    if (!isobj(rec) || rec.hash !== strOf(o.hash)) return true
    const r = rec.results?.[o.std]
    return !isobj(r) || Number(r.v) !== Number(o.v)
}

/**
 * 記一筆檢核結果(內容雜湊變了即重建紀錄)
 *
 * @param {Object} store 輸入 checks 集合(需 get／replace)
 * @param {Object} c 輸入 { object, oid, hash, std, v, at, status, seats?, reason? }
 * @returns {Promise} 回傳 Promise，resolve 回傳寫入後之紀錄
 * @throws {Error} 集合缺方法、欄位不全或狀態不在 STATUS 時拋出
 * @example
 * let rows = new Map()
 * let store = { get: async (id) => rows.get(id) || null, replace: async (r) => rows.set(r.id, r) }
 * let at = '2026-11-02T00:00:00+08:00'
 * await recordCheck(store, { object: 'edge', oid: 'e1', hash: 'h1', std: 'RS4', v: 1, at, status: 'pass', seats: 'a|b', reason: '兩席皆判成立' })
 * let rec = await recordCheck(store, { object: 'edge', oid: 'e1', hash: 'h1', std: 'RS6', v: 2, at, status: 'violation' })
 * console.log(rec.id, Object.keys(rec.results), rec.results.RS4.seats, rec.results.RS6.v, rows.size)
 * let rec2 = await recordCheck(store, { object: 'edge', oid: 'e1', hash: 'h2', std: 'RS6', v: 2, at, status: 'pass' })
 * console.log(Object.keys(rec2.results), needsCheck(rec2, { hash: 'h2', std: 'RS6', v: 2 }))
 * // => edge:e1 [ 'RS4', 'RS6' ] a|b 2 1
 * // => [ 'RS6' ] false
 */
export async function recordCheck(store, c) {
    if (!isfun(store?.get) || !isfun(store?.replace)) throw new Error('檢核紀錄需要 checks 集合(具 get／replace 方法)')
    if (!isobj(c) || !isestr(c.object) || !isestr(c.oid) || !isestr(c.std) || !isestr(c.hash)) throw new Error('recordCheck 需要 object、oid、std、hash')
    if (!Object.values(STATUS).includes(c.status)) throw new Error(`recordCheck 之狀態「${c.status}」不在 ${Object.values(STATUS).join('／')}`)
    const id = checkKey(c.object, c.oid)
    const cur = await store.get(id)
    const base = isobj(cur) && cur.hash === c.hash ? cur : { id, object: c.object, oid: c.oid, hash: c.hash, results: {} }
    const rec = { ...base, results: { ...(base.results || {}), [c.std]: { v: Number(c.v) || 0, at: strOf(c.at), status: c.status, seats: strOf(c.seats), reason: strOf(c.reason) } } }
    await store.replace(rec)
    return rec
}

/**
 * 符合度掃描之 AI 標準列(檔頭【AI 標準列】):檢核紀錄之已檢、四態、版本過時;待判登錄之未結與已豁免
 *
 * @param {Object} s 輸入標準登記列 { id, title, kind, v, object }
 * @param {Object} o 輸入 { module:String(工作名), checkRows:Array|null(檢核紀錄;未給或不適用者 null), holds:Array|null(待判登錄;未給者 null) }
 * @returns {Object|null} 回傳 { id, title, kind, v, module, object, checked, pass, violation, undetermined, na, stale, holdsOpen, holdsWaived }
 *   (來源未給之欄為 null);兩來源皆未給回 null
 * @example
 * let row = aiStandardRowOf({ id: 'X1', title: 't', kind: 'ai', v: 2, object: 'edge' }, { module: 'relate', checkRows: [{ results: { X1: { status: 'pass', v: 1 } } }], holds: null })
 * console.log(row.checked, row.pass, row.stale, row.holdsOpen)
 * // => 1 1 1 null
 */
export function aiStandardRowOf(s, o = {}) {
    const checkRows = isarr(o?.checkRows) ? o.checkRows : null
    const holds = isarr(o?.holds) ? o.holds : null
    if (!checkRows && !holds) return null
    const row = { id: s.id, title: s.title, kind: s.kind, v: s.v, module: strOf(o.module), object: s.object, checked: null, pass: null, violation: null, undetermined: null, na: null, stale: null, holdsOpen: null, holdsWaived: null }
    if (checkRows) {
        Object.assign(row, { checked: 0, pass: 0, violation: 0, undetermined: 0, na: 0, stale: 0 })
        for (const r of checkRows) {
            const res = isobj(r?.results) ? r.results : {}
            if (!Object.hasOwn(res, s.id)) continue
            const x = res[s.id]
            row.checked++
            if (CHECK_STATES.includes(x?.status)) row[x.status]++
            if (Number(x?.v) !== Number(s.v)) row.stale++
        }
    }
    if (holds) {
        const mine = holds.filter((h) => h?.std === s.id)
        row.holdsOpen = mine.filter((h) => h.status === 'open').length
        row.holdsWaived = mine.filter((h) => h.status === 'waived').length
    }
    return row
}

export default { CHECK_STATES, checkKey, needsCheck, recordCheck, aiStandardRowOf }
