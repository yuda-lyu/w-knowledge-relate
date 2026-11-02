// candidates.mjs — 正向關聯之候選挑選(不花 AI 額度之機械篩選)與 slug 之抄寫容錯:概念比對鍵、依共享概念挑候選、slug 解析器
//
// 【概念鍵】筆記之概念標籤經抓取套件之單一讀法(noteConceptsOf:normalizeConcept 含注入之字形折疊與別名、同篇同義標籤收斂為一鍵、
//   空鍵略過)取鍵集合——同篇兩個同義標籤只算一次(逐標籤計會讓同義重複加分);正規化後為空之標籤不計(空鍵互相命中不是相關性)。
// 【候選分數】candidateScoreOf(共享之正規化概念鍵數×10＋同類別 1;stores/reverseCandidates——正向之候選挑選、反向之資格、輪巡之排名同一式);
//   同分以建立時刻新者優先。
// 【slug 容錯】完全相符優先,其次以尾碼(抓取套件之 slugSuffixOf:格式之單一解析)比對——長中文 slug 抄寫誤差(多插連字號、漏字)實測常見,
//   尾碼是 sha1 衍生、候選集內撞碼機率可忽略;**同尾碼多候選者不猜**(該尾碼回 null,該條剔除——猜錯會種下指向錯誤對象之邊);
//   幻想 slug(尾碼也對不上)回 null,該條剔除——放行會在關聯圖裡種下永遠指向空檔案之邊。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import cint from 'wsemi/src/cint.mjs'
import { noteConceptsOf, slugSuffixOf } from '../core/capturePackage.mjs'
import { candidateScoreOf } from './reverseCandidates.mjs'

/**
 * 筆記之概念比對鍵集合(檔頭【概念鍵】;抓取套件之 noteConceptsOf:正規化、去重、空鍵略過)
 *
 * @param {Object} note 輸入筆記(取 concepts)
 * @returns {Set} 回傳正規化鍵集合
 * @example
 * console.log([...conceptKeysOf({ concepts: [' 恆星演化 ', '', '恆星演化', '紅移'] })])
 * // => [ '恆星演化', '紅移' ]
 */
export function conceptKeysOf(note) {
    return new Set(noteConceptsOf(note).map((x) => x.key))
}

/**
 * 依共享概念挑候選（不花 AI 額度的機械篩選），不足補同類別／最近筆記
 *
 * 分數＝candidateScoreOf(共享之正規化概念鍵數×10＋同類別 1;反向段與輪巡同一式);同分以建立時刻新者優先。命中以「鍵集合」計:
 * 同篇兩個同義標籤(折疊或別名後同鍵)只算一次(逐標籤計會讓同義重複加分)。
 *
 * @param {Object} target 輸入目標筆記，需含 concepts、category、id；非物件回 []
 * @param {Array} allNotes 輸入全體筆記陣列；非陣列回 []
 * @param {Integer} limit 輸入回傳上限；非非負整數則不限(回傳全部候選)
 * @param {Object} [opt={}] 輸入選項
 * @param {Set} [opt.exclude] 輸入排除之筆記 id 集合(關聯段傳衝突鄰居——已是衝突者無可升級)
 * @param {Function} [opt.keysOf] 輸入取概念鍵集合之函數(呼叫端可快取;預設 conceptKeysOf)
 * @returns {Array} 回傳依分數降冪排序之候選筆記陣列(最多 limit 筆)
 * @example
 * const target = { id: 't', category: '天文', concepts: ['恆星演化', '紅移'] }
 * const notes = [
 *     { id: 'n1', category: '天文', concepts: ['紅移'], createdAt: '2026-01-01' },
 *     { id: 'n2', category: '物理', concepts: ['恆星演化', '紅移'], createdAt: '2026-01-02' },
 *     { id: 'n3', category: '天文', concepts: [], createdAt: '2026-01-03' },
 *     { id: 'n4', category: '化學', concepts: [], createdAt: '2026-01-04' },
 *     target,
 * ]
 * console.log(pickCandidates(target, notes, 2).map((n) => n.id))
 * // => [ 'n2', 'n1' ]
 *
 * console.log(pickCandidates(target, notes, 3, { exclude: new Set(['n2']) }).map((n) => n.id))
 * // => [ 'n1', 'n3', 'n4' ]
 */
export function pickCandidates(target, allNotes, limit, opt = {}) {

    //check
    if (!isobj(target)) {
        return []
    }
    if (!isarr(allNotes)) {
        return []
    }
    if (!isp0int(limit)) {
        limit = allNotes.length
    }
    limit = cint(limit)
    const exclude = opt?.exclude instanceof Set ? opt.exclude : null
    const keysOf = isfun(opt?.keysOf) ? opt.keysOf : conceptKeysOf

    // 比對鍵走 normalizeConcept（含注入的字形折疊）：僅 toLowerCase 會讓
    // 「注意力機制」與「注意力机制」互不命中，繁簡分裂的筆記彼此永遠選不到對方當候選
    const concepts = keysOf(target)
    const scored = allNotes.filter((n) => n.id !== target.id && !(exclude && exclude.has(n.id))).map((n) => {
        let hit = 0
        for (const k of keysOf(n)) if (concepts.has(k)) hit++
        return { n, score: candidateScoreOf(hit, n.category === target.category) }
    })
    scored.sort((a, b) => b.score - a.score || String(b.n.createdAt).localeCompare(String(a.n.createdAt)))
    return scored.slice(0, limit).map((s) => s.n)
}

/**
 * slug 解析器(檔頭【slug 容錯】):完全相符優先,其次以雜湊尾碼比對;同尾碼多候選者不猜(回 null);幻想 slug 回 null
 *
 * @param {Array} candidates 輸入候選筆記陣列(各項需含 id)；非陣列視為 []
 * @returns {Function} 回傳解析函數 (raw:String) => String|null
 * @example
 * const resolve = makeSlugResolver([{ id: '深度學習於蛋白質結構預測-ab12cd34' }])
 * console.log(resolve('深度學習於蛋白質結構預測-ab12cd34'), resolve('深度學習蛋白質結構預測-ab12cd34'), resolve('x-00000000'))
 * // => 深度學習於蛋白質結構預測-ab12cd34 深度學習於蛋白質結構預測-ab12cd34 null
 */
export function makeSlugResolver(candidates) {

    //check
    if (!isarr(candidates)) {
        candidates = []
    }

    const ids = new Set(candidates.map((c) => c.id))
    const bySuffix = new Map()
    const ambiguous = new Set()
    for (const c of candidates) {
        const sfx = slugSuffixOf(c.id)
        if (!sfx) continue
        if (bySuffix.has(sfx) && bySuffix.get(sfx) !== c.id) ambiguous.add(sfx)
        else bySuffix.set(sfx, c.id)
    }
    return (raw) => {
        const s = String(raw || '').trim()
        if (ids.has(s)) return s
        const sfx = slugSuffixOf(s)
        if (!sfx || ambiguous.has(sfx)) return null
        return bySuffix.get(sfx) || null
    }
}

export default { conceptKeysOf, pickCandidates, makeSlugResolver }
