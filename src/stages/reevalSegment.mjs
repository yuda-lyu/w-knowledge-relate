// reevalSegment.mjs — 關聯重評段:內容變更之筆記,其既有邊逐條裁決 keep／change／retire(知識變更時調整關聯)
//
// 【位置】關聯子階段內,正向段之後、反向段之前:頁取正向後之鄰接表(本版本正向剛建／升級之邊已以新內容判過,不入頁);
//   反向出隊重驗看得到撤邊後之鄰接表。
// 【目標內容】讀 md 之「一句話重點」全文(摘要套件之 summaryTextOf;記錄之 summary 有字數上限)——讀不到者本輪不入池、
//   不記 tries、計 reevalMdMissing;鄰居用記錄之 summary(提示詞截 120 字)。
// 【流程】選池(needsEdgeReview;守門 relate.reeval.guard;逾 maxTries 者登錄待判 RS5〔物件 note〕、本版本停止自動重評)→ 每篇之待裁邊(reviewEdgesOf:懸空、本版本已判、
//   已裁、同輪兩端皆待重評者由 id 小者之頁裁)→ 分頁(pagesOf)→ 一頁一項,runAiBatchStage 調度;callAI 包兩席並行(第二席之鄰居順序
//   打亂)→ 兩評之同一頁皆回才算涵蓋 → 逐項鏈(hook 錨點 relate.reeval.{verdict, agree, apply, markReviewed};鏈由 relateStage 於建構期組好)。
// 【AI 呼叫】經 stages/relateAiCall(段名 'reeval'、席別 first／second／third);逐次給 acceptTruncated:true——回覆為一項一頁之陣列,
//   各席之裁決逐條驗證、部分接受,截斷時救回前段完整之項仍有用(缺項之邊下輪再評)。三席之回覆同以 verdictsByIndexOf 取項
//   (結構完整之項、同 index 重複取第一個;與批次調度同一規則)。
// 【失敗語意(中止不計、失敗計;與衝突核對、既有邊覆核同一規則)】中止(skipped:額度用盡、整輪截止、斷網)不是該篇之失敗,不記 tries:
//   前兩席中止 → 整批 skipped(批次調度不再開新輪);第三席中止 → 送第三席之邊本輪不判(不計缺項、不寫帳、下輪再評),本輪其後之頁不再叫
//   第三席(已耗盡;其後需第三席之邊同不判),記 aborted。失敗 → reevalTries＋1(每篇每輪至多一次):任一席失敗、兩席未共同涵蓋、逐項鏈異常、
//   本頁有缺項(前兩席缺票;第三席失敗、未涵蓋或該條不合格)、兩票同一供應者、共識之改寫不過納入閘(不套用、不記已審)。
//   陳舊(互斥內回讀已變)→ 本輪不判:不記已審、不記 tries(下輪再評)。
//   逾 relate.reeval.maxTries → 登錄待判(使用者;物件 note),本版本停止自動重評(不以「保留」靜默結案)。開啟(perRun > 0)須 holds 集合(缺即拋,同衝突核對)。
// 【判定(摘要套件之判定小組)】兩席之票成立(明確、相同、供應者不同)才算判定、才記已審;不確定(unsure)為合法裁決;
//   前兩票未成立而可成立者交第三席(relate.reeval.ai.third,有設才叫)。第三席缺票(呼叫失敗、未涵蓋或該條不合格)→ 該邊照缺項:
//   第三席本可改變結果,不以前兩票之未決結果轉使用者(與衝突核對、既有邊覆核同);第三席中止見【失敗語意】。仍未成立:缺票、同一供應者 → 下輪重評;
//   不確定、不一致 → 待判(使用者;物件 edge、標準 RS5)——不記已審、不擋本版本評完,使用者要求重試時該篇本版本再評未判者。
//   待判之結案:該邊判定成立、該篇本版本評完(物件 note 者)、或登錄已過時(筆記不在、內容已再變更、邊不在;每輪開頭掃)。
// 【進度(同篇多頁、委派之邊)】本版本之進度(edgesReviewed)以互斥序列化、鎖內回讀合併(同篇多頁並行時後到者看得到先到者之進度;markNoteProgress);
//   同輪兩端皆待重評之對交 id 小者之頁裁(委派),委派方待承辦頁判定後才記已審——有未判之委派邊者本輪不評完,批次結束後收尾補記、補評完。
// 【不改用摘要套件之 runPanelPage(core/standards/panelRun)】判定小組之票組／流程與 runPanelPage 不同(①受檢項不是以頁內編號對回之項:
//   一頁一篇,頁內各邊以鄰居 slug 對回(verdictsOf),第二席打亂的是鄰居之順序;②前兩席是批次調度(runAiBatchStage)之 callAI:任一席失敗、
//   或兩席未共同涵蓋該篇 → 整頁失敗、該篇記 tries,不是逐邊缺票;③逐條驗證與第三席在逐項鏈之錨點 relate.reeval.verdict／agree(可整條
//   置換或掛載),不在呼叫層;④第三席中止(skipped)只使送第三席之邊本輪不判(不記 tries)、其餘邊照常裁定,不整頁中止),故不改用。
//   與 runPanelPage 同一規則者:兩票之成立與是否叫第三席皆取摘要套件之 decidePanel／needThird(same＝sameEdgeVerdict)。
// 【套用】判定成立、且閘門(relate.reeval.apply)允許該級別 → 套用;否則只記候選。
//   一律寫重評帳 relate-reeval.jsonl(含變更前之邊值與各席裁決)。改型／理由更新之提案先過納入閘(standards/edgeGate;
//   RS1／RS2／RS3／RS8,材料＝模型所見之目標區塊與該鄰居列——含現行理由):第一席之理由不合格改用第二席者,皆不合格 → 該次判定失敗:
//   不套用、不記已審、重評帳 std-reject、計 reevalStdRejected(該篇記 tries)。套用:互斥內回讀比對(陳舊不套)→ 改型:stores/edgeRewrite
//   (兩端 dirty、總覽待重建、衝突降級先寫事件帳、reviseEdge＋writeEdge、鄰接表——與覆核、核對同一件);撤銷:stores/edgeRetire(事件帳、稽核、
//   刪、回驗、鄰接表、反向帳)。撤銷之邊可由 restoreEdge 依稽核還原(還原前再過納入閘)。
//   升為衝突(非衝突改為衝突型)於衝突核對開啟時不先寫:提案持久為 RS4 提案待判(standards/edgeQueue 之 queueConflictProposal)並交本輪衝突核對
//   (比照正向之暫緩;重評帳 deferred、計 rs4Deferred),該邊記已審(判定已成立,套用交核對);衝突核對未開 → 直接改為衝突型。
// 【否決】本版本正向段以新內容又選中之鄰居(relatedPicks),撤銷一票否決——同一版本之兩次判斷互相矛盾時不撤。

import isarr from 'wsemi/src/isarr.mjs'
import { oneline } from '../core/capturePackage.mjs'
import { readMd, summaryTextOf } from '../core/summarizePackage.mjs'
import { runAiBatchStage } from '../core/summarizePackage.mjs'
import { defineMw, applyTaps, makeMsg, count, runChainOverMsgs, cmp } from '../core/capturePackage.mjs'
import { reserveOf, reserveMsOf, reservedAiCallOf, captureCallMsOf } from '../core/capturePackage.mjs'
import { RELATE_DEFAULT, relateFeatureProblems, relateSeatOf } from '../core/relateSettings.mjs'
import { needThird, PANEL_WHY, PANEL_WHY_LABELS } from '../core/summarizePackage.mjs'
import { listHolds, putHold, resolveHold, holdKey, retryRequestedOf } from '../core/capturePackage.mjs'
import { makeEdge } from '../stores/edgeStore.mjs'
import { appendAudit } from '../stores/relateLedgers.mjs'
import { retireEdge } from '../stores/edgeRetire.mjs'
import { rewriteEdge } from '../stores/edgeRewrite.mjs'
import { EDGE_PRODUCED_STAGES, voteOfVerdict, producedFieldsOf } from '../stores/edgeProvenance.mjs'
import { RS5, relateHoldDeadlineOf, RELATE_HOLD_NEXT, RELATE_API_HINT } from '../stores/relateHolds.mjs'
import { gateEdgeProposal, gateCtxOf } from '../standards/edgeGate.mjs'
import { packIds, unpackIds, reviewEdgesOf, pagesOf, verdictsByIndexOf, verdictsOf, decideOf, levelOf, gateAllows, reevalPromptItemOf } from '../stores/reevalPolicy.mjs'
import { needsEdgeReview, edgesReviewedOf } from '../stores/relatedNotes.mjs'
import { makeSlugResolver } from '../stores/candidates.mjs'
import { shuffleStable, sameEdgeVerdict } from '../stores/edgeCheckKit.mjs'
import { queueConflictProposal } from '../standards/edgeQueue.mjs'
import { relateAiCallOf } from './relateAiCall.mjs'

/**
 * 本版本評完時結案該篇之「逾次未評完」待判(RS5,物件 note)——否則使用者要求重試後評完,登錄仍在、每輪又把該篇重新待評
 * @param {Object|null} holds 輸入 holds 集合(未開回 false)
 * @param {String} noteId 輸入筆記 id
 * @param {String} at 輸入時刻
 * @returns {Promise<Boolean>} 回傳是否有結案
 */
async function closeNoteHold(holds, noteId, at) {
    if (!holds) return false
    const cur = await holds.get(holdKey(RS5.objectNote, noteId, RS5.std))
    return cur?.status === 'open' && !!(await resolveHold(holds, cur.id, { how: '本版本既有邊已評完', at }))
}

/** 單評回覆之形狀(調度層之 check):陣列,且至少一項帶整數 index 與 verdicts 陣列 */
const checkSingle = (d) => Array.isArray(d) && d.some((it) => Number.isInteger(it?.index) && Array.isArray(it?.verdicts))

/**
 * 錨點:verdict(兩評之裁決逐條驗證:slug 須解析到本頁鄰居、裁決值合法、change 之型別經 domain.resolveType 對映到清單、change／retire 理由 ≥10 字、
 * 同 to 矛盾作廢)
 *
 * 讀 msg.data(_item、_page、_resolve、_domain、note);寫 _va、_vb(verdictsOf 之產物);計數 reevalInvalid;不短路
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let page = [{ edge: { id: 'e1', type: '甲', reason: '原本的理由原本的理由' }, nb: 'n2' }]
 * let raw = [{ to: 'n2', verdict: 'keep' }, { to: 'nX', verdict: 'keep' }]
 * let msg = {
 *     topic: 'note',
 *     data: { note: { id: 'n1' }, _page: page, _item: { a: raw, b: raw }, _resolve: (to) => (to === 'n2' ? 'n2' : null), _domain: { relationTypes: ['甲'], resolveType: (t) => t } },
 *     meta: {},
 *     stats: {},
 * }
 * let mw = mwReevalVerdict()
 * await mw.handle(msg, {}, (m) => m)
 * console.log(mw.name, [...msg.data._va.byEdge], msg.data._vb.invalid, msg.stats)
 * // => verdict [ [ 'e1', { verdict: 'keep', reason: '' } ] ] 1 { reevalInvalid: 2 }
 */
export const mwReevalVerdict = () => defineMw({
    name: 'verdict',
    handle: async (msg, ctx, next) => {
        const { _item: it, _page: page, _resolve: resolve, _domain: domain, note } = msg.data
        const o = { resolve, relationTypes: domain.relationTypes, resolveType: domain.resolveType, selfId: note.id }
        msg.data._va = verdictsOf(it.a, page, o)
        msg.data._vb = verdictsOf(it.b, page, o)
        const bad = msg.data._va.invalid + msg.data._vb.invalid
        if (bad) count(msg, 'reevalInvalid', bad)
        return next(msg)
    },
})

/**
 * 錨點:agree(判定小組:兩席＋第三席;正向選中之否決)——成立＝兩票明確、相同、實際成交之供應者不同(摘要套件之判定小組);
 *   前兩票未成立而可成立(無缺票、至少一票明確)者交第三席(有設時,只送該些邊);第三席缺票(失敗、未涵蓋或該條不合格)之邊照缺項(missing);
 *   第三席中止(seg.third 回 { stopped:true })之邊標 stopped(why 仍為 missing——未處理 stopped 之 apply 照缺項,不轉使用者);仍未成立者交 apply
 *   依原因處置(不記已審)
 *
 * 讀 msg.data(_page、_va、_vb、_item、note、_seg.third);寫 _results(decideOf 之項＋vetoed／stopped);計數 reevalThird(交第三席之邊數;
 *   第三席本輪已中止而未叫者亦計);不短路
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let page = [{ edge: { id: 'e1', type: '甲' }, nb: 'n2' }, { edge: { id: 'e2', type: '甲' }, nb: 'n3' }]
 * let keep = { verdict: 'keep', reason: '' }
 * let retire = { verdict: 'retire', reason: '兩者無實質關聯可言' }
 * let msg = {
 *     topic: 'note',
 *     data: {
 *         note: { id: 'n1' },
 *         _page: page,
 *         _item: { pa: 'A', pb: 'B' },
 *         _va: { byEdge: new Map([['e1', keep], ['e2', keep]]) },
 *         _vb: { byEdge: new Map([['e1', keep], ['e2', retire]]) },
 *         _seg: { third: async (note, need) => ({ byEdge: new Map(need.map((x) => [x.edge.id, retire])), provider: 'C' }) },
 *     },
 *     meta: {},
 *     stats: {},
 * }
 * let mw = mwReevalAgree()
 * await mw.handle(msg, {}, (m) => m)
 * console.log(mw.name, msg.data._results.map((r) => `${r.edge.id}:${r.decided}:${r.why || r.outcome}`), msg.stats)
 * // => agree [ 'e1:true:keep', 'e2:true:retire' ] { reevalThird: 1 }
 */
export const mwReevalAgree = () => defineMw({
    name: 'agree',
    handle: async (msg, ctx, next) => {
        const { _page: page, _va: va, _vb: vb, _item: it, _seg: seg, note } = msg.data
        const picks = unpackIds(note.relatedPicks, note.knowledgeChangedAt)
        const seats = [{ seat: 'first', provider: it.pa, byEdge: va.byEdge }, { seat: 'second', provider: it.pb, byEdge: vb.byEdge }]
        let results = decideOf(page, seats)
        const need = results.filter((r) => !r.decided && needThird(r.votes, { same: sameEdgeVerdict }))
        if (need.length && typeof seg?.third === 'function') {
            const rc = await seg.third(note, need.map((r) => ({ edge: r.edge, nb: r.nb })))
            count(msg, 'reevalThird', need.length)
            const asked = new Set(need.map((r) => r.edge.id))
            if (rc?.stopped) {
                // 第三席中止(額度、截止;本輪已中止者不再叫):中止不是該邊之失敗——送第三席之邊本輪不判,apply 不計缺項、不記 tries(下輪再評)
                results = results.map((r) => (asked.has(r.edge.id) ? { ...r, decided: false, why: PANEL_WHY.MISSING, stopped: true } : r))
            }
            else {
                const byEdge = rc?.byEdge instanceof Map ? rc.byEdge : new Map()
                if (byEdge.size) results = decideOf(page, [...seats, { seat: 'third', provider: rc.provider, byEdge }])
                // 第三席缺票(呼叫失敗、未涵蓋或該條裁決不合格)→ 該邊照缺項(記 tries):第三席本可改變結果,不以前兩票之未決結果轉使用者
                results = results.map((r) => (asked.has(r.edge.id) && !byEdge.has(r.edge.id) ? { ...r, decided: false, why: PANEL_WHY.MISSING } : r))
            }
        }
        msg.data._results = results.map((r) => {
            if (r.decided && r.outcome === 'retire' && picks.has(r.nb)) {
                count(msg, 'reevalVetoed')
                return { ...r, outcome: 'keep', vetoed: true }
            }
            return r
        })
        return next(msg)
    },
})

/**
 * 錨點:apply(閘門與套用;寫重評帳——缺票與第三席中止之邊本輪未判,不寫)
 *
 * 讀 msg.data(_results、_item、_rt、_seg(重評段之共用件)、_domain、note);寫 _reviewed(本頁判定成立之邊 id;陳舊與改寫不過閘者不在內)、
 * _seg.reviewedEdges(本輪已判定之邊;委派方據以記已審);計數 reevalChanged／reevalRetired／reevalUpgraded／reevalDowngraded／reevalCandidates／
 * reevalDisagree／reevalUnsure／reevalSameProvider／reevalStale／reevalMissing／reevalStdRejected／reevalHolds／reevalHoldsResolved／rs4Deferred、
 * conflicts／conflictTouchExtracted(與正向同口徑);不短路
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let file = path.join(dir, 'relate-reeval.jsonl')
 * let e1 = { id: 'e1', from: 'n1', to: 'n2', type: '甲', reason: '原本的理由原本的理由' }
 * let e2 = { id: 'e2', from: 'n1', to: 'n3', type: '甲', reason: '原本的理由原本的理由' }
 * let seg = { nowIso: () => '2026-11-02T00:00:00+08:00', files: { reeval: file }, apply: false, heldEdges: new Set(), reviewedEdges: new Set() }
 * let msg = {
 *     topic: 'note',
 *     data: {
 *         note: { id: 'n1', knowledgeChangedAt: '2026-11-01T00:00:00+08:00' },
 *         _results: [
 *             { edge: e1, nb: 'n2', votes: [], decided: true, outcome: 'keep' },
 *             { edge: e2, nb: 'n3', votes: [], decided: true, outcome: 'retire', reason: '兩者無實質關聯可言' },
 *         ],
 *         _item: {},
 *         _rt: { conflictType: '衝突' },
 *         _seg: seg,
 *         _domain: {},
 *     },
 *     meta: {},
 *     stats: {},
 * }
 * let ctx = { deps: { stores: { relations: {}, holds: { get: async () => null } } }, log: { info: () => {} } }
 * let mw = mwReevalApply()
 * await mw.handle(msg, ctx, (m) => m)
 * console.log(mw.name, msg.data._reviewed, msg.stats, readAuditRows(file).map((r) => r.outcome))
 * fs.rmSync(dir, { recursive: true, force: true })
 * // => apply [ 'e1', 'e2' ] { reevalCandidates: 1 } [ 'candidate' ]
 */
export const mwReevalApply = () => defineMw({
    name: 'apply',
    handle: async (msg, ctx, next) => {
        const { _results: results, _item: it, _rt: rt, _seg: seg, _domain: domain, note } = msg.data
        const { relations, holds } = ctx.deps.stores
        const version = note.knowledgeChangedAt
        const reviewed = []
        /**
         * 改型／理由更新之提案過納入閘(材料＝模型所見之目標區塊與該鄰居列);第一席之理由不合格改用第二席者
         * @param {Object} r 輸入 decideOf 之一項(outcome＝change)
         * @returns {Object} 回傳 gateEdgeProposal 之結果
         */
        const gateChange = (r) => {
            const nbNote = rt.byId.get(r.nb)
            const seen = new Map([[note.id, domain.seenTextOf(note, 'reevalTarget', { summary: seg.summaryOf(note.id) })], [r.nb, nbNote ? domain.seenTextOf(nbNote, 'reevalNeighbor', { edge: r.edge }) : null]])
            const gctx = gateCtxOf(domain, { hasNote: (id) => rt.byId.has(id), materialOf: (id) => (seen.has(id) ? seen.get(id) : null), locale: ctx.deps.locale })
            const tryReason = (reason) => gateEdgeProposal(makeEdge({ from: note.id, to: r.nb, type: r.type, reason, nowIso: seg.nowIso() }), gctx)
            const g = tryReason(r.reason)
            // by＝被採用之裁決值(產出鏈之成交者由此回找該票:第一席之理由合格取成立之第一票,否則取成立之第二票)
            if (g.ok || !r.b?.reason || r.b.reason === r.reason) return g.ok ? { ...g, by: r.a } : g
            const g2 = tryReason(r.b.reason)
            return g2.ok ? { ...g2, by: r.b } : g
        }
        const held = []
        for (const r of results) {
            const base = { at: seg.nowIso(), note: note.id, version, edgeId: r.edge.id, edge: { from: r.edge.from, to: r.edge.to, type: r.edge.type, reason: r.edge.reason }, verdicts: (r.votes || []).map((v) => ({ ...(v.verdict && typeof v.verdict === 'object' ? v.verdict : { verdict: v.verdict }), seat: v.seat, provider: v.provider || '' })) }
            // 未成立 → 不記已審(未判不記已審):缺票、同一供應者 → 下輪重評(本篇記 tries);不確定、不一致 → 待判(使用者);
            //   第三席中止之邊(stopped)→ 本輪不判:不計缺項、不記 tries、不寫帳(下輪再評)
            if (!r.decided) {
                if (r.stopped) continue
                if (r.why === PANEL_WHY.MISSING) {
                    count(msg, 'reevalMissing')
                    continue
                }
                if (r.why === PANEL_WHY.SAME_PROVIDER) {
                    count(msg, 'reevalSameProvider')
                    appendAudit(seg.files.reeval, { ...base, outcome: 'same-provider' })
                    continue
                }
                count(msg, r.why === PANEL_WHY.UNSURE ? 'reevalUnsure' : 'reevalDisagree')
                appendAudit(seg.files.reeval, { ...base, outcome: r.why })
                held.push({ edge: r.edge, why: r.why, votes: base.verdicts })
                continue
            }
            const level = levelOf(r, rt.conflictType)
            if (level === 'none') {
                reviewed.push(r.edge.id)
                continue
            }
            const proposal = { verdict: r.outcome, type: r.type || '', reason: r.reason || '' }
            if (!gateAllows(seg.apply, level)) {
                reviewed.push(r.edge.id)
                count(msg, 'reevalCandidates')
                appendAudit(seg.files.reeval, { ...base, proposal, level, outcome: 'candidate' })
                continue
            }
            const gated = r.outcome === 'change' ? gateChange(r) : null
            if (gated && !gated.ok) {
                // 共識之改寫不過納入閘 → 該次判定失敗:不套用、不記已審(下輪再評)、該篇記 tries(applyItem 依 reevalStdRejected 記)
                count(msg, 'reevalStdRejected')
                appendAudit(seg.files.reeval, { ...base, proposal, level, outcome: 'std-reject', problems: gated.reasons })
                ctx.log.info(`關聯重評：[[${r.edge.from}]] ⇄ [[${r.edge.to}]] 改為「${r.type}」之理由未達標準，不套用（${oneline(gated.reasons.join('；'), 120)}）`)
                continue
            }
            // 升為衝突於衝突核對開啟時不先寫:提案持久為 RS4 提案待判並交本輪衝突核對(比照正向之暫緩)
            const toConflict = !!gated && gated.edge.type === rt.conflictType && r.edge.type !== rt.conflictType
            const res = await rt.mutex(async () => {
                const cur = await relations.get(r.edge.id)
                if (!cur || cur.type !== r.edge.type || cur.reason !== r.edge.reason) return 'stale'
                const now = seg.nowIso()
                const wasConflict = cur.type === rt.conflictType
                if (r.outcome === 'retire') {
                    await retireEdge({ relations, ledgers: rt.ledgers, stateDir: seg.stateDir }, cur, { reason: 'reeval-retire', at: now, note: note.id, detail: r.reason, conflictTypes: domain.conflictTypeNames, hasNote: (id) => rt.byId.has(id), adj: rt.adj, extra: { verdicts: base.verdicts } })
                    return 'retired'
                }
                if (toConflict && rt.conflictCheckOn) {
                    const p = { ...gated.edge, createdAt: now, updatedAt: now }
                    const proposer = String(it.pa || '')
                    await queueConflictProposal(holds, { from: cur.from, to: cur.to, reason: p.reason, reasonCut: p.reasonCut, proposer, segment: 'reeval', proposedAt: now, at: now, holdReason: '重評兩席判升為衝突，待衝突核對兩席核對' })
                    rt.pendingConflicts.push({ edge: p, proposer, segment: 'reeval' })
                    return 'deferred'
                }
                const newType = gated.edge.type
                // 產出鏈之成交者(stores/edgeProvenance 檔頭【席位與成交者】):採用其改寫值之那一票(seat 與 provider 同重評帳 verdicts 之該票);無票可回找者不寫
                const v = voteOfVerdict(r.votes, gated.by)
                const produced = rt.prov && v ? rt.prov.make({ stage: EDGE_PRODUCED_STAGES.reeval, seat: v.seat, provider: v.provider || '', role: 'reeval' }) : undefined
                await rewriteEdge({ relations, ledgers: rt.ledgers, stateDir: seg.stateDir }, cur, { ...gated.edge, createdAt: now, updatedAt: now }, { rank: rt.rank, at: now, note: note.id, conflictTypes: domain.conflictTypeNames, hasNote: (id) => rt.byId.has(id), adj: rt.adj, produced })
                return wasConflict ? (newType === rt.conflictType ? 'changed' : 'downgraded') : (newType === rt.conflictType ? 'upgraded' : 'changed')
            })
            if (res === 'stale') {
                // 陳舊(互斥內回讀已變):本輪不判——不記已審、不記 tries(下輪再評)
                count(msg, 'reevalStale')
                appendAudit(seg.files.reeval, { ...base, proposal, level, outcome: 'stale' })
                continue
            }
            reviewed.push(r.edge.id)
            if (res === 'deferred') {
                count(msg, 'rs4Deferred')
                appendAudit(seg.files.reeval, { ...base, proposal, level, outcome: 'deferred', written: { type: gated.edge.type, reason: gated.edge.reason, fixes: gated.fixes } })
                ctx.log.info(`關聯重評：[[${r.edge.from}]] ⇄ [[${r.edge.to}]] 升為衝突，交衝突核對判定（${oneline(gated.edge.reason, 80)}）`)
                continue
            }
            // 改寫列(有 gated)之 edge 另帶改寫前之產出鏈三欄(新增欄位;revertEdgeRevision 撤回時據以撤銷該次改寫所留之產出鏈;改寫前無產出鏈者不帶)
            appendAudit(seg.files.reeval, { ...base, ...(gated ? { edge: { ...base.edge, ...producedFieldsOf(r.edge) } } : {}), proposal, level, outcome: 'applied', ...(gated ? { written: { type: gated.edge.type, reason: gated.edge.reason, fixes: gated.fixes } } : {}) })
            if (res === 'retired') count(msg, 'reevalRetired')
            else {
                count(msg, 'reevalChanged')
                if (res === 'downgraded') count(msg, 'reevalDowngraded')
                if (res === 'upgraded') {
                    count(msg, 'reevalUpgraded')
                    count(msg, 'conflicts')
                    if (rt.touchesExtracted(r.edge)) count(msg, 'conflictTouchExtracted')
                }
            }
            ctx.log.info(`關聯重評：[[${r.edge.from}]] ⇄ [[${r.edge.to}]] ${res === 'retired' ? '撤銷' : `改為「${gated.edge.type}」`}（${oneline(gated ? gated.edge.reason : r.reason, 80)}）`)
        }
        // 判不了之邊 → 待判(使用者;物件 edge、標準 RS5);已判定之邊之既有待判結案(holds 集合於段開工時已驗必備)
        const deadline = relateHoldDeadlineOf(seg.nowIso())
        for (const h of held) {
            await putHold(holds, { object: RS5.objectEdge, oid: h.edge.id, std: RS5.std, reason: `重評判不了（${PANEL_WHY_LABELS[h.why] || h.why}）：[[${h.edge.from}]] ⇄ [[${h.edge.to}]]（${h.edge.type}）——${oneline(h.votes.map((v) => `${v.seat}:${v.provider || '?'}:${v.verdict}${v.type ? `→${v.type}` : ''}`).join('；'), 200)}`, next: RELATE_HOLD_NEXT.reevalEdge, owner: 'user', deadline, ctx: { note: note.id, version } }, seg.nowIso())
            seg.heldEdges.add(h.edge.id)
            count(msg, 'reevalHolds')
        }
        for (const id of reviewed) {
            seg.reviewedEdges.add(id)
            const cur = await holds.get(holdKey(RS5.objectEdge, id, RS5.std))
            if (cur?.status === 'open' && await resolveHold(holds, cur.id, { how: '重評已判定', at: seg.nowIso() })) count(msg, 'reevalHoldsResolved')
        }
        msg.data._reviewed = reviewed
        return next(msg)
    },
})

/**
 * 本版本進度落帳(檔頭【進度】):互斥序列化、鎖內回讀合併;有明確裁決之邊記入 edgesReviewed;委派之邊待承辦頁判定後才記;
 *   全部待裁之邊皆已裁、無未判之委派邊 → 評完(edgesReviewedChangeAt＝版本、tries 歸零)。判不了而已交使用者(待判中)之邊不記已審,亦不擋評完
 *   (否則每輪重選、每輪白評;使用者要求重試時再評);評完時有待判中之邊者保留已審清單(使用者要求重試時只再評未判者),無者清空
 *
 * @param {Object} ctx 輸入管線 ctx
 * @param {Object} note 輸入筆記(記憶體快照;落帳後同步)
 * @param {Object} o 輸入 { ids:Array(本頁判定成立之邊 id), deferred:Array(委派之邊 id), rt, seg }
 * @returns {Promise<Object>} 回傳 { complete:Boolean, done:Integer(本版本已審數) }
 * @example
 * let note = { id: 'n1', knowledgeChangedAt: '2026-11-01T00:00:00+08:00', edgesReviewed: '' }
 * let e1 = { id: 'e1', from: 'n1', to: 'n2', type: '甲', createdAt: '2026-10-01T00:00:00+08:00' }
 * let rt = { mutex: createMutex(), adj: new Map([['n1', new Map([['n2', e1]])]]), byId: new Map([['n1', note], ['n2', {}]]), ledgers: { tombstones: { has: () => false } } }
 * let seg = { reviewedEdges: new Set(), coSelected: new Set(), heldEdges: new Set() }
 * let patches = []
 * let ctx = { deps: { stores: { notes: { get: async () => note, patch: async (id, f) => { patches.push(f) } } } } }
 * console.log(await markNoteProgress(ctx, note, { ids: [], deferred: [], rt, seg }), patches[0])
 * console.log(await markNoteProgress(ctx, note, { ids: ['e1'], deferred: [], rt, seg }), patches[1].edgesReviewedChangeAt, patches[1].reevalTries)
 * // => { complete: false, done: 0 } { edgesReviewed: '' }
 * // => { complete: true, done: 1 } 2026-11-01T00:00:00+08:00 0
 */
export async function markNoteProgress(ctx, note, o) {
    const { rt, seg } = o
    return rt.mutex(async () => {
        const version = note.knowledgeChangedAt
        const cur = (await ctx.deps.stores.notes.get(note.id)) || note
        const deferred = isarr(o.deferred) ? o.deferred : []
        const pendingDeferred = deferred.filter((id) => !seg.reviewedEdges.has(id))
        const done = new Set([...unpackIds(cur.edgesReviewed, version), ...(isarr(o.ids) ? o.ids : []), ...deferred.filter((id) => seg.reviewedEdges.has(id))])
        const packed = packIds(version, done)
        const left = reviewEdgesOf({ ...cur, edgesReviewed: packed }, { adj: rt.adj, byId: rt.byId, isTombstoned: (id) => rt.ledgers.tombstones.has(id), coSelected: seg.coSelected, isHeld: (id) => seg.heldEdges.has(id) })
        const complete = !left.edges.length && !pendingDeferred.length
        const hasHeld = [...(rt.adj.get(note.id)?.values() || [])].some((e) => seg.heldEdges.has(e.id))
        const patch = complete ? { edgesReviewedChangeAt: version, edgesReviewed: hasHeld ? packed : '', reevalTries: 0 } : { edgesReviewed: packed }
        await ctx.deps.stores.notes.patch(note.id, patch)
        Object.assign(note, patch)
        return { complete, done: done.size }
    })
}

/**
 * 錨點:markReviewed(本版本進度落帳;markNoteProgress)
 *
 * 讀 msg.data(note、_reviewed、_deferred、_rt、_seg);計數 reevalCompleted／reevalHoldsResolved;不短路
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let note = { id: 'n1', knowledgeChangedAt: '2026-11-01T00:00:00+08:00', edgesReviewed: '' }
 * let e1 = { id: 'e1', from: 'n1', to: 'n2', type: '甲', createdAt: '2026-10-01T00:00:00+08:00' }
 * let rt = { mutex: createMutex(), adj: new Map([['n1', new Map([['n2', e1]])]]), byId: new Map([['n1', note], ['n2', {}]]), ledgers: { tombstones: { has: () => false } } }
 * let seg = { nowIso: () => '2026-11-02T00:00:00+08:00', reviewedEdges: new Set(), coSelected: new Set(), heldEdges: new Set() }
 * let ctx = { deps: { stores: { notes: { get: async () => note, patch: async () => {} } } }, log: { info: () => {} } }
 * let msg = { topic: 'note', data: { note, _reviewed: ['e1'], _deferred: [], _rt: rt, _seg: seg }, meta: {}, stats: {} }
 * let mw = mwReevalMarkReviewed()
 * await mw.handle(msg, ctx, (m) => m)
 * console.log(mw.name, msg.stats, note.edgesReviewedChangeAt)
 * // => markReviewed { reevalCompleted: 1 } 2026-11-01T00:00:00+08:00
 */
export const mwReevalMarkReviewed = () => defineMw({
    name: 'markReviewed',
    handle: async (msg, ctx, next) => {
        const { note, _reviewed: rev, _deferred: deferred, _rt: rt, _seg: seg } = msg.data
        const r = await markNoteProgress(ctx, note, { ids: rev || [], deferred: deferred || [], rt, seg })
        if (r.complete) {
            count(msg, 'reevalCompleted')
            if (await closeNoteHold(ctx.deps.stores.holds, note.id, seg.nowIso())) count(msg, 'reevalHoldsResolved')
            ctx.log.info(`關聯重評：${note.id} 既有邊評完（本版本 ${r.done} 條）`)
        }
        return next(msg)
    },
})

/**
 * 重評鏈(錨點 relate.reeval.{verdict, agree, apply, markReviewed}):opt.reevalChain 給了即整條置換,否則以 opt.reevalTap 掛載於預設鏈。
 *   關聯子階段於建構期呼叫(插件之錨點對不上即拋,不等重評段開工)
 *
 * @param {Object} [opt={}] 輸入 stageRelate 之 opt(取 reevalChain、reevalTap)
 * @returns {Array} 回傳重評鏈
 * @throws {Error} reevalTap 對不上錨點或掛載規格不合時拋出(抓取套件之 applyTaps)
 * @example
 * console.log(reevalChainOf().map((m) => m.name))
 * let own = [{ __kind: 'mw', name: 'mine' }]
 * console.log(reevalChainOf({ reevalChain: own }) === own)
 * try {
 *     reevalChainOf({ reevalTap: { noSuchAnchor: { after: [] } } })
 * }
 * catch (err) {
 *     console.log(err.name)
 * }
 * // => [ 'verdict', 'agree', 'apply', 'markReviewed' ]
 * // => true
 * // => MwContractError
 */
export function reevalChainOf(opt = {}) {
    return opt?.reevalChain || applyTaps([mwReevalVerdict(), mwReevalAgree(), mwReevalApply(), mwReevalMarkReviewed()], opt?.reevalTap, { chainName: 'relate.reeval' })
}

/**
 * 重評段(關聯子階段呼叫;停用時回 null)
 *
 * @param {Object} o 輸入 { ctx, rt, domain, settings, ai, allNotes, log, opt, chain?(重評鏈;未給依 opt 組) }
 * @returns {Promise<Object|null>} 回傳 { det, aiCalls, aiAttempts, fail, failedBatches, missed, chainFailed } 或 null(停用)
 * @example
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let V = '2026-11-01T00:00:00+08:00'
 * fs.writeFileSync(path.join(dir, 'n1.md'), '---\ntitle: 標題n1\nslug: n1\n---\n# 標題n1\n\n## 一句話重點\n\nn1 之重點\n\n## 核心知識\n\n- 要點\n')
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
 * let n1 = { id: 'n1', title: '標題n1', category: 'c', summary: 'n1 之重點', concepts: ['p'], file: path.join(dir, 'n1.md'), relatedAt: V, relatedChangeAt: V, knowledgeChangedAt: V }
 * let n2 = { id: 'n2', title: '標題n2', category: 'c', summary: 'n2 之重點', concepts: ['p'] }
 * let edge = makeEdge({ from: 'n1', to: 'n2', type: domain.relationTypes[0], reason: 'n1 與 n2 共用同一組參數', nowIso: '2026-10-01T00:00:00+08:00' })
 * let notes = [n1, n2]
 * let stores = { notes: mem(notes), relations: mem([edge]), holds: mem([]) }
 * let ctx = {
 *     deps: { stores, clock: { iso8: () => '2026-11-02T00:00:00+08:00' }, dirs: { state: dir } },
 *     log: { info: () => {}, warn: () => {} },
 * }
 * let rt = { adj: buildAdjacency([edge]), byId: new Map(notes.map((n) => [n.id, n])), ledgers: openRelateLedgers(dir), conflictType: domain.conflictType, mutex: createMutex() }
 * let settings = resolveRelateSettings({ ai: { parallel: 1 }, relate: { ai: { use: 'stub:a' }, reeval: { perRun: 1, ai: { second: { use: 'stub:b' } } } } })
 * let callAI = async (prompt, check, c) => ({ ok: true, providerId: c.seat === 'first' ? 'p1' : 'p2', data: [{ index: 1, verdicts: [{ to: 'n2', verdict: 'keep' }] }], attempts: 1 })
 * let r = await runReevalSegment({ ctx, rt, domain, settings, ai: null, allNotes: notes, log: ctx.log, opt: { callAI } })
 * console.log(r.det.reevalPending, r.det.reevalCompleted, r.aiCalls, r.fail, (await stores.notes.get('n1')).edgesReviewedChangeAt === V)
 * let off = await runReevalSegment({ ctx, rt, domain, settings: resolveRelateSettings({}), ai: null, allNotes: notes, log: ctx.log })
 * console.log(off)
 * fs.rmSync(dir, { recursive: true, force: true })
 * // => 1 1 2 0 true
 * // => null
 */
export async function runReevalSegment(o) {
    const { ctx, rt, domain, settings, ai, allNotes, log, opt = {} } = o
    const cfg = settings.relate.reeval
    const D = RELATE_DEFAULT.reeval
    const perRun = opt.reevalPerRun ?? cfg.perRun ?? D.perRun
    if (!(perRun > 0)) return null
    // domain 成員(與判定小組之席位):功能表之單一判定(與執行期件之啟動期檢核同一字樣;本段之開關可由選項覆寫)
    const featureProblems = relateFeatureProblems(settings, domain, { enabled: ['reeval'] })
    if (featureProblems.length) throw new Error(featureProblems.join('；'))
    const holds = ctx.deps.stores.holds
    if (!holds) throw new Error('關聯重評(relate.reeval.perRun)需要 holds 集合')
    const det = { reevalPending: 0, reevalTargets: 0, reevalPages: 0, reevalZero: 0, reevalGaveUp: 0, reevalBlocked: 0, reevalMdMissing: 0, reevalDeferred: false, reevalRetried: 0, reevalHoldsStale: 0 }
    const notesPatch0 = async (n, patch) => {
        await ctx.deps.stores.notes.patch(n.id, patch)
        Object.assign(n, patch)
    }
    // 待判(RS5;物件 edge＝判不了之邊、note＝逾次未評完之篇):待判中(未要求重試)之邊不再自動重評、不擋評完;使用者要求重試 → 其筆記本版本重新待評
    //   (既有已審者不重評);使用者豁免(waive＝裁示保留)之邊本版本不再評(新版本照常評)。
    //   過時之登錄先結案:筆記已不在、內容已再變更(新版本照常重評,不受舊版本之待判阻擋)、邊已不在
    const heldEdges = new Set()
    {
        const byNote = new Map(allNotes.map((n) => [n.id, n]))
        for (const h of await listHolds(holds, { std: RS5.std })) {
            if (h.status === 'resolved') continue
            const n = byNote.get(h.object === RS5.objectEdge ? h.ctx?.note : h.oid)
            if (h.status === 'waived') {
                if (h.object === RS5.objectEdge && n && n.knowledgeChangedAt === h.ctx?.version) heldEdges.add(h.oid)
                continue
            }
            const stale = !n
                ? '筆記已不存在'
                : n.knowledgeChangedAt !== h.ctx?.version
                    ? '內容已再變更（依新版本重評）'
                    : h.object === RS5.objectEdge && ![...(rt.adj.get(n.id)?.values() || [])].some((e) => e.id === h.oid) ? '邊已不存在' : ''
            if (stale) {
                await resolveHold(holds, h.id, { how: stale, at: ctx.deps.clock.iso8() })
                det.reevalHoldsStale++
                continue
            }
            if (!retryRequestedOf(h)) {
                if (h.object === RS5.objectEdge) heldEdges.add(h.oid)
                continue
            }
            if (edgesReviewedOf(n)) {
                await notesPatch0(n, { edgesReviewedChangeAt: '' })
                det.reevalRetried++
            }
        }
    }
    const pending = allNotes.filter(needsEdgeReview)
    det.reevalPending = pending.length
    if (!pending.length) return { det, aiCalls: 0, aiAttempts: 0, fail: 0 }
    const guard = cfg.guard ?? D.guard
    if (pending.length > guard) {
        det.reevalBlocked = pending.length
        log.warn(`關聯重評守門：待重評 ${pending.length} 篇逾 ${guard} 篇（批次改寫？），本輪不開工——${RELATE_API_HINT.reevalBaseline}`)
        return { det, aiCalls: 0, aiAttempts: 0, fail: 0 }
    }
    const notesPatch = notesPatch0
    const maxTries = cfg.maxTries ?? D.maxTries
    const order = pending.sort((a, b) => (a.reevalTries || 0) - (b.reevalTries || 0) || cmp(String(a.knowledgeChangedAt), String(b.knowledgeChangedAt)) || cmp(a.id, b.id))
    const selected = []
    const summaries = new Map() // 目標之一句話重點全文(讀自 md;記錄之 summary 有字數上限)
    const mdMissing = []
    for (const n of order) {
        if ((n.reevalTries || 0) >= maxTries) {
            // 逾次未評完:不以「保留」靜默結案(未判不記已審)——登錄待判(使用者;物件 note),本版本停止自動重評
            const left = reviewEdgesOf(n, { adj: rt.adj, byId: rt.byId, isTombstoned: (id) => rt.ledgers.tombstones.has(id), isHeld: (id) => heldEdges.has(id) }).edges.length
            const at = ctx.deps.clock.iso8()
            await putHold(holds, { object: RS5.objectNote, oid: n.id, std: RS5.std, reason: `重評逾 ${maxTries} 次未評完：本版本尚有 ${left} 條既有邊未得判定（${oneline(n.reevalLastError, 120)}）`, next: RELATE_HOLD_NEXT.reevalNote, owner: 'user', deadline: relateHoldDeadlineOf(at), ctx: { version: n.knowledgeChangedAt } }, at)
            await notesPatch(n, { edgesReviewedChangeAt: n.knowledgeChangedAt, reevalTries: 0 })
            det.reevalGaveUp++
            log.warn(`關聯重評：${n.id} 逾 ${maxTries} 次未評完（尚有 ${left} 條未判），已登錄待判（${RS5.std}）`)
            continue
        }
        if (selected.length >= perRun) continue
        // md 讀不到(或無一句話重點)＝不知道變更後之內容:本輪不入池、不記 tries(不佔名額;md 補回即續評)
        const text = summaryTextOf(readMd(n.file))
        if (!text) {
            mdMissing.push(n.id)
            continue
        }
        summaries.set(n.id, text)
        selected.push(n)
    }
    det.reevalMdMissing = mdMissing.length
    if (mdMissing.length) log.info(`關聯重評：${mdMissing.length} 篇之 md 讀不到（或無一句話重點），本輪不評（例 ${mdMissing.slice(0, 3).join('、')}）`)
    const coSelected = new Set(selected.map((n) => n.id))
    const pageSize = cfg.pageSize ?? D.pageSize
    const items = []
    const deferredOf = new Map() // 筆記 id → 委派之邊 id(交 id 小者之頁裁;待承辦頁判定後於收尾補記)
    for (const n of selected) {
        const r = reviewEdgesOf(n, { adj: rt.adj, byId: rt.byId, isTombstoned: (id) => rt.ledgers.tombstones.has(id), coSelected, isHeld: (id) => heldEdges.has(id) })
        if (r.deferred.length) deferredOf.set(n.id, r.deferred)
        if (!r.edges.length) {
            // 只有委派之邊:待承辦頁判定後才記已審、才評完(檔頭【進度】)
            if (r.deferred.length) continue
            // 無待裁之邊:有待判中之邊者保留已審清單(同 markNoteProgress)
            const hasHeld = [...(rt.adj.get(n.id)?.values() || [])].some((e) => heldEdges.has(e.id))
            await notesPatch(n, { edgesReviewedChangeAt: n.knowledgeChangedAt, edgesReviewed: hasHeld ? n.edgesReviewed || '' : '', reevalTries: 0 })
            await closeNoteHold(holds, n.id, ctx.deps.clock.iso8())
            det.reevalZero++
            continue
        }
        for (const page of pagesOf(r.edges, pageSize, rt.conflictType)) items.push({ note: n, page, deferred: r.deferred })
    }
    const queue = items.slice(0, cfg.pagesPerRun ?? D.pagesPerRun)
    if (!queue.length && !deferredOf.size) return { det, aiCalls: 0, aiAttempts: 0, fail: 0 }

    // 席位沿用之唯一規則(core/relateSettings 之 relateSeatOf):first 未設即 relate.ai、second 未設即 first
    const seatA = relateSeatOf(settings, 'reeval.first')
    const seatB = relateSeatOf(settings, 'reeval.second')
    const seatC = relateSeatOf(settings, 'reeval.third')
    // 開工門檻含第三席(與衝突核對、既有邊覆核同一規則);第三席之逐次進門門檻＝該席首家之逾時(stages/relateAiCall 檔頭【逐次進門門檻】)
    const firstMs = captureCallMsOf(settings, [seatA, seatB, seatC])
    const thirdMs = captureCallMsOf(settings, seatC)
    const sub = reserveOf(ctx, reserveMsOf(opt.reserveMs ?? ctx.deps.reserveMs, '關聯重評段之 reserveMs')(ctx))
    if (!sub.canStart(firstMs)) {
        det.reevalDeferred = true
        log.info(`關聯重評：扣保留時間後剩餘時間不足一次呼叫（${Math.round(firstMs / 1000)}s），本輪延後（待重評 ${pending.length} 篇）`)
        return { det, aiCalls: 0, aiAttempts: 0, fail: 0 }
    }

    const chain = o.chain || reevalChainOf(opt)
    const ask = reservedAiCallOf(relateAiCallOf({ ai, callAI: opt.callAI }), sub, { firstMs })
    // async:呼叫端同步拋出時回 rejected promise(包裝不為 async;前兩席以 Promise.all 並行,第一席之同步拋出不得使第二席未被呼叫——同修前)
    const call = async (spec, p, which) => ask(p, checkSingle, { spec, seat: which, segment: 'reeval', startMs: which === 'third' ? thirdMs : undefined })
    let thirdCalls = 0
    let thirdStopped = false
    const seg = {
        nowIso: () => ctx.deps.clock.iso8(), files: rt.ledgers.files, stateDir: ctx.deps.dirs.state, apply: cfg.apply ?? D.apply, coSelected, summaryOf: (id) => summaries.get(id) || '', heldEdges,
        // 本輪已判定之邊(委派方據以記已審;檔頭【進度】)
        reviewedEdges: new Set(),
        // 第三席(relate.reeval.ai.third;有設才叫):只送前兩票未成立而可成立之邊;回 { byEdge, provider }｜{ stopped:true }｜null——
        //   中止(skipped:額度、截止)→ { stopped:true }(該些邊本輪不判、不記 tries),本輪其後不再叫(已耗盡,亦回 { stopped:true });
        //   失敗 → null(該些邊照缺項,記 tries)
        third: seatC
            ? async (note, sub) => {
                if (thirdStopped) return { stopped: true }
                const p = domain.buildReevalPrompt([reevalPromptItemOf(note, summaries.get(note.id), sub.map((y) => ({ note: rt.byId.get(y.nb), edge: y.edge })))])
                thirdCalls++
                const rc = await call(seatC, p, 'third')
                if (rc?.skipped) {
                    // 並行之頁同時中止時只記一次
                    if (!thirdStopped) log.info(`關聯重評：第三席額度或截止中止（${oneline(rc?.error, 80)}），送第三席之邊本輪不判、下輪再評（不計次）；本輪其後不再叫第三席`)
                    thirdStopped = true
                    return { stopped: true }
                }
                if (!rc?.ok) return null
                const verdicts = verdictsByIndexOf(rc.data).get(1)
                const v = verdictsOf(verdicts, sub, { resolve: makeSlugResolver(sub.map((y) => rt.byId.get(y.nb))), relationTypes: domain.relationTypes, resolveType: domain.resolveType, selfId: note.id })
                return { byEdge: v.byEdge, provider: String(rc.providerId || '') }
            }
            : null,
    }
    const second = new Map() // 第一席之 prompt → 第二席之 prompt(鄰居順序打亂)
    const perBatch = new Map() // 批 → 各頁之 slug 解析器
    const bumped = new Set()
    const bumpTries = async (n, why) => {
        if (bumped.has(n.id)) return
        bumped.add(n.id)
        await notesPatch(n, { reevalTries: (n.reevalTries || 0) + 1, reevalLastError: String(why || '').slice(0, 150) })
    }
    // 只剩委派之邊者(無頁可送)不開批次,只做收尾
    const r = !queue.length ? { applied: {}, aborted: false, stopped: false, aiCalls: 0, aiAttempts: 0, failedBatches: 0, missed: 0, chainFailed: 0 } : await runAiBatchStage({
        log,
        batchSize: 1,
        parallel: opt.parallel ?? settings.ai.parallel,
        rounds: queue.length,
        shouldStop: () => sub.shouldStop(firstMs),
        pickPool: async (limit) => queue.splice(0, limit),
        buildPrompt: async (batch) => {
            const forPrompt = (shuffle) => batch.map((x) => reevalPromptItemOf(
                x.note,
                summaries.get(x.note.id),
                (shuffle ? shuffleStable(x.page, `${x.note.id}|${x.note.knowledgeChangedAt}`, (y) => y.nb) : x.page).map((y) => ({ note: rt.byId.get(y.nb), edge: y.edge })),
            ))
            const p1 = domain.buildReevalPrompt(forPrompt(false))
            second.set(p1, domain.buildReevalPrompt(forPrompt(true)))
            perBatch.set(batch, batch.map((x) => makeSlugResolver(x.page.map((y) => rt.byId.get(y.nb)))))
            return p1
        },
        callAI: async (p1, check) => {
            const [ra, rb] = await Promise.all([call(seatA, p1, 'first'), call(seatB, second.get(p1) || p1, 'second')])
            const attempts = (Number.isFinite(ra?.attempts) ? ra.attempts : 1) + (Number.isFinite(rb?.attempts) ? rb.attempts : 1)
            if (ra?.skipped || rb?.skipped) return { ok: false, skipped: true, error: `重評中止（${oneline((ra?.skipped ? ra : rb)?.error, 80)}）`, attempts }
            if (!ra?.ok || !rb?.ok) return { ok: false, skipped: false, error: `重評${!ra?.ok ? '第一' : '第二'}席失敗（${oneline((!ra?.ok ? ra : rb)?.error, 80)}）`, attempts, errors: [...(ra?.errors || []), ...(rb?.errors || [])] }
            const ma = verdictsByIndexOf(ra.data)
            const mb = verdictsByIndexOf(rb.data)
            const data = [...ma.keys()].filter((i) => mb.has(i)).map((i) => ({ index: i, a: ma.get(i), b: mb.get(i), pa: String(ra.providerId || ''), pb: String(rb.providerId || '') }))
            if (!check(data)) return { ok: false, skipped: false, error: '重評兩席之回覆無共同之完整項', attempts }
            return { ok: true, data, attempts }
        },
        checkResult: (data, batch) => Array.isArray(data) && data.some((it) => Number.isInteger(it?.index) && !!batch[it.index - 1]),
        isValidItem: (it, batch) => Number.isInteger(it?.index) && !!batch[it.index - 1] && Array.isArray(it.a) && Array.isArray(it.b),
        indexOf: (it) => it.index,
        applyItem: async (item, x, helpers) => {
            const resolve = perBatch.get(helpers?.batch)?.[item.index - 1] || (() => null)
            const msg = makeMsg('note', { note: x.note, _item: item, _page: x.page, _deferred: x.deferred, _resolve: resolve, _domain: domain, _rt: rt, _seg: seg }, { stage: 'relate' })
            const res = await runChainOverMsgs({ chain, ctx, msgs: [msg], chainName: 'relate.reeval' })
            if (res.fails) {
                log.warn(`關聯重評：逐項鏈異常[${oneline(x.note.id, 60)}]：${res.errors.join('；')}`)
                await bumpTries(x.note, `逐項鏈異常：${oneline(res.errors.join('；'), 120)}`)
                return { ...res.stats, _chainFailed: true }
            }
            const why = [res.stats.reevalMissing ? `兩評有缺項（${res.stats.reevalMissing} 條缺票：未得兩份明確裁決，或第三席缺票）` : '', res.stats.reevalSameProvider ? `${res.stats.reevalSameProvider} 條兩票同一供應者` : '', res.stats.reevalStdRejected ? `${res.stats.reevalStdRejected} 條改寫之理由未達標準（不套用、不記已審）` : ''].filter(Boolean)
            if (why.length) await bumpTries(x.note, why.join('；'))
            return { ...res.stats, reevalPages: 1 }
        },
        onMissed: (x) => bumpTries(x.note, '本頁未被兩評完整涵蓋'),
        onBatchFailed: async (batch, res) => {
            for (const x of batch) await bumpTries(x.note, `重評批次失敗（${oneline(res?.error, 80)}）`)
        },
    })
    // 收尾:委派之邊已由承辦頁判定者補記已審、補評完(檔頭【進度】;各頁之落帳皆經互斥,此時皆已完成)
    const late = { reevalCompleted: 0, reevalHoldsResolved: 0 }
    for (const [id, deferred] of deferredOf) {
        const n = selected.find((x) => x.id === id)
        const fresh = await ctx.deps.stores.notes.get(id)
        if (!n || !fresh || !needsEdgeReview(fresh) || !deferred.every((e) => seg.reviewedEdges.has(e))) continue
        const m = await markNoteProgress(ctx, n, { ids: [], deferred, rt, seg })
        if (!m.complete) continue
        late.reevalCompleted++
        if (await closeNoteHold(holds, id, seg.nowIso())) late.reevalHoldsResolved++
        log.info(`關聯重評：${id} 既有邊評完（本版本 ${m.done} 條；含委派承辦頁判定者）`)
    }
    det.reevalTargets = new Set(items.map((x) => x.note.id)).size
    return {
        // aborted:額度／截止中止(前兩席由批次調度判;第三席之中止由本段判——同衝突核對、既有邊覆核之 rs4Aborted／rs6Aborted)
        det: { ...det, ...r.applied, reevalCompleted: (r.applied.reevalCompleted || 0) + late.reevalCompleted, reevalHoldsResolved: (r.applied.reevalHoldsResolved || 0) + late.reevalHoldsResolved, aborted: r.aborted || thirdStopped, stopped: r.stopped },
        aiCalls: r.aiCalls * 2 + thirdCalls,
        aiAttempts: r.aiAttempts,
        fail: r.failedBatches + r.missed + r.chainFailed,
        failedBatches: r.failedBatches,
        missed: r.missed,
        chainFailed: r.chainFailed,
    }
}

export default { runReevalSegment, reevalChainOf, mwReevalVerdict, mwReevalAgree, mwReevalApply, mwReevalMarkReviewed, markNoteProgress }
