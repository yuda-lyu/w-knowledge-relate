// relateHolds.mjs — 關聯之待判(待判登錄之關聯端用法):期限、重評之標準識別(RS5)、面向使用者之下一步與處置 API 之字樣
//
// 【期限】關聯之待判一律 RELATE_HOLD_DEADLINE_DAYS 天(relateHoldDeadlineOf——期限之機制為抓取套件之 holdDeadlineOf;重評、衝突核對、
//   既有邊覆核、還原與存量處置之登錄同讀此處);刻意不開放設定(同摘要套件之待判期限)。
// 【標準識別】RS5＝重評(物件 edge＝判不了之邊、note＝逾次未評完之篇);RS4、RS6 之識別在其判定之純函數模組(conflictCheckPolicy、
//   edgeReviewPolicy),與檢核紀錄之版本同處。
// 【字樣】面向使用者之下一步、處置方式與日誌之提示:指本套件之處置 API(restoreEdge、restoreNote、undoDeleteNote、deleteNote、requestRetry、
//   waiveHold、reevalBaseline、projectAll、pruneDangling)與其選項(opt.apply、opt.all、opt.reason、opt.by、opt.ruling、opt.withHolds),不指特定執行端之指令。
//   日誌之前綴(關聯邊庫世代不符、關聯懸空邊、關聯帳檔損壞、關聯投影手改另存、關聯型別不在現行清單、關聯重評守門、關聯刪除或還原未完成、逐項鏈異常)與
//   重評逾次之句「關聯重評：<id> 逾 N 次未評完（尚有 N 條未判），已登錄待判（RS5）」是外部巡檢所讀之字樣,不在此改。

import isobj from 'wsemi/src/isobj.mjs'
import { holdDeadlineOf, strOf } from '../core/capturePackage.mjs'
import { RS4 } from './conflictCheckPolicy.mjs'
import { edgeTimeOf } from './edgeStore.mjs'

/** 待判之期限(天;關聯之全部待判同一期限) */
export const RELATE_HOLD_DEADLINE_DAYS = 30

/**
 * 待判之期限時刻(登錄時刻＋RELATE_HOLD_DEADLINE_DAYS 天;抓取套件之 holdDeadlineOf)
 *
 * @param {String} nowIso 輸入登錄時刻
 * @returns {String} 回傳期限時刻(ISO 8601,UTC)
 * @throws {RangeError} nowIso 不可解析時拋出
 * @example
 * console.log(relateHoldDeadlineOf('2026-10-05T10:00:00+08:00'))
 * // => 2026-11-04T02:00:00.000Z
 */
export function relateHoldDeadlineOf(nowIso) {
    return holdDeadlineOf(nowIso, RELATE_HOLD_DEADLINE_DAYS)
}

/** 重評之標準識別:ID、待判登錄之物件種類(edge＝判不了之邊、note＝逾次未評完之篇) */
export const RS5 = Object.freeze({ std: 'RS5', objectEdge: 'edge', objectNote: 'note' })

/**
 * 使用者對一條邊之豁免是否仍涵蓋其現值(使用者之裁示不被自動流程推翻,值變了才重提):豁免時刻不早於邊之時刻(updatedAt‖createdAt)——
 *   存量佇列不重排、還原不重登之同一判定;以時刻比較(任一無法解析時依字面)
 *
 * @param {Object|null} hold 輸入待判登錄
 * @param {Object|null} edge 輸入邊之現值
 * @returns {Boolean} 回傳是否涵蓋(非豁免者 false)
 * @example
 * console.log(waiverCoversEdge({ status: 'waived', waivedAt: '2026-10-02T00:00:00Z' }, { createdAt: '2026-10-01T00:00:00+08:00' }), waiverCoversEdge({ status: 'waived', waivedAt: '2026-10-02T00:00:00Z' }, { createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-03T00:00:00+08:00' }))
 * // => true false
 */
export function waiverCoversEdge(hold, edge) {
    if (!isobj(hold) || hold.status !== 'waived') return false
    const at = edgeTimeOf(edge)
    const w = strOf(hold.waivedAt)
    const x = Date.parse(at)
    const y = Date.parse(w)
    return !(Number.isFinite(x) && Number.isFinite(y) ? x > y : at > w)
}

/**
 * 處置 API 之提示(日誌、拋錯與處置方式之尾段共用;面向使用者)
 *
 * @type {Object}
 */
export const RELATE_API_HINT = Object.freeze({
    pruneDangling: '確認後以 pruneDangling（opt.apply）清理',
    projectAll: '可用 projectAll（opt.all）全庫重投補回',
    migrate: '邊 id 非無序對身分之舊世代資料，須先遷移',
    reevalBaseline: '確認後以 reevalBaseline（opt.apply、opt.by、opt.ruling）重設基準',
    reevalBaselineRuling: 'reevalBaseline 之 opt.apply 須記裁示者與裁示內容（opt.by、opt.ruling）——記為評完而未判是使用者之裁示',
    withHolds: '確認仍要還原者給 opt.withHolds（照還原並登錄待判，由使用者修正）',
    restoreNote: '請以 restoreNote（重新收件：過標準）或 undoDeleteNote（撤銷刪除：原樣放回）還原該筆記（其邊一併還原）',
    deletionResume: '以 deleteNote（續刪）或 undoDeleteNote／restoreNote（續還原）續作完成',
    restoreEdge: '可 restoreEdge 還原',
    restoreEdgeReason: '可 restoreEdge 以 opt.reason（新理由）還原',
    newReason: '撤出時之理由本身不合標準者，可給 opt.reason（新理由）以新理由還原',
})

/** reevalBaseline 豁免待判時之裁示前綴(豁免紀錄之 ruling＝前綴＋使用者之裁示內容) */
export const RELATE_BASELINE_RULING_PREFIX = 'reevalBaseline：'

/**
 * 待判之下一步(固定者;負責者 user 之使用者處置與負責者 pipeline 之管線重判——皆見於待判清單,各段不另寫字面)
 *
 * @type {Object}
 */
export const RELATE_HOLD_NEXT = Object.freeze({
    // 重評(RS5):判不了之邊、逾次未評完之篇
    reevalEdge: '使用者判讀：要求重試（requestRetry：該篇本版本再評此邊）或豁免（waiveHold：保留，本版本不再評）',
    reevalNote: '使用者判讀：要求重試（requestRetry：該篇本版本再評未判之邊）或豁免（waiveHold：保留）',
    // 衝突核對(RS4):新衝突之提案判不了;既有衝突邊須經核對(還原帶回、他段轉交、下游登錄)
    proposalUndetermined: '使用者判讀：要求重試（requestRetry：換席位或補材料後重判）或豁免（waiveHold：提案不落地）',
    conflictCheck: '下輪衝突核對兩席核對（relate.standards.conflictCheck.enabled 開啟時）',
    // 衝突核對(RS4)之管線重判:提案本輪未及核對、判定小組未成立或核對期間邊被改寫、存量之衝突型邊(RS2／RS3／RS8;存量處置排入或既有邊覆核轉交)
    proposalPending: '下輪衝突核對',
    conflictCheckRetry: '下輪衝突核對重判',
    conflictCheckStock: '下輪衝突核對兩席核對：成立者之現行理由未達標準即以成立之票所附理由改寫，修不了即撤出（可還原）',
    // 既有邊覆核(RS6):關聯成立而型別判不了
    typeSplit: '使用者判讀型別：要求重試（requestRetry：換席位重判）或豁免（waiveHold：維持現行型別）',
    // 既有邊覆核(RS6)之管線重判:判定小組未成立或覆核期間邊被改寫、存量(RS2／RS3／RS8)、型別不在現行清單(RS1)
    edgeReviewRetry: '下輪既有邊覆核重判',
    edgeReviewStock: '既有邊覆核(RS6)開啟時優先重判:成立者須改寫理由使過納入閘,否則撤出(可還原)',
    edgeReviewTypeOffList: '既有邊覆核(RS6)重判型別:兩席成立之清單內型別過納入閘即改型;關聯成立而未得清單內型別 → 使用者;無關聯 → 撤出(可還原)',
    // 存量處置(RS3):現行理由已合正體而沿革(history)之字形之確定性修正做不到——改寫理由修不了沿革,本套件無改寫沿革之途徑 → 使用者;
    //   沿革被他途改正者存量處置套用時自動結案(closeStockHold),不必豁免
    stockHistoryScript: '使用者判讀：沿革（history）中之理由有確定性修正做不到之字形，本套件無改寫沿革之途徑——豁免（waiveHold：保留沿革原樣；符合度掃描即記已豁免）；沿革已被他途改正者，存量處置套用時自動結案',
})

/**
 * 逾次未得判定而改由使用者之下一步(衝突核對、既有邊覆核;管線只消化 pipeline 或要求重試者,下一步須為使用者可完成之處置)
 *
 * @param {Integer} maxTries 輸入次數上限
 * @param {String} keep 輸入豁免之結果(如「提案不落地」「維持現值」)
 * @returns {String} 回傳下一步
 * @example
 * console.log(escalatedHoldNextOf(3, '維持現值'))
 * // => 逾 3 次未得判定，改由使用者：要求重試（requestRetry：換席重判）或豁免（waiveHold：維持現值）
 */
export function escalatedHoldNextOf(maxTries, keep) {
    return `逾 ${maxTries} 次未得判定，改由使用者：要求重試（requestRetry：換席重判）或豁免（waiveHold：${keep}）`
}

/**
 * 隔離之邊之下一步:以 restoreEdge 還原即使用者對該標準之裁示(本待判結案、記檢核,不再自動判此值);否則豁免維持撤出
 *
 * @param {String} std 輸入標準(RS4.std 衝突核對｜RS6.std 既有邊覆核)
 * @param {String} edgeId 輸入邊 id
 * @returns {String} 回傳下一步
 * @example
 * console.log(quarantineHoldNextOf('RS4', 'e1'))
 * // => 使用者判讀：確認為真衝突者以 restoreEdge（邊 e1，opt.apply）還原（即裁示為真衝突：本待判結案、記檢核，不再自動核對此值）；否則豁免（waiveHold：維持隔離）
 * console.log(quarantineHoldNextOf('RS6', 'e2'))
 * // => 使用者判讀：確認關聯成立者以 restoreEdge（邊 e2，opt.apply）還原（即裁示關聯成立：本待判結案、記檢核，不再自動覆核此值）；否則豁免（waiveHold：維持撤出）
 */
export function quarantineHoldNextOf(std, edgeId) {
    return std === RS4.std
        ? `使用者判讀：確認為真衝突者以 restoreEdge（邊 ${edgeId}，opt.apply）還原（即裁示為真衝突：本待判結案、記檢核，不再自動核對此值）；否則豁免（waiveHold：維持隔離）`
        : `使用者判讀：確認關聯成立者以 restoreEdge（邊 ${edgeId}，opt.apply）還原（即裁示關聯成立：本待判結案、記檢核，不再自動覆核此值）；否則豁免（waiveHold：維持撤出）`
}

/**
 * 現行理由確定不合格而修不了即撤出(std-retire)之處置方式(衝突核對、既有邊覆核同一句):兩席判成立而現行理由不合格,又無可用之改寫理由
 *   (席位未附改寫,或所附理由亦未達標準)
 *
 * @param {String} why 輸入現行理由之違反
 * @param {String} edgeId 輸入邊 id
 * @returns {String} 回傳處置方式
 * @example
 * console.log(stdRetiredHowOf('理由過短', 'e1'))
 * // => 現行理由未達標準（理由過短）且無可用之改寫理由（席位未附改寫，或所附理由亦未達標準），已撤出（std-retire；可 restoreEdge（邊 e1，opt.reason＝新理由、opt.apply）還原）
 */
export function stdRetiredHowOf(why, edgeId) {
    return `現行理由未達標準（${why}）且無可用之改寫理由（席位未附改寫，或所附理由亦未達標準），已撤出（std-retire；可 restoreEdge（邊 ${edgeId}，opt.reason＝新理由、opt.apply）還原）`
}

export default {
    RELATE_HOLD_DEADLINE_DAYS, relateHoldDeadlineOf, RS5, waiverCoversEdge, RELATE_API_HINT, RELATE_BASELINE_RULING_PREFIX, RELATE_HOLD_NEXT,
    escalatedHoldNextOf, quarantineHoldNextOf, stdRetiredHowOf,
}
