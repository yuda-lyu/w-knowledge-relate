// edgeStandards.mjs — 關聯之檢定標準(邊):純函數,輸入＝邊記錄,新進守門(所有寫入點)與符合度掃描共用
//
// 【標準】(各標準之版本 v 見 EDGE_STANDARDS;判定改變即升版)
//   RS1 結構:兩端皆為現存筆記、非自指、型別在詞彙表清單內(清單外型別不得由程式改落後備型別——RS9 併此判)
//   RS2 理由形式:去掉空泛片語(詞彙表 guide.relate 之 vagueReason／broadRelation)與標點空白後 ≥10 字;非佔位字(封閉清單)
//   RS3 正體:理由(含 history 中之敗方提案理由——完整全序模式下可能浮上為現值)之簡體專用字與同形字誤用數＝0;
//     [[連結]] 與網址不檢(指稱他物之識別字,轉換即斷連結;與筆記等之正體標準同一規則——抓取套件之 withoutForeignSpans);
//     只適用於臺灣正體之字形政策(appliesTo;ctx.locale 非繁體中文 → 不適用,抓取套件之 core/locale)
//   RS8 數字紮根:理由中之數字事實須見於兩端筆記之材料(新進:AI 所見之候選資料;存量:兩端筆記之內容章＋標題);材料不可得 → 未能判定
// 【能證明／不能證明】RS1～RS3、RS8 只證明形式與數字來源;「理由是否指出共同機制、型別是否正確、衝突是否為真」是語意判斷,
//   屬 AI 標準 RS4／RS6(兩席逐案)。
// 【資訊(不算邊本身之違反;edgeInfoOf)】①history 條目之 RS1(型別)／RS2／RS8 違反——history 是敗方提案之紀錄,只在浮上為現值時才須
//   過閘(stores/edgeStore mergeEdge 之 admit),掃描另計資訊數使存量看得見(RS3 之 history 仍計入邊本身:正體可確定性修正,存量處置即修)
//   ②理由經納入閘於句界截短(reasonCut;截斷須明示)。種類(kind:'history'｜'cut')之顯示名唯一在 EDGE_INFO_LABELS。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { STATUS, result, fromProblems } from '../core/capturePackage.mjs'
import { withoutForeignSpans, scriptOf, scriptApplies, SCRIPT_NA_DETAIL } from '../core/capturePackage.mjs'
import { ungroundedNumbers, outputNumbers } from '../core/summarizePackage.mjs'

/** 邊之檢定標準登記列(RS1 結構、RS2 理由形式、RS3 正體、RS8 理由之數字紮根;各列 { id, title, kind, v(判定版本,判定改變即升版) },RS3 另有 appliesTo:['zh-Hant-TW']＝只適用於臺灣正體之字形政策) */
export const EDGE_STANDARDS = [
    { id: 'RS1', title: '結構(兩端存在、非自指、型別在清單)', kind: 'program', v: 1 },
    { id: 'RS2', title: '理由形式(具體、非佔位)', kind: 'program', v: 1 },
    { id: 'RS3', title: '正體', kind: 'program', v: 2, appliesTo: ['zh-Hant-TW'] },
    { id: 'RS8', title: '理由之數字紮根', kind: 'program', v: 1 },
]

/** 資訊項之種類之顯示名(edgeInfoOf 之 kind;掃描報表之讀者據以顯示,不另寫一份) */
export const EDGE_INFO_LABELS = Object.freeze({ history: 'history 條目不合', cut: '理由截短' })

/** 佔位理由(封閉清單;比對時去標點空白、轉小寫) */
export const PLACEHOLDER_REASONS = ['', '占位', '佔位', 'placeholder', 'tbd', 'todo', '待補', '待填', 'na', 'n/a', '無', '略', '同上', '理由', 'reason']
/** 理由去空泛片語與標點後之最短字數 */
export const REASON_MIN_CHARS = 10

const squash = (s) => String(s ?? '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')

/**
 * 理由形式之問題(RS2)
 *
 * @param {*} reason 輸入理由
 * @param {Array} [vague=[]] 輸入空泛片語(詞彙表 guide.relate 之 vagueReason、broadRelation)
 * @returns {String} 回傳問題說明(無問題回 '')
 * @example
 * console.log(reasonFormProblem('都與某主題有關', ['都與某主題有關']))
 * // => '去空泛片語與標點後只剩 0 字（須 ≥10）'
 */
export function reasonFormProblem(reason, vague = []) {
    const raw = String(reason ?? '').trim()
    if (PLACEHOLDER_REASONS.includes(squash(raw).toLowerCase())) return `佔位理由「${raw}」`
    let s = raw.normalize('NFKC')
    for (const v of (isarr(vague) ? vague : []).map(String).filter(Boolean)) s = s.split(v.normalize('NFKC')).join('')
    const n = [...squash(s)].length
    return n < REASON_MIN_CHARS ? `去空泛片語與標點後只剩 ${n} 字（須 ≥${REASON_MIN_CHARS}）` : ''
}

/**
 * 檢定一條邊(RS1、RS2、RS3、RS8)
 *
 * @param {Object} edge 輸入邊記錄 { id, from, to, type, reason, history? }
 * @param {Object} [ctx={}] 輸入 { relationTypes:Array, vague:Array, hasNote:(id)=>Boolean,
 *        materialOf:(noteId)=>String|null(RS8;未給則不檢 RS8), locale:語言設定或字形政策(RS3 只適用於臺灣正體,其餘列不適用;未給＝正體) }
 * @returns {Array} 回傳判定結果陣列
 * @throws {Error} ctx.locale 不合時拋出
 * @example
 * const ctx = { relationTypes: ['互補搭配'], vague: [], hasNote: () => true }
 * const ok = checkEdge({ id: 'e1', from: 'a', to: 'b', type: '互補搭配', reason: '兩篇皆以近日點距離之量測方法比較軌道' }, ctx)
 * console.log(ok.map((r) => `${r.std}:${r.status}`))
 * // => [ 'RS1:pass', 'RS2:pass', 'RS3:pass' ]
 *
 * const bad = checkEdge({ id: 'e2', from: 'a', to: 'a', type: '未知', reason: 'placeholder' }, ctx)
 * console.log(bad.filter((r) => r.status === 'violation').map((r) => `${r.std} ${r.detail}`))
 * // => [ 'RS1 自指；型別「未知」不在清單', 'RS2 佔位理由「placeholder」' ]
 *
 * const num = checkEdge({ id: 'e3', from: 'a', to: 'b', type: '互補搭配', reason: '兩篇皆以近日點距離之量測方法比較 12 條軌道' }, { ...ctx, materialOf: () => '近日點距離' })
 * console.log(num.find((r) => r.std === 'RS8').detail)
 * // => 兩端皆無之數字：12
 */
export function checkEdge(edge, ctx = {}) {
    const e = isobj(edge) ? edge : {}
    const script = scriptOf(ctx.locale, 'checkEdge 之 ctx.locale')
    const out = []
    // RS1 結構
    const p1 = []
    const has = isfun(ctx.hasNote) ? ctx.hasNote : () => true
    if (!has(e.from)) p1.push(`端點不存在：${e.from}`)
    if (!has(e.to)) p1.push(`端點不存在：${e.to}`)
    if (e.from && e.from === e.to) p1.push('自指')
    if (isarr(ctx.relationTypes) && !ctx.relationTypes.includes(e.type)) p1.push(`型別「${e.type}」不在清單`)
    out.push(fromProblems('RS1', p1))
    // RS2 理由形式
    out.push(fromProblems('RS2', [reasonFormProblem(e.reason, ctx.vague)]))
    // RS3 正體(含 history);字形政策非臺灣正體 → 不適用
    if (!scriptApplies(EDGE_STANDARDS.find((s) => s.id === 'RS3'), script)) out.push(result('RS3', STATUS.NA, SCRIPT_NA_DETAIL))
    else {
        const p3 = []
        const pr = script.problems(withoutForeignSpans(e.reason))
        if (pr.count) p3.push(`理由 ${pr.count} 處`)
        for (const [k, h] of (isarr(e.history) ? e.history : []).entries()) {
            const ph = script.problems(withoutForeignSpans(h?.reason))
            if (ph.count) p3.push(`history[${k}] 理由 ${ph.count} 處`)
        }
        out.push(fromProblems('RS3', p3))
    }
    // RS8 數字紮根(理由無數字事實者不必取材料)
    if (isfun(ctx.materialOf) && !outputNumbers(e.reason).length) out.push(result('RS8', STATUS.PASS))
    else if (isfun(ctx.materialOf)) {
        const ma = ctx.materialOf(e.from)
        const mb = ctx.materialOf(e.to)
        if (ma === null || mb === null) out.push(result('RS8', STATUS.UNDETERMINED, '端點材料不可得'))
        else {
            const ung = ungroundedNumbers(e.reason, [ma, mb])
            out.push(ung.length ? result('RS8', STATUS.VIOLATION, `兩端皆無之數字：${ung.slice(0, 6).join('、')}`) : result('RS8', STATUS.PASS))
        }
    }
    return out
}

/**
 * 邊之資訊項(不算邊本身之違反;見檔頭【資訊】):history 條目之 RS1(型別)／RS2／RS8 違反、理由之句界截短
 *
 * @param {Object} edge 輸入邊記錄 { from, to, history?, reasonCut? }
 * @param {Object} [ctx={}] 輸入 同 checkEdge(relationTypes、vague、materialOf;未給 materialOf 或材料不可得者不判 RS8)
 * @returns {Array} 回傳 [{ std:'RS1'|'RS2'|'RS8', kind:'history'|'cut', detail }]
 * @example
 * console.log(edgeInfoOf({ from: 'a', to: 'b', reasonCut: 230, history: [{ type: '舊型', reason: '同上' }] }, { relationTypes: ['互補搭配'] }).map((x) => `${x.std}:${x.kind}`))
 * // => [ 'RS1:history', 'RS2:history', 'RS2:cut' ]
 */
export function edgeInfoOf(edge, ctx = {}) {
    const e = isobj(edge) ? edge : {}
    const out = []
    const types = isarr(ctx.relationTypes) ? ctx.relationTypes : null
    let mat
    const materials = () => (mat === undefined ? (mat = isfun(ctx.materialOf) ? [ctx.materialOf(e.from), ctx.materialOf(e.to)] : null) : mat)
    for (const [k, h] of (isarr(e.history) ? e.history : []).entries()) {
        if (!isobj(h)) continue
        if (types && !types.includes(h.type)) out.push({ std: 'RS1', kind: 'history', detail: `history[${k}] 型別「${h.type}」不在清單` })
        const p2 = reasonFormProblem(h.reason, ctx.vague)
        if (p2) out.push({ std: 'RS2', kind: 'history', detail: `history[${k}] ${p2}` })
        // RS8 能判者:理由含數字事實且材料可得(兩端皆非 null;理由無數字者不取材料)
        if (outputNumbers(h.reason).length && materials() && mat[0] !== null && mat[1] !== null) {
            const ung = ungroundedNumbers(h.reason, mat)
            if (ung.length) out.push({ std: 'RS8', kind: 'history', detail: `history[${k}] 兩端皆無之數字：${ung.slice(0, 6).join('、')}` })
        }
    }
    if (Number.isInteger(e.reasonCut) && e.reasonCut > 0) out.push({ std: 'RS2', kind: 'cut', detail: `理由於句界截短（原 ${e.reasonCut} 字）` })
    return out
}

export default { EDGE_STANDARDS, EDGE_INFO_LABELS, PLACEHOLDER_REASONS, REASON_MIN_CHARS, reasonFormProblem, checkEdge, edgeInfoOf }
