// reverseCandidates.mjs — 關聯反向段之資格計算:新筆記(或內容變更之筆記)n 加入後,哪些舊筆記 o「若現在重評,會把 n 排進前 K 名」;
//   以及候選分數之單一規則(candidateScoreOf:正向之候選挑選、反向之資格、輪巡之排名同讀)
//
// 【資格】score(o,n) ＞ kth(o) 且 ≥ 共享一個概念鍵之分數(MIN_SHARED_SCORE)、o 已完成正向評估且其時刻早於 n 之內容時刻(createdAt 或
//   knowledgeChangedAt;o 評估時 n 尚不存在或尚是舊內容,故從未判過這一對)、o 不在 n 之正向候選內(n 已判過)、兩者無邊、o 非 n 之衝突鄰居。
//   嚴格大於:舊筆記之第 K 名常是只共享 1 個樞紐概念之大量同分者,≥ 會讓所有共享該概念之新筆記以「較新」擠入——不是相關性,
//   且待處理對隨新筆記數放大。
// 【kth 與正向同一候選規則】kth(o)＝以 candidateScoreOf(共享正規化概念鍵×10＋同類別 1)、排除自身與 o 之衝突鄰居,第 K 名之分數;
//   共享鍵者不足 K 個時其餘名額由零共享者(分數 ≤1)補上,故 kth ≤ 1、任何共享一鍵以上者皆合格。
// 【成本】概念倒排索引一次建立;kth 每輪每個 o 快取。樞紐概念(數千篇)之 o 每次計算約百毫秒級,故只在反向段啟用時才建索引。

import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { isRelated } from './relatedNotes.mjs'

/**
 * 候選分數(單一規則):共享之正規化概念鍵數×10＋同類別 1——正向之候選挑選(pickCandidates)、反向之資格(kth)與輪巡之排名同讀此式
 *
 * @param {Integer} shared 輸入共享之正規化概念鍵數
 * @param {Boolean} sameCategory 輸入是否同類別
 * @returns {Number} 回傳分數
 * @example
 * console.log(candidateScoreOf(2, true), candidateScoreOf(0, false))
 * // => 21 0
 */
export function candidateScoreOf(shared, sameCategory) {
    return shared * 10 + (sameCategory ? 1 : 0)
}

/** 至少共享一個概念鍵之最低分(反向段之資格門檻;零共享者之分數 ≤1) */
const MIN_SHARED_SCORE = candidateScoreOf(1, false)

/**
 * 建立反向候選計算器
 *
 * @param {Array} notes 輸入全體筆記記錄(取 id、category、concepts、relatedAt、createdAt、knowledgeChangedAt)
 * @param {Object} o 輸入選項
 * @param {Function} o.keysOf 輸入 (note) => Set(正規化概念鍵;與正向同一函數)
 * @param {Integer} o.K 輸入候選數(relate.candidatesPerNote)
 * @param {Function} o.excludeOf 輸入 (id) => Set(該篇候選池之排除集合:衝突鄰居)
 * @returns {Object} 回傳 { scoresFor(id):Map(他篇 id → 分數,只含共享鍵者), kthOf(id):Number, pairsFor(n, ctx):Array<{o,n,score}> }
 * @example
 * const notes = [
 *     { id: 'old', category: 'c', concepts: ['x', 'y'], relatedAt: '2026-10-01', createdAt: '2026-10-01' },
 *     { id: 'p1', category: 'c', concepts: ['x'], relatedAt: '2026-10-01', createdAt: '2026-10-01' },
 *     { id: 'p2', category: 'c', concepts: ['y'], relatedAt: '2026-10-01', createdAt: '2026-10-01' },
 *     { id: 'n', category: 'c', concepts: ['x', 'y'], relatedAt: '', createdAt: '2026-10-05' },
 * ]
 * const idx = createReverseIndex(notes, { keysOf: (note) => new Set(note.concepts), K: 2 })
 * console.log(idx.scoresFor('n'), idx.kthOf('old'))
 * // => Map(3) { 'old' => 21, 'p1' => 11, 'p2' => 11 } 11
 * console.log(idx.pairsFor(notes[3], { forward: new Set(), hasEdge: () => false, conflictOf: () => new Set() }))
 * // => [ { o: 'old', n: 'n', score: 21 } ]
 */
export function createReverseIndex(notes, o) {
    const list = isarr(notes) ? notes : []
    const byId = new Map(list.map((x) => [x.id, x]))
    const keys = new Map(list.map((x) => [x.id, o.keysOf(x)]))
    const inv = new Map()
    for (const [id, ks] of keys) {
        for (const k of ks) {
            if (!inv.has(k)) inv.set(k, [])
            inv.get(k).push(id)
        }
    }
    const K = Math.max(1, Number(o.K) || 1)
    const excludeOf = isfun(o.excludeOf) ? o.excludeOf : () => new Set()
    const kthCache = new Map()

    /**
     * 與 id 共享至少一個鍵之各篇分數
     * @param {String} id 輸入筆記 id
     * @returns {Map} 回傳 他篇 id → 分數
     */
    const scoresFor = (id) => {
        const hits = new Map()
        for (const k of keys.get(id) || []) {
            for (const x of inv.get(k) || []) if (x !== id) hits.set(x, (hits.get(x) || 0) + 1)
        }
        const cat = byId.get(id)?.category
        const out = new Map()
        for (const [x, h] of hits) out.set(x, candidateScoreOf(h, byId.get(x)?.category === cat))
        return out
    }

    /**
     * o 之第 K 名分數(排除自身與 excludeOf(o));共享鍵者不足 K 個時回 1(其餘名額之分數 ≤1)
     * @param {String} id 輸入筆記 id
     * @returns {Number} 回傳分數
     */
    const kthOf = (id) => {
        if (kthCache.has(id)) return kthCache.get(id)
        const ex = excludeOf(id)
        const scores = []
        for (const [x, sc] of scoresFor(id)) if (!ex.has(x)) scores.push(sc)
        let kth = 1
        if (scores.length >= K) {
            scores.sort((a, b) => b - a)
            kth = scores[K - 1]
        }
        kthCache.set(id, kth)
        return kth
    }

    /**
     * 新筆記 n 之反向待處理對
     * @param {Object} n 輸入筆記記錄
     * @param {Object} c 輸入 { forward:Set(n 之正向候選 id), hasEdge:(a,b)=>Boolean, conflictOf:(id)=>Set(衝突鄰居) }
     * @returns {Array} 回傳 [{ o, n, score }](依分數降冪)
     */
    const pairsFor = (n, c) => {
        const contentAt = String(n.knowledgeChangedAt || n.createdAt || '')
        const forward = c.forward instanceof Set ? c.forward : new Set()
        const nConf = isfun(c.conflictOf) ? c.conflictOf(n.id) : new Set()
        const out = []
        for (const [oid, score] of scoresFor(n.id)) {
            if (score < MIN_SHARED_SCORE) continue
            const old = byId.get(oid)
            if (!isRelated(old) || !(String(old.relatedAt) < contentAt)) continue
            if (forward.has(oid) || nConf.has(oid) || (isfun(c.hasEdge) && c.hasEdge(oid, n.id))) continue
            if (score > kthOf(oid)) out.push({ o: oid, n: n.id, score })
        }
        return out.sort((a, b) => b.score - a.score || (a.o < b.o ? -1 : 1))
    }

    return { scoresFor, kthOf, pairsFor }
}

export default { candidateScoreOf, createReverseIndex }
