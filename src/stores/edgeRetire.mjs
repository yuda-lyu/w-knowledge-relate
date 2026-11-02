// edgeRetire.mjs — 關聯邊之撤出(單一實作):墓碑驅動清理、明示刪除筆記、懸空清理、重評撤銷、標準撤出、衝突核對與既有邊覆核之撤出／隔離
//   一律經此「稽核 → 刪 → 回驗」
//
// 【順序固定】兩端(現存者)記待投影＋總覽待重建(ledgers.touch;改寫之 edgeRewrite 同一件)→ 衝突型先寫事件帳(stores/conflictEvents;下游據以判「衝突已不成立」)→
//   稽核(relate-retired.jsonl,含理由;先記再刪)→ 刪 → 回驗(仍在即拋錯)→ 鄰接表、反向待處理對同步。
//   中途被砍:多記之 dirty／事件／稽核無害(事件之效力由讀者以「邊當下仍非衝突」覆核);反之先刪後記則撤出不可追溯、兩端永不重投。
// 【理由(封閉清單)】note-deleted(明示刪除筆記;撤銷刪除 undoDeleteNote 或還原筆記 restoreNote 時一併放回)、prune-dangling(懸空清理)、
//   reeval-retire(重評兩席一致撤銷)、std-retire(存量未達檢定標準之處置)、rs4-retire(衝突核對兩席一致判無知識關聯)、rs4-quarantine(衝突核對
//   未能判定之隔離;待使用者判讀)、rs6-retire(既有邊覆核兩席一致判無知識關聯)、rs6-quarantine(既有邊覆核未能判定之隔離;待使用者判讀)。
//   RESTORABLE_REASONS 可由 restoreEdge 依稽核還原(還原前須再過納入閘;note-deleted 須兩端皆在——還原筆記時未過納入閘或對方當時不在之邊之補救)。
// 【稽核亦記還原】restoreEdge、restoreNote、undoDeleteNote 放回後追加 { reason:'restored', restoredFrom, edge, … }(撤出與還原同一份紀錄,
//   依寫入序可追溯;最後一筆為撤出者即「在撤出中」——stores/edgeAudit 之 retiredEdgesOf)。

import { appendConflictEvent } from '../stores/conflictEvents.mjs'
import { appendAudit } from './relateLedgers.mjs'
import { removeFromAdjacency } from './edgeStore.mjs'

/** 撤出理由(封閉清單) */
export const RETIRE_REASONS = ['note-deleted', 'prune-dangling', 'reeval-retire', 'std-retire', 'rs4-retire', 'rs4-quarantine', 'rs6-retire', 'rs6-quarantine']
/** 可由 restoreEdge 依稽核還原之撤出理由(note-deleted 另須兩端皆在;檔頭【理由】) */
export const RESTORABLE_REASONS = ['note-deleted', 'prune-dangling', 'reeval-retire', 'std-retire', 'rs4-retire', 'rs4-quarantine', 'rs6-retire', 'rs6-quarantine']

/**
 * 撤出一條邊
 *
 * @param {Object} deps 輸入 { relations(get／del), ledgers(openRelateLedgers 之產物), stateDir(dirs.state) }
 * @param {Object} edge 輸入庫內之邊(撤出前之值;原樣記入稽核,供還原)
 * @param {Object} o 輸入 { reason:RETIRE_REASONS 之一, at:時刻, note?:相關筆記 id, detail?:說明(事件帳與稽核),
 *        conflictTypes?:Array(衝突型現名與舊名;邊屬之即寫事件帳), hasNote?:(id)=>Boolean(記待投影之端點篩選), adj?:Map(鄰接表), extra?:Object(稽核附帶欄) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { conflictEvent:Boolean }
 * @throws {Error} 理由不在清單、刪除後回驗仍在時拋出
 * @example
 * const fs = process.getBuiltinModule('fs')
 * const dir = fs.mkdtempSync('ex-')
 * const ledgers = openRelateLedgers(dir)
 * const m = new Map()
 * const relations = { get: async (id) => m.get(id) ?? null, del: async (id) => { m.delete(id) } }
 * const edge = makeEdge({ from: 'a', to: 'b', type: '衝突或反例', reason: '甲說有效；乙說無效', nowIso: 'T1' })
 * m.set(edge.id, edge)
 * const r = await retireEdge({ relations, ledgers, stateDir: dir }, edge, { reason: 'rs4-retire', at: 'T2', conflictTypes: ['衝突或反例'] })
 * console.log(r, m.size, ledgers.dirty.ids())
 * // => { conflictEvent: true } 0 [ 'a', 'b' ]
 * console.log(readEdgeAudit(dir).map((x) => x.reason), readConflictEvents(dir).map((x) => x.kind))
 * // => [ 'rs4-retire' ] [ 'retire' ]
 *
 * await retireEdge({ relations, ledgers, stateDir: dir }, edge, { reason: 'x', at: 'T3' }).catch((e) => console.log(e.message.slice(0, 21)))
 * // => retireEdge 之理由「x」不在清單
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export async function retireEdge(deps, edge, o = {}) {
    if (!RETIRE_REASONS.includes(o.reason)) throw new Error(`retireEdge 之理由「${o.reason}」不在清單（${RETIRE_REASONS.join('、')}）`)
    const { relations, ledgers, stateDir } = deps
    ledgers.touch([edge.from, edge.to], { has: o.hasNote })
    const conflict = Array.isArray(o.conflictTypes) && o.conflictTypes.includes(edge.type)
    if (conflict) appendConflictEvent(stateDir, { edgeId: edge.id, from: edge.from, to: edge.to, kind: 'retire', oldType: edge.type, newType: '', reason: o.detail || o.reason, note: o.note || '', at: o.at })
    appendAudit(ledgers.files.retired, { at: o.at, reason: o.reason, ...(o.note ? { note: o.note } : {}), ...(o.detail ? { detail: o.detail } : {}), ...(o.extra || {}), edge })
    await relations.del(edge.id)
    if (await relations.get(edge.id)) throw new Error(`關聯邊 ${edge.id} 撤出後回驗仍在`)
    if (o.adj instanceof Map) removeFromAdjacency(o.adj, edge)
    ledgers.reverse.remove((p) => (p.o === edge.from && p.n === edge.to) || (p.o === edge.to && p.n === edge.from))
    return { conflictEvent: conflict }
}

export default { RETIRE_REASONS, RESTORABLE_REASONS, retireEdge }
