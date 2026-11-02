// rotationPolicy.mjs — 檢定標準 RS10(候選涵蓋之召回:舊×舊公平輪巡、進度可查)之純函數:一篇之輪巡頁、輪巡佇列
//   ——候選之完整性(從未比較之對)屬召回、非納入標準,故以公平輪巡(配額、進度可查)補,不以閘門擋
//
// 【缺口】正向評估只看前 K 名候選(candidateScoreOf:共享概念鍵×10＋同類別);反向段補「新筆記進入舊筆記之前 K 名」者。兩篇皆為舊筆記、
//   且在彼此評估時皆排在第 K 名之後者,從未被比較過——共享概念鍵越多之樞紐概念,漏比越多。
// 【輪巡】對已完成正向評估之舊筆記,依其與共享鍵之他篇之分數降冪(同分依建立時刻舊到新、再依 id;新筆記排在同分者之後——插入只使
//   其後者往後移,不致跳過),一頁 K 篇逐頁往後比對(頁 0＝正向評估時之前 K 名,輪巡自頁 1 起);頁內之既有鄰居(任何型別)不重送,
//   全為鄰居之頁直接跳過;取盡 → 用盡(done)。游標記於筆記記錄 relateRotation { page:下一次之頁, at:上次輪巡時刻, total, done }。
//   刪除筆記或概念重標使排名前移時,少數對可能跳過(已知限制)。
// 【公平】佇列依上次輪巡時刻舊到新(從未輪巡者最先)、建立時刻舊到新;失敗者只更新時刻(排隊尾)、不前進頁。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { strOf, cmp } from '../core/capturePackage.mjs'
import { isRelated } from './relatedNotes.mjs'

/** 游標之重置值(內容變更之重判 → 輪巡自頁 1 重來;從未輪巡者無游標、失敗者以此為底只更新時刻) */
export const ROTATION_RESET = Object.freeze({ page: 1, at: '', total: 0, done: false })

/**
 * 游標之形狀只一份(筆記記錄 relateRotation { page:下一次之頁, at:上次輪巡時刻, total, done }):該頁已比對 → 前進(取盡即用盡);本次無候選 → 用盡
 *
 * @param {Object} pg 輸入 rotationPageOf 之產物(取 next、total)
 * @param {Object} o 輸入 { at:時刻, K:每頁篇數(預設 1), done:Boolean(true＝用盡;未給依 next×K ≥ total 判) }
 * @returns {Object} 回傳游標
 * @example
 * console.log(rotationCursorOf({ next: 2, total: 9 }, { at: 'T', K: 5 }), rotationCursorOf({ next: 3, total: 9 }, { at: 'T', done: true }).done)
 * // => { page: 2, at: 'T', total: 9, done: true } true
 */
export function rotationCursorOf(pg, o = {}) {
    const K = Math.max(1, Number(o.K) || 1)
    const next = Number(pg?.next) || 1
    const total = Number(pg?.total) || 0
    return { page: next, at: strOf(o.at), total, done: o.done === true || next * K >= total }
}

/**
 * 失敗或未涵蓋之游標:只更新時刻(排隊尾)、不前進頁(從未輪巡者以重置值為底)
 *
 * @param {Object|undefined} cur 輸入現有游標
 * @param {String} at 輸入時刻
 * @returns {Object} 回傳游標
 * @example
 * console.log(rotationBumpOf({ page: 3, at: 'T0', total: 9, done: false }, 'T1'), rotationBumpOf(undefined, 'T1'))
 * // => { page: 3, at: 'T1', total: 9, done: false } { page: 1, at: 'T1', total: 0, done: false }
 */
export function rotationBumpOf(cur, at) {
    return { ...ROTATION_RESET, ...(isobj(cur) ? cur : {}), at: strOf(at) }
}

/**
 * 一篇之輪巡頁
 *
 * @param {Object} note 輸入筆記記錄
 * @param {Object} o 輸入 { scoresFor:(id)=>Map(他篇 id → 分數;只含共享鍵者), byId:Map, K:Integer, page:Integer(要取之頁,預設 1),
 *   isNeighbor:(a, b)=>Boolean(既有邊) }
 * @returns {Object} 回傳 { candidates:Array(筆記記錄), page(實際取之頁), next(下一次之頁), total(共享鍵之他篇數), done:Boolean(已用盡、本次無候選) }
 * @example
 * const notes = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id, i) => ({ id, createdAt: `T${i}` }))
 * const byId = new Map(notes.map((x) => [x.id, x]))
 * const scores = new Map([['n2', 30], ['n3', 20], ['n4', 20], ['n5', 10]])
 * const pg = rotationPageOf(notes[0], { scoresFor: () => scores, byId, K: 2 })
 * console.log(pg.candidates.map((x) => x.id), pg.page, pg.next, pg.total, pg.done)
 * // => [ 'n4', 'n5' ] 1 2 4 false
 * console.log(rotationPageOf(notes[0], { scoresFor: () => scores, byId, K: 2, page: pg.next }))
 * // => { candidates: [], page: 2, next: 2, total: 4, done: true }
 */
export function rotationPageOf(note, o = {}) {
    const K = Math.max(1, Number(o.K) || 1)
    const byId = o.byId instanceof Map ? o.byId : new Map()
    const isNeighbor = typeof o.isNeighbor === 'function' ? o.isNeighbor : () => false
    const ranked = [...(typeof o.scoresFor === 'function' ? o.scoresFor(note.id) : new Map()).entries()]
        .filter(([id]) => id !== note.id && byId.has(id))
        .sort((a, b) => b[1] - a[1] || cmp(strOf(byId.get(a[0]).createdAt), strOf(byId.get(b[0]).createdAt)) || cmp(a[0], b[0]))
        .map(([id]) => byId.get(id))
    const total = ranked.length
    let page = Number.isInteger(o.page) && o.page >= 1 ? o.page : 1
    while (page * K < total) {
        const cands = ranked.slice(page * K, (page + 1) * K).filter((c) => !isNeighbor(note.id, c.id))
        if (cands.length) return { candidates: cands, page, next: page + 1, total, done: false }
        page++
    }
    return { candidates: [], page, next: page, total, done: true }
}

/**
 * 輪巡佇列:已完成正向評估、不在正向池、未用盡者;依上次輪巡時刻舊到新(從未輪巡者最先)、建立時刻舊到新、id
 *
 * @param {Array} notes 輸入筆記記錄
 * @param {Object} [o={}] 輸入 { inPool:(note)=>Boolean(正向池;不輪巡) }
 * @returns {Array} 回傳排序後之筆記記錄
 * @example
 * const notes = [
 *     { id: 'a', relatedAt: 'T', createdAt: 'T2', relateRotation: { at: 'R2', done: false } },
 *     { id: 'b', relatedAt: 'T', createdAt: 'T1' },
 *     { id: 'c', relatedAt: 'T', createdAt: 'T3', relateRotation: { at: 'R1', done: false } },
 *     { id: 'd', relatedAt: 'T', createdAt: 'T4', relateRotation: { at: 'R0', done: true } },
 *     { id: 'e', relatedAt: '', createdAt: 'T0' },
 *     { id: 'f', relatedAt: 'T', createdAt: 'T5' },
 * ]
 * console.log(rotationQueueOf(notes, { inPool: (x) => x.id === 'f' }).map((x) => x.id))
 * // => [ 'b', 'c', 'a' ]
 */
export function rotationQueueOf(notes, o = {}) {
    const inPool = typeof o.inPool === 'function' ? o.inPool : () => false
    return (isarr(notes) ? notes : [])
        .filter((n) => isRelated(n) && !inPool(n) && n.relateRotation?.done !== true)
        .sort((a, b) => cmp(strOf(a.relateRotation?.at), strOf(b.relateRotation?.at)) || cmp(strOf(a.createdAt), strOf(b.createdAt)) || cmp(strOf(a.id), strOf(b.id)))
}

/**
 * 輪巡進度:已用盡之篇數／已完成正向評估之篇數
 *
 * @param {Array} notes 輸入筆記記錄
 * @returns {Object} 回傳 { done, total }
 * @example
 * const notes = [{ relatedAt: 'T', relateRotation: { done: true } }, { relatedAt: 'T' }, { relatedAt: '' }]
 * console.log(rotationProgressOf(notes))
 * // => { done: 1, total: 2 }
 */
export function rotationProgressOf(notes) {
    const list = (isarr(notes) ? notes : []).filter(isRelated)
    return { done: list.filter((n) => n.relateRotation?.done === true).length, total: list.length }
}

export default { ROTATION_RESET, rotationCursorOf, rotationBumpOf, rotationPageOf, rotationQueueOf, rotationProgressOf }
