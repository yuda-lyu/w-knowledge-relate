// conflictEvents.mjs — 衝突關係之撤銷／降級事件帳:關聯寫入(撤出衝突邊、衝突降級為他型之當下),讀關聯之下游讀取
//   (如依「衝突已不成立」重審其產物)
//
// 【檔名只定義一次】寫者與讀者同取本檔之常數與讀法。
// 【帳驅動,不以讀不到推定】下游只依此帳之正面事件判定「衝突已不成立」——不以「先前見過之衝突減現行衝突邊」推定:
//   衝突型改名、domain 無衝突型、刪除筆記、懸空清理、開錯集合都會讓衝突邊「讀不到」。
// 【格式】append-only JSONL,每行 { id(事件 id), edgeId, from, to, kind:'retire'|'downgrade', oldType, newType(撤銷為 ''), reason, note(相關筆記), at }。
//   事件只增不刪。讀寫為抓取套件之 JSONL 共用件:缺檔＝無事件、壞行(半行)略過、讀取本身失敗即拋(不假裝成無事件)、append 先補尾換行。

import path from 'path'
import isestr from 'wsemi/src/isestr.mjs'
import { sha1, readJsonlRows, appendJsonlRow } from '../core/capturePackage.mjs'

/** 事件帳之檔名(dirs.state 下) */
export const CONFLICT_EVENT_FILE = 'relate-conflict-events.jsonl'

/**
 * 寫一筆事件(append;先於刪邊／改型寫入——中途被砍,多一筆未生效之事件無害:讀者另驗當下該邊仍非衝突)
 *
 * @param {String} stateDir 輸入 dirs.state
 * @param {Object} e 輸入 { edgeId, from, to, kind, oldType, newType, reason, note, at }
 * @returns {Object} 回傳寫入之事件(含 id)
 * @example
 * const fs = process.getBuiltinModule('fs')
 * const dir = fs.mkdtempSync('ex-')
 * const ev = appendConflictEvent(dir, { edgeId: 'e1', from: 'a', to: 'b', kind: 'retire', oldType: '衝突或反例', reason: '兩席判無知識關聯', at: '2026-10-05T10:00:00+08:00' })
 * console.log(ev.id, ev.kind, JSON.stringify(ev.newType), ev.at)
 * // => a3941e6d26286468 retire "" 2026-10-05T10:00:00+08:00
 * console.log(fs.readFileSync(`${dir}/${CONFLICT_EVENT_FILE}`, 'utf8').trim().split('\n').length)
 * // => 1
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export function appendConflictEvent(stateDir, e) {
    const ev = { id: sha1(`${e.edgeId}|${e.kind}|${e.at}`).slice(0, 16), edgeId: String(e.edgeId), from: String(e.from), to: String(e.to), kind: e.kind, oldType: String(e.oldType || ''), newType: String(e.newType || ''), reason: String(e.reason || '').slice(0, 200), note: String(e.note || ''), at: String(e.at || '') }
    appendJsonlRow(path.join(stateDir, CONFLICT_EVENT_FILE), ev)
    return ev
}

/**
 * 讀全部事件(缺檔＝無事件;壞行與形狀不合之列略過;讀取失敗拋)
 *
 * @param {String} stateDir 輸入 dirs.state
 * @returns {Array} 回傳事件陣列(依寫入序)
 * @throws {Error} 讀取本身失敗(非缺檔)時拋出
 * @example
 * const fs = process.getBuiltinModule('fs')
 * const dir = fs.mkdtempSync('ex-')
 * console.log(readConflictEvents(dir))
 * // => []
 *
 * appendConflictEvent(dir, { edgeId: 'e1', from: 'a', to: 'b', kind: 'retire', oldType: '衝突或反例', at: '2026-10-05T10:00:00+08:00' })
 * appendConflictEvent(dir, { edgeId: 'e2', from: 'a', to: 'c', kind: 'downgrade', oldType: '衝突或反例', newType: '互補搭配', at: '2026-10-06T10:00:00+08:00' })
 * fs.appendFileSync(`${dir}/${CONFLICT_EVENT_FILE}`, '{半行')
 * console.log(readConflictEvents(dir).map((e) => `${e.edgeId} ${e.kind}`))
 * // => [ 'e1 retire', 'e2 downgrade' ]
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export function readConflictEvents(stateDir) {
    return readJsonlRows(path.join(stateDir, CONFLICT_EVENT_FILE)).filter((e) => isestr(e?.edgeId) && isestr(e?.from) && isestr(e?.to) && ['retire', 'downgrade'].includes(e?.kind))
}

export default { CONFLICT_EVENT_FILE, appendConflictEvent, readConflictEvents }
