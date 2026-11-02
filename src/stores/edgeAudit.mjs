// edgeAudit.mjs — 關聯邊之撤出稽核帳(append-only JSONL)之檔名、讀法與「被撤出之邊」之判定:撤出(stores/edgeRetire;先記再刪)與還原
//   (ops/noteOps 之 restoreEdge)寫入;還原與讀關聯變更之下游讀之(撤銷之正面證據——不以讀不到推定)
//
// 【格式】每行 { at, reason, note?, detail?, edge(撤出前之邊值) };還原另記 { reason:'restored', restoredFrom, edge }。
// 【讀法】JSONL 之讀寫為抓取套件之共用件(缺檔＝空、壞行略過〔append 中途被砍之半行〕、讀取本身失敗即拋——寫入大概率同樣失敗,不假裝成功)。
// 【被撤出之邊】以每條邊之最後一筆為準:最後一筆為撤出(任何理由)者在撤出中,其後又還原者不算(retiredEdgesOf;還原與下游同一判定)。

import path from 'path'
import isarr from 'wsemi/src/isarr.mjs'
import { readJsonlRows } from '../core/capturePackage.mjs'

/** 撤出稽核帳之檔名(dirs.state 下) */
export const EDGE_AUDIT_FILE = 'relate-retired.jsonl'

/**
 * 讀撤出稽核帳
 *
 * @param {String} stateDir 輸入 dirs.state
 * @returns {Array} 回傳依寫入序之紀錄
 * @example
 * const fs = process.getBuiltinModule('fs')
 * const dir = fs.mkdtempSync('ex-')
 * console.log(readEdgeAudit(dir))
 * // => []
 *
 * const rows = [{ at: 'T1', reason: 'std-retire', edge: { id: 'e1' } }, { at: 'T2', reason: 'restored', edge: { id: 'e1' } }]
 * fs.writeFileSync(`${dir}/${EDGE_AUDIT_FILE}`, [...rows.map((r) => JSON.stringify(r)), '{半行'].join('\n'))
 * console.log(readEdgeAudit(dir).map((r) => `${r.at} ${r.reason}`))
 * // => [ 'T1 std-retire', 'T2 restored' ]
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export function readEdgeAudit(stateDir) {
    return readJsonlRows(path.join(stateDir, EDGE_AUDIT_FILE))
}

/**
 * 目前在撤出中之邊:依寫入序,每條邊之最後一筆為撤出者(任何理由)取該筆;最後一筆為還原(reason 'restored')者不在其列
 *
 * @param {Array} rows 輸入稽核帳之列(依寫入序;非陣列視為 [])
 * @returns {Map} 回傳 邊 id → 最後一筆撤出列
 * @example
 * let rows = [{ reason: 'std-retire', edge: { id: 'e1' } }, { reason: 'reeval-retire', edge: { id: 'e2' } }, { reason: 'restored', edge: { id: 'e2' } }]
 * console.log([...retiredEdgesOf(rows).keys()])
 * // => [ 'e1' ]
 */
export function retiredEdgesOf(rows) {
    const out = new Map()
    for (const r of isarr(rows) ? rows : []) {
        const id = typeof r?.edge?.id === 'string' ? r.edge.id : ''
        if (!id) continue
        if (r.reason === 'restored') out.delete(id)
        else out.set(id, r)
    }
    return out
}

export default { EDGE_AUDIT_FILE, readEdgeAudit, retiredEdgesOf }
