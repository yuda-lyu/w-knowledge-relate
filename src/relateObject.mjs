// relateObject.mjs — 關聯物件:子階段序列(relate → project → relationIndex)
//
// ════════════════ 分形組裝:物件=子階段序列,子階段=動作鏈 ════════════════
//
// 工廠零參數即可用(內建預設子階段與動作鏈);opt 逐層覆寫:
//   opt.stages           整組重排子階段(混入自寫 {name, run(ctx)} 單元)
//   opt.<子階段名>       透傳該子階段工廠(其內 tap/chain/單元 opts;鍵見 RELATE_STAGE_KEYS)
//   opt.reeval           關聯子階段內之重評鏈 { tap?, chain? }(錨點 relate.reeval.{verdict, agree, apply, markReviewed};轉為 stageRelate 之
//                        reevalTap／reevalChain)
//   opt.name/onError…    階段契約欄位
//   其餘平鋪鍵           只給 relate 子階段(與 opt.relate 合併,opt.relate 優先)
//
// 【依賴一律走 ctx.deps】stores/clock/dirs/settings/data/vocab/ai/domains 由總組裝每輪開啟交入;套件子階段與自寫子階段同一條注入通道。
// 【子階段失敗預設隔離】單一子階段倒了記於 detail、續跑後續子階段;子階段宣告 onError:'abort' 才中止整個物件。物件本身預設
//   onError:'continue'(關聯失敗不阻斷同一管線之後段)。
// 【物件 report 形狀】{ ok, stats, detail: <子階段名 → 子階段 report>, summary }——子階段 opts 之合併、子階段序列執行、統計彙總、摘要組裝與
//   物件 report 取自抓取套件之物件共用件(各物件同一份規則);固定格式摘要(relateSummaryOf)為對外契約,見其 JSDoc。
// 【平鋪 tap 與子階段 tap 合併而非覆蓋】呼叫端可能同時給平鋪之 tap 與 opt.relate.tap(兩方各自組 opt 時);二擇一會使其一靜默失效,
//   故以 mergeTaps 合併(同錨點 before／after 串接,雙方皆 replace 即拋錯)。重評鏈之 tap 同一規則:平鋪之 reevalTap、opt.relate.reevalTap、
//   opt.reeval.tap 三者合併;整條置換(chain)只能給一處。
// 【錨點於建構期驗】有動作鏈之鍵(RELATE_TAP_STAGE_KEYS)之 tap 對不上錨點者,建立物件時即拋——不等到該段開工才發現插件掛不上。

import isobj from 'wsemi/src/isobj.mjs'
import { mergeTaps, subOpt, stageFields, runSubStages, summaryOf, objectReport } from './core/capturePackage.mjs'
import { RELATE_REPORT_KEYS } from './logContract.mjs'
import { stageRelate } from './stages/relateStage.mjs'
import { stageRelateProject } from './stages/projectStage.mjs'
import { stageRelationIndex } from './stages/relationIndexStage.mjs'

/**
 * 內建子階段之鍵(依執行順序;亦為 opt.<子階段名> 之可用鍵與物件 report 之 detail 鍵)——即日誌契約之 report 子階段鍵(RELATE_REPORT_KEYS.subStages,
 *   同一實體;物件之階段名亦取該契約之 stage,巡檢讀 run.json 時與物件同一份名稱)
 *
 * @type {Array}
 */
export const RELATE_STAGE_KEYS = RELATE_REPORT_KEYS.subStages

/**
 * 有動作鏈(hook 錨點)之鍵:三個子階段之鏈,加上關聯子階段內之重評鏈 reeval(錨點 relate.reeval.{verdict, agree, apply, markReviewed})——
 *   opt.<鍵>.tap／chain 與總組裝之插件掛載(stageOpts)之可用鍵
 *
 * @type {Array}
 */
export const RELATE_TAP_STAGE_KEYS = Object.freeze([RELATE_STAGE_KEYS[0], 'reeval', ...RELATE_STAGE_KEYS.slice(1)])

/** opt.reeval 之可用鍵:tap(掛載規格)、chain(整條置換之重評鏈) */
const REEVAL_OPT_KEYS = Object.freeze(['tap', 'chain'])

/**
 * relate 子階段之 opt:平鋪 opts 與 opt.relate 合併(抓取套件之 subOpt),再併入重評鏈之 opts——重評鏈之 tap 以 mergeTaps 合併三處
 *   (平鋪之 reevalTap、opt.relate.reevalTap、opt.reeval.tap),整條置換只能給一處(檔頭【平鋪 tap 與子階段 tap 合併而非覆蓋】)
 *
 * @param {Object} opt 輸入物件層之 opt(已正規化為物件)
 * @returns {Object} 回傳 stageRelate 之 opt
 * @throws {Error} opt.reeval 給了而非物件、含不認得之鍵、整條重評鏈給了兩處、或同錨點雙方皆給 replace 時拋出
 */
function relateOptOf(opt) {
    const out = subOpt(opt, opt.relate, 'relate.relate')
    const rv = opt.reeval
    if (rv !== undefined && rv !== null) {
        if (!isobj(rv)) throw new Error(`createRelateObject 之 opt.reeval 須為物件 { ${REEVAL_OPT_KEYS.join(', ')} }`)
        const unknown = Object.keys(rv).filter((k) => !REEVAL_OPT_KEYS.includes(k))
        if (unknown.length) throw new Error(`createRelateObject 之 opt.reeval 含不認得之鍵：${unknown.join('、')}（可用：${REEVAL_OPT_KEYS.join('、')}）`)
    }
    const tap = mergeTaps(mergeTaps(opt.reevalTap, opt.relate?.reevalTap, 'relate.reeval'), isobj(rv) ? rv.tap : undefined, 'relate.reeval')
    if (tap) out.reevalTap = tap
    else delete out.reevalTap
    const chains = [opt.reevalChain, opt.relate?.reevalChain, isobj(rv) ? rv.chain : undefined].filter((c) => c !== undefined && c !== null)
    if (chains.length > 1) throw new Error('createRelateObject 之重評鏈整條置換(reevalChain、opt.relate.reevalChain、opt.reeval.chain)只能給一處')
    if (chains.length) out.reevalChain = chains[0]
    else delete out.reevalChain
    return out
}

/**
 * 關聯之固定格式摘要(預設子階段全數成功時):格式為對外契約——外部巡檢之正則退路依此解析逐輪統計,既有段落不動,
 * 新增段落一律附於句尾、>0 才附。「處理 N、關聯 N 條、衝突 N 組（AI N 次）」之關聯＝本輪新建之邊、衝突＝新成為衝突之無序對
 *
 * 段落(依序;第一段恆在,其餘 >0 才附):
 *   「處理 N、關聯 N 條、衝突 N 組（AI N 次）」｜「重判 N 篇」(內容變更)｜「反向 N 篇 N 條」｜「刪除 N 條」(清除已刪筆記之邊)｜
 *   「投影失敗 N」｜「重評 N 篇（改型 a、撤銷 b、候選 c）」(有經 AI 之頁才附)｜「標準修正 N、未達標準 N 條」(納入閘)｜「型別改名 N 條」｜
 *   「衝突核對 N 條（…）」(有核對才附)｜「輪巡 N 篇（新邊 N；用盡 N／N 篇）」(有輪巡或用盡才附)｜「既有邊覆核 N 條（…；進度 N／N）」(有覆核才附)
 *
 * @param {Object} reports 輸入子階段名 → report 之對照物件
 * @returns {String} 回傳摘要字串；缺 relate 之 detail(或 reports 非物件)時回 ''(由 summaryOf 退用通用摘要)
 * @example
 * let reports = {
 *     relate: { stats: { aiCalls: 2 }, detail: { targets: 2, edges: 3, conflicts: 1, reTargets: 1 } },
 *     project: { stats: {}, detail: { failed: 0 } },
 * }
 * console.log(relateSummaryOf(reports))
 * // => 處理 2、關聯 3 條、衝突 1 組（AI 2 次）｜重判 1 篇
 */
export function relateSummaryOf(reports) {

    //check
    if (!isobj(reports)) {
        return ''
    }

    const r = reports.relate?.detail
    const p = reports.project?.detail
    if (!r) return ''
    return `處理 ${r.targets}、關聯 ${r.edges} 條、衝突 ${r.conflicts} 組（AI ${reports.relate.stats.aiCalls} 次）` +
        (r.reTargets > 0 ? `｜重判 ${r.reTargets} 篇` : '') +
        (r.reverseTargets > 0 ? `｜反向 ${r.reverseTargets} 篇 ${r.reverseEdges || 0} 條` : '') +
        (r.retired > 0 ? `｜刪除 ${r.retired} 條` : '') +
        (p?.failed > 0 ? `｜投影失敗 ${p.failed}` : '') +
        // 重評:有經 AI 之頁才附(零邊即評完者不計)
        (r.reevalPages > 0 ? `｜重評 ${r.reevalTargets} 篇（改型 ${r.reevalChanged || 0}、撤銷 ${r.reevalRetired || 0}、候選 ${r.reevalCandidates || 0}）` : '') +
        // 檢定標準之納入閘:逐條修正後納入／未達標準而不納入;型別改名之機械改寫
        (r.edgeStdFixed > 0 || r.edgeStdRejected > 0 ? `｜標準修正 ${r.edgeStdFixed || 0}、未達標準 ${r.edgeStdRejected || 0} 條` : '') +
        (r.typeRenamed > 0 ? `｜型別改名 ${r.typeRenamed} 條` : '') +
        // 衝突核對(檢定標準 RS4):有核對才附;理由修不了而撤出(std-retire)另列——改寫者已計入「改理由」
        (r.rs4Checked > 0 ? `｜衝突核對 ${r.rs4Checked} 條（成立 ${r.rs4Kept || 0}、改理由 ${r.rs4ReasonFixed || 0}、非衝突 ${(r.rs4Downgraded || 0) + (r.rs4NotSplit || 0)}、無關聯 ${r.rs4Retired || 0}、理由修不了而撤出 ${r.rs4StdRetired || 0}、判不了 ${r.rs4Undetermined || 0}）` : '') +
        // 候選輪巡(檢定標準 RS10;有輪巡或用盡才附):本輪輪巡篇數、新建之邊、進度(用盡篇數／已關聯篇數)
        (r.rotationTargets > 0 || r.rotationExhausted > 0 ? `｜輪巡 ${r.rotationTargets || 0} 篇（新邊 ${r.rotationEdges || 0}；用盡 ${r.rotationDone || 0}／${r.rotationTotal || 0} 篇）` : '') +
        // 既有邊覆核(檢定標準 RS6;有覆核才附):各處置數與進度(已核／受檢總數)
        (r.rs6Checked > 0 ? `｜既有邊覆核 ${r.rs6Checked} 條（成立 ${r.rs6Kept || 0}、改理由 ${r.rs6ReasonFixed || 0}、改型 ${r.rs6Retyped || 0}、升為衝突 ${r.rs6Upgraded || 0}、無關聯 ${r.rs6Retired || 0}、理由修不了而撤出 ${r.rs6StdRetired || 0}、型別判不了 ${r.rs6TypeSplit || 0}、判不了 ${r.rs6Undetermined || 0}；進度 ${r.rs6Done || 0}／${r.rs6Total || 0}）` : '')
}

/**
 * 關聯物件:relate(邊庫:正向、反向、輪巡、內容變更與刪除之反應、重評、既有邊覆核、衝突核對)→ project(待投影之筆記依邊庫重算 md 兩章)
 * → relationIndex(邊有變化、本輪有重標或總覽待重建時重建總覽)。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}；relate 子階段之 opts 亦可直接平鋪於 opt(見檔頭)
 * @param {Array} [opt.stages] 輸入整組重排之子階段陣列，給了即取代 relate／project／relationIndex 三個內建子階段
 * @param {Object} [opt.relate] 輸入透傳給 stageRelate 之 opt(與平鋪 opts 合併，opt.relate 優先；tap 則與平鋪之 tap 合併)
 * @param {Object} [opt.reeval] 輸入重評鏈 { tap?:掛載規格(錨點 verdict／agree／apply／markReviewed), chain?:整條置換之鏈 }(轉為 stageRelate 之
 *   reevalTap／reevalChain;tap 與平鋪或 opt.relate 之 reevalTap 合併)
 * @param {Object} [opt.project] 輸入透傳給 stageRelateProject 之 opt
 * @param {Object} [opt.relationIndex] 輸入透傳給 stageRelationIndex 之 opt
 * @param {String} [opt.name='關聯'] 輸入階段名稱
 * @param {String} [opt.onError='continue'] 輸入階段失敗處置，'continue'／'abort'
 * @returns {Object} 回傳階段物件 { name, onError, when?, timeoutMs?, always?, run(ctx) }
 * @throws {Error} 平鋪 tap 與 opt.relate.tap 同錨點皆給 replace、子階段或重評鏈之 tap 對不上錨點、opt.reeval 形狀不合、或整條重評鏈給了兩處時拋出
 * @example
 * need test in nodejs.
 *
 * let obj = createRelateObject({ relate: { reversePerRun: 4 }, relationIndex: { indexTopN: 20 } })
 * console.log(obj.name)
 * // => 關聯
 */
export function createRelateObject(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const stages = opt.stages || [
        stageRelate(relateOptOf(opt)),
        stageRelateProject(opt.project || {}),
        stageRelationIndex(opt.relationIndex || {}),
    ]
    return {
        ...stageFields(opt, { name: RELATE_REPORT_KEYS.stage }),
        run: async (ctx) => {
            const reports = await runSubStages(stages, ctx)
            return objectReport(reports, summaryOf(reports, () => relateSummaryOf(reports)))
        },
    }
}

export default createRelateObject
