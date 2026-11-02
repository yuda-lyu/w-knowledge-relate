// audit.mjs — 關聯檢定標準之符合度掃描(唯讀,不寫任何知識庫檔案)
//
// 【單一實作】新進閘、還原與本掃描呼叫同一判定(standards/edgeStandards 之 checkEdge;資訊項 edgeInfoOf),輸入同為落地形態之邊;
//   判定之型別清單與空泛片語一律取關聯 domain(與納入閘同一份——安裝方整組置換之 domain 亦然),不另由詞彙表組一份——掃描之結果即
//   「現行標準下存量之真實違反數」。
// 【RS8 之材料】兩端筆記之內容章＋原文標題(摘要套件之 noteMaterialText;與還原路徑同一定義)。來源三擇一:①呼叫端給 opt.materialOf
//   (共用其已有之走訪,本掃描不讀 md)②給 opt.onNote 者逐篇讀 md(全量走訪;每篇讀得到 md 者回呼一次)③其餘只讀判定所需之筆記之 md
//   (各篇至多一次)。md 讀不到 → 該篇之材料不可得 → 理由含數字之邊記未能判定(不報為零)。opt.material 為 false → 不讀材料:
//   理由含數字之邊記未能判定並註明(理由無數字者不需材料,照判)。範圍不含 RS8 者不取材料、不走訪。
// 【回報】逐標準:總量、四態計數、版本、完整 id(不合格、未能判定、已豁免皆列)。不合格或未能判定而該邊該標準有使用者豁免(holds 之
//   waived;鍵 edge:<邊 id>:<標準>,集合可缺)者記「已豁免」(逐一列出)——豁免是裁示,不是合格。既有違反經覆核待判(RS6;衝突型為 RS4)
//   處理者(存量之 RS2／RS3／RS8、維護段登錄之清單外型別 RS1),使用者豁免該待判(其來源即該標準;standards/edgeQueue 之 stockWaiverKeyOf
//   ——與存量處置不重開同一判定)亦是對該邊該標準之裁示,同記已豁免。RS1／RS2／RS8 另回資訊項
//   (info:{ 種類: 筆數 }、infos:[{ id, kind, detail }]——history 條目之違反、理由之句界截短;不算邊本身之違反;種類之顯示名見
//   edgeStandards 之 EDGE_INFO_LABELS)。
// 【AI 標準】RS4、RS6 之判定在檢核紀錄(checks;各紀錄之 results 之該標準)與待判登錄(holds):ai[標準]＝已檢、四態、版本過時
//   (紀錄之 v ≠ 現版,須重檢)、待判之未結與已豁免;RS5 不寫檢核紀錄,只列待判(檢核之欄為 null)。來源集合未給者其欄為 null
//   (無從計,不報為零);該列之來源集合皆未給者該列為 null。列之計法取 core/stores/checks 之 aiStandardRowOf(紀錄形狀之家;各工作同一份)。
// 【累計與總覽之形狀】桶、四態、豁免之映射與逐態 id 上限取抓取套件之 createStandardsTally(四工作同一份;存量經覆核待判之豁免為其登錄另認之
//   豁免鍵、RS8 未讀材料之說明為其說明之替換);總覽之形狀 relateScanOf 取其 standardsScanOf(兩個總組裝之掃描同一份)。
// 【材料讀取器一份】createMaterialReader 為各工作之掃描同一份(三來源、快取、全量走訪之規則只此一處;材料之文字由呼叫端以 textOf 注入——
//   本掃描為內容章＋原文標題,下游之掃描另有其材料定義);下游經其埠取用。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { STATUS, createStandardsTally, standardsScanOf } from '../core/capturePackage.mjs'
import { readMd, noteMaterialText } from '../core/summarizePackage.mjs'
import { aiStandardRowOf } from '../core/stores/checks.mjs'
import { checkEdge, edgeInfoOf } from './edgeStandards.mjs'
import { gateCtxOf } from './edgeGate.mjs'
import { RS4 } from '../stores/conflictCheckPolicy.mjs'
import { RS6 } from '../stores/edgeReviewPolicy.mjs'
import { stockWaiverKeyOf } from './edgeQueue.mjs'
import { RELATE_STANDARDS, RELATE_AUDITED_STANDARD_IDS, RELATE_AI_STANDARD_IDS } from './registry.mjs'

export { RELATE_AUDITED_STANDARD_IDS, RELATE_AI_STANDARD_IDS }

/** 掃描結果之物件名(併入總覽時之對象欄) */
export const RELATE_SCAN_OBJECT = 'edges'

/** 有資訊項之標準(edgeInfoOf 之 std) */
const INFO_STDS = Object.freeze(['RS1', 'RS2', 'RS8'])

/** 判定記於檢核紀錄之 AI 標準(RS5 不寫檢核紀錄) */
const CHECKED_STDS = Object.freeze([RS4.std, RS6.std])

/** opt.material 為 false 時 RS8 之未能判定說明 */
const NO_MATERIAL_DETAIL = '未讀筆記材料（material:false），數字紮根無從判定'

/** 待判登錄之物件種類(邊) */
const EDGE_OBJECT = RS6.objectEdge

/**
 * 掃描之關聯 domain(判定之型別清單與空泛片語)
 *
 * @param {*} d 輸入 deps.domain
 * @returns {Object} 回傳 domain
 * @throws {Error} 缺 domain 或缺型別清單、空泛片語時拋出
 */
function auditDomainOf(d) {
    if (!isobj(d) || !isarr(d.relationTypes) || !isarr(d.vagueReasons)) {
        throw new Error('auditRelateStandards 需要 deps.domain（關聯 domain，createRelateDomain 之產物——型別清單與空泛片語取自此，與新進閘同一份）')
    }
    return d
}

/**
 * 關聯檢定標準之符合度掃描(唯讀)
 *
 * @param {Object} deps 輸入 { stores:{ relations, notes, holds?, checks? }, domain(關聯 domain;判定之型別清單與空泛片語), locale?(語言設定;RS3 只適用於
 *   臺灣正體,其餘逐邊列不適用;未給＝正體) }
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Array} [opt.only] 輸入只跑這些標準 id(未給或空陣列＝全部:逐件判定之標準與 AI 標準之列;不認得之 id 略過)
 * @param {Boolean} [opt.material=true] 輸入 RS8 是否讀兩端筆記之材料;false 時理由含數字之邊記未能判定(給了 materialOf 者以之為準)
 * @param {Function} [opt.materialOf] 輸入 (筆記記錄) => 材料字串｜null(不可得):呼叫端已有之材料(與他段共用一次走訪;本掃描不讀 md)
 * @param {Function} [opt.onNote] 輸入 (筆記記錄, md) => void:給了即逐篇讀 md(全量走訪),每篇讀得到 md 者回呼一次——他段於同一次走訪
 *   取其所需;只在範圍含 RS8、未給 materialOf 且 material 非 false 時走訪(未走訪即不呼叫)
 * @param {Integer} [opt.maxIds] 輸入每態(與資訊項)列出之 id 上限(非負整數;預設全部)
 * @returns {Promise} 回傳 Promise,resolve 回傳 { counts:{ edges }, standards:{ [id]: { id, title, kind, v, module:'relate', object,
 *   total, pass, violation, undetermined, na, waived, violations:[{ id, detail }], undetermineds:[{ id, detail }], waiveds:[{ id, detail }],
 *   info?:{ 種類: 筆數 }, infos?:[{ id, kind, detail }](RS1、RS2、RS8) } },
 *   ai?:{ [AI 標準]: { id, title, kind, v, module:'relate', object, checked, pass, violation, undetermined, na, stale, holdsOpen, holdsWaived }|null }
 *   (範圍內有 AI 標準時才有;欄為 null＝來源集合未給或不適用,列為 null＝來源集合皆未給) }
 * @throws {Error} deps.stores.relations 或 deps.stores.notes 缺 select 方法、或缺 deps.domain(或其型別清單、空泛片語)時拋出
 * @example
 * need test in nodejs.
 *
 * const rep = await auditRelateStandards({ stores, domain }, { only: ['RS2', 'RS8'] })
 * console.log(rep.standards.RS2.violation, rep.standards.RS8.undetermineds)
 */
export async function auditRelateStandards(deps, opt = {}) {

    //check
    const stores = deps?.stores
    if (!isobj(stores) || !isfun(stores.relations?.select) || !isfun(stores.notes?.select)) {
        throw new Error('auditRelateStandards 需要 deps.stores.relations 與 deps.stores.notes（具 select 方法）')
    }
    const domain = auditDomainOf(deps.domain)
    if (!isobj(opt)) {
        opt = {}
    }

    const only = isarr(opt.only) && opt.only.length ? new Set(opt.only) : null
    const useMaterial = opt.material !== false
    const materialOf = isfun(opt.materialOf) ? opt.materialOf : null
    const onNote = isfun(opt.onNote) ? opt.onNote : null
    const maxIds = Number.isInteger(opt.maxIds) && opt.maxIds >= 0 ? opt.maxIds : Infinity

    // 待判登錄(一次讀;集合可缺):使用者豁免映射回四態(該標準之登錄、或存量經覆核待判之豁免——檔頭【回報】)、AI 標準之待判數
    const allHolds = isfun(stores.holds?.select) ? await stores.holds.select() : null
    const tally = createStandardsTally(RELATE_STANDARDS, {
        module: 'relate', only, holds: allHolds, maxIds,
        waivedKeyOf: stockWaiverKeyOf,
        // 未讀材料者之未能判定註明其因(不是材料不可得)
        detailOf: (r) => (!useMaterial && !materialOf && r.std === 'RS8' && r.status === STATUS.UNDETERMINED ? NO_MATERIAL_DETAIL : r.detail),
    })
    const std = tally.std
    for (const id of INFO_STDS) if (std[id]) Object.assign(std[id], { info: {}, infos: [] })
    const scanIds = Object.keys(std)
    const aiIds = RELATE_AI_STANDARD_IDS.filter((id) => !only || only.has(id))
    /**
     * 記一筆判定;不合格／未能判定而該邊該標準有豁免者記 waived
     */
    const add = (edgeId, r) => tally.add(edgeId, r, [[EDGE_OBJECT, edgeId]])
    /**
     * 記一筆資訊項(不算違反)
     */
    const addInfo = (edgeId, x) => {
        const b = std[x.std]
        if (!b?.info) return
        b.info[x.kind] = (b.info[x.kind] || 0) + 1
        if (b.infos.length < maxIds) b.infos.push({ id: edgeId, kind: x.kind, detail: x.detail })
    }

    // ── 邊:RS1／RS2／RS3／RS8(與新進閘同一判定)──
    const edges = await stores.relations.select()
    if (scanIds.length) {
        const notes = await stores.notes.select()
        const noteById = new Map(notes.map((n) => [n.id, n]))
        const ctx = gateCtxOf(domain, { hasNote: (id) => noteById.has(id), locale: deps.locale })
        if (std.RS8) ctx.materialOf = createMaterialReader({ notes, noteById, useMaterial, materialOf, onNote, textOf: (n, md) => noteMaterialText(md.body) })
        for (const e of edges) {
            for (const r of checkEdge(e, ctx)) add(e.id, r)
            for (const x of edgeInfoOf(e, ctx)) addInfo(e.id, x)
        }
    }

    const out = { counts: { edges: edges.length }, standards: std }

    // ── AI 標準:檢核紀錄＋待判(檔頭;列之計法 core/stores/checks 之 aiStandardRowOf;RS5 不讀檢核紀錄)──
    if (aiIds.length) {
        const checkRows = CHECKED_STDS.some((id) => aiIds.includes(id)) && isfun(stores.checks?.select) ? await stores.checks.select() : null
        out.ai = {}
        for (const id of aiIds) {
            const s = RELATE_STANDARDS.find((x) => x.id === id)
            out.ai[id] = aiStandardRowOf(s, { module: 'relate', checkRows: CHECKED_STDS.includes(id) ? checkRows : null, holds: allHolds })
        }
    }
    return out
}

/**
 * 掃描之材料讀取器(檔頭【RS8 之材料】【材料讀取器一份】;結果依筆記 id 快取,同一篇至多讀一次):①materialOf 給了即以之為準(不讀 md、不回呼 onNote)
 *   ②useMaterial 為 false → 一律不可得 ③otherwise 讀 md(onNote 給了即先全量走訪、每篇讀得到 md 者回呼一次),材料之文字由 textOf 算出
 *
 * @param {Object} o 輸入 { notes:Array(筆記記錄), noteById:Map(id → 記錄), useMaterial:Boolean, materialOf:Function|null((記錄) => 字串｜null),
 *   onNote:Function|null((記錄, md) => void), textOf:Function((記錄, md) => 材料字串) }
 * @returns {Function} 回傳 (筆記 id) => 材料字串｜null(不可得:筆記不在、md 讀不到、materialOf 回非字串)
 * @throws {Error} noteById 非 Map 或 textOf 非函數(未給 materialOf 且 useMaterial 時)時拋出
 * @example
 * let readerOf = createMaterialReader({ notes: [], noteById: new Map([['a', { id: 'a' }]]), useMaterial: true, materialOf: (n) => `材料:${n.id}`, onNote: null, textOf: () => '' })
 * console.log(readerOf('a'), readerOf('b'))
 * // => 材料:a null
 */
export function createMaterialReader(o) {
    if (!(o?.noteById instanceof Map)) throw new Error('createMaterialReader 需要 noteById（Map：筆記 id → 記錄）')
    const cache = new Map()
    const toMat = (v) => (typeof v === 'string' ? v : null)
    if (isfun(o.materialOf)) {
        return (id) => {
            if (!cache.has(id)) {
                const n = o.noteById.get(id)
                cache.set(id, n ? toMat(o.materialOf(n)) : null)
            }
            return cache.get(id)
        }
    }
    if (o.useMaterial === false) return () => null
    if (!isfun(o.textOf)) throw new Error('createMaterialReader 需要 textOf（(筆記記錄, md) => 材料字串）')
    const onNote = isfun(o.onNote) ? o.onNote : null
    const readOf = (n) => {
        const md = readMd(n?.file)
        if (!md) return null
        if (onNote) onNote(n, md)
        return toMat(o.textOf(n, md))
    }
    // 他段要逐篇之 md:全量走訪(每篇一次)
    if (onNote) for (const n of (isarr(o.notes) ? o.notes : [])) cache.set(n.id, readOf(n))
    return (id) => {
        if (!cache.has(id)) {
            const n = o.noteById.get(id)
            cache.set(id, n ? readOf(n) : null)
        }
        return cache.get(id)
    }
}

/**
 * 關聯掃描結果之對外形狀(兩個總組裝同一份;抓取套件之 standardsScanOf):標準列之對象為 RELATE_SCAN_OBJECT;AI 列(RS4／RS5／RS6)之計數欄
 *   null 補 0(來源集合未給者)、全零之列與整列為 null 者不列;邊數入 counts
 *
 * @param {Object} rep 輸入 auditRelateStandards 之產物
 * @returns {Object} 回傳 { counts:{ edges }, standards:{ [id]: 標準列(object 'edges') }, ai:{ [id]: { checked, pass, violation, undetermined, na,
 *   stale, holdsOpen, holdsWaived, v } } }
 * @example
 * let s = relateScanOf({ counts: { edges: 3 }, standards: {}, ai: { RS4: { v: 1, checked: null, holdsOpen: 2 }, RS5: null, RS6: { v: 1, checked: 0, holdsOpen: 0 } } })
 * console.log(s.counts.edges, Object.keys(s.ai), s.ai.RS4.checked, s.ai.RS4.holdsOpen)
 * // => 3 [ 'RS4' ] 0 2
 */
export function relateScanOf(rep) {
    return { ...standardsScanOf(rep, { object: RELATE_SCAN_OBJECT }), counts: { edges: Number(rep?.counts?.edges) || 0 } }
}

export default { RELATE_SCAN_OBJECT, RELATE_AUDITED_STANDARD_IDS, RELATE_AI_STANDARD_IDS, auditRelateStandards, createMaterialReader, relateScanOf }
