// edgeReviewSegment.mjs — 關聯之既有邊覆核段(檢定標準 RS6:內容未變之非衝突型既有邊——仍成立、型別正確(含漏標之衝突)、理由具體;
//   內容未變之邊不經重評,須另行覆核;判定之純函數在 stores/edgeReviewPolicy)
//
// 【開關】relate.standards.edgeReview.enabled(套件預設 false);每輪至多 relate.standards.edgeReview.perRun 條(預設 0＝只消化待判、不核存量)、
//   每頁 relate.standards.edgeReview.pageSize 條。席位沿用關聯之核對席 relate.standards.ai(first、second 必填;third 選填)。
// 【入口】①待判登錄 RS6(負責者 pipeline,或使用者要求重試者)——含存量處置排入之 RS2／RS3／RS8(standards/edgeQueue 之 queueEdgeReview)、
//   關聯段維護排入之清單外型別(stages/relateMaintain 之 maintainRelations)②存量:非衝突型之邊中檢核紀錄無 RS6、或邊值／兩端內容版本／素材／關聯型別定義版本變者
//   (觸及下游已處理筆記者先、再舊到新;**不重排**有未結待判(任何負責者)或豁免仍涵蓋現值之邊——待判自己負責其去向、使用者之裁示不被自動流程推翻)。
// 【過時待判之清掃(不分負責者)】邊已撤出(隔離者除外——其問題「是否還原」仍成立,以稽核帳最後一列之理由 rs6-quarantine 判)、端點不在 → 結案;
//   邊已成衝突型 → 結案(存量 RS2／RS3／RS8 排入者須真的轉交:登錄 RS4 待判——queueConflictCheck;使用者已對同一問題豁免者不重開——登錄件守之)。
// 【入項前預檢(不呼叫 AI)】本輪會送兩席之待判(負責者 pipeline)而其來源標準(ctx.stockStd:存量之 RS2／RS3／RS8、維護之 RS1)之違反已不在
//   (現值以 checkEdge 判合格——他途改寫了理由、型別回到清單)→ 結案(計 rs6SourceResolved)、不送兩席、不記檢核(未經判定不記合格;存量佇列日後照核);
//   未能判定、仍違反 → 照送;負責者 user 者不預檢(standards/edgeQueue 之 stockSourceResolvedOf;與衝突核對同一件)。
// 【進度與完成期限】進度(已核 rs6Done／受檢總數 rs6Total)每輪計數(各返回點皆重算);relate.standards.edgeReview.deadline
//   (ISO 日期,'' 不設)給了即隨 detail 帶出 rs6Deadline,由外部巡檢依近輪消化速度判「趕不上」或「已逾期仍有未核」。
// 【票(摘要套件之判定小組)】第一、二席(第二席之項序打亂、編號不變);類別或型別未成立而可成立者 → 第三席(只送該些項;第三席失敗或缺票 →
//   重試;第三席中止 → 該些項本輪不判)。
// 【判定小組之執行】逐頁執行與衝突核對同一份(stages/checkPanelPages;兩席並行、第二席打亂、中止與第三席之規則,及不改用摘要套件之
//   runPanelPage 之理由皆見該檔頭);本段兩席皆看整頁(打亂前綴 rs6)、票組 [第一席, 第二席],是否叫第三席依兩層判定(rs6DecisionOf)之
//   needThird——型別層 keep 之型別＝該項之現行型別、現行型別已不在清單者之 keep 於型別層視同不確定。
// 【失敗語意(中止不計、失敗計;與重評、衝突核對同一規則)】中止(skipped:額度用盡、整輪截止、斷網)不是該項之失敗,不記 tries:
//   任一席(含第三席)中止 → 未判之項本輪不判(待判原樣、存量下輪再排)、其後之頁不核、記 rs6Aborted。失敗(呼叫失敗、未涵蓋或回覆不合格之
//   缺票、兩票同一供應者)→ retry:待判 pipeline、tries＋1,逾 maxTries 改使用者;使用者負責之待判(要求重試而本輪又未得判定)負責者與下一步不改,
//   只記原因與 tries。陳舊(互斥內回讀型別或理由已變)→ 本輪不判、不記 tries、待判原樣(下輪再核)。
// 【AI 呼叫】經 stages/relateAiCall(段名 'edgeReview'、席別 first／second／third);逐次給 acceptTruncated:true——回覆為一項一條之陣列,
//   逐項驗證、部分接受,截斷時救回前段完整之項仍有用(缺票之項下輪再核)。
// 【處置】keep → 現行理由之確定性標準(RS2／RS3／RS8;材料＝兩端存量材料,與符合度掃描同一判定;standards/edgeGate 之 reasonRewriteProblemsOf)
//   合格者記檢核合格;確定不合格者於送審時即在該項附「須以 change 改寫理由、不可 keep」(relateDomain.buildEdgeReviewPrompt 之 reasonProblem;
//   keep 之 reason 未定義為理由,不得拿來改寫邊)——兩席改寫者走 reason 處置;仍判 keep 者(keep 決策下無改寫之票)→ 修不了即移除 retireEdge
//   (std-retire;稽核,可以 restoreEdge 之 opt.reason 給新理由還原)、檢核記不合格、待判結案——不記未能判定(確定性違反不是判不了)。
//   reason(建議性改寫:一席之 change 即觸發)→ 以成立之票之理由過納入閘後改寫;皆不過 → 依現行理由之確定性狀態分流:合格即保留記合格、不合格即
//   std-retire(與衝突核對同一處置)。retype／upgrade(共識之改寫)→ 過納入閘後改寫(stores/edgeRewrite);皆不過 → 該次判定失敗(待判 pipeline 重試,
//   不記檢核)。upgrade 於衝突核對開啟時不先寫:提案持久為 RS4 提案待判(queueConflictProposal)並交本輪衝突核對(比照正向之暫緩),本邊之檢核記
//   未能判定(交 RS4 判定中)、待判結案;核對判非衝突者由衝突核對另登錄 RS6 使用者待判(兩段不一致);衝突核對未開 → 直接改為衝突型(RS4 存量佇列日後另核)。
//   retire → retireEdge(rs6-retire,可 restoreEdge);type-split(關聯成立、型別判不了;含現行型別已不在清單而未得清單內型別者)→ 邊不動、
//   未能判定、待判 user;undetermined(類別判不了)→ 先登錄使用者待判、記檢核(未能判定),後隔離 retireEdge(rs6-quarantine)——使用者以 restoreEdge
//   還原即裁示關聯成立(ops/noteOps:待判結案、記檢核,不再自動覆核此值);retry(缺票、同一供應者)→ 待判 pipeline(逾 maxTries 改 user,下一步改為
//   使用者可完成之處置)。判定之項一律寫覆核帳 relate-edge-review.jsonl(本輪未判者不寫);結果記檢核紀錄(checks,與 RS4 同一雜湊——含素材,
//   stores/checkMaterial.createCheckHasher)。收尾三件事之序一律:記檢核 → 結案待判 → 寫帳。
// 【時間】扣保留時間(關聯子階段之 opt.reserveMs,未給取 deps.reserveMs;由組裝者注入)後須夠一次呼叫才開工;不夠或額度中止 → 本輪不核
//   (存量不丟,下輪再排;額度中止記 rs6Aborted)。

import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { oneline } from '../core/capturePackage.mjs'
import { reserveOf, reserveMsOf } from '../core/capturePackage.mjs'
import { RELATE_DEFAULT, callTimeoutMsOf, relateFeatureProblems } from '../core/relateSettings.mjs'
import { panelSeats, PANEL_WHY_LABELS } from '../core/summarizePackage.mjs'
import { STATUS } from '../core/capturePackage.mjs'
import { putHold, resolveHold, listHolds, pipelineDueOf } from '../core/capturePackage.mjs'
import { recordCheck } from '../core/stores/checks.mjs'
import { makeEdge } from '../stores/edgeStore.mjs'
import { rewriteEdge } from '../stores/edgeRewrite.mjs'
import { EDGE_PRODUCED_STAGES, voteOfVerdict, producedFieldsOf } from '../stores/edgeProvenance.mjs'
import { appendAudit } from '../stores/relateLedgers.mjs'
import { retireEdge } from '../stores/edgeRetire.mjs'
import { readEdgeAudit, retiredEdgesOf } from '../stores/edgeAudit.mjs'
import { relateHoldDeadlineOf, escalatedHoldNextOf, quarantineHoldNextOf, stdRetiredHowOf, waiverCoversEdge, RELATE_HOLD_NEXT, RELATE_API_HINT } from '../stores/relateHolds.mjs'
import { gateEdgeProposal, gateCtxOf, reasonRewriteProblemsOf, checkPromptItemOf } from '../standards/edgeGate.mjs'
import { RS6, reviewVerdictOf, rs6DecisionOf, reviewQueueOf } from '../stores/edgeReviewPolicy.mjs'
import { seatVotesOf, relationTypesVersionOf } from '../stores/edgeCheckKit.mjs'
import { createCheckHasher } from '../stores/checkMaterial.mjs'
import { queueConflictCheck, queueConflictProposal, stockSourceResolvedOf } from '../standards/edgeQueue.mjs'
import { relateAiCallOf } from './relateAiCall.mjs'
import { runCheckPanelPages } from './checkPanelPages.mjs'

const checkJson = (d) => Array.isArray(d) && d.some((it) => Number.isInteger(it?.index))
const voteRow = (v) => ({ seat: v.seat, provider: v.provider || '', verdict: v.verdict === null || v.verdict === undefined ? null : (typeof v.verdict === 'object' ? v.verdict : String(v.verdict)) })
const ACTION_WORD = { reason: '理由改寫', retype: '改型', upgrade: '升為衝突' }

/**
 * 既有邊覆核段(關聯子階段呼叫;停用時回 null)
 *
 * @param {Object} o 輸入 { ctx, rt(relateStage 之 rt), domain, settings, ai, log, opt }
 * @returns {Promise<Object|null>} 回傳 { det, aiCalls, removed(撤出／隔離者), rs4Deferred(升為衝突交衝突核對者) } 或 null(停用)
 * @example
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async (find) => [...m.values()].filter((r) => !find || Object.entries(find).every(([k, v]) => r[k] === v)),
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *         replace: async (r) => { m.set(r.id, r) },
 *     }
 * }
 * let domain = createRelateDomain({})
 * let notes = [
 *     { id: 'n1', title: '標題n1', category: 'c', summary: 'n1 之重點', concepts: ['p'] },
 *     { id: 'n2', title: '標題n2', category: 'c', summary: 'n2 之重點', concepts: ['p'] },
 * ]
 * let edge = makeEdge({ from: 'n1', to: 'n2', type: domain.relationTypes[0], reason: 'n1 與 n2 共用同一組參數', nowIso: '2026-10-01T00:00:00+08:00' })
 * let stores = { notes: mem(notes), relations: mem([edge]), holds: mem([]), checks: mem([]) }
 * let ctx = {
 *     deps: { stores, clock: { iso8: () => '2026-11-02T00:00:00+08:00' }, dirs: { state: dir } },
 *     log: { info: () => {}, warn: () => {} },
 * }
 * let rt = { adj: buildAdjacency([edge]), byId: new Map(notes.map((n) => [n.id, n])), ledgers: openRelateLedgers(dir), conflictType: domain.conflictType, mutex: createMutex(), rank: typeRankOf(domain), isExtracted: () => false, touchesExtracted: () => false, pendingConflicts: [] }
 * let settings = resolveRelateSettings({
 *     ai: { parallel: 1 },
 *     relate: { ai: { use: 'stub:a' }, standards: { edgeReview: { enabled: true, perRun: 5 }, ai: { first: { use: 'stub:a' }, second: { use: 'stub:b' } } } },
 * })
 * let callAI = async (prompt, check, c) => ({ ok: true, providerId: c.seat === 'first' ? 'p1' : 'p2', data: [{ index: 1, verdict: 'keep', reason: '' }], attempts: 1 })
 * let r = await runEdgeReviewSegment({ ctx, rt, domain, settings, ai: null, log: ctx.log, opt: { callAI } })
 * console.log(r.det.rs6Stock, r.det.rs6Checked, r.det.rs6Kept, r.aiCalls, r.removed)
 * let off = await runEdgeReviewSegment({ ctx, rt, domain, settings: resolveRelateSettings({}), ai: null, log: ctx.log })
 * console.log(off)
 * fs.rmSync(dir, { recursive: true, force: true })
 * // => 1 1 1 2 0
 * // => null
 */
export async function runEdgeReviewSegment(o) {
    const { ctx, rt, domain, settings, ai, log, opt = {} } = o
    const cfg = settings.relate.standards.edgeReview
    const D = RELATE_DEFAULT.standards.edgeReview
    if ((opt.edgeReview ?? cfg.enabled) !== true) return null
    const { stores, clock } = ctx.deps
    const nowIso = () => clock.iso8()
    const stateDir = ctx.deps.dirs.state
    const perRun = opt.edgeReviewPerRun ?? cfg.perRun ?? D.perRun
    const pageSize = cfg.pageSize ?? D.pageSize
    const maxTries = cfg.maxTries ?? D.maxTries
    const seats = settings.relate.standards.ai || {}
    const det = { rs6Holds: 0, rs6SourceResolved: 0, rs6Stock: 0, rs6Checked: 0, rs6Kept: 0, rs6ReasonFixed: 0, rs6StdFixed: 0, rs6Retyped: 0, rs6Upgraded: 0, rs6Retired: 0, rs6StdRetired: 0, rs6TypeSplit: 0, rs6Undetermined: 0, rs6Quarantined: 0, rs6Retry: 0, rs6StdRejected: 0, rs6Stale: 0, rs6Third: 0, rs6Deferred: false, rs6Aborted: false, rs6Stopped: false, rs6MdMissing: 0, rs6Pending: 0, rs6Done: 0, rs6Total: 0, edgesChanged: 0, conflicts: 0, conflictTouchExtracted: 0 }
    // 完成期限(檔頭【進度與完成期限】):給了才帶出,外部巡檢據以判趕不上／逾期
    if (isestr(cfg.deadline)) det.rs6Deadline = cfg.deadline
    const out = { det, aiCalls: 0, removed: 0, rs4Deferred: 0 }
    if (!stores.holds || !stores.checks) throw new Error('既有邊覆核(relate.standards.edgeReview.enabled)需要 holds 與 checks 集合')
    // 席位與 domain 成員:功能表之單一判定(與執行期件之啟動期檢核同一字樣;本段之開關可由選項覆寫)
    const featureProblems = relateFeatureProblems(settings, domain, { enabled: ['edgeReview'] })
    if (featureProblems.length) throw new Error(featureProblems.join('；'))
    const byId = rt.byId
    // 關聯型別定義之版本(檢核雜湊之成分;relateStage 每輪算一次)
    const typesVer = rt.typesVer ?? relationTypesVersionOf(domain)
    // 材料與檢核雜湊(與 RS4 同一讀取器與算法;stores/checkMaterial——關聯段每輪一份)
    const hasher = rt.checkHasher || createCheckHasher({ byId, domain, typesVer })
    const deadline = () => relateHoldDeadlineOf(nowIso())
    const edgesNow = () => {
        const m = new Map()
        for (const nb of rt.adj.values()) for (const e of nb.values()) m.set(e.id, e)
        return [...m.values()]
    }
    const checksNow = async () => new Map((await stores.checks.select()).filter((r) => r.object === RS6.objectEdge).map((r) => [r.oid, r]))
    const scanOpt = (edges, checks) => ({ edges, conflictType: rt.conflictType, byId, checkOf: (id) => checks.get(id) || null, extracted: rt.isExtracted, typesVer, seenOf: hasher.seenOf })
    // 收尾(各返回點同一份):未結待判數、進度(本輪處置後重算:已核＝檢核紀錄有效之非衝突邊;受檢總數＝現存之非衝突邊)
    const finish = async () => {
        det.rs6Pending = (await listHolds(stores.holds, { status: 'open', std: RS6.std })).length
        const q = reviewQueueOf({ ...scanOpt(edgesNow(), await checksNow()), quota: 0 })
        det.rs6Total = q.total
        det.rs6Done = q.done
        return out
    }
    const resolveH = (h, how) => resolveHold(stores.holds, h.id, { at: nowIso(), how })
    // 材料(與 RS4 同一讀取器;stores/checkMaterial)與現行理由之確定性判定之 ctx(送審之項與入項前預檢同一組;standards/edgeGate)
    const sideOf = hasher.sideOf
    const stockCtx = gateCtxOf(domain, { hasNote: (id) => byId.has(id), materialOf: (id) => sideOf(id).material, locale: ctx.deps.locale })

    // ── 入口:待判(pipeline 或要求重試)＋存量配額;過時待判之清掃不分負責者;存量排入之來源違反已不在者入項前結案(預檢,不呼叫 AI)──
    const entries = new Map() // 邊 id → 項
    let retiredLast = null
    const quarantined = (id) => {
        if (!retiredLast) retiredLast = retiredEdgesOf(readEdgeAudit(stateDir))
        return retiredLast.get(id)?.reason === 'rs6-quarantine'
    }
    for (const h of await listHolds(stores.holds, { status: 'open', std: RS6.std })) {
        const cur = await stores.relations.get(h.oid)
        if (!cur) {
            if (!quarantined(h.oid)) await resolveH(h, '邊已撤出')
            continue
        }
        if (cur.type === rt.conflictType) {
            // 衝突型由衝突核對(RS4)負責;存量 RS2／RS3／RS8 排入者(ctx.stockStd)須真的轉交——只結案則其理由之違反無人處置(衝突核對之存量
            //   佇列不重核檢核紀錄仍有效之邊):登錄 RS4 待判(queueConflictCheck;pipeline、已有未結者不重登、使用者已對同一問題豁免者不重開)後結案
            let how = '邊已為衝突型（由衝突核對 RS4 負責）'
            if (h.ctx?.stockStd) {
                const r = await queueConflictCheck(stores.holds, {
                    edgeId: cur.id, from: cur.from, to: cur.to, at: nowIso(),
                    reason: `存量 ${h.ctx.stockStd}（衝突型；由既有邊覆核轉交）：${String(h.reason || '').slice(0, 120)}`,
                    next: RELATE_HOLD_NEXT.conflictCheckStock,
                    ctx: { stockStd: h.ctx.stockStd },
                })
                how = r === 'waived' ? `邊為衝突型，存量 ${h.ctx.stockStd} 之同一問題使用者已於衝突核對豁免（不重開）` : `邊為衝突型，存量 ${h.ctx.stockStd} 已轉交衝突核對（RS4 待判）`
            }
            await resolveH(h, how)
            continue
        }
        if (!byId.has(cur.from) || !byId.has(cur.to)) {
            await resolveH(h, '端點筆記已不在')
            continue
        }
        if (!pipelineDueOf(h)) continue
        // 預檢(standards/edgeQueue 檔頭【已不再違反之預檢】):存量排入(ctx.stockStd)之來源標準現值已合格 → 結案、不送兩席、不記檢核
        const src = stockSourceResolvedOf(h, cur, stockCtx)
        if (src) {
            det.rs6SourceResolved++
            await resolveH(h, src.how)
            continue
        }
        entries.set(cur.id, { edge: cur, hold: h })
    }
    det.rs6Holds = entries.size
    const edges = edgesNow()
    const byEdgeId = new Map(edges.map((e) => [e.id, e]))
    // 不重排:本輪已入列、有未結待判(任何負責者)、豁免仍涵蓋現值者
    const exclude = new Set(entries.keys())
    for (const h of await listHolds(stores.holds, { std: RS6.std })) {
        if (h.status === 'open' || waiverCoversEdge(h, byEdgeId.get(h.oid))) exclude.add(h.oid)
    }
    const q = reviewQueueOf({ ...scanOpt(edges, await checksNow()), exclude, quota: perRun })
    for (const s of q.queue) entries.set(s.edge.id, { edge: s.edge, hold: null, fromBacklog: true })
    det.rs6Stock = q.queue.length
    const list = [...entries.values()]
    if (!list.length) return finish()

    // ── 材料 ──
    // 現行理由之確定性違反(RS2／RS3／RS8;材料＝兩端之存量材料,與符合度掃描同一判定;先做確定性正規化——正體可修者不算;只判現行理由):
    //   只收「不合格」——材料不可得之未能判定不在此列(交符合度掃描列未能判定,不據以撤出)。判定前算好,隨項送覆核席(提示詞該項
    //   附「須以 change 改寫、不可 keep」——keep 之 reason 未定義為理由,不得拿來改寫邊)。與衝突核對同一函數(standards/edgeGate)
    const currentProblems = (x) => reasonRewriteProblemsOf(x.edge, stockCtx)
    let idx = 0
    for (const x of list) {
        x.index = ++idx
        x.key = x.edge.id // 判定小組執行器之打亂與裁定之鍵
        x.a = sideOf(x.edge.from)
        x.b = sideOf(x.edge.to)
        x.bad = currentProblems(x)
    }
    det.rs6MdMissing = [...new Set(list.flatMap((x) => [x.edge.from, x.edge.to]))].filter((id) => hasher.missing.has(id)).length
    const promptItem = (x) => checkPromptItemOf(x, x.bad)

    // ── 時間 ──
    const firstMs = callTimeoutMsOf(settings, [seats.first, seats.second, seats.third])
    const sub = reserveOf(ctx, reserveMsOf(opt.reserveMs ?? ctx.deps.reserveMs, '既有邊覆核段之 reserveMs')(ctx))
    if (!sub.canStart(firstMs)) {
        det.rs6Deferred = true
        log.info(`既有邊覆核：扣保留時間後剩餘時間不足一次呼叫（${Math.round(firstMs / 1000)}s），本輪延後`)
        return finish()
    }

    // ── 判定(逐頁:第一、二席並行;未成立而可成立者 → 第三席)──
    const ask = relateAiCallOf({ ai, callAI: opt.callAI })
    const call = async (spec, prompt, which) => {
        out.aiCalls++
        return ask(prompt, checkJson, { spec, seat: which, segment: 'edgeReview', shouldStop: () => sub.shouldStop(firstMs), budgetMs: sub.remainingMs() })
    }
    const vopt = (items) => ({ relationTypes: domain.relationTypes, resolveType: domain.resolveType, conflictType: rt.conflictType, roles: domain.relationTypeRoles, verdictOf: reviewVerdictOf, indices: new Set(items.map((x) => x.index)), currentOf: (i) => items.find((x) => x.index === i)?.edge })
    // 判定小組之逐頁執行與衝突核對同一份(stages/checkPanelPages);本段:兩席皆看整頁、票組 [第一席, 第二席];
    //   relationTypes:現行型別已不在清單者之 keep 不得判為型別合格(edgeReviewPolicy 檔頭【清單外之現行型別】)
    const panel = await runCheckPanelPages({
        list, pageSize, seats, call, log, label: '既有邊覆核', shufflePrefix: 'rs6',
        buildPrompt: (items) => domain.buildEdgeReviewPrompt(items.map(promptItem)),
        votesOf: (data, items) => seatVotesOf(data, vopt(items)),
        secondOf: (page) => page,
        ballotOf: (x, a, b) => [a, b],
        decide: (x) => rs6DecisionOf(x.votes, { conflictType: rt.conflictType, current: x.edge, relationTypes: domain.relationTypes }),
        shouldStop: () => sub.shouldStop(firstMs),
    })
    if (panel.aborted) det.rs6Aborted = true
    if (panel.stopped) det.rs6Stopped = true
    det.rs6Third += panel.third

    // ── 處置 ──
    // 覆核帳之入口欄:'hold'｜'stock'(存量;帳列之持久化值)
    const audit = (x, outcome, extra = {}) => appendAudit(rt.ledgers.files.edgeReview, { at: nowIso(), entry: x.hold ? 'hold' : 'stock', edgeId: x.edge.id, edge: { from: x.edge.from, to: x.edge.to, type: x.edge.type, reason: x.edge.reason }, votes: (x.votes || []).map(voteRow), outcome, ...extra })
    const record = (e, status, reason, votes) => recordCheck(stores.checks, { object: RS6.objectEdge, oid: e.id, hash: hasher.hashOf(e), std: RS6.std, v: RS6.v, at: nowIso(), status, seats: panelSeats(votes), reason })
    const resolve = (x, how) => (x.hold ? resolveHold(stores.holds, x.hold.id, { at: nowIso(), how }) : null)
    /**
     * 登錄待判(重試、逾次、判不了、隔離):使用者負責之待判(要求重試而本輪又未得判定)負責者與下一步不改;逾次改由使用者;其餘依 h
     * @param {Object} x 輸入項
     * @param {Object} h 輸入 { reason, next, owner? }
     * @returns {Promise} 回傳登錄後之記錄
     */
    const holdOf = (x, h) => {
        const prev = x.hold
        const userOwned = !h.owner && prev?.owner === 'user'
        const prevTries = Number(prev?.tries || 0) + (prev ? 1 : 0)
        const escalated = !h.owner && !userOwned && prevTries + 1 >= maxTries
        const owner = h.owner || (userOwned || escalated ? 'user' : 'pipeline')
        // 逾次改由使用者:管線不再自動重判(只消化 pipeline 或要求重試者)——下一步須為使用者可完成之處置
        const next = userOwned ? prev.next : (escalated ? escalatedHoldNextOf(maxTries, '維持現值') : h.next)
        return putHold(stores.holds, { object: RS6.objectEdge, oid: x.edge.id, std: RS6.std, reason: h.reason, next, owner, deadline: deadline(), ctx: { from: x.edge.from, to: x.edge.to, ...(prev?.ctx || {}) } }, nowIso())
    }
    const label = (x) => `[[${x.edge.from}]] ⇄ [[${x.edge.to}]]`
    // 改寫之提案過納入閘(材料＝覆核席所見之兩方區塊;RS8):依成立之票序逐一試,第一個合格者採用
    const gateOf = (x, type, verdicts) => {
        const seenText = new Map([[x.edge.from, domain.seenTextOf(x.a.note, 'checkSide', x.a.extra)], [x.edge.to, domain.seenTextOf(x.b.note, 'checkSide', x.b.extra)]])
        const gctx = gateCtxOf(domain, { hasNote: (id) => byId.has(id), materialOf: (id) => (seenText.has(id) ? seenText.get(id) : null), locale: ctx.deps.locale })
        let first = null
        for (const v of verdicts.filter((y) => isobj(y) && y.reason)) {
            const g = gateEdgeProposal(makeEdge({ from: x.edge.from, to: x.edge.to, type, reason: v.reason, nowIso: nowIso() }), gctx)
            if (g.ok) return { ...g, by: v } // by＝被採用之裁決值(產出鏈之成交者由此回找該票)
            first = first || g
        }
        return first || { ok: false, reasons: ['無可用之理由'] }
    }
    const stale = (cur, x) => !cur || cur.type !== x.edge.type || cur.reason !== x.edge.reason
    const ledgers = { relations: stores.relations, ledgers: rt.ledgers, stateDir }
    const retireOpt = (reason, detail, extra) => ({ reason, at: nowIso(), detail, conflictTypes: domain.conflictTypeNames, hasNote: (id) => byId.has(id), adj: rt.adj, extra })
    // 改寫(互斥內回讀比對;陳舊不套):新值＝閘後之型別與理由(截短者帶 reasonCut;stores/edgeStore 檔頭【理由截短之明示】)
    //   產出鏈之成交者(stores/edgeProvenance 檔頭【席位與成交者】):採用其改寫值之那一票(by＝gateOf 之被採用裁決值;seat 與 provider 同稽核列 votes 之該票);
    //   無票可回找者不寫產出鏈
    const rewrite = (x, g, kind) => rt.mutex(async () => {
        const cur = await stores.relations.get(x.edge.id)
        if (stale(cur, x)) return { r: 'stale' }
        const now = nowIso()
        const gEdge = g.edge
        const proposal = { ...makeEdge({ from: cur.from, to: cur.to, type: gEdge.type, reason: gEdge.reason, nowIso: now }), ...(gEdge.reasonCut ? { reasonCut: gEdge.reasonCut } : {}) }
        const v = voteOfVerdict(x.votes, g.by)
        const produced = rt.prov && v ? rt.prov.make({ stage: EDGE_PRODUCED_STAGES.edgeReview, seat: v.seat, provider: v.provider || '', role: 'edge-review' }) : undefined
        const w = await rewriteEdge(ledgers, cur, proposal, { rank: rt.rank, at: now, conflictTypes: domain.conflictTypeNames, hasNote: (id) => byId.has(id), adj: rt.adj, produced })
        return { r: kind, edge: w.edge }
    })
    const removed = () => {
        out.removed++
    }
    /**
     * 兩席判成立而現行理由確定不合格、又無可用之改寫理由 → 修不了即移除(std-retire)
     * @param {Object} x 輸入項
     * @param {String} why 輸入現行理由之違反
     * @returns {Promise<Boolean>} 回傳是否撤出(陳舊回 false)
     */
    const stdRetire = async (x, why) => {
        const res = await rt.mutex(async () => {
            const cur = await stores.relations.get(x.edge.id)
            if (stale(cur, x)) return 'stale'
            await retireEdge(ledgers, cur, retireOpt('std-retire', `既有邊覆核：兩席判關聯成立而現行理由未達標準（${why}），無可用之改寫理由——修不了即移除`, { std: RS6.std, problems: x.bad, votes: x.votes.map(voteRow) }))
            return 'retired'
        })
        if (res === 'stale') {
            det.rs6Stale++
            return false
        }
        removed()
        det.rs6StdRetired++
        await record(x.edge, STATUS.VIOLATION, `兩席判關聯成立而現行理由未達標準（${why}），且無可用之改寫理由——撤出`, x.votes)
        await resolve(x, stdRetiredHowOf(why, x.edge.id))
        audit(x, 'std-retire', { problems: x.bad })
        log.info(`既有邊覆核：${label(x)} 現行理由未達標準且無可用之改寫理由，撤出（std-retire，${RELATE_API_HINT.restoreEdgeReason}）`)
        return true
    }
    /**
     * 兩席判關聯成立、型別同現行、無改寫:記檢核合格、結案
     * @param {Object} x 輸入項
     */
    const keepPass = async (x) => {
        det.rs6Kept++
        await record(x.edge, STATUS.PASS, '兩席判關聯成立、型別正確、理由具體', x.votes)
        await resolve(x, '兩席判關聯成立')
        audit(x, 'keep')
    }

    for (const x of list) {
        if (!x.decision) continue // 本輪未判(任一席之額度／截止中止——含第三席中止而送第三席之項):待判者原樣(不記 tries)、存量下輪再入佇列
        det.rs6Checked++
        const d = x.decision
        if (d.action === 'retry') {
            det.rs6Retry++
            await holdOf(x, { reason: `判定小組未成立（${PANEL_WHY_LABELS[d.why] || d.why}）`, next: RELATE_HOLD_NEXT.edgeReviewRetry })
            audit(x, 'retry', { why: d.why })
            continue
        }
        if (d.action === 'undetermined') {
            det.rs6Undetermined++
            // 先登錄使用者待判、記檢核(未能判定),後隔離(先記後寫);下一步須與實際可完成之處置一致:邊已撤出,要求重試只會因「邊已撤出」結案;
            //   以 restoreEdge 還原即裁示關聯成立(ops/noteOps.restoreEdge:本待判結案、記檢核,不再自動覆核此值)
            const res = await rt.mutex(async () => {
                const cur = await stores.relations.get(x.edge.id)
                if (stale(cur, x)) return 'stale'
                await holdOf(x, { reason: `判定小組判不了（${PANEL_WHY_LABELS[d.why] || d.why}）——已隔離`, next: quarantineHoldNextOf(RS6.std, x.edge.id), owner: 'user' })
                await record(x.edge, STATUS.UNDETERMINED, `判定小組判不了（${d.why}）`, x.votes)
                await retireEdge(ledgers, cur, retireOpt('rs6-quarantine', `既有邊覆核判不了（${d.why}）`, { votes: x.votes.map(voteRow) }))
                return 'quarantined'
            })
            if (res === 'stale') {
                det.rs6Stale++
                continue
            }
            det.rs6Quarantined++
            removed()
            audit(x, 'quarantine', { why: d.why })
            log.info(`既有邊覆核：${label(x)} 判不了（${d.why}），隔離（${RELATE_API_HINT.restoreEdge}）並入待判`)
            continue
        }
        if (d.action === 'keep') {
            // 兩席判關聯成立而現行理由確定不合格(RS2／RS3／RS8;記未能判定或記合格皆會讓確定性違反留在庫內):提示詞已對該項要求 change 改寫;
            //   keep 決策下無改寫之票(有即為 reason),仍判 keep 者其 reason 不是理由 → 修不了即移除(std-retire)。不記未能判定
            if (x.bad.length) {
                await stdRetire(x, oneline(x.bad.join('；'), 120))
                continue
            }
            await keepPass(x)
            continue
        }
        if (d.action === 'type-split') {
            det.rs6TypeSplit++
            const offList = !domain.relationTypes.includes(x.edge.type)
            await record(x.edge, STATUS.UNDETERMINED, offList ? d.why : `關聯成立而型別各席不一致（${[...new Set(d.verdicts.map((v) => (v.verdict === 'keep' ? x.edge.type : v.type)))].join('／')}）`, x.votes)
            await holdOf(x, { reason: offList ? `${d.why}——邊不動` : '關聯成立而型別各席不一致——邊不動', next: RELATE_HOLD_NEXT.typeSplit, owner: 'user' })
            audit(x, 'type-split')
            continue
        }
        if (d.action === 'retire') {
            const res = await rt.mutex(async () => {
                const cur = await stores.relations.get(x.edge.id)
                if (stale(cur, x)) return 'stale'
                await retireEdge(ledgers, cur, retireOpt('rs6-retire', d.verdicts[0]?.reason || '兩席判無知識關聯', { votes: x.votes.map(voteRow) }))
                return 'retired'
            })
            if (res === 'stale') {
                det.rs6Stale++
                continue
            }
            det.rs6Retired++
            removed()
            await record(x.edge, STATUS.VIOLATION, `兩席判無知識關聯：${oneline(d.verdicts[0]?.reason, 120)}`, x.votes)
            await resolve(x, `兩席判無知識關聯，已撤出（${RELATE_API_HINT.restoreEdge}）`)
            audit(x, 'retired')
            log.info(`既有邊覆核：${label(x)} 判無知識關聯，撤出（${oneline(d.verdicts[0]?.reason, 80)}）`)
            continue
        }
        // reason／retype／upgrade:改寫之理由過納入閘後改寫
        const g = gateOf(x, d.type, d.verdicts)
        if (!g.ok) {
            det.rs6StdRejected++
            audit(x, 'std-reject', { action: d.action, problems: g.reasons })
            if (d.action === 'reason') {
                // 建議性改寫不過閘 → 依現行理由之確定性狀態分流(與衝突核對同一處置)
                if (x.bad.length) await stdRetire(x, oneline(x.bad.join('；'), 120))
                else await keepPass(x)
                continue
            }
            // 共識之改寫不過閘 → 該次判定失敗:待判重試(記 tries;不記檢核)
            await holdOf(x, { reason: `覆核席之理由未達標準（${oneline(g.reasons.join('；'), 120)}）`, next: RELATE_HOLD_NEXT.edgeReviewRetry })
            continue
        }
        if (d.action === 'upgrade' && rt.conflictCheckOn) {
            // 漏標之衝突於衝突核對開啟時不先寫:提案持久為 RS4 提案待判並交本輪衝突核對(比照正向之暫緩);本邊之檢核記未能判定(交 RS4 判定中)
            const res = await rt.mutex(async () => {
                const cur = await stores.relations.get(x.edge.id)
                if (stale(cur, x)) return 'stale'
                const now = nowIso()
                const proposal = { ...makeEdge({ from: cur.from, to: cur.to, type: rt.conflictType, reason: g.edge.reason, nowIso: now }), ...(g.edge.reasonCut ? { reasonCut: g.edge.reasonCut } : {}) }
                const proposer = String(x.votes[0]?.provider || '')
                await queueConflictProposal(stores.holds, { from: cur.from, to: cur.to, reason: proposal.reason, reasonCut: proposal.reasonCut, proposer, segment: 'edgeReview', proposedAt: now, at: now, holdReason: '既有邊覆核兩席判為漏標之衝突，待衝突核對兩席核對' })
                rt.pendingConflicts.push({ edge: proposal, proposer, segment: 'edgeReview' })
                return 'deferred'
            })
            if (res === 'stale') {
                det.rs6Stale++
                continue
            }
            out.rs4Deferred++
            await record(x.edge, STATUS.UNDETERMINED, '兩席判為漏標之衝突，交衝突核對（RS4）判定', x.votes)
            await resolve(x, '兩席判為漏標之衝突，已交衝突核對（RS4 提案待判）')
            audit(x, 'upgrade-deferred', { proposal: { type: rt.conflictType, reason: g.edge.reason } })
            log.info(`既有邊覆核：${label(x)} 兩席判為漏標之衝突，交衝突核對判定（${oneline(g.edge.reason, 80)}）`)
            continue
        }
        const res = await rewrite(x, g, d.action)
        if (res.r === 'stale') {
            det.rs6Stale++
            continue
        }
        det.edgesChanged++
        // 現行理由確定不合格而經提示詞要求改寫者另計(修正之來源可見)
        if (x.bad.length) det.rs6StdFixed++
        if (res.r === 'reason') det.rs6ReasonFixed++
        else if (res.r === 'retype') det.rs6Retyped++
        else {
            det.rs6Upgraded++
            det.conflicts++
            if (rt.touchesExtracted(res.edge)) det.conflictTouchExtracted++
        }
        await record(res.edge, STATUS.PASS, res.r === 'reason' ? '兩席判關聯成立、理由改寫為具體' : (res.r === 'retype' ? `兩席判型別應為「${res.edge.type}」` : '兩席判為漏標之衝突，已改為衝突型（衝突核對 RS4 另核）'), x.votes)
        await resolve(x, `${ACTION_WORD[res.r]}落地`)
        // 改寫列之 edge 另帶改寫前之產出鏈三欄(新增欄位;revertEdgeRevision 撤回時據以撤銷該次改寫所留之產出鏈;改寫前無產出鏈者不帶)
        audit(x, res.r, { edge: { from: x.edge.from, to: x.edge.to, type: x.edge.type, reason: x.edge.reason, ...producedFieldsOf(x.edge) }, written: { type: res.edge.type, reason: res.edge.reason } })
        log.info(`既有邊覆核：${label(x)} ${ACTION_WORD[res.r]}（${res.r === 'reason' ? '' : `「${res.edge.type}」；`}${oneline(res.edge.reason, 80)}）`)
    }
    await finish()
    if (det.rs6Checked) log.info(`既有邊覆核：核 ${det.rs6Checked} 條（待判 ${det.rs6Holds}、存量 ${det.rs6Stock}）：成立 ${det.rs6Kept}、改理由 ${det.rs6ReasonFixed}（其中現行理由未達標準而改寫 ${det.rs6StdFixed}）、改型 ${det.rs6Retyped}、升為衝突 ${det.rs6Upgraded}（交核對 ${out.rs4Deferred}）、無關聯 ${det.rs6Retired}、理由修不了而撤出 ${det.rs6StdRetired}、型別判不了 ${det.rs6TypeSplit}、判不了 ${det.rs6Undetermined}、重試 ${det.rs6Retry}；進度 ${det.rs6Done}／${det.rs6Total}；未結待判 ${det.rs6Pending}`)
    return out
}

export default { runEdgeReviewSegment }
