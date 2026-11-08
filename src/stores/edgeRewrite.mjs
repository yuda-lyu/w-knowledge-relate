// edgeRewrite.mjs — 關聯邊之改寫(單一實作;與撤出之 edgeRetire 同層):重評、既有邊覆核、衝突核對之改寫與降級一律經此
//
// 【順序固定】兩端(現存者)記待投影＋總覽待重建(ledgers.touch)→ 衝突降級先寫事件帳(stores/conflictEvents;下游據以判「衝突已不成立」)→
//   reviseEdge(現值＝已過閘之裁決提案,舊現值入 history)→ 寫 → 鄰接表。中途被砍:多記之 dirty／事件無害(事件之效力由讀者以「邊當下仍非衝突」
//   覆核);反之先寫後記則兩端永不重投、總覽不重建。
// 【降級事件之判準一份】改寫前之型別屬衝突型(現名與舊名)而提案不屬 → kind:'downgrade';各段不自判(衝突型之舊名亦算,既有邊覆核之降級同寫事件)。

import isobj from 'wsemi/src/isobj.mjs'
import { appendConflictEvent } from './conflictEvents.mjs'
import { reviseEdge, writeEdge, addToAdjacency } from './edgeStore.mjs'
import { stampEdge, withProducedRestored } from './edgeProvenance.mjs'

/**
 * 改寫一條邊
 *
 * @param {Object} deps 輸入 { relations(寫邊), ledgers(openRelateLedgers 之產物), stateDir(dirs.state) }
 * @param {Object} cur 輸入庫內之邊(改寫前之現值;呼叫端於互斥內回讀比對、陳舊不套)
 * @param {Object} proposal 輸入已過閘之裁決提案(makeEdge 之形＋reasonCut?)
 * @param {Object} o 輸入 { rank:(type)=>Number, at:時刻, conflictTypes?:Array(衝突型現名與舊名), hasNote?:(id)=>Boolean(記待投影之端點篩選), adj?:Map(鄰接表), note?:相關筆記 id(事件帳),
 *   produced?:Object(本次之產出者,stores/edgeProvenance 之 make 之產物;每次改寫追加一筆產出鏈,未給即不寫),
 *   restoreProduced?:Object({ produced?, producedHistory?, producedHistoryDropped? }:撤回時產出鏈三欄換成之值,{}＝移除;給了即不追加 produced——撤銷該次改寫所留之產出鏈) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { edge(寫入之新值), conflictEvent:Boolean(寫了降級事件) }
 * @example
 * const fs = process.getBuiltinModule('fs')
 * const dir = fs.mkdtempSync('ex-')
 * const ledgers = openRelateLedgers(dir)
 * const m = new Map()
 * const relations = { get: async (id) => m.get(id) ?? null, patch: async (id, v) => { m.set(id, { ...m.get(id), ...v }) }, replace: async (r) => { m.set(r.id, r) } }
 * const cur = makeEdge({ from: 'a', to: 'b', type: '衝突或反例', reason: '甲說有效；乙說無效', nowIso: 'T1' })
 * m.set(cur.id, cur)
 * const proposal = makeEdge({ from: 'a', to: 'b', type: '互補搭配', reason: '兩者各補足對方缺少之條件', nowIso: 'T2' })
 * const rank = typeRankOf({ relationTypes: ['互補搭配', '衝突或反例'], conflictType: '衝突或反例' })
 * const r = await rewriteEdge({ relations, ledgers, stateDir: dir }, cur, proposal, { rank, at: 'T2', conflictTypes: ['衝突或反例'] })
 * console.log(r.edge.type, r.edge.reason, r.edge.updatedAt, r.edge.history.map((h) => h.type), r.conflictEvent)
 * // => 互補搭配 兩者各補足對方缺少之條件 T2 [ '衝突或反例' ] true
 * console.log((await relations.get(cur.id)).type, readConflictEvents(dir).map((e) => `${e.kind} ${e.oldType}->${e.newType}`), ledgers.dirty.ids())
 * // => 互補搭配 [ 'downgrade 衝突或反例->互補搭配' ] [ 'a', 'b' ]
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export async function rewriteEdge(deps, cur, proposal, o = {}) {
    const { relations, ledgers, stateDir } = deps
    ledgers.touch([cur.from, cur.to], { has: o.hasNote })
    const types = Array.isArray(o.conflictTypes) ? o.conflictTypes : []
    const downgrade = types.includes(cur.type) && !types.includes(proposal.type)
    if (downgrade) appendConflictEvent(stateDir, { edgeId: cur.id, from: cur.from, to: cur.to, kind: 'downgrade', oldType: cur.type, newType: proposal.type, reason: proposal.reason, note: o.note || '', at: o.at })
    // 產出鏈(stores/edgeProvenance):每次改寫追加一筆(o.produced 未給即不寫產出鏈);撤回(revertEdgeRevision)改給 o.restoreProduced——三欄換成給定之值
    //   (撤銷該次改寫所留之產出鏈,不追加;{}＝移除三欄),優先於 o.produced
    const revised = reviseEdge(cur, proposal, { rank: o.rank })
    const next = isobj(o.restoreProduced) ? withProducedRestored(revised, o.restoreProduced) : stampEdge(revised, cur, o.produced)
    await writeEdge(relations, next)
    if (o.adj instanceof Map) addToAdjacency(o.adj, next)
    return { edge: next, conflictEvent: downgrade }
}

export default { rewriteEdge }
