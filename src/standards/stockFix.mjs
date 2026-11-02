// stockFix.mjs — 邊之檢定標準存量處置:預演(plan)→ 套用(apply;處置帳可回退)→ 連鎖斷言(verify)→ 回退(rollback)
//
// 【目標取自符合度掃描】與每輪掃描同一判定(standards/audit 之 RS2、RS3、RS8;RS8 以兩端筆記之材料判):只處置現行違反者(已豁免者不在其列)。
//   RS3 → 確定性修正(本檔之 edgeFixOf:理由與 history 之理由轉正體,只改違規處、[[連結]] 與網址不轉;id、型別、updatedAt 不動
//   ——正體修正不是內容變更,重評以 updatedAt 挑邊);套用時逐條以現值重算(已不須修者列 stale)。
//   RS2、RS8 → 修正須重寫理由(AI),不在此猜:登錄待判交兩席改寫——非衝突型交既有邊覆核(RS6;standards/edgeQueue 之 queueEdgeReview),
//   衝突型交衝突核對(RS4;queueConflictCheck——衝突型之核對屬 RS4,其現行理由之違反由衝突核對改寫);兩段送審時即要求 change 改寫
//   (standards/edgeGate 之 reasonRewriteProblemsOf),成立而改寫不過者由各該段撤出(std-retire,可還原)。
// 【修不了者(RS3)以現值重判分流】確定性修正做不到者(預演之 unfixable)由套用逐條以現值重判:邊不在、RS3 已合格、或現值已可確定性修正
//   (交下次預演之修正項)→ stale;現行理由經正規化仍未合正體(reasonRewriteProblemsOf 含 RS3)→ 與 RS2／RS8 同一去處(依型別交兩席改寫);
//   只剩沿革(history)之字形 → 使用者待判 edge:<邊 id>:RS3(下一步 RELATE_HOLD_NEXT.stockHistoryScript)。掃描唯讀、不會結案,修不了者
//   須交給能完成處置之負責者:現行理由仍不合格 → 管線改寫(兩席);只剩沿革 → 使用者豁免(改寫理由修不了沿革,本套件無改寫沿革之途徑)。
//   期限一律 relateHoldDeadlineOf、下一步一律取 stores/relateHolds 之常數。修不了者不得留在庫中而無負責者。
// 【豁免:同一問題之裁示不重提】交兩席改寫之登錄(RS2／RS8 之項、修不了之 RS3)先看該邊之覆核待判(RS6;衝突型為 RS4):使用者已豁免而
//   其來源即本標準者(standards/edgeQueue 之 stockWaiverKeyOf)→ 不重開(列 alreadyHeld);豁免之來源不同或無(如型別判不了之豁免)→ 照登錄
//   (新問題;前段之裁示由待判之 history 留存)。已有未結者不重登。使用者待判 edge:<邊 id>:RS3:已有未結或已豁免者不重登。符合度掃描以同一
//   判定把前者記為該標準之已豁免——預演因而不再列之。
// 【已不再違反之結案(各工作之存量待判件同一機制:抓取套件 core/stores/holds)】本模組所登錄之使用者待判 edge:<邊 id>:RS3,其邊仍在而現值以 checkEdge 判 RS3 合格者
//   (沿革已被他途改正等),預演列 resolvable(受 ids 限、不受 limit 限)、套用以抓取套件之 closeStockHold 結案並記結案列、回退 reopenStockHold
//   復原、連鎖斷言驗其登錄在且已結案。邊不在(撤出中,可 restoreEdge 還原——其問題仍會回來)、不適用、未能判定皆不結(未能判定不結案)。
//   交兩席改寫之登錄(RS6／RS4,ctx.stockStd)之「已不再違反」由兩席段入項前預檢結案(standards/edgeQueue 之 stockSourceResolvedOf),不在此列。
// 【連鎖】RS3 修正之連鎖(本套件可處置者):RS4／RS6 之檢核紀錄原與舊值同步者(雜湊＝舊值之雜湊)換為新值之雜湊——字形修正不作廢已核之結果、
//   不觸發重核;原本就不同步者(另有未處理之變更)不動。呼叫端之連鎖(如讀關聯之下游之邊庫快照)經 opt.onEdgeFixed(before, after) 處置,
//   其回傳之物件併入該帳列(回退時經 opt.onEdgeRolledBack(row) 換回)。兩端之投影交呼叫端:套用與回退回傳受影響之兩端(affected),
//   以 ops/projectOps 之 projectAffected 記待投影、總覽待重建並當場投影。
// 【處置帳】抓取套件之帳協定(opt.ledgerFile;未給為 deps.dirs.state 下之 STOCK_LEDGER_FILE——四工作與宿主同一本帳,本模組只讀寫自己之列):
//   邊列 { at, object:'edge', id, stds:['RS3'], changes, before:{ edge(處置前之邊全值) }, after:{ edge(處置後之邊全值) }, …onEdgeFixed 之回傳,
//   check?:{ from, to }(檢核紀錄之雜湊換值) };覆核列 { at, object:'edge-review', id:邊 id, stds, before:{ hold:登錄前之記錄｜null }, hold:登錄鍵 };
//   修不了之待判列 { at, object:'hold', id:登錄鍵, stds, before:{ hold }, hold:登錄鍵 };結案列 { at, object:'hold-resolved', id:登錄鍵, stds, before:{ hold:結案前之登錄 }, hold:登錄鍵 };
//   回退列 { at, rollbackOf, object, id }。先寫邊、即記帳、再換檢核雜湊——
//   其後之步驟失敗亦可依帳回退。讀帳(readEdgeStockLedger)遇無法解析之列即拋(allowBad 才略過)。
// 【回退＝撤銷該次處置之效果】邊列之擁有單位＝該次處置改過之欄位(理由、沿革中被修之理由——以提案身分 from|to|type|createdAt 識別;RS3 只改此);
//   以抓取套件之回退防護(rollbackPlanOf)逐單位比現值:＝after 者寫回 before(其餘欄位——其後之合併、型別等——保留現值)、已＝before 者已完成;
//   其後被改動之單位或邊已不在(其後被撤出)→ 衝突(不覆寫、不復活、不記回退列;opt.acceptCurrent 記取代列)。覆核列與待判列只動同一登錄
//   (未結且登錄時刻＝帳列之時刻;抓取套件之 rollbackStockHold)。
// 【回退逐列】rollbackEdgeStockFix 接受任意帳列(他模組之列略過:restored 0、不報錯):呼叫端依帳之全域逆序逐列交付,與他模組之列交錯時先後不變。
// 【呼叫端負責】取執行鎖、一致備份、使用者同意(正式庫)。本模組不取鎖、不呼叫 AI。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { STATUS, strOf, scriptOf } from '../core/capturePackage.mjs'
import {
    holdKey, stockLedgerFileOf, stockAtOf, stockLedgerRowsOf, stockLedgerWriter, appendRollbackRow, rollbackPlanOf, stockErrorOf, holdStockUnfixable, closeStockHold, rollbackStockHold, reopenStockHold,
    stockHoldProblems,
} from '../core/capturePackage.mjs'
import { checkKey } from '../core/stores/checks.mjs'
import { writeEdge } from '../stores/edgeStore.mjs'
import { openRelateLedgers } from '../stores/relateLedgers.mjs'
import { RS4 } from '../stores/conflictCheckPolicy.mjs'
import { relationTypesVersionOf } from '../stores/edgeCheckKit.mjs'
import { createCheckHasher } from '../stores/checkMaterial.mjs'
import { RS6 } from '../stores/edgeReviewPolicy.mjs'
import { relateHoldDeadlineOf, RELATE_HOLD_NEXT } from '../stores/relateHolds.mjs'
import { queueEdgeReview, queueConflictCheck, EDGE_REVIEW_STDS } from './edgeQueue.mjs'
import { checkEdge } from './edgeStandards.mjs'
import { reasonRewriteProblemsOf, gateCtxOf, scriptFixHistory } from './edgeGate.mjs'
import { auditRelateStandards } from './audit.mjs'

/** 確定性修正之標準 */
const FIX_STD = 'RS3'

/**
 * 一條邊之 RS3 修正(純函數;字形政策依語言設定——非繁體中文之語言為恆等、恆回 null):理由與沿革(history)之理由轉正體(只改違規處;[[連結]] 與網址原樣,
 *   與 RS3 之判定同一範圍);id、型別、updatedAt 不動(重評以 updatedAt 挑邊——正體修正不是內容變更)
 *
 * @param {Object} edge 輸入邊
 * @param {Object} [ctx={}] 輸入 { locale:語言設定或字形政策(未給＝臺灣正體) }
 * @returns {Object|null} 回傳 { edge(新值;updatedAt 不變), changes:[{ std, what }] };無須修正回 null
 * @throws {Error} ctx.locale 不合時拋出
 * @example
 * const r = edgeFixOf({ id: 'e1', reason: '两篇皆以近日点距离之量测方法比较轨道' })
 * console.log(r.edge.reason, r.changes)
 * // => 兩篇皆以近日點距離之量測方法比較軌道 [ { std: 'RS3', what: '理由轉正體' } ]
 *
 * console.log(edgeFixOf({ id: 'e1', reason: '兩篇皆以近日點距離之量測方法比較軌道' }))
 * // => null
 *
 * const h = edgeFixOf({ id: 'e2', reason: '兩篇', history: [{ type: 'T', reason: '两篇' }] })
 * console.log(h.edge.history[0].reason, h.changes)
 * // => 兩篇 [ { std: 'RS3', what: '沿革理由轉正體 1 筆' } ]
 */
export function edgeFixOf(edge, ctx = {}) {
    const script = scriptOf(ctx?.locale, 'edgeFixOf 之 ctx.locale')
    if (!isobj(edge)) return null
    const reason0 = String(edge.reason ?? '')
    const reason = script.fixKeepLinks(reason0)
    const hist0 = isarr(edge.history) ? edge.history : []
    // 沿革之字形修正與納入閘之正規化同一份(standards/edgeGate);型別不動、理由非字串之筆不動(修不了者交使用者)
    const hs = scriptFixHistory(hist0, (s) => script.fixKeepLinks(s), { stringOnly: true })
    if (reason === reason0 && hs.fixed === 0) return null
    const changes = []
    if (reason !== reason0) changes.push({ std: FIX_STD, what: '理由轉正體' })
    if (hs.fixed) changes.push({ std: FIX_STD, what: `沿革理由轉正體 ${hs.fixed} 筆` })
    return { edge: { ...edge, reason, ...(hist0.length ? { history: hs.history } : {}) }, changes }
}

/** 可處置之標準:RS3 確定性修正;RS2、RS8 交兩席改寫 */
export const EDGE_FIX_STDS = Object.freeze([FIX_STD, ...EDGE_REVIEW_STDS])

/** 邊列之本模組欄位(onEdgeFixed 之回傳不得覆寫) */
const ROW_KEYS = Object.freeze(['at', 'object', 'id', 'stds', 'changes', 'before', 'after', 'check', 'hold', 'rollbackOf'])

/**
 * 邊之擁有單位之值(回退防護之單位;檔頭【回退＝撤銷該次處置之效果】):理由、沿革各提案之理由(以提案身分識別)
 *
 * @param {Object|null} edge 輸入邊
 * @returns {Object|null} 回傳 單位 → 理由(邊不在回 null)
 */
function edgeUnitsOf(edge) {
    if (!isobj(edge)) return null
    const out = { reason: strOf(edge.reason) }
    for (const h of isarr(edge.history) ? edge.history : []) if (isobj(h)) out[`history:${strOf(h.from)}|${strOf(h.to)}|${strOf(h.type)}|${strOf(h.createdAt)}`] = strOf(h.reason)
    return out
}

/**
 * 邊列之回退之單位:處置前後有變之單位(其餘欄位不屬該次處置)
 *
 * @param {Object} r 輸入邊列
 * @returns {Object} 回傳 { before, after }(以單位為鍵)
 * @throws {Error} 帳列缺 before／after 之邊時拋出(缺 after 之值列即錯)
 */
function edgeRowUnitsOf(r) {
    if (!isobj(r.before?.edge) || !isestr(r.before.edge.id)) throw new Error('帳列缺 before（邊之處置前值），無從還原')
    if (!isobj(r.after?.edge)) throw new Error('帳列缺 after（處置後之值），無從判定其後是否被改動')
    const b = edgeUnitsOf(r.before.edge)
    const a = edgeUnitsOf(r.after.edge)
    const before = {}
    const after = {}
    for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])]) {
        if (b[k] === a[k]) continue
        if (Object.hasOwn(b, k)) before[k] = b[k]
        if (Object.hasOwn(a, k)) after[k] = a[k]
    }
    return { before, after }
}

/**
 * 寫邊前之記帳(關聯帳之 touch:兩端記待投影＋總覽待重建——與管線之寫邊同一規則;先記後寫)。用到才開帳(回退逐列交付、他模組之列不開)
 *
 * @param {Object} deps 輸入 { dirs:{ state } }
 * @param {String} where 輸入呼叫處之名稱(錯誤訊息用)
 * @returns {Object} 回傳 { touch:(ids)=>undefined }
 * @throws {Error} 寫邊時 deps.dirs.state 未給則拋出(不靜默略過記帳)
 */
function edgeLedgersOf(deps, where) {
    let ledgers = null
    return {
        touch: (ids) => {
            if (!ledgers) {
                if (!isestr(deps?.dirs?.state)) throw new Error(`${where} 需要 deps.dirs.state（寫邊前記待投影與總覽待重建）`)
                ledgers = openRelateLedgers(deps.dirs.state, { stamp: deps.clock?.stamp8?.(), log: deps.log }) // 壞帳之告警同關聯段(字樣一份)
            }
            ledgers.touch(ids)
        },
    }
}

/**
 * 邊寫回處置前之擁有單位(其餘欄位保留現值)
 *
 * @param {Object} cur 輸入現值
 * @param {Object} before 輸入處置前之單位
 * @param {Array} units 輸入要寫回之單位
 * @returns {Object} 回傳寫回後之邊值
 */
function edgeRestoredOf(cur, before, units) {
    const next = { ...cur }
    if (units.includes('reason')) next.reason = before.reason
    if (isarr(cur.history)) {
        next.history = cur.history.map((h) => {
            const k = isobj(h) ? `history:${strOf(h.from)}|${strOf(h.to)}|${strOf(h.type)}|${strOf(h.createdAt)}` : ''
            return k && units.includes(k) && Object.hasOwn(before, k) ? { ...h, reason: before[k] } : h
        })
    }
    return next
}

/**
 * 預演與套用之關聯 domain(掃描之判定、檢核雜湊之型別定義版本、衝突型之去處)
 *
 * @param {Object} deps 輸入依賴物件
 * @param {String} where 輸入呼叫處之名稱(錯誤訊息用)
 * @returns {Object} 回傳 deps.domain
 * @throws {Error} 缺 domain 或缺型別清單、空泛片語、衝突型之名時拋出(任何寫入前)
 */
function stockDomainOf(deps, where) {
    const d = deps?.domain
    if (!isobj(d) || !isarr(d.relationTypes) || !isarr(d.vagueReasons) || !isarr(d.conflictTypeNames)) {
        throw new Error(`${where} 需要 deps.domain（關聯 domain，createRelateDomain 之產物——掃描之判定、檢核雜湊之型別定義版本與衝突型之去處皆讀之）`)
    }
    return d
}

/**
 * 是否為本模組之帳列:邊列、覆核列、邊之待判列與結案列(stds 皆為 EDGE_FIX_STDS;待判列與結案列之登錄鍵之物件為邊)
 *
 * @param {*} r 輸入帳列
 * @returns {Boolean} 回傳是否為本模組之列
 */
function isEdgeRow(r) {
    if (!isobj(r) || r.rollbackOf || !isarr(r.stds) || !r.stds.length || !r.stds.every((s) => EDGE_FIX_STDS.includes(s))) return false
    if (r.object === 'edge' || r.object === 'edge-review') return true
    return (r.object === 'hold' || r.object === 'hold-resolved') && strOf(r.hold || r.id).startsWith(`${RS6.objectEdge}:`)
}

/**
 * 須改寫理由之邊登錄待判(依型別:衝突型交衝突核對 RS4、其餘交既有邊覆核 RS6;期限與下一步取 stores/relateHolds 之常數)。
 *   使用者已對同一問題豁免該待判者(stockWaiverKeyOf＝edge:<邊 id>:<本標準>)不重開;豁免之來源不同或無者照登錄(檔頭【豁免】)
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {Object} domain 輸入關聯 domain(取 conflictTypeNames)
 * @param {Object} edge 輸入邊之現值
 * @param {Object} o 輸入 { std:標準(登錄之來源;REASON_REWRITE_STDS 之一), why:String, at:ISO }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { r:'queued'|'exists'|'waived', key:登錄鍵, prior:登錄前之記錄｜null(帳列之 before.hold;回退時寫回) }
 */
async function queueRewrite(holds, domain, edge, o) {
    const conflict = domain.conflictTypeNames.includes(edge.type)
    const key = conflict ? holdKey(RS4.objectEdge, edge.id, RS4.std) : holdKey(RS6.objectEdge, edge.id, RS6.std)
    const prior = (await holds.get(key)) || null
    // 同一問題之豁免不重開:登錄件內建此守門(standards/edgeQueue 檔頭【豁免之守門】),回 'waived'
    const r = conflict
        ? await queueConflictCheck(holds, {
            edgeId: edge.id, from: edge.from, to: edge.to, at: o.at,
            reason: `存量 ${o.std}（衝突型）：${strOf(o.why).slice(0, 160)}`,
            next: RELATE_HOLD_NEXT.conflictCheckStock,
            ctx: { stockStd: o.std },
        })
        : await queueEdgeReview(holds, edge, { std: o.std, why: o.why, at: o.at })
    return { r, key, prior: prior ? JSON.parse(JSON.stringify(prior)) : null }
}

/**
 * 修不了者之去處(以現值重判;檔頭【修不了者(RS3)以現值重判分流】):RS3 已合格或現值已可確定性修正 → null(stale);現行理由經正規化
 *   仍未合正體 → 交兩席改寫;只剩沿革之字形 → 使用者。RS2／RS8(預演不產生;他處給者)照交兩席改寫
 *
 * @param {Object} cur 輸入邊之現值
 * @param {String} std 輸入修不了之標準
 * @param {String} detail 輸入預演之說明
 * @param {Object} domain 輸入關聯 domain(型別解析、空泛片語)
 * @param {Object} [locale] 輸入語言設定(deps.locale;RS3 之適用與修正依之)
 * @returns {Object|null} 回傳 { to:'rewrite'|'user', why } 或 null(不須登錄)
 */
function unfixableRouteOf(cur, std, detail, domain, locale) {
    if (std !== FIX_STD) return { to: 'rewrite', why: `確定性修正做不到（${detail}）` }
    const r3 = checkEdge(cur, { locale }).find((x) => x.std === FIX_STD)
    if (r3?.status !== STATUS.VIOLATION || edgeFixOf(cur, { locale })) return null
    const p = reasonRewriteProblemsOf(cur, gateCtxOf(domain, { locale })).find((x) => x.startsWith(`${FIX_STD} `))
    return p ? { to: 'rewrite', why: `確定性修正後現行理由仍未合正體（${p.slice(FIX_STD.length + 1)}）` } : { to: 'user', why: r3.detail }
}

/**
 * 只剩沿革之字形之修不了者之使用者待判 edge:<邊 id>:RS3(交抓取套件之存量待判件登錄:已有未結或已豁免者不重登;下一步
 *   RELATE_HOLD_NEXT.stockHistoryScript、期限 relateHoldDeadlineOf)
 *
 * @param {Object} edge 輸入邊之現值
 * @param {Object} o 輸入 { detail:String(RS3 之說明), at:ISO }
 * @returns {Object} 回傳待判之欄位(holdStockUnfixable 之 h)
 */
function historyScriptHoldOf(edge, o) {
    return {
        object: RS6.objectEdge, oid: edge.id, std: FIX_STD,
        reason: `存量 ${FIX_STD}：沿革理由之字形確定性修正做不到（${strOf(o.detail).slice(0, 160)}）`,
        next: RELATE_HOLD_NEXT.stockHistoryScript,
        owner: 'user',
        deadline: relateHoldDeadlineOf(o.at),
        ctx: { from: edge.from, to: edge.to, type: edge.type },
    }
}

/**
 * RS3 修正後檢核紀錄之雜湊換值(連鎖;檔頭):紀錄之雜湊＝舊值之雜湊者才換(原本就不同步者不動)
 *
 * @param {Object} stores 輸入集合(notes 之 get:兩端內容版本)
 * @param {Object} checks 輸入 checks 集合
 * @param {Object} before 輸入修正前之邊
 * @param {Object} after 輸入修正後之邊
 * @param {String} typesVer 輸入關聯型別定義之版本
 * @param {Object} domain 輸入關聯 domain(檢核雜湊之素材讀法 seenTextOf)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { rec, from, to } 或 null(無紀錄或不同步)
 */
async function checkSyncOf(stores, checks, before, after, typesVer, domain) {
    const rec = await checks.get(checkKey(RS6.objectEdge, before.id))
    if (!isobj(rec)) return null
    const a = await stores.notes.get(before.from)
    const b = await stores.notes.get(before.to)
    // 與關聯段同一算法、同一素材讀法(stores/checkMaterial.createCheckHasher)
    const hashOf = createCheckHasher({ byId: new Map([[before.from, a], [before.to, b]]), domain, typesVer }).hashOf
    const from = hashOf(before)
    if (rec.hash !== from) return null
    return { rec, from, to: hashOf(after) }
}

/**
 * 預演:列出各邊之處置(不寫任何東西)
 *
 * @param {Object} deps 輸入 { stores:{ relations(select／get), notes(select;RS1 之端點、RS8 之材料), holds?(使用者豁免;已不再違反之未結登錄) }, domain(關聯 domain), clock? }
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Array} [opt.stds] 輸入只處置這些標準(EDGE_FIX_STDS 之子集;未給或空陣列＝全部;其他 id 略過)
 * @param {Array} [opt.ids] 輸入只處置這些邊 id
 * @param {Integer} [opt.limit] 輸入每標準至多幾件(正整數;依掃描之序;RS3 之修不了者於達上限前照列;已不再違反之未結登錄不受限)
 * @param {String} [opt.at] 輸入預演時刻 ISO(預設 clock.iso8() 或現在)
 * @returns {Promise} 回傳 Promise,resolve 回傳 { at, stds,
 *   items:[{ object:'edge', id, stds:['RS3'], changes:[{ std, what }], ends:[from, to] } | { object:'edge-review', id, stds:[RS2|RS8], why }],
 *   unfixable:[{ id, std:'RS3', detail }], resolvable:[{ key, id, std:'RS3' }](本模組所登錄之使用者待判而邊之現值已合格者;套用時結案;檔頭【已不再違反之結案】),
 *   counts:{ violations:{ 標準: 掃描之違反數 }, items, unfixable, resolvable, fixes:{ 標準: 件數 } } }
 * @throws {Error} deps.stores.relations 缺 select／get 方法、deps.stores.notes 缺 select 方法、或缺 deps.domain 時拋出
 * @example
 * need test in nodejs.
 *
 * const plan = await planEdgeStockFix({ stores, domain, clock }, { stds: ['RS3'] })
 * console.log(plan.items.map((x) => x.id), plan.unfixable)
 */
export async function planEdgeStockFix(deps, opt = {}) {

    //check
    const stores = deps?.stores
    if (!isobj(stores) || !isfun(stores.relations?.select) || !isfun(stores.relations?.get) || !isfun(stores.notes?.select)) {
        throw new Error('planEdgeStockFix 需要 deps.stores.relations（具 select／get 方法）與 deps.stores.notes（具 select 方法）')
    }
    const domain = stockDomainOf(deps, 'planEdgeStockFix')
    if (!isobj(opt)) {
        opt = {}
    }

    const stds = [...new Set((isarr(opt.stds) && opt.stds.length ? opt.stds : EDGE_FIX_STDS).filter((s) => EDGE_FIX_STDS.includes(s)))]
    const ids = isarr(opt.ids) && opt.ids.length ? new Set(opt.ids.map(String)) : null
    const limit = Number.isInteger(opt.limit) && opt.limit > 0 ? opt.limit : Infinity
    const at = stockAtOf(deps, opt)
    const items = []
    const unfixable = []
    const resolvable = []
    const violations = {}
    const fixes = {}
    const bump = (s) => {
        fixes[s] = (fixes[s] || 0) + 1
    }
    const done = () => ({ at, stds, items, unfixable, resolvable, counts: { violations, items: items.length, unfixable: unfixable.length, resolvable: resolvable.length, fixes } })
    if (!stds.length) return done()

    // 掃描(與每輪掃描同一判定;RS8 以兩端筆記之材料判;字形政策取 deps.locale)
    const audit = await auditRelateStandards({ stores, domain, locale: deps.locale }, { only: stds })
    for (const s of stds) violations[s] = audit.standards[s]?.violation || 0
    const viol = (s) => audit.standards[s]?.violations || []

    // ── RS3:確定性修正(逐條以現值算;修不了者另列)──
    let n3 = 0
    for (const v of stds.includes(FIX_STD) ? viol(FIX_STD) : []) {
        if (ids && !ids.has(strOf(v.id))) continue
        if (n3 >= limit) break
        const e = await stores.relations.get(v.id)
        const fix = e ? edgeFixOf(e, { locale: deps.locale }) : null
        if (!fix) {
            unfixable.push({ id: v.id, std: FIX_STD, detail: e ? v.detail : '邊不在' })
            continue
        }
        items.push({ object: 'edge', id: v.id, stds: [FIX_STD], changes: fix.changes, ends: [e.from, e.to] })
        bump(FIX_STD)
        n3++
    }

    // ── RS2、RS8:交兩席改寫(套用時依型別登錄待判)──
    for (const s of EDGE_REVIEW_STDS.filter((x) => stds.includes(x))) {
        let n = 0
        for (const v of viol(s)) {
            if (ids && !ids.has(strOf(v.id))) continue
            if (n >= limit) break
            items.push({ object: 'edge-review', id: v.id, stds: [s], why: v.detail })
            bump(s)
            n++
        }
    }

    // ── 已不再違反之未結登錄(檔頭【已不再違反之結案】):本模組之使用者待判 edge:<邊 id>:RS3,邊仍在且現值以 checkEdge 判 RS3 合格者;
    //   受 ids 限、不受 limit 限;邊不在、不適用、未能判定、仍違反皆不列(套用時結案)──
    if (stds.includes(FIX_STD) && isfun(stores.holds?.select)) {
        for (const h of await stores.holds.select()) {
            if (!isobj(h) || h.object !== RS6.objectEdge || h.std !== FIX_STD || h.status !== 'open') continue
            const oid = strOf(h.oid)
            if (ids && !ids.has(oid)) continue
            const cur = await stores.relations.get(oid)
            if (!cur) continue
            if (checkEdge(cur, { locale: deps.locale }).find((x) => x.std === FIX_STD)?.status !== STATUS.PASS) continue
            resolvable.push({ key: strOf(h.id) || holdKey(RS6.objectEdge, oid, FIX_STD), id: oid, std: FIX_STD })
        }
    }
    return done()
}

/**
 * 套用預演之計畫:RS3 逐條以現值重算再寫(writeEdge 回讀驗、即記帳、檢核雜湊同步);RS2／RS8 依型別登錄待判(同一問題已豁免者不重開);
 *   修不了者以現值重判分流(stale／交兩席改寫／只沿革者交使用者);已不再違反之未結登錄結案(抓取套件之 closeStockHold;記結案列);
 *   不投影(回傳受影響之兩端,呼叫端以 projectAffected 投影)
 *
 * @param {Object} deps 輸入 { stores:{ relations(get／patch／replace), notes(get;檢核雜湊之兩端內容版本), holds?(待判;未開者列入 errors),
 *   checks?(RS4／RS6 檢核紀錄;未開者不同步) }, domain(關聯 domain), dirs?:{ state }(處置帳之預設位置), clock? }
 * @param {Object} plan 輸入 planEdgeStockFix 之產物(取 items 中 object 為 edge／edge-review 者、unfixable 與 resolvable 中 EDGE_FIX_STDS 者;他模組之項略過)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.at] 輸入處置時刻 ISO(帳列之 at、待判之登錄時刻;預設 clock.iso8() 或現在)
 * @param {String} [opt.ledgerFile] 輸入處置帳(JSONL)絕對路徑(未給為 deps.dirs.state 下之 STOCK_LEDGER_FILE)
 * @param {Function} [opt.onEdgeFixed] 輸入 (before, after) => Object|undefined(可為 async):每條 RS3 修正寫入後呼叫,回傳之物件併入該帳列
 *   (本模組之欄位不被覆寫);拋錯者該條照記帳、列入 errors
 * @returns {Promise} 回傳 Promise，resolve 回傳 { at, counts:{ RS3?, RS2?, RS8?(件數), held?(修不了者新登錄之待判數), resolved?(已不再違反而結案之待判數) },
 *   rows:Array(本次寫入之帳列), affected:Array(RS3 修正之邊之兩端筆記 id;去重), held:[{ key, id, std }](修不了者之新登錄;交兩席改寫者
 *   之鍵為 RS6／RS4 之待判、只沿革者為 edge:<邊 id>:RS3), resolved:Array(本次結案之登錄鍵),
 *   alreadyHeld:Array(已有未結、或同一問題已豁免之登錄鍵), stale:Array(現值已不須處置、已可確定性修正或邊已不在之 id), errors:[{ id, object, error }], ledgerFile }
 * @throws {Error} deps.stores.relations 缺 get／patch／replace、deps.stores.notes 缺 get、缺 deps.domain、或處置帳之路徑皆未給時拋出(任何寫入前)
 * @example
 * need test in nodejs.
 *
 * const r = await applyEdgeStockFix({ stores, domain, dirs, clock }, plan, { onEdgeFixed: (b, a) => ({}) })
 * await projectAffected({ stores, dirs, clock, domain }, r.affected)
 */
export async function applyEdgeStockFix(deps, plan, opt = {}) {

    //check
    const stores = deps?.stores
    if (!isobj(stores) || !isfun(stores.relations?.get) || !isfun(stores.relations?.patch) || !isfun(stores.relations?.replace) || !isfun(stores.notes?.get)) {
        throw new Error('applyEdgeStockFix 需要 deps.stores.relations（具 get／patch／replace 方法）與 deps.stores.notes（具 get 方法）')
    }
    const domain = stockDomainOf(deps, 'applyEdgeStockFix')
    if (!isobj(opt)) {
        opt = {}
    }
    const ledgerFile = stockLedgerFileOf(deps, opt, 'applyEdgeStockFix')
    const ledgers = edgeLedgersOf(deps, 'applyEdgeStockFix')

    const at = stockAtOf(deps, opt)
    const onEdgeFixed = isfun(opt.onEdgeFixed) ? opt.onEdgeFixed : null
    const holds = isfun(stores.holds?.get) ? stores.holds : null
    const checks = isfun(stores.checks?.get) && isfun(stores.checks?.replace) ? stores.checks : null
    const typesVer = relationTypesVersionOf(domain)
    const { log, rows } = stockLedgerWriter(ledgerFile, at)
    const counts = {}
    const bump = (k) => {
        counts[k] = (counts[k] || 0) + 1
    }
    const affected = []
    const held = []
    const resolved = []
    const alreadyHeld = []
    const stale = []
    const errors = []
    const items = (isarr(plan?.items) ? plan.items : []).filter((x) => x?.object === 'edge' || x?.object === 'edge-review')

    for (const it of items) {
        const id = strOf(it.id)
        try {
            if (it.object === 'edge') {
                const cur = await stores.relations.get(id)
                const fix = cur ? edgeFixOf(cur, { locale: deps.locale }) : null
                if (!fix) {
                    stale.push(id)
                    continue
                }
                // 檢核紀錄之換值寫前即定(帳列須記之)
                const check = checks ? await checkSyncOf(stores, checks, cur, fix.edge, typesVer, domain) : null
                ledgers.touch([cur.from, cur.to])
                await writeEdge(stores.relations, fix.edge)
                let extra = {}
                let cbErr = null
                if (onEdgeFixed) {
                    try {
                        const x = await onEdgeFixed(cur, fix.edge)
                        if (isobj(x)) extra = Object.fromEntries(Object.entries(x).filter(([k]) => !ROW_KEYS.includes(k)))
                    }
                    catch (e) {
                        cbErr = e
                    }
                }
                // 即記帳(其後之檢核換值失敗亦可依帳回退;after 供回退防護判其後是否被改動)
                log({ object: 'edge', id, stds: [FIX_STD], changes: fix.changes, before: { edge: cur }, after: { edge: fix.edge }, ...extra, ...(check ? { check: { from: check.from, to: check.to } } : {}) })
                if (check) await checks.replace({ ...check.rec, hash: check.to })
                bump(FIX_STD)
                affected.push(cur.from, cur.to)
                if (cbErr) errors.push(stockErrorOf(id, 'edge', cbErr, 'onEdgeFixed：'))
            }
            else {
                const its = (isarr(it.stds) ? it.stds : []).filter((s) => EDGE_REVIEW_STDS.includes(s))
                if (!its.length) continue
                const cur = await stores.relations.get(id)
                if (!cur) {
                    stale.push(id)
                    continue
                }
                if (!holds) throw new Error('未開 holds 集合，須改寫理由之存量未登錄待判')
                const q = await queueRewrite(holds, domain, cur, { std: its[0], why: it.why, at })
                if (q.r !== 'queued') {
                    alreadyHeld.push(q.key)
                    continue
                }
                log({ object: 'edge-review', id, stds: its, before: { hold: q.prior }, hold: q.key })
                bump(its[0])
            }
        }
        catch (e) {
            errors.push(stockErrorOf(id, it.object, e))
        }
    }

    // 修不了者:以現值重判分流(檔頭【修不了者(RS3)以現值重判分流】);須登錄而未開 holds 集合 → errors(不靜默)
    for (const u of isarr(plan?.unfixable) ? plan.unfixable : []) {
        const s = strOf(u?.std)
        if (!EDGE_FIX_STDS.includes(s)) continue
        const oid = strOf(u.id).split('#')[0]
        try {
            const cur = await stores.relations.get(oid)
            const route = cur ? unfixableRouteOf(cur, s, strOf(u.detail), domain, deps.locale) : null
            if (!route) {
                stale.push(oid)
                continue
            }
            if (!holds) throw new Error('未開 holds 集合，修不了之存量未登錄待判')
            let key = ''
            if (route.to === 'user') {
                // 使用者待判:抓取套件之存量待判件(登錄即記待判列)
                const q = await holdStockUnfixable(holds, historyScriptHoldOf(cur, { detail: route.why, at }), { at, log })
                key = q.key
                if (!q.held) {
                    alreadyHeld.push(key)
                    continue
                }
            }
            else {
                const q = await queueRewrite(holds, domain, cur, { std: s, why: route.why, at })
                key = q.key
                if (q.r !== 'queued') {
                    alreadyHeld.push(key)
                    continue
                }
                log({ object: 'hold', id: key, stds: [s], before: { hold: q.prior }, hold: key })
            }
            bump('held')
            held.push({ key, id: oid, std: s })
        }
        catch (e) {
            errors.push(stockErrorOf(oid, RS6.objectEdge, e))
        }
    }

    // 已不再違反之未結登錄:結案(檔頭【已不再違反之結案】;抓取套件之存量待判件——記結案前之登錄,回退時復原;非未結者不動、不記)
    for (const x of (isarr(plan?.resolvable) ? plan.resolvable : []).filter((y) => EDGE_FIX_STDS.includes(strOf(y?.std)))) {
        const key = strOf(x.key)
        try {
            if (!holds) throw new Error('未開 holds 集合，已不再違反之待判未結案')
            if (!(await closeStockHold(holds, key, strOf(x.std), { at, log }))) continue
            bump('resolved')
            resolved.push(key)
        }
        catch (e) {
            errors.push(stockErrorOf(key, RS6.objectEdge, e))
        }
    }

    return { at, counts, rows, affected: [...new Set(affected)], held, resolved, alreadyHeld, stale, errors, ledgerFile }
}

/**
 * 套用後之連鎖斷言(本套件可驗者):邊列——邊仍在、updatedAt 未被改(重評以之挑邊)、理由已合正體(RS3)、RS4／RS6 檢核紀錄之雜湊已隨修正換值
 *   (帳列有 check 且給了 checks 集合者);覆核列與待判列——登錄存在;結案列——登錄存在且已結案。呼叫端之連鎖(如讀關聯之下游之快照)由呼叫端驗
 *
 * @param {Object} deps 輸入 { stores:{ relations(get), holds?, checks? } }
 * @param {Array} rows 輸入帳列(applyEdgeStockFix 之 rows,或 readEdgeStockLedger 之產物;他模組之列略過)
 * @returns {Promise} 回傳 Promise,resolve 回傳 { checked:Integer(驗過之本模組帳列數), problems:Array(字串) }
 * @throws {Error} deps.stores.relations 缺 get 方法時拋出
 * @example
 * need test in nodejs.
 *
 * const r = await applyEdgeStockFix(deps, plan)
 * console.log((await verifyEdgeStockChain(deps, r.rows)).problems)
 * // => []
 */
export async function verifyEdgeStockChain(deps, rows) {

    //check
    const stores = deps?.stores
    if (!isobj(stores) || !isfun(stores.relations?.get)) {
        throw new Error('verifyEdgeStockChain 需要 deps.stores.relations（具 get 方法）')
    }

    const checks = isfun(stores.checks?.get) ? stores.checks : null
    let checked = 0
    const problems = []
    for (const r of (isarr(rows) ? rows : []).filter(isEdgeRow)) {
        checked++
        if (r.object === 'edge') {
            const cur = await stores.relations.get(r.id)
            if (!cur) {
                problems.push(`邊 ${r.id}：處置後不在`)
                continue
            }
            if (cur.updatedAt !== r.before?.edge?.updatedAt) {
                problems.push(`邊 ${r.id}：updatedAt 被改（${r.before?.edge?.updatedAt} → ${cur.updatedAt}；重評會誤挑此邊）`)
                continue
            }
            const p3 = checkEdge(cur, { locale: deps.locale }).find((x) => x.std === FIX_STD)
            if (p3?.status !== STATUS.PASS) problems.push(`邊 ${r.id}：理由仍未合正體（${p3?.detail || '無判定'}）`)
            if (r.check && checks && (await checks.get(checkKey(RS6.objectEdge, r.id)))?.hash !== r.check.to) problems.push(`邊 ${r.id}：RS4／RS6 檢核紀錄未隨字形修正換雜湊（下輪會重核）`)
        }
        else problems.push(...(await stockHoldProblems(stores.holds, r)))
    }
    return { checked, problems }
}

/**
 * 讀處置帳(JSONL;抓取套件之帳協定):本模組之列(邊列、覆核列、邊之待判列與結案列),排除回退列與已被回退者;檔案不存在回空陣列
 *
 * @param {String} file 輸入處置帳絕對路徑
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.since] 輸入只取此時刻起之列(以時刻比較)
 * @param {String} [opt.at] 輸入只取此時刻之列(某次套用之列;連鎖斷言用)
 * @param {Boolean} [opt.allowBad=false] 輸入有無法解析之列時是否略過(預設即拋)
 * @returns {Array} 回傳列陣列(依檔內順序)
 * @throws {Error} 帳有無法解析之列而未給 allowBad 時拋出(訊息列行號)
 * @example
 * need test in nodejs.
 *
 * const rows = readEdgeStockLedger(path.join(dirs.state, STOCK_LEDGER_FILE), { at: r.at })
 */
export function readEdgeStockLedger(file, opt = {}) {
    if (!isobj(opt)) opt = {}
    return stockLedgerRowsOf(file, { since: opt.since, at: opt.at, allowBad: opt.allowBad, keep: isEdgeRow })
}

/**
 * 回退(逐列;檔頭【回退逐列】【回退＝撤銷該次處置之效果】):給定之列中本模組之列依逆序還原——邊列以回退防護寫回處置前之擁有單位(writeEdge 回讀驗;
 *   其後被改動或邊已不在 → 衝突)、檢核紀錄之雜湊仍為處置所換之值者換回、呼叫端之連鎖經 onEdgeRolledBack 換回;覆核列與待判列只動同一登錄
 *   (使用者其後之裁示如豁免、他次登錄不被回退改寫);結案列——仍為該次所結者復原為結案前之登錄(reopenStockHold;其後已重開或豁免者不動);
 *   無衝突者附寫回退列 { at, rollbackOf, object, id }(readEdgeStockLedger 據以排除已回退者)。
 *   他模組之列略過(restored 0、不報錯)。兩端之投影交呼叫端(affected)
 *
 * @param {Object} deps 輸入 { stores:{ relations(get／patch／replace), holds?, checks? }, dirs?:{ state }(處置帳之預設位置), clock? }
 * @param {Array} rows 輸入帳列(單列之陣列,或 readEdgeStockLedger 之產物;他模組之列略過)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {String} [opt.at] 輸入回退時刻 ISO(回退列之 at、待判結案時刻;預設 clock.iso8() 或現在)
 * @param {String} [opt.ledgerFile] 輸入處置帳(JSONL)絕對路徑(未給為 deps.dirs.state 下之 STOCK_LEDGER_FILE)
 * @param {Function} [opt.onEdgeRolledBack] 輸入 (row) => void(可為 async):每條邊列寫回後呼叫(呼叫端換回其連鎖,如快照)
 * @param {Boolean} [opt.acceptCurrent=false] 輸入衝突之邊列是否接受現值(記取代列 { accepted:'current', units }、不寫值)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { at, restored:Integer, accepted:Integer, conflicts:[{ id, object:'edge', units }], errors:[{ id, object, error }],
 *   affected:Array(寫回之邊之兩端筆記 id;去重) }
 * @throws {Error} deps.stores.relations 缺 get／patch／replace 方法、或處置帳之路徑皆未給時拋出
 * @example
 * need test in nodejs.
 *
 * const rows = readEdgeStockLedger(path.join(dirs.state, STOCK_LEDGER_FILE))
 * const rb = await rollbackEdgeStockFix({ stores, dirs, clock }, rows)
 * await projectAffected({ stores, dirs, clock, domain }, rb.affected)
 * console.log(rb.restored, rb.errors)
 */
export async function rollbackEdgeStockFix(deps, rows, opt = {}) {

    //check
    const stores = deps?.stores
    if (!isobj(stores) || !isfun(stores.relations?.get) || !isfun(stores.relations?.patch) || !isfun(stores.relations?.replace)) {
        throw new Error('rollbackEdgeStockFix 需要 deps.stores.relations（具 get／patch／replace 方法）')
    }
    if (!isobj(opt)) {
        opt = {}
    }
    const ledgerFile = stockLedgerFileOf(deps, opt, 'rollbackEdgeStockFix')
    const ledgers = edgeLedgersOf(deps, 'rollbackEdgeStockFix')

    const at = stockAtOf(deps, opt)
    const onEdgeRolledBack = isfun(opt.onEdgeRolledBack) ? opt.onEdgeRolledBack : null
    const checks = isfun(stores.checks?.get) && isfun(stores.checks?.replace) ? stores.checks : null
    const mine = [...(isarr(rows) ? rows : [])].filter(isEdgeRow).reverse()
    let restored = 0
    let accepted = 0
    const conflicts = []
    const errors = []
    const affected = []
    for (const r of mine) {
        try {
            if (r.object === 'edge') {
                const own = edgeRowUnitsOf(r)
                const cur = await stores.relations.get(r.id)
                const plan = rollbackPlanOf(edgeUnitsOf(cur), own)
                // 邊已不在(其後被撤出)或擁有單位其後被改動 → 衝突(不復活、不覆寫)
                if (!cur || plan.conflict.length) {
                    const units = cur ? plan.conflict : ['（記錄不在）']
                    if (opt.acceptCurrent === true) {
                        appendRollbackRow(ledgerFile, r, at, { accepted: 'current', units })
                        accepted++
                    }
                    else conflicts.push({ id: strOf(r.id), object: 'edge', units })
                    continue
                }
                if (plan.restore.length) {
                    ledgers.touch([cur.from, cur.to])
                    await writeEdge(stores.relations, edgeRestoredOf(cur, own.before, plan.restore))
                }
                // 檢核紀錄仍為處置所換之值者換回(其後已被他處推進者不動)
                if (r.check && checks) {
                    const rec = await checks.get(checkKey(RS6.objectEdge, r.id))
                    if (rec?.hash === r.check.to) await checks.replace({ ...rec, hash: r.check.from })
                }
                if (onEdgeRolledBack) await onEdgeRolledBack(r)
                affected.push(cur.from, cur.to)
            }
            // 結案列:仍為該次所結者復原;覆核列與待判列:只動同一登錄(使用者其後之裁示——豁免——與他次登錄不被回退改寫)
            else if (r.object === 'hold-resolved') await reopenStockHold(stores.holds, r)
            else await rollbackStockHold(stores.holds, r, at)
            appendRollbackRow(ledgerFile, r, at)
            restored++
        }
        catch (e) {
            errors.push(stockErrorOf(r.id, r.object, e))
        }
    }
    return { at, restored, accepted, conflicts, errors, affected: [...new Set(affected)] }
}

export default { EDGE_FIX_STDS, edgeFixOf, planEdgeStockFix, applyEdgeStockFix, verifyEdgeStockChain, readEdgeStockLedger, rollbackEdgeStockFix }
