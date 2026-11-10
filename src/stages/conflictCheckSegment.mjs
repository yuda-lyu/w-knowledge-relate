// conflictCheckSegment.mjs — 關聯之衝突核對段(檢定標準 RS4:衝突型之邊須為真衝突且理由陳述雙方)
//
// 【開關】relate.standards.conflictCheck.enabled(套件預設 false:正向／反向／輪巡之衝突提案直接落地)。開啟後(須 holds 與 checks 集合;關聯段開工即驗):
// 【入口】①本輪之新衝突提案(正向／反向／輪巡之新建或由非衝突升級、重評與既有邊覆核之升級;皆於暫緩當下已持久為 RS4 提案待判——
//     standards/edgeQueue 之 queueConflictProposal——再交本段;同邊多提案依提案全序取最優,與完成順序無關)
//   ②待判登錄 RS4(物件 edge-proposal:前輪未判完之提案,依 ctx 重建〔含 reasonCut〕;物件 edge:下游判「非對立」而交回、還原帶回、既有邊覆核轉交
//     ——standards/edgeQueue 之 queueConflictCheck;前輪缺票或改寫不過閘者——本段 holdOf 之再登錄(累計 tries);負責者 pipeline,或使用者要求重試者)
//     ③存量衝突邊(檢核紀錄無 RS4,或邊值／兩端內容版本／
//     素材變;配額 relate.standards.conflictCheck.perRun,預設 0;觸及下游已處理筆記者先;**不重排**有未結待判(任何負責者)或豁免仍涵蓋現值之邊——
//     待判自己負責其去向、使用者之裁示不被自動流程推翻)。既有邊(②之物件 edge 與③)須第二席:未設第二席時物件 edge 之待判不入本輪
//     (計 rs4HoldsNoSecond、INFO 一行,待判維持未結)、存量不排。
// 【過時待判之清掃(不分負責者)】提案:該對已成衝突邊、端點不在 → 結案;既有邊:已撤出(隔離者除外——其問題「是否還原」仍成立,以稽核帳最後一列之
//   理由 rs4-quarantine 判)、已非衝突型、端點不在 → 結案。
// 【入項前預檢(不呼叫 AI)】本輪會送兩席之既有邊待判(負責者 pipeline)而其來源標準(ctx.stockStd:存量處置排入或既有邊覆核轉交之 RS2／RS3／RS8)
//   之違反已不在(現值以 checkEdge 判合格)→ 結案(計 rs4SourceResolved)、不送兩席、不記檢核(未經判定不記合格;存量佇列日後照核);未能判定、
//   仍違反 → 照送;負責者 user 者不預檢(standards/edgeQueue 之 stockSourceResolvedOf;與既有邊覆核同一件)。
// 【票(摘要套件之判定小組)】新提案(正向／反向／輪巡):提案席(keep;供應者＝提案之實際成交者)＋核對第一席;既有邊之升級提案(重評、既有邊覆核
//   之升級——其提案席與核對席同一小組,提案席再投即同一供應者而永遠判不成)與既有邊:核對第一、二席(第二席之項序打亂、編號不變;未設第二席
//   即不入本輪,計 rs4HoldsNoSecond)。兩層判定(stores/conflictCheckPolicy.rs4DecisionOf):①是否真衝突(類別)②類別成立後之處置;是否衝突未成立而
//   可成立、或非衝突已定而改正之型別各席不一致 → 第三席(只送該些項;第三席失敗或缺票 → 重試;第三席中止 → 該些項本輪不判)。
// 【判定小組之執行】逐頁執行與既有邊覆核同一份(stages/checkPanelPages;兩席並行、第二席打亂、中止與第三席之規則,及不改用摘要套件之
//   runPanelPage 之理由皆見該檔頭);本段之差異:新提案之兩票＝提案席＋第一席(票序 [提案席, 第一席]),同一頁之第二席只送既有邊
//   (打亂前綴 rs4 取既有邊之 id;頁內無既有邊即不叫)。
// 【失敗語意(中止不計、失敗計;與重評、既有邊覆核同一規則)】中止(skipped:額度用盡、整輪截止、斷網)不是該項之失敗,不記 tries:
//   任一席(含第三席)中止 → 未判之項本輪不判——提案待判原樣(已持久)、既有邊之待判原樣、存量下輪再排;其後之頁不核、記 rs4Aborted。
//   失敗(呼叫失敗、未涵蓋或回覆不合格之缺票、兩票同一供應者)→ retry:待判 pipeline、tries＋1,逾 maxTries 改使用者;使用者負責之待判(要求重試
//   而本輪又未得判定)負責者與下一步不改,只記原因與 tries。陳舊(互斥內回讀型別或理由已變)→ 本輪不判、不記 tries、待判原樣(下輪再核)。
// 【AI 呼叫】經 stages/relateAiCall(段名 'conflictCheck'、席別 first／second／third);逐次給 acceptTruncated:true——回覆為一項一條之陣列,
//   逐項驗證、部分接受,截斷時救回前段完整之項仍有用(缺票之項下輪再核)。
// 【處置】keep:提案落地為衝突邊(依 ctx 重建之提案另過納入閘——材料＝核對席所見之兩方區塊;不過 → 待判重試)／既有邊記檢核合格——既有邊之現行理由
//   確定不合格(RS2／RS3／RS8;兩端存量材料,與符合度掃描同一判定;standards/edgeGate 之 reasonRewriteProblemsOf)者於送審時即附「須以 change 改寫、
//   不可 keep」(buildConflictCheckPrompt 之 reasonProblem);仍判 keep 者 keep 之 reason 未定義為理由、而 keep 決策下無改寫之票 → 修不了即移除
//   std-retire(可以 restoreEdge 之 opt.reason 還原;同既有邊覆核 RS6 之 keep);reason:以核對席之新理由(過納入閘;皆不過 → 依現行理由之確定性狀態
//   分流:合格即維持原理由記合格,不合格即 std-retire——是否衝突已成立,理由改寫只是補強)落地或改寫;downgrade:改為非衝突型(提案以該型落地;既有邊經
//   stores/edgeRewrite 先寫衝突事件帳再改寫,下游據以判「衝突已不成立」;改寫之理由不過閘 → 該次判定失敗,待判重試);retire:提案不落地／既有邊
//   retireEdge(rs4-retire);not-split(非衝突已定而改正之型別判不了):修不了即移除——提案不落地／既有邊 retireEdge(rs4-retire,可 restoreEdge),
//   不交使用者(是否衝突已判定)。既有邊覆核升級而來之提案判非衝突者,另登錄 RS6 使用者待判(兩段之判定不一致)。
//   未成立 retry(缺票、同一供應者):待判 pipeline(逾 maxTries 改 user,下一步改為使用者可完成之處置);undetermined(不確定、不一致):
//   提案不落地、待判 user;既有邊先登錄使用者待判、記檢核(未能判定)、後隔離 retireEdge(rs4-quarantine)——使用者以 restoreEdge 還原即裁示為真衝突
//   (ops/noteOps.restoreEdge:本待判結案、記檢核,不再自動核對此值)。
//   由待判而來者,成立即結案。判定之項一律寫核對帳 relate-conflict-check.jsonl(入口、各票含供應者、結果、寫入值;本輪未判者不寫);既有邊之結果記檢核紀錄
//   (checks;雜湊含型別定義之版本與核對席所見之素材——stores/edgeCheckKit.edgeCheckHashOf,經 stores/checkMaterial.createCheckHasher)。
//   收尾三件事之序一律:記檢核 → 結案待判 → 寫帳。
// 【存量進度】rs4Done／rs4Total(已核／兩端皆在之衝突邊;與既有邊覆核 RS6 同口徑)每輪計數,外部巡檢列示。
// 【時間】扣保留時間(關聯子階段之 opt.reserveMs,未給取 deps.reserveMs;由組裝者注入)後須夠一次呼叫(三席首家逾時之最大者)才開工;
//   不夠 → 本輪不核(提案已持久,不丟)。第三席之每次呼叫以該席首家之逾時判進門(stages/relateAiCall 檔頭【逐次進門門檻】)。
//   額度中止(skipped;含第三席)見【失敗語意】。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { oneline } from '../core/capturePackage.mjs'
import { reserveOf, reserveMsOf, reservedAiCallOf, captureCallMsOf } from '../core/capturePackage.mjs'
import { RELATE_DEFAULT, relateFeatureProblems } from '../core/relateSettings.mjs'
import { panelSeats, PANEL_WHY_LABELS } from '../core/summarizePackage.mjs'
import { STATUS } from '../core/capturePackage.mjs'
import { putHold, resolveHold, listHolds, holdKey, pipelineDueOf } from '../core/capturePackage.mjs'
import { recordCheck } from '../core/stores/checks.mjs'
import { makeEdge, persistEdge, addToAdjacency, compareProposals } from '../stores/edgeStore.mjs'
import { rewriteEdge } from '../stores/edgeRewrite.mjs'
import { EDGE_PRODUCED_STAGES, PROPOSER_ROLE_OF_SEGMENT, voteOfVerdict, producedFieldsOf } from '../stores/edgeProvenance.mjs'
import { appendAudit } from '../stores/relateLedgers.mjs'
import { retireEdge } from '../stores/edgeRetire.mjs'
import { readEdgeAudit, retiredEdgesOf } from '../stores/edgeAudit.mjs'
import { relateHoldDeadlineOf, escalatedHoldNextOf, quarantineHoldNextOf, stdRetiredHowOf, waiverCoversEdge, RELATE_HOLD_NEXT, RELATE_API_HINT } from '../stores/relateHolds.mjs'
import { gateEdgeProposal, gateCtxOf, reasonRewriteProblemsOf, checkPromptItemOf } from '../standards/edgeGate.mjs'
import { RS4, checkVerdictOf, stockQueueOf, stockProgressOf, rs4DecisionOf } from '../stores/conflictCheckPolicy.mjs'
import { RS6 } from '../stores/edgeReviewPolicy.mjs'
import { seatVotesOf, relationTypesVersionOf } from '../stores/edgeCheckKit.mjs'
import { createCheckHasher } from '../stores/checkMaterial.mjs'
import { stockSourceResolvedOf } from '../standards/edgeQueue.mjs'
import { relateAiCallOf } from './relateAiCall.mjs'
import { runCheckPanelPages } from './checkPanelPages.mjs'

const checkJson = (d) => Array.isArray(d) && d.some((it) => Number.isInteger(it?.index))
const uniqTypes = (vs) => [...new Set((vs || []).map((v) => (v?.verdict === 'retire' ? '撤銷' : v?.type)).filter(Boolean))].join('／')
const voteRow = (v) => ({ seat: v.seat, provider: v.provider || '', verdict: v.verdict === null || v.verdict === undefined ? null : (typeof v.verdict === 'object' ? v.verdict : String(v.verdict)) })

/**
 * 衝突核對段(關聯子階段呼叫;停用時回 null)
 *
 * @param {Object} o 輸入 { ctx, rt(relateStage 之 rt;含 pendingConflicts、checkHasher), domain, settings, ai, log, opt }
 * @returns {Promise<Object|null>} 回傳 { det, aiCalls, removed(撤出／隔離者), historyOnly(提案只入 history 之合併) } 或 null(停用)
 * @example
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async (find) => [...m.values()].filter((r) => !find || Object.entries(find).every(([k, v]) => r[k] === v)),
 *         insertNew: async (xs) => { xs.forEach((x) => m.set(x.id, x)); return { addCount: xs.length } },
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *         replace: async (r) => { m.set(r.id, r) },
 *     }
 * }
 * let domain = createRelateDomain({})
 * let notes = [
 *     { id: 'n1', title: '標題n1', category: 'c', summary: 'n1 之重點', concepts: ['p'] },
 *     { id: 'n2', title: '標題n2', category: 'c', summary: 'n2 之重點', concepts: ['p'] },
 * ]
 * let proposal = makeEdge({ from: 'n1', to: 'n2', type: domain.conflictType, reason: 'n1 說動量有效，n2 說動量於高波動期失效', nowIso: '2026-11-01T00:00:00+08:00' })
 * let stores = { notes: mem(notes), relations: mem([]), holds: mem([]), checks: mem([]) }
 * let ctx = {
 *     deps: { stores, clock: { iso8: () => '2026-11-02T00:00:00+08:00' }, dirs: { state: dir } },
 *     log: { info: () => {}, warn: () => {} },
 * }
 * let rt = {
 *     adj: buildAdjacency([]),
 *     byId: new Map(notes.map((n) => [n.id, n])),
 *     ledgers: openRelateLedgers(dir),
 *     conflictType: domain.conflictType,
 *     mutex: createMutex(),
 *     createdThisRun: new Set(),
 *     rank: typeRankOf(domain),
 *     isExtracted: () => false,
 *     touchesExtracted: () => false,
 *     pendingConflicts: [{ edge: proposal, proposer: 'p0', segment: 'forward' }],
 * }
 * let settings = resolveRelateSettings({
 *     ai: { parallel: 1 },
 *     relate: { ai: { use: 'stub:a' }, standards: { conflictCheck: { enabled: true }, ai: { first: { use: 'stub:a' } } } },
 * })
 * let callAI = async (prompt, check, c) => ({ ok: true, providerId: 'p1', data: [{ index: 1, verdict: 'keep', reason: '' }], attempts: 1 })
 * let r = await runConflictCheckSegment({ ctx, rt, domain, settings, ai: null, log: ctx.log, opt: { callAI } })
 * console.log(r.det.rs4Proposals, r.det.rs4Checked, r.det.rs4Written, r.det.conflicts, r.aiCalls)
 * console.log((await stores.relations.get(proposal.id))?.type === domain.conflictType)
 * let off = await runConflictCheckSegment({ ctx, rt, domain, settings: resolveRelateSettings({}), ai: null, log: ctx.log })
 * console.log(off)
 * fs.rmSync(dir, { recursive: true, force: true })
 * // => 1 1 1 1 1
 * // => true
 * // => null
 */
export async function runConflictCheckSegment(o) {
    const { ctx, rt, domain, settings, ai, log, opt = {} } = o
    const cfg = settings.relate.standards.conflictCheck
    const D = RELATE_DEFAULT.standards.conflictCheck
    if ((opt.conflictCheck ?? cfg.enabled) !== true) return null
    const { stores, clock } = ctx.deps
    const nowIso = () => clock.iso8()
    const files = rt.ledgers.files
    const stateDir = ctx.deps.dirs.state
    const perRun = opt.conflictCheckPerRun ?? cfg.perRun ?? D.perRun
    const pageSize = cfg.pageSize ?? D.pageSize
    const maxTries = cfg.maxTries ?? D.maxTries
    const seats = settings.relate.standards.ai || {}
    const det = { rs4Proposals: 0, rs4Holds: 0, rs4HoldsNoSecond: 0, rs4SourceResolved: 0, rs4Stock: 0, rs4Checked: 0, rs4Kept: 0, rs4ReasonFixed: 0, rs4Downgraded: 0, rs4NotSplit: 0, rs4Retired: 0, rs4Undetermined: 0, rs4Quarantined: 0, rs4Retry: 0, rs4StdRejected: 0, rs4StdFixed: 0, rs4StdRetired: 0, rs4SurfaceRejected: 0, rs4Stale: 0, rs4Third: 0, rs4Written: 0, rs4TimeDeferred: false, rs4Aborted: false, rs4Stopped: false, rs4MdMissing: 0, rs4Pending: 0, rs4Done: 0, rs4Total: 0, edges: 0, conflicts: 0, conflictTouchExtracted: 0, edgesChanged: 0 }
    const out = { det, aiCalls: 0, removed: 0, historyOnly: 0 }
    if (!stores.holds || !stores.checks) throw new Error('衝突核對(relate.standards.conflictCheck.enabled)需要 holds 與 checks 集合')
    // 席位與 domain 成員:功能表之單一判定(與執行期件之啟動期檢核同一字樣;本段之開關可由選項覆寫)
    const featureProblems = relateFeatureProblems(settings, domain, { enabled: ['conflictCheck'] })
    if (featureProblems.length) throw new Error(featureProblems.join('；'))
    const byId = rt.byId
    // 關聯型別定義之版本(檢核雜湊之成分;relateStage 每輪算一次)
    const typesVer = rt.typesVer ?? relationTypesVersionOf(domain)
    // 材料與檢核雜湊(兩端 md:一句話重點全文、核心知識、適用條件;讀不到用記錄之 summary 並計數;stores/checkMaterial——關聯段每輪一份,RS6 共用)
    const hasher = rt.checkHasher || createCheckHasher({ byId, domain, typesVer })
    const deadline = () => relateHoldDeadlineOf(nowIso())
    const edgesNow = () => {
        const m = new Map()
        for (const nb of rt.adj.values()) for (const e of nb.values()) m.set(e.id, e)
        return [...m.values()]
    }
    const scanOpt = (edges, checks) => ({ edges, conflictType: rt.conflictType, byId, checkOf: (id) => checks.get(id) || null, extracted: rt.isExtracted, typesVer, seenOf: hasher.seenOf })
    const checksNow = async () => new Map((await stores.checks.select()).filter((r) => r.object === RS4.objectEdge).map((r) => [r.oid, r]))
    // 收尾(各返回點同一份):未結待判數、存量進度(檔頭【存量進度】;以本輪處置後之鄰接表與檢核紀錄重算)
    const finish = async () => {
        det.rs4Pending = (await listHolds(stores.holds, { status: 'open', std: RS4.std })).length
        const p = stockProgressOf(scanOpt(edgesNow(), await checksNow()))
        det.rs4Total = p.total
        det.rs4Done = p.done
        return out
    }
    const resolveH = (h, how) => resolveHold(stores.holds, h.id, { at: nowIso(), how })
    // 材料(兩端 md;stores/checkMaterial,RS6 共用)與既有衝突邊之現行理由之確定性判定之 ctx(送審之項與入項前預檢同一組;standards/edgeGate)
    const sideOf = hasher.sideOf
    const stockCtx = gateCtxOf(domain, { hasNote: (id) => byId.has(id), materialOf: (id) => sideOf(id).material, locale: ctx.deps.locale })

    // ── 入口 ──
    // 提案(本輪之新衝突與前輪未判完之提案待判):同邊多提案依提案全序取最優(stores/edgeStore 之 compareProposals;與完成順序無關)
    const candidates = new Map() // 邊 id → [{ edge, proposer, segment, rebuilt }]
    const addCandidate = (id, c) => {
        if (!candidates.has(id)) candidates.set(id, [])
        candidates.get(id).push(c)
    }
    const memIds = new Set()
    for (const p of isarr(rt.pendingConflicts) ? rt.pendingConflicts : []) {
        memIds.add(p.edge.id)
        addCandidate(p.edge.id, { edge: p.edge, proposer: String(p.proposer || ''), segment: p.segment || 'forward', rebuilt: false })
    }
    det.rs4Proposals = memIds.size
    const entries = new Map() // 邊 id → 項(序:提案(本輪者先、再前輪之待判)→ 既有邊之待判(依 since)→ 存量)
    const proposalHolds = new Map() // 邊 id → 待判(物件 edge-proposal)
    const edgeEntries = []
    let retiredLast = null
    const quarantined = (id) => {
        if (!retiredLast) retiredLast = retiredEdgesOf(readEdgeAudit(stateDir))
        return retiredLast.get(id)?.reason === 'rs4-quarantine'
    }
    // 過時待判之清掃不分負責者(檔頭);本輪入列者只取負責者為管線或使用者要求重試者
    for (const h of await listHolds(stores.holds, { status: 'open', std: RS4.std })) {
        const ctxh = h.ctx || {}
        if (h.object === RS4.objectProposal) {
            const cur = rt.adj.get(ctxh.from)?.get(ctxh.to)
            if (cur && cur.type === rt.conflictType) {
                await resolveH(h, '該對已由其他入口成為衝突邊')
                continue
            }
            if (!byId.has(ctxh.from) || !byId.has(ctxh.to)) {
                await resolveH(h, '端點筆記已不在')
                continue
            }
            if (!pipelineDueOf(h)) continue
            proposalHolds.set(h.oid, h)
            const cut = Number(ctxh.reasonCut)
            addCandidate(h.oid, { edge: { ...makeEdge({ from: ctxh.from, to: ctxh.to, type: rt.conflictType, reason: ctxh.reason, nowIso: ctxh.proposedAt || nowIso() }), ...(Number.isInteger(cut) && cut > 0 ? { reasonCut: cut } : {}) }, proposer: String(ctxh.proposer || ''), segment: ctxh.segment || 'hold', rebuilt: true })
        }
        else if (h.object === RS4.objectEdge) {
            const cur = await stores.relations.get(h.oid)
            if (!cur) {
                if (!quarantined(h.oid)) await resolveH(h, '邊已撤出')
                continue
            }
            if (cur.type !== rt.conflictType) {
                await resolveH(h, `邊已非衝突（現為「${cur.type}」）`)
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
                det.rs4SourceResolved++
                await resolveH(h, src.how)
                continue
            }
            // 既有邊須核對第一、二席:未設第二席 → 不入本輪(待判維持未結),計數並 INFO——不入列後再靜默濾掉
            if (!isobj(seats.second)) {
                det.rs4HoldsNoSecond++
                continue
            }
            edgeEntries.push({ kind: 'edge', edge: cur, hold: h })
        }
    }
    // 既有邊之升級提案(重評、既有邊覆核)須核對第一、二席(檔頭【票】);未設第二席 → 不入本輪(待判已持久,維持未結)
    const twoSeat = (x) => x.kind === 'edge' || ['edgeReview', 'reeval'].includes(x.segment)
    for (const [id, list] of candidates) {
        const best = list.reduce((m, x) => (!m || compareProposals(x.edge, m.edge, rt.rank) < 0 ? x : m), null)
        const x = { kind: 'proposal', edge: best.edge, proposer: best.proposer, segment: best.segment, hold: proposalHolds.get(id) || null, rebuilt: best.rebuilt }
        if (twoSeat(x) && !isobj(seats.second)) {
            det.rs4HoldsNoSecond++
            continue
        }
        entries.set(id, x)
    }
    for (const x of edgeEntries) entries.set(x.edge.id, x)
    if (det.rs4HoldsNoSecond) log.info(`衝突核對：未設第二席（relate.standards.ai.second），既有衝突邊之待判與既有邊之升級提案 ${det.rs4HoldsNoSecond} 條本輪不核（待判維持未結）`)
    det.rs4Holds = [...entries.values()].filter((x) => x.hold && !memIds.has(x.edge.id)).length
    if (perRun > 0 && isobj(seats.second)) {
        const edges = edgesNow()
        const byEdgeId = new Map(edges.map((e) => [e.id, e]))
        // 不重排:本輪已入列、有未結待判(任何負責者)、豁免仍涵蓋現值者
        const exclude = new Set(entries.keys())
        for (const h of await listHolds(stores.holds, { std: RS4.std })) {
            if (h.object !== RS4.objectEdge) continue
            if (h.status === 'open' || waiverCoversEdge(h, byEdgeId.get(h.oid))) exclude.add(h.oid)
        }
        const backlog = stockQueueOf({ ...scanOpt(edges, await checksNow()), exclude, quota: perRun })
        for (const s of backlog) entries.set(s.edge.id, { kind: 'edge', edge: s.edge, hold: null, fromBacklog: true })
        det.rs4Stock = backlog.length
    }
    const list = [...entries.values()]
    if (!list.length) return finish()

    // ── 材料 ──
    // 既有衝突邊之現行理由之確定性違反(RS2／RS3／RS8;材料＝兩端存量材料,與符合度掃描同一判定;正體可修者不算;只判現行理由;材料不可得之
    //   未能判定不在此列)——與既有邊覆核(RS6)同一函數(standards/edgeGate);判定前算好,隨項送核對席(提示詞該項附「須以 change 改寫、
    //   不可 keep」——keep 之 reason 未定義為理由,不得拿來改寫邊)。提案不檢(新進已過納入閘)
    const currentProblems = (x) => (x.kind === 'proposal' ? [] : reasonRewriteProblemsOf(x.edge, stockCtx))
    let idx = 0
    for (const x of list) {
        x.index = ++idx
        x.key = x.edge.id // 判定小組執行器之打亂與裁定之鍵
        x.a = sideOf(x.edge.from)
        x.b = sideOf(x.edge.to)
        x.bad = currentProblems(x)
    }
    det.rs4MdMissing = [...new Set(list.flatMap((x) => [x.edge.from, x.edge.to]))].filter((id) => hasher.missing.has(id)).length
    const promptItem = (x) => checkPromptItemOf(x, x.bad)

    // ── 時間 ──
    // 段之開工門檻(整段延後、每頁開工前之守門)＝三席首家逾時之最大值;第三席之逐次進門門檻＝該席首家之逾時(stages/relateAiCall 檔頭【逐次進門門檻】)
    const firstMs = captureCallMsOf(settings, [seats.first, seats.second, seats.third])
    const thirdMs = captureCallMsOf(settings, seats.third)
    const sub = reserveOf(ctx, reserveMsOf(opt.reserveMs ?? ctx.deps.reserveMs, '衝突核對段之 reserveMs')(ctx))
    /**
     * 登錄待判(重試、逾次、判不了、隔離):使用者負責之待判(要求重試而本輪又未得判定)負責者與下一步不改;逾次改由使用者;其餘依 h。
     *   失敗次數＝登錄之 tries(每次再登錄＋1)——本輪暫緩當下持久之提案待判尚未判過,不算一次
     * @param {Object} x 輸入項
     * @param {Object} h 輸入 { reason, next, owner?, ctx? }
     * @returns {Promise} 回傳登錄後之記錄
     */
    const holdOf = async (x, h) => {
        const prev = x.hold
        const userOwned = !h.owner && prev?.owner === 'user'
        const prevFailures = !prev ? 0 : (x.kind === 'proposal' && memIds.has(x.edge.id) ? Number(prev.tries || 0) : Number(prev.tries || 0) + 1)
        const escalated = !h.owner && !userOwned && prevFailures + 1 >= maxTries
        const owner = h.owner || (userOwned || escalated ? 'user' : 'pipeline')
        // 逾次改由使用者:本段只消化 pipeline 或要求重試者——下一步須為使用者可完成之處置
        const next = userOwned ? prev.next : (escalated ? escalatedHoldNextOf(maxTries, x.kind === 'proposal' ? '提案不落地' : '維持現值') : h.next)
        const object = x.kind === 'proposal' ? RS4.objectProposal : RS4.objectEdge
        // 提案之 ctx 以本輪取最優之提案為準(理由、截短原字數、提案席、來源段、提案時刻)
        const ctxh = x.kind === 'proposal'
            ? { ...(prev?.ctx || {}), from: x.edge.from, to: x.edge.to, reason: x.edge.reason, proposer: x.proposer, segment: x.segment, proposedAt: x.edge.createdAt, reasonCut: x.edge.reasonCut || '', ...(h.ctx || {}) }
            : { from: x.edge.from, to: x.edge.to, ...(prev?.ctx || {}), ...(h.ctx || {}) }
        return putHold(stores.holds, { object, oid: x.edge.id, std: RS4.std, reason: h.reason, next, owner, deadline: deadline(), ctx: ctxh }, nowIso())
    }
    if (!sub.canStart(firstMs)) {
        det.rs4TimeDeferred = true
        log.info(`衝突核對：扣保留時間後剩餘時間不足一次呼叫（${Math.round(firstMs / 1000)}s），本輪延後（提案 ${det.rs4Proposals} 條已在待判）`)
        return finish()
    }

    // ── 判定(逐頁:第一輪 first＋second(既有邊),第二輪 third)──
    // 進門以本次之進門門檻判、鏈內以續派門檻判(抓取套件之 reservedAiCallOf):主席等滿逾時後仍續派遞補,不因剩餘不足一次主席逾時而放棄整條鏈;
    //   第三席於前兩票之後才叫,以該席首家之逾時判進門(startMs),不以三席之最大值再擋一次
    const ask = reservedAiCallOf(relateAiCallOf({ ai, callAI: opt.callAI }), sub, { firstMs })
    const call = async (spec, prompt, which) => {
        out.aiCalls++
        return ask(prompt, checkJson, { spec, seat: which, segment: 'conflictCheck', startMs: which === 'third' ? thirdMs : undefined })
    }
    const vopt = (items) => ({ relationTypes: domain.relationTypes, resolveType: domain.resolveType, conflictType: rt.conflictType, verdictOf: checkVerdictOf, indices: new Set(items.map((x) => x.index)), currentOf: (i) => items.find((x) => x.index === i)?.edge })
    // 判定小組之逐頁執行與既有邊覆核同一份(stages/checkPanelPages);本段之差異:新提案之兩票＝提案席(keep;供應者＝提案之實際成交者)＋
    //   第一席、第二席只送既有邊與既有邊之升級提案(檔頭【票】);第三席:是否衝突未成立而可成立、或非衝突已定而改正之型別各席不一致
    //   (policy.rs4DecisionOf 之 needThird)
    const panel = await runCheckPanelPages({
        list, pageSize, seats, call, log, label: '衝突核對', shufflePrefix: 'rs4',
        buildPrompt: (items) => domain.buildConflictCheckPrompt(items.map(promptItem)),
        votesOf: (data, items) => seatVotesOf(data, vopt(items)),
        secondOf: (page) => page.filter(twoSeat),
        ballotOf: (x, a, b) => (twoSeat(x) ? [a, b] : [{ seat: 'proposer', provider: x.proposer, verdict: { verdict: 'keep', reason: x.edge.reason } }, a]),
        decide: (x) => rs4DecisionOf(x.votes, rt.conflictType),
        shouldStop: () => sub.shouldStop(firstMs),
    })
    if (panel.aborted) det.rs4Aborted = true
    if (panel.stopped) det.rs4Stopped = true
    det.rs4Third += panel.third

    // ── 處置 ──
    // 寫入之提案過納入閘(材料＝核對席所見之兩方區塊;RS8):依成立之票序逐一試其型別與理由,第一個合格者採用(同重評)
    const gateOf = (x, verdicts, at = nowIso()) => {
        const seen = new Map([[x.edge.from, domain.seenTextOf(x.a.note, 'checkSide', x.a.extra)], [x.edge.to, domain.seenTextOf(x.b.note, 'checkSide', x.b.extra)]])
        const gctx = gateCtxOf(domain, { hasNote: (id) => byId.has(id), materialOf: (id) => (seen.has(id) ? seen.get(id) : null), locale: ctx.deps.locale })
        let first = null
        for (const v of verdicts.filter((y) => isobj(y) && y.reason)) {
            const g = gateEdgeProposal(makeEdge({ from: x.edge.from, to: x.edge.to, type: v.type, reason: v.reason, nowIso: at }), gctx)
            if (g.ok) return { ...g, by: v } // by＝被採用之裁決值(產出鏈之成交者由此回找該票:adoptedOf)
            first = first || g
        }
        return first || { ok: false, reasons: ['無可用之理由'] }
    }
    // 產出鏈之成交者(stores/edgeProvenance 檔頭【席位與成交者】):keep 原樣落地之提案＝提案席('proposer',供應者＝提案之實際成交者,提示詞角色依提案來源段);
    //   reason／downgrade＝採用其改寫值之那一票(seat 與 provider 同稽核列 votes 之該票)。找不到(無票可回找)＝不寫產出鏈
    const proposerOf = (x) => ({ seat: 'proposer', provider: x.proposer, role: PROPOSER_ROLE_OF_SEGMENT[x.segment] || 'relate' })
    const adoptedOf = (x, by) => {
        const v = voteOfVerdict(x.votes, by)
        return v ? { seat: v.seat, provider: v.provider || '', role: 'conflict-check' } : null
    }
    const producedOf = (who) => (rt.prov && who ? rt.prov.make({ stage: EDGE_PRODUCED_STAGES.conflictCheck, seat: who.seat, provider: who.provider, role: who.role }) : undefined)
    // 核對帳之入口欄:hold:<物件>｜'stock'(存量;帳列之持久化值)｜'proposal'
    const audit = (x, outcome, extra = {}) => appendAudit(files.conflictCheck, { at: nowIso(), entry: x.hold && !memIds.has(x.edge.id) ? `hold:${x.hold.object}` : (x.fromBacklog ? 'stock' : x.kind), edgeId: x.edge.id, edge: { from: x.edge.from, to: x.edge.to, type: x.edge.type, reason: x.edge.reason }, votes: (x.votes || []).map(voteRow), outcome, ...(x.kind === 'proposal' ? { segment: x.segment } : {}), ...extra })
    const writeProposal = async (x, e, who) => rt.mutex(async () => {
        // 先記後寫:端點記待投影＋總覽待重建(帳之 touch;總覽不只靠輪末之 ctx 旗標——中途被砍亦不漏)
        rt.ledgers.touch([e.from, e.to], { has: (id) => byId.has(id) })
        // admit:完整全序模式下浮上之 history 條目再驗(stores/edgeStore 檔頭【history 浮上再驗】;relateStage 之 rt 提供)
        const res = await persistEdge(stores.relations, e, { rank: rt.rank, conflictType: rt.conflictType, allowTypeChange: rt.createdThisRun.has(e.id), admit: rt.admitSurfaced, produced: producedOf(who) })
        if (res.surfaceRejected) det.rs4SurfaceRejected++
        if (res.created) rt.createdThisRun.add(res.edge.id)
        if (res.changed) addToAdjacency(rt.adj, res.edge)
        if (res.created) det.edges++
        else if (res.visibleChanged) det.edgesChanged++
        else if (res.changed) out.historyOnly++
        const newConflict = (res.created && res.edge.type === rt.conflictType) || res.upgradedToConflict
        if (newConflict) {
            det.conflicts++
            if (rt.touchesExtracted(res.edge)) det.conflictTouchExtracted++
        }
        return res
    })
    const removed = () => {
        out.removed++
    }
    const recordEdge = (e, status, reason, votes) => recordCheck(stores.checks, { object: RS4.objectEdge, oid: e.id, hash: hasher.hashOf(e), std: RS4.std, v: RS4.v, at: nowIso(), status, seats: panelSeats(votes), reason })
    const resolve = (x, how) => (x.hold ? resolveHold(stores.holds, x.hold.id, { at: nowIso(), how }) : null)
    const label = (x) => `[[${x.edge.from}]] ⇄ [[${x.edge.to}]]`
    const stale = (cur, x) => !cur || cur.type !== x.edge.type || cur.reason !== x.edge.reason
    const retireOpt = (reason, detail, extra) => ({ reason, at: nowIso(), detail, conflictTypes: domain.conflictTypeNames, hasNote: (id) => byId.has(id), adj: rt.adj, extra })
    const ledgers = { relations: stores.relations, ledgers: rt.ledgers, stateDir }
    /**
     * 既有邊覆核升級而來之提案經核對判非衝突:兩段之判定不一致 → 登錄 RS6 使用者待判(已有未結者不重登)
     * @param {Object} x 輸入項
     * @param {String} how 輸入核對之結果
     */
    const holdErDisagree = async (x, how) => {
        if (x.segment !== 'edgeReview') return
        const cur = await stores.holds.get(holdKey(RS6.objectEdge, x.edge.id, RS6.std))
        if (cur?.status === 'open') return
        await putHold(stores.holds, { object: RS6.objectEdge, oid: x.edge.id, std: RS6.std, reason: `既有邊覆核兩席判為漏標之衝突，衝突核對${how}——兩段之判定不一致`, next: RELATE_HOLD_NEXT.typeSplit, owner: 'user', deadline: deadline(), ctx: { from: x.edge.from, to: x.edge.to } }, nowIso())
        log.info(`衝突核對：${label(x)} 既有邊覆核判漏標之衝突而核對${how}，兩段不一致，入待判（使用者）`)
    }
    for (const x of list) {
        // 本輪未判(時間不足、任一席之額度／截止中止——含第三席中止而送第三席之項):提案待判原樣(已持久)、既有邊不動(待判者原樣、不記 tries;
        //   存量下輪再入佇列)
        if (!x.decision) continue
        det.rs4Checked++
        let action = x.decision.action
        const verdicts = x.decision.verdicts || []
        const verdict = verdicts[0]
        if (action === 'retry' || action === 'undetermined') {
            const why = x.decision.why
            if (action === 'retry') {
                det.rs4Retry++
                await holdOf(x, { reason: `判定小組未成立（${PANEL_WHY_LABELS[why] || why}）`, next: RELATE_HOLD_NEXT.conflictCheckRetry })
                audit(x, 'retry', { why })
                continue
            }
            det.rs4Undetermined++
            if (x.kind === 'proposal') {
                await holdOf(x, { reason: `判定小組判不了（${PANEL_WHY_LABELS[why] || why}）——衝突未落地`, next: RELATE_HOLD_NEXT.proposalUndetermined, owner: 'user' })
                audit(x, 'undetermined', { why })
                log.info(`衝突核對：${label(x)} 判不了（${why}），提案不落地、入待判`)
                continue
            }
            // 先登錄使用者待判、記檢核(未能判定),後隔離(先記後寫);下一步須與實際可完成之處置一致:邊已撤出,要求重試只會因「邊已撤出」結案;
            //   以 restoreEdge 還原即裁示為真衝突(ops/noteOps.restoreEdge:本待判結案、記檢核,不再自動核對此值——不再派兩席,免再隔離而迴圈)
            const res = await rt.mutex(async () => {
                const cur = await stores.relations.get(x.edge.id)
                if (stale(cur, x)) return 'stale'
                await holdOf(x, { reason: `判定小組判不了（${PANEL_WHY_LABELS[why] || why}）——已隔離`, next: quarantineHoldNextOf(RS4.std, x.edge.id), owner: 'user' })
                await recordEdge(x.edge, STATUS.UNDETERMINED, `判定小組判不了（${why}）`, x.votes)
                await retireEdge(ledgers, cur, retireOpt('rs4-quarantine', `衝突核對判不了（${why}）`, { votes: x.votes.map(voteRow) }))
                return 'quarantined'
            })
            if (res === 'stale') {
                det.rs4Stale++
                continue
            }
            det.rs4Quarantined++
            removed()
            audit(x, 'quarantine', { why })
            log.info(`衝突核對：${label(x)} 判不了（${why}），隔離（${RELATE_API_HINT.restoreEdge}）並入待判`)
            continue
        }

        // ── 成立 ──
        // 真衝突而改寫之理由皆過不了納入閘 → 依現行理由之確定性狀態分流(是否衝突已成立;理由改寫只是補強,不因補強失敗而不納入)
        let g = action === 'reason' || action === 'downgrade' ? gateOf(x, verdicts) : null
        if (action === 'reason' && !g.ok) {
            det.rs4StdRejected++
            audit(x, 'reason-std-reject', { problems: g.reasons })
            action = 'keep'
            g = null
        }
        if (x.kind === 'proposal') {
            if (action === 'retire' || action === 'not-split') {
                if (action === 'retire') det.rs4Retired++
                else det.rs4NotSplit++
                audit(x, action === 'retire' ? 'retire' : 'not-conflict-split')
                await resolve(x, action === 'retire' ? '核對判無知識關聯，提案不落地' : '核對判非衝突而改正之型別各席不一致，提案不落地')
                if (action === 'not-split') log.info(`衝突核對：${label(x)} 判非衝突而型別各席不一致，提案不落地`)
                await holdErDisagree(x, action === 'retire' ? '判無知識關聯' : '判非衝突而型別各席不一致')
                continue
            }
            // keep:本輪之提案已過納入閘;依待判 ctx 重建者另過閘(材料＝核對席所見之兩方區塊;提案時刻不變、截短原字數 reasonCut 帶回)
            if (action === 'keep') {
                g = x.rebuilt ? gateOf(x, [{ type: rt.conflictType, reason: x.edge.reason }], x.edge.createdAt) : { ok: true, edge: x.edge }
                if (g.ok && x.rebuilt && x.edge.reasonCut && !g.edge.reasonCut) g = { ...g, edge: { ...g.edge, reasonCut: x.edge.reasonCut } }
            }
            if (!g.ok) {
                det.rs4StdRejected++
                await holdOf(x, { reason: `${action === 'keep' ? '提案之' : '核對席之'}理由未達標準（${oneline(g.reasons.join('；'), 120)}）`, next: RELATE_HOLD_NEXT.conflictCheckRetry })
                audit(x, 'std-reject', { problems: g.reasons })
                continue
            }
            const res = await writeProposal(x, g.edge, action === 'keep' ? proposerOf(x) : adoptedOf(x, g.by))
            det.rs4Written++
            if (action === 'keep') det.rs4Kept++
            else if (action === 'reason') det.rs4ReasonFixed++
            else det.rs4Downgraded++
            if (res.edge.type === rt.conflictType) await recordEdge(res.edge, STATUS.PASS, action === 'keep' ? '兩席判為真衝突' : '兩席判為真衝突、理由改寫為陳述雙方', x.votes)
            await resolve(x, action === 'downgrade' ? `核對判非衝突，以「${g.edge.type}」落地` : '核對成立，衝突邊落地')
            audit(x, action === 'keep' ? 'written' : (action === 'reason' ? 'written-reason' : 'written-other-type'), { written: { type: res.edge.type, reason: res.edge.reason } })
            if (action !== 'keep') log.info(`衝突核對：${label(x)} ${action === 'reason' ? '理由改寫後落地' : `判非衝突，改以「${g.edge.type}」落地`}（${oneline(g.edge.reason, 80)}）`)
            if (action === 'downgrade') await holdErDisagree(x, `判非衝突（${g.edge.type}）`)
            continue
        }
        if (action === 'keep') {
            // 真衝突成立而現行理由確定不合格(RS2／RS3／RS8;存量排入者——存量處置排入或既有邊覆核轉交——帶 ctx.stockStd):提示詞已對該項要求 change 改寫;
            //   keep 決策下無改寫之票(有即為 reason),仍判 keep 者其 reason 不是理由 → 修不了即移除(std-retire,可以 restoreEdge 之 opt.reason 還原)
            //   ——同既有邊覆核(RS6)之 keep
            const bad = x.bad
            if (bad.length) {
                const why = oneline(bad.join('；'), 120)
                const res = await rt.mutex(async () => {
                    const cur = await stores.relations.get(x.edge.id)
                    if (stale(cur, x)) return 'stale'
                    await retireEdge(ledgers, cur, retireOpt('std-retire', `衝突核對：兩席判為真衝突而現行理由未達標準（${why}），無可用之改寫理由——修不了即移除`, { std: RS4.std, problems: bad, votes: x.votes.map(voteRow) }))
                    return 'std-retired'
                })
                if (res === 'stale') {
                    det.rs4Stale++
                    continue
                }
                removed()
                det.rs4StdRetired++
                await recordEdge(x.edge, STATUS.VIOLATION, `兩席判為真衝突而現行理由未達標準（${why}），且無可用之改寫理由——撤出`, x.votes)
                await resolve(x, stdRetiredHowOf(why, x.edge.id))
                audit(x, 'std-retire', { problems: bad })
                log.info(`衝突核對：${label(x)} 現行理由未達標準且無可用之改寫理由，撤出（std-retire，${RELATE_API_HINT.restoreEdgeReason}）`)
                continue
            }
            det.rs4Kept++
            await recordEdge(x.edge, STATUS.PASS, '兩席判為真衝突', x.votes)
            await resolve(x, '關聯段兩席核對為真衝突（下游之非對立判斷屬其自身脈絡，兩者可並存）')
            audit(x, 'keep')
            continue
        }
        if (g && !g.ok) {
            // 共識之改寫(downgrade)不過閘 → 該次判定失敗:待判重試(記 tries)
            det.rs4StdRejected++
            await holdOf(x, { reason: `核對席之理由未達標準（${oneline(g.reasons.join('；'), 120)}）`, next: RELATE_HOLD_NEXT.conflictCheckRetry })
            audit(x, 'std-reject', { problems: g.reasons })
            continue
        }
        // 非衝突已定而改正之型別各席不一致:修不了 → 撤出(稽核、可 restoreEdge;不留錯標之衝突)
        const splitWhy = action === 'not-split' ? `兩席判非衝突而改正之型別各席不一致（${uniqTypes(verdicts)}）` : ''
        const res = await rt.mutex(async () => {
            const cur = await stores.relations.get(x.edge.id)
            if (stale(cur, x)) return { r: 'stale' }
            const now = nowIso()
            if (action === 'retire' || action === 'not-split') {
                await retireEdge(ledgers, cur, retireOpt('rs4-retire', splitWhy || verdict.reason, { votes: x.votes.map(voteRow) }))
                return { r: action === 'retire' ? 'retired' : 'not-split' }
            }
            // 閘後截短之理由帶 reasonCut(stores/edgeStore 檔頭【理由截短之明示】);降級事件由 rewriteEdge 依型別判(與重評、覆核同一件)
            const proposal = { ...makeEdge({ from: cur.from, to: cur.to, type: g.edge.type, reason: g.edge.reason, nowIso: now }), ...(g.edge.reasonCut ? { reasonCut: g.edge.reasonCut } : {}) }
            const w = await rewriteEdge(ledgers, cur, proposal, { rank: rt.rank, at: now, conflictTypes: domain.conflictTypeNames, hasNote: (id) => byId.has(id), adj: rt.adj, produced: producedOf(adoptedOf(x, g.by)) })
            return { r: action, edge: w.edge }
        })
        if (res.r === 'stale') {
            det.rs4Stale++
            continue
        }
        if (res.r === 'retired' || res.r === 'not-split') {
            removed()
            const why = res.r === 'retired' ? `兩席判無知識關聯：${oneline(verdict.reason, 120)}` : splitWhy
            if (res.r === 'retired') det.rs4Retired++
            else det.rs4NotSplit++
            await recordEdge(x.edge, STATUS.VIOLATION, why, x.votes)
            await resolve(x, `${why}，已撤出（${RELATE_API_HINT.restoreEdge}）`)
            audit(x, res.r === 'retired' ? 'retired' : 'not-conflict-split')
            log.info(`衝突核對：${label(x)} ${res.r === 'retired' ? `判無知識關聯，撤出（${oneline(verdict.reason, 80)}）` : `${splitWhy}，撤出（${RELATE_API_HINT.restoreEdge}）`}`)
            continue
        }
        det.edgesChanged++
        if (res.r === 'reason') {
            det.rs4ReasonFixed++
            // 現行理由確定不合格而經提示詞要求改寫者另計(修正之來源可見)
            if (x.bad.length) det.rs4StdFixed++
            await recordEdge(res.edge, STATUS.PASS, '兩席判為真衝突、理由改寫為陳述雙方', x.votes)
        }
        else {
            det.rs4Downgraded++
            await recordEdge(x.edge, STATUS.VIOLATION, `兩席判非衝突，改為「${res.edge.type}」`, x.votes)
        }
        await resolve(x, res.r === 'reason' ? '真衝突，理由已改寫為陳述雙方' : `非衝突，已改為「${res.edge.type}」`)
        // 改寫列之 edge 另帶改寫前之產出鏈三欄(新增欄位;revertEdgeRevision 撤回時據以撤銷該次改寫所留之產出鏈;改寫前無產出鏈者不帶)
        audit(x, res.r, { edge: { from: x.edge.from, to: x.edge.to, type: x.edge.type, reason: x.edge.reason, ...producedFieldsOf(x.edge) }, written: { type: res.edge.type, reason: res.edge.reason } })
        log.info(`衝突核對：${label(x)} ${res.r === 'reason' ? '理由改寫' : `判非衝突，改為「${res.edge.type}」`}（${oneline(res.edge.reason, 80)}）`)
    }
    await finish()
    if (det.rs4Checked) log.info(`衝突核對：核 ${det.rs4Checked} 條（提案 ${det.rs4Proposals}、待判 ${det.rs4Holds}、存量 ${det.rs4Stock}）：成立 ${det.rs4Kept}、改理由 ${det.rs4ReasonFixed}、非衝突改型 ${det.rs4Downgraded}、非衝突型別分歧 ${det.rs4NotSplit}、無關聯 ${det.rs4Retired}、判不了 ${det.rs4Undetermined}、重試 ${det.rs4Retry}；存量進度 ${det.rs4Done}／${det.rs4Total}；未結待判 ${det.rs4Pending}`)
    return out
}

export default { runConflictCheckSegment }
