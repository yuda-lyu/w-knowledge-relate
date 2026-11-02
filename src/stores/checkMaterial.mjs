// checkMaterial.mjs — 關聯之覆核類標準(RS4 衝突核對、RS6 既有邊覆核)之一方材料:讀筆記 md 之一句話重點全文、核心知識、適用條件與限制
//   (relateDomain.seenTextOf 'checkSide' 之 extra;RS8 之新進材料同此)。讀不到 md → 退用記錄之 summary 並計數(呼叫端記為 *MdMissing)。
//   兩段共用此單一實作——材料不一致會使同一對在兩標準下看到不同內容。
//   另附 material＝存量材料(原文標題＋內容章;摘要套件之 noteMaterialText——符合度掃描之 RS8 同一材料):判「現行理由」用
//   (席位所寫之新理由仍以 checkSide 所見判);md 讀不到 → null(RS8 未能判定,不以 summary 代之)。
// 【檢核雜湊之素材】核對席所見之區塊原文(seenTextOf 'checkSide')即檢核雜湊之素材成分(stores/edgeCheckKit 檔頭【檢核雜湊】):
//   兩段、存量佇列、還原與存量處置皆經 createCheckHasher 算雜湊——素材讀法只此一份,各入口算出之雜湊才會相同。

import { readMd, summaryTextOf } from '../core/summarizePackage.mjs'
import { sectionItemsOf, noteMaterialText, NOTE_SECTION_TITLES } from '../core/summarizePackage.mjs'
import { edgeCheckHashOf } from './edgeCheckKit.mjs'

/**
 * 一方材料之讀取器(本輪內快取)
 *
 * @param {Map} byId 輸入筆記 id → 記錄
 * @param {Function} [onMissing] 輸入 md 讀不到時之回呼
 * @returns {Function} 回傳 (筆記 id) => { note, extra:{ summary, keyPoints?, conditions? }, material:String|null(存量材料), missing:Boolean(md 讀不到) }
 * @example
 * const byId = new Map([['n1', { id: 'n1', summary: '一句話重點' }]])
 * const missing = []
 * const readSide = createSideReader(byId, (id) => missing.push(id))
 * const s = readSide('n1')
 * console.log(s.extra, s.material, s.missing, missing)
 * // => { summary: '一句話重點' } null true [ 'n1' ]
 * console.log(readSide('n1') === s, missing.length)
 * // => true 1
 *
 * const fs = process.getBuiltinModule('fs')
 * const dir = fs.mkdtempSync('ex-')
 * fs.writeFileSync(`${dir}/n2.md`, '---\ntitle: "太陽黑子"\n---\n\n# 太陽黑子\n\n## 一句話重點\n\n黑子數約每 11 年循環一次。\n\n## 核心知識\n\n- 週期約 11 年\n\n## 適用條件與限制\n\n- 僅限可見光觀測\n')
 * const s2 = createSideReader(new Map([['n2', { id: 'n2', file: `${dir}/n2.md`, summary: '記錄之摘要' }]]))('n2')
 * console.log(s2.extra.summary, s2.extra.keyPoints, s2.extra.conditions, s2.missing, s2.material.includes('週期約 11 年'))
 * // => 黑子數約每 11 年循環一次。 [ '週期約 11 年' ] [ '僅限可見光觀測' ] false true
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export function createSideReader(byId, onMissing = () => {}) {
    const cache = new Map()
    return (id) => {
        if (cache.has(id)) return cache.get(id)
        const n = byId.get(id) || { id }
        const md = readMd(n.file)
        if (!md) onMissing(id)
        // 條列章之讀法取摘要套件(版型之家;sectionItemsOf)
        const extra = md ? { summary: summaryTextOf(md) || n.summary, keyPoints: sectionItemsOf(md.body, NOTE_SECTION_TITLES.keyPoints), conditions: sectionItemsOf(md.body, NOTE_SECTION_TITLES.conditions) } : { summary: n.summary }
        const v = { note: n, extra, material: md ? noteMaterialText(md.body) : null, missing: !md }
        cache.set(id, v)
        return v
    }
}

/**
 * 檢核雜湊之計算器(檔頭【檢核雜湊之素材】):一方材料之讀取器＋核對席所見之區塊＋邊之檢核雜湊,三者同一份
 *
 * @param {Object} o 輸入 { byId:Map(筆記 id → 記錄), domain:關聯 domain(seenTextOf), typesVer:String(關聯型別定義之版本), onMissing?:(筆記 id)=>void }
 * @returns {Object} 回傳 { sideOf:(筆記 id)=>一方材料, seenOf:(筆記 id)=>String(核對席所見之區塊), hashOf:(邊)=>String(檢核雜湊), missing:Set(md 讀不到之筆記 id) }
 * @example
 * const byId = new Map([
 *     ['a', { id: 'a', title: '甲', summary: '甲之重點', createdAt: '2026-01-01' }],
 *     ['b', { id: 'b', title: '乙', summary: '乙之重點', createdAt: '2026-01-02' }],
 * ])
 * const domain = { seenTextOf: (note, kind, extra) => `${note.title}|${extra.summary}` }
 * const hasher = createCheckHasher({ byId, domain, typesVer: 'v1' })
 * const edge = { from: 'a', to: 'b', type: '互補搭配', reason: '兩篇皆以近日點距離之量測方法比較軌道' }
 * console.log(hasher.seenOf('a'), hasher.hashOf(edge))
 * // => 甲|甲之重點 28f518d39864d070
 * console.log(hasher.hashOf(edge) === hasher.hashOf({ ...edge, reason: '改寫後之理由' }), [...hasher.missing])
 * // => false [ 'a', 'b' ]
 */
export function createCheckHasher(o = {}) {
    const missing = new Set()
    const sideOf = createSideReader(o.byId, (id) => {
        missing.add(id)
        if (typeof o.onMissing === 'function') o.onMissing(id)
    })
    const seenOf = (id) => {
        const s = sideOf(id)
        return o.domain.seenTextOf(s.note, 'checkSide', s.extra)
    }
    const hashOf = (edge) => edgeCheckHashOf(edge, o.byId.get(edge.from), o.byId.get(edge.to), o.typesVer, seenOf(edge.from), seenOf(edge.to))
    return { sideOf, seenOf, hashOf, missing }
}

export default { createSideReader, createCheckHasher }
