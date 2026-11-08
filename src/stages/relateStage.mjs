// relateStage.mjs — 關聯子階段之編排:開工前維護 → 正向段 → 重評段 → 反向段 → 輪巡段 → 既有邊覆核段 → 衝突核對段 → 彙總報告
//
// 【機制入套件、prompt 與關聯型別留執行端】候選怎麼挑(共享概念;stores/candidates)、slug 怎麼容錯(雜湊尾碼;同處)、邊怎麼合併(stores/edgeStore)——
//   泛用機制;「有哪些關聯型別」「怎麼要求模型獵取衝突」是領域內容,由執行端注入(詞彙表、提示詞覆寫或整組 domain)。
// 【邊庫為真理、md 為投影】邊一對一條(stores/edgeStore:id＝sha1(min|max)、提案全序合併、單次原子寫入＋回讀);兩端 md 之「關聯」「⚠ 衝突與反例」章
//   由 project 子階段依邊庫重算(stores/noteProjection)。逐項鏈(stages/relateChain)只記 dirty,且先記 dirty 後寫邊。
// 【開工前(無 AI)】①世代檢核:邊 id 不是無序對雜湊者 >0 即 ERROR、本段與投影不寫(fail-closed;未遷移之有序對庫會產生重複)
//   ②③④型別改名、墓碑驅動之懸空清理、內容變更之反應——stages/relateMaintain(maintainRelations)
//   ⑤刪除、還原、撤銷之半狀態(stores/deletions 之 deletionHalfStatesOf;中途中斷而未續作者)每輪發必看字樣「關聯刪除或還原未完成」;
//   墓碑在而記錄在之篇不是本段之對象——不入正向池、候選、反向索引與待處理對、輪巡、重評(其邊之維護照常:記錄在即不算懸空),待使用者續作。
// 【評估版本與正向池】已關聯／待重判之判定在 stores/relatedNotes(isRelated、needsReeval);正向池＝未關聯 ∪ 待重判(內容變更)。同一 prompt、
//   同一候選規則(共享概念;排除自身與衝突鄰居——已是衝突者無可升級,非衝突鄰居仍可被再判為衝突)。正向段跨輪之既有邊只升為衝突;本輪新建之邊以
//   完整全序合併(並行批次之完成順序不影響結果)。
// 【重評段(內容變更之筆記;stages/reevalSegment)】正向之後、反向之前,對其既有邊逐條裁決 keep／change／retire:兩席各評一次、一致且實際供應者不同、
//   閘門(relate.reeval.apply)允許該級別才套用,否則只記候選帳;套件預設停用(relate.reeval.perRun 0)。重評鏈(錨點 relate.reeval.{verdict, agree,
//   apply, markReviewed})於建構期組好(tap 對不上錨點即拋)。
// 【反向段(配額 relate.reverse.perRun,預設 0)】正向評估完一篇即算其反向待處理對(stores/reverseCandidates;不受時間守門,落帳 dirs.state/relate-reverse.json),
//   正向各輪之後以舊筆記為目標、候選＝其待處理之新筆記(分頁)再判一次;tries 只決定排序、永不丟。出隊重驗:兩端皆在、尚無邊、o 已評估且早於 n 之
//   內容時刻(o 若在正向池中則等它評估完)。
// 【輪巡段(檢定標準 RS10;stores/rotationPolicy;relate.rotation.perRun,套件預設 0)】反向之後:已關聯之舊筆記依上次輪巡時刻排隊,逐頁(K 篇)往其
//   共享概念之候選清單後段比對(頁 0＝正向評估之前 K 名),同一條逐項鏈落邊(_segment 'rotation');游標記於筆記 relateRotation,取盡即用盡;
//   失敗只更新時刻(排隊尾)。進度＝用盡篇數／已關聯篇數。
// 【反向與輪巡同一執行器】時間守門、分批、逐項鏈、排隊尾——stages/relateQueueSegment(兩段只給 items 與差異);席位同為 relate.reverse.ai
//   (未設即 relate.ai;core/relateSettings 之 relateSeatOf)。
// 【既有邊覆核段(檢定標準 RS6;stages/edgeReviewSegment;relate.standards.edgeReview.enabled,套件預設 false)】反向之後、衝突核對之前,
//   非衝突型既有邊(內容未變者亦覆核)以兩席(＋第三席)判成立／型別(含漏標之衝突)／理由具體;席位沿用 relate.standards.ai;配額 relate.standards.edgeReview.perRun。
// 【衝突核對段(檢定標準 RS4;stages/conflictCheckSegment;relate.standards.conflictCheck.enabled,套件預設 false)】啟用時正向／反向／輪巡之新衝突
//   (新建或由非衝突升級;重評與既有邊覆核之升級亦同)不在逐項鏈落地——提案於暫緩當下即持久為 RS4 提案待判(standards/edgeQueue 之
//   queueConflictProposal;來源記完成前已持久,中途被砍不遺失;使用者已豁免而理由未變者不重提,計 rs4Waived)——於其後以提案席＋核對席
//   (未成立叫第三席;摘要套件之判定小組)判真衝突才寫入;並消化 RS4 待判與存量衝突邊(配額)。啟用須 holds 與 checks 集合(開工即驗)。
// 【時間】正向段與選配段扣掉保留給後段之時間(opt.reserveMs,未給取每輪依賴之 deps.reserveMs;由組裝者注入,本段不讀他工作之設定)後須夠一次呼叫
//   (callTimeoutMsOf:席位首家之單次逾時)才開工,每次呼叫以「剩餘−保留」封頂(抓取套件之 reserveOf);正向、反向、輪巡、重評、既有邊覆核、衝突核對同一份保留時間。
//   正向段:開工前與每輪(wave)開工前各判一次,不足即少做幾輪(開工前即不足 → 本輪延後,detail.forwardDeferred、新筆記留在池中下輪再做);容量鍵
//   (rounds、notesPerCall)不因時間不足而縮。未注入保留(取值為 0)者正向段不設首家逾時門檻,守門只剩整輪逾期(行為同扣保留前)。
// 【AI 呼叫(stages/relateAiCall)】六類呼叫同一形狀:注入之 opt.callAI 收 { spec, seat, segment, shouldStop, budgetMs, acceptTruncated };
//   回覆為陣列、逐項驗證而部分接受,故逐次給 acceptTruncated:true(截斷時救回前段完整之項)。單項之合格判準＝stages/relateChain 之 coveredItemOf。
// 【history 浮上再驗(檢定標準 RS1／RS2／RS3)】本輪新建之邊以完整全序合併時,勝出身分之最優代表可為 history 條目;
//   rt.admitSurfaced(checkEdge,合併時無材料而不判 RS8)不過者不升任(stores/edgeStore mergeEdge 之 admit),計 edgeSurfaceRejected。
// 【下游已處理之筆記】新衝突與內容變更觸及下游處理時刻 extractedAt 非空之筆記者另計(conflictTouchExtracted／changedTouchExtracted;
//   extractedAt 為摘要套件筆記記錄之資料契約,由讀筆記之下游寫入)——只計數與 INFO,下游自行偵測並處置其產物。
// 【ctx 旗標(logContract 之 RELATE_CTX_FLAGS)】edgesChanged＝本輪邊之實際異動數(新增、可見欄位改變、撤出;每筆寫入只計一次)、
//   blocked＝邊庫世代不符(投影子階段據以略過)。
// 【邊之產出鏈(stores/edgeProvenance)】本段每輪建一個產出者工廠 rt.prov(stamp 取本段 ctx.stamp,同該輪 run.json;提示詞指紋取每輪依賴
//   deps.promptFpOf,未注入即無指紋),各段寫邊時以 rt.prov.make 組 produced 交 persistEdge／rewriteEdge 之 o.produced:正向(relate)、反向(reverse)、
//   輪巡(relate)、重評(reeval)、衝突核對(conflict-check)、既有邊覆核(edge-review)、型別改名(standards-fix)。手組 rt 而未給 prov 者不寫產出鏈。

import isobj from 'wsemi/src/isobj.mjs'
import { noteConsumedOf } from '../core/capturePackage.mjs'
import { oneline } from '../core/capturePackage.mjs'
import { runAiBatchStage } from '../core/summarizePackage.mjs'
import { applyTaps, makeMsg, runChainOverMsgs, stdReport, stageFields } from '../core/capturePackage.mjs'
import { reserveOf, reserveMsOf } from '../core/capturePackage.mjs'
import { STATUS } from '../core/capturePackage.mjs'
import { RELATE_DEFAULT, relateSeatOf, callTimeoutMsOf } from '../core/relateSettings.mjs'
import { RELATE_CTX_FLAGS } from '../logContract.mjs'
import { typeRankOf, createMutex, buildAdjacency, conflictNeighborsOf, generationMismatchOf } from '../stores/edgeStore.mjs'
import { createEdgeProvenance } from '../stores/edgeProvenance.mjs'
import { openRelateLedgers, recentReevalRetiredIds } from '../stores/relateLedgers.mjs'
import { deletionHalfStatesOf, DELETION_HALF_STATE_LABEL } from '../stores/deletions.mjs'
import { isRelated, relatePendingOf, needsReeval, inRelatePool } from '../stores/relatedNotes.mjs'
import { RELATE_API_HINT } from '../stores/relateHolds.mjs'
import { gateCtxOf } from '../standards/edgeGate.mjs'
import { checkEdge } from '../standards/edgeStandards.mjs'
import { relationTypesVersionOf } from '../stores/edgeCheckKit.mjs'
import { createCheckHasher } from '../stores/checkMaterial.mjs'
import { conceptKeysOf, pickCandidates, makeSlugResolver } from '../stores/candidates.mjs'
import { createReverseIndex } from '../stores/reverseCandidates.mjs'
import { REEVAL_REPROPOSE_DAYS } from '../stores/reevalPolicy.mjs'
import { rotationPageOf, rotationQueueOf, rotationProgressOf, rotationCursorOf, rotationBumpOf } from '../stores/rotationPolicy.mjs'
import { relateAiCallOf } from './relateAiCall.mjs'
import { itemTargetOf, coveredItemOf, mwBuildEdges, mwMarkDirty, mwPersistEdges, mwQueueReverse, mwMarkRelated } from './relateChain.mjs'
import { maintainRelations } from './relateMaintain.mjs'
import { createRelateQueueRunner } from './relateQueueSegment.mjs'
import { runReevalSegment, reevalChainOf } from './reevalSegment.mjs'
import { runConflictCheckSegment } from './conflictCheckSegment.mjs'
import { runEdgeReviewSegment } from './edgeReviewSegment.mjs'

/**
 * 關聯子階段(批次 AI 由摘要套件之 aiBatchStage 調度;逐項結果進動作鏈)。hook 錨點:relate.relate.{buildEdges, markDirty, persistEdges,
 * queueReverse, markRelated};重評鏈 relate.reeval.{verdict, agree, apply, markReviewed}(於建構期組好)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.chain] 輸入自組動作鏈(defineMw 產物陣列)，未給則以 tap 組裝預設鏈
 * @param {Object} [opt.tap] 輸入認名掛載規格(applyTaps 之 taps)
 * @param {Array} [opt.reevalChain] 輸入自組之重評鏈(整條置換),未給則以 reevalTap 組裝預設之重評鏈
 * @param {Object} [opt.reevalTap] 輸入重評鏈之認名掛載規格(錨點 verdict／agree／apply／markReviewed)
 * @param {Object} [opt.domain] 輸入整組置換之關聯領域物件，未給則用 ctx.deps.domains.relate
 * @param {Function} [opt.callAI] 輸入覆寫之 AI 呼叫函數 (prompt, check, { spec, seat, segment, shouldStop, budgetMs, acceptTruncated }) => Promise，
 *   未給則用 ai.callJson(六類呼叫同一形狀;stages/relateAiCall)
 * @param {Integer} [opt.candidatesPerTarget] 輸入每一目標之候選數，未給則用 settings.relate.candidatesPerNote
 * @param {Integer} [opt.batchSize] 輸入每批目標數，未給則用 settings.relate.notesPerCall
 * @param {Integer} [opt.parallel] 輸入每輪並行批數，未給則用 settings.ai.parallel
 * @param {Integer} [opt.rounds] 輸入正向輪數，未給則用 settings.relate.rounds
 * @param {Integer} [opt.reversePerRun] 輸入反向段每輪至多目標數，未給則用 settings.relate.reverse.perRun(0＝停用)
 * @param {Integer} [opt.rotationPerRun] 輸入輪巡段每輪至多篇數，未給則用 settings.relate.rotation.perRun(0＝停用)
 * @param {Integer} [opt.reevalPerRun] 輸入重評段每輪至多篇數，未給則用 settings.relate.reeval.perRun(0＝停用)
 * @param {Boolean} [opt.conflictCheck] 輸入衝突核對段是否啟用，未給則用 settings.relate.standards.conflictCheck.enabled
 * @param {Integer} [opt.conflictCheckPerRun] 輸入衝突核對之存量配額，未給則用 settings.relate.standards.conflictCheck.perRun
 * @param {Boolean} [opt.edgeReview] 輸入既有邊覆核段是否啟用，未給則用 settings.relate.standards.edgeReview.enabled
 * @param {Integer} [opt.edgeReviewPerRun] 輸入既有邊覆核之存量配額，未給則用 settings.relate.standards.edgeReview.perRun
 * @param {Integer} [opt.maxRelationsPerNote=RELATE_MAX_RELATIONS_PER_NOTE] 輸入單篇最多取用之關聯數
 * @param {Number|Function} [opt.reserveMs] 輸入保留給後段之毫秒數(非負)，或 (ctx) => 毫秒數(每輪求值):正向段與選配段(反向、輪巡、重評、既有邊覆核、
 *   衝突核對)扣保留後剩餘不足一次呼叫即不開工(正向段於每輪開工前亦判,不足即少做幾輪;開工前即不足 → 本輪延後,detail.forwardDeferred)、
 *   每次 AI 呼叫以「剩餘−保留」封頂;由組裝者注入,本段不讀他工作之設定。未給則取每輪依賴之 ctx.deps.reserveMs(皆未給為 0,此時正向段行為同
 *   扣保留前;不合者於該段開工時拋出,正向段為本段開工時)
 * @returns {Object} 回傳 stage 物件 { name, run }
 * @throws {Error} tap 或 reevalTap 對不上錨點、掛載規格不合時拋出(建構期)
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
 * let notes = mem([
 *     { id: 'a', title: '甲', category: 'c', summary: '以波動度調整部位大小', concepts: ['p'], createdAt: '2026-11-01T00:00:00+08:00', relatedAt: '' },
 *     { id: 'b', title: '乙', category: 'c', summary: '依風險預算縮放部位', concepts: ['p'], createdAt: '2026-10-01T00:00:00+08:00', relatedAt: '2026-10-02T00:00:00+08:00' },
 * ])
 * let relations = mem([])
 * let bag = new Map()
 * let ctx = {
 *     deps: {
 *         stores: { notes, relations },
 *         settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { rounds: 1, notesPerCall: 6, candidatesPerNote: 5, ai: { use: 'stub:a' }, reverse: { perRun: 0 } } }),
 *         ai: null,
 *         clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *         dirs: { state: dir },
 *         domains: { relate: domain },
 *     },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     get: (k, fallback) => (bag.has(k) ? bag.get(k) : fallback),
 *     set: (k, v) => bag.set(k, v),
 * }
 * let callAI = async (prompt, check, c) => ({
 *     ok: true,
 *     providerId: 'p1',
 *     attempts: 1,
 *     data: [{ index: 1, relations: [{ to: 'b', type: domain.relationTypes[0], reason: '兩篇皆以波動度調整部位，屬同一機制之延伸' }] }],
 * })
 * let stage = stageRelate({ callAI })
 * let r = await stage.run(ctx)
 * console.log(stage.name, r.ok, r.stats)
 * console.log(r.detail.targets, r.detail.edges, (await relations.select()).length, bag.get(RELATE_CTX_FLAGS.edgesChanged), (await notes.get('a')).relatedAt)
 * fs.rmSync(dir, { recursive: true, force: true })
 * // => relate true { in: 1, out: 1, skip: 0, fail: 0, aiCalls: 1 }
 * // => 1 1 1 1 2026-11-02T00:00:00+08:00
 */
export function stageRelate(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps(
        [mwBuildEdges(opt), mwMarkDirty(opt), mwPersistEdges(opt), mwQueueReverse(opt), mwMarkRelated(opt)],
        opt.tap, { chainName: 'relate.relate' },
    )
    // 重評鏈於建構期組好(插件之錨點對不上即拋,不等重評段開工才發現)
    const reevalChain = reevalChainOf(opt)

    return {
        ...stageFields(opt, { name: 'relate' }),
        run: async (ctx) => {
            const { stores, settings, ai, dirs, clock } = ctx.deps
            const log = ctx.log
            const domain = opt.domain || ctx.deps.domains.relate
            const nowIso = clock.iso8()
            const ledgers = openRelateLedgers(dirs.state, { stamp: clock.stamp8(), log })
            const allNotes = await stores.notes.select()
            const edges0 = await stores.relations.select()
            // ① 世代檢核(fail-closed)
            const mismatch = generationMismatchOf(edges0)
            if (mismatch > 0) {
                log.error(`關聯邊庫世代不符：${mismatch} 條邊之 id 不是無序對雜湊（sha1(min|max)）——本輪關聯段與投影不寫入；${RELATE_API_HINT.migrate}`)
                ctx.set(RELATE_CTX_FLAGS.blocked, true)
                ctx.set(RELATE_CTX_FLAGS.edgesChanged, 0)
                return stdReport({ ok: false, stats: { fail: 1 }, detail: { genMismatch: mismatch, blocked: true, targets: 0, edges: 0, conflicts: 0, pending: relatePendingOf(allNotes) } })
            }
            const byId = new Map(allNotes.map((n) => [n.id, n]))
            // 邊之產出鏈(stores/edgeProvenance 檔頭):stamp 取本段 ctx.stamp(與 run.json 同值;輪次外之呼叫無);提示詞指紋取每輪依賴之 deps.promptFpOf(未注入即無指紋)
            const prov = createEdgeProvenance({ stamp: ctx.stamp ?? null, nowIso: () => clock.iso8(), promptFpOf: ctx.deps.promptFpOf })
            // ②③④ 維護(早於「筆記不足 2 篇」之提前返回:清理與補帳不因無新工作而跳過)
            const edgeReviewOn = (opt.edgeReview ?? settings.relate.standards.edgeReview.enabled) === true
            const m = await maintainRelations({ stores, edges: edges0, byId, ledgers, domain, stateDir: dirs.state, nowIso, log, edgeReviewOn, prov })
            const base = { typeRenamed: m.typeRenamed, typeOffList: m.typeOffList, typeOffListQueued: m.typeOffListQueued, retired: m.retired, dangling: m.dangling, changedSeen: m.changedSeen, changedTouchExtracted: m.changedTouchExtracted }
            // ⑤ 刪除、還原、撤銷之半狀態(檔頭):每輪發必看字樣;墓碑在而記錄在之篇不是本段之對象(live 以外)
            const half = deletionHalfStatesOf(dirs.state, (id) => byId.has(id))
            if (half.length) log.warn(`關聯刪除或還原未完成：${half.slice(0, 10).map((x) => `${x.id}（${DELETION_HALF_STATE_LABEL[x.state]}）`).join('、')}${half.length > 10 ? `…等 ${half.length} 篇` : ''}——${RELATE_API_HINT.deletionResume}`)
            const isTomb = (id) => ledgers.tombstones.has(id)
            const live = allNotes.filter((n) => !isTomb(n.id))
            if (live.length < 2) {
                log.info('關聯：筆記不足 2 篇，略過')
                ctx.set(RELATE_CTX_FLAGS.edgesChanged, m.retired)
                return stdReport({ stats: { in: 0, out: 0, skip: 0, fail: 0, aiCalls: 0 }, detail: { ...base, targets: 0, edges: 0, conflicts: 0, pending: relatePendingOf(allNotes) } })
            }

            const K = opt.candidatesPerTarget ?? settings.relate.candidatesPerNote
            const quota = opt.reversePerRun ?? settings.relate.reverse.perRun ?? RELATE_DEFAULT.reverse.perRun
            const keysCache = new Map()
            const keysOf = (n) => {
                let k = keysCache.get(n.id)
                if (!k) {
                    k = conceptKeysOf(n)
                    keysCache.set(n.id, k)
                }
                return k
            }
            const adj = buildAdjacency(m.edges)
            const conflictOf = (id) => conflictNeighborsOf(adj, id, domain.conflictType)
            // 下游已處理(檔頭【下游已處理之筆記】:抓取套件之 noteConsumedOf——下游處理時刻 extractedAt 非空)——各段之計數與存量佇列之優先同讀此判準
            const isExtracted = (id) => noteConsumedOf(byId.get(id))
            let revIndex = null
            const typesVer = relationTypesVersionOf(domain)
            const rt = {
                ledgers,
                adj,
                byId,
                // 邊之產出鏈(各段寫邊時取之;手組 rt 之呼叫端未給即不寫產出鏈)
                prov,
                // 本段之對象(記錄在且不在墓碑——刪除或還原停在中途者除外,檔頭⑤):逐項鏈之納入閘以之判端點
                isLive: (id) => byId.has(id) && !isTomb(id),
                conflictOf,
                mutex: createMutex(),
                rank: typeRankOf(domain),
                conflictType: domain.conflictType,
                // 關聯型別定義之版本(RS4／RS6 檢核雜湊之成分;清單或定義變更即令舊檢核作廢——stores/edgeCheckKit)
                typesVer,
                // 檢核雜湊之計算器(兩端 md 之材料本輪快取;衝突核對與既有邊覆核共用一份——stores/checkMaterial)
                checkHasher: createCheckHasher({ byId, domain, typesVer }),
                // 浮上之 history 條目再驗(檔頭【history 浮上再驗】;合併時無材料,RS8 不判)
                admitSurfaced: (p) => checkEdge(p, gateCtxOf(domain, { hasNote: (id) => byId.has(id), locale: ctx.deps.locale })).every((x) => x.status === STATUS.PASS),
                // 筆記／邊之任一端已被下游處理(各段之 conflictTouchExtracted 與 RS4／RS6 存量佇列之優先同讀此判準)
                isExtracted,
                touchesExtracted: (e) => isExtracted(e.from) || isExtracted(e.to),
                createdThisRun: new Set(),
                reproposeIds: recentReevalRetiredIds(ledgers.files.retired, Date.parse(nowIso) - REEVAL_REPROPOSE_DAYS * 86_400_000),
                reverseOn: quota > 0,
                reverseIndex: () => revIndex || (revIndex = createReverseIndex(live, { keysOf, K, excludeOf: conflictOf })),
                // 檢定標準 RS4:啟用時正向／反向／輪巡之新衝突交衝突核對段(stages/conflictCheckSegment)
                conflictCheckOn: (opt.conflictCheck ?? settings.relate.standards.conflictCheck.enabled) === true,
                pendingConflicts: [],
            }
            // 衝突核對開啟須 holds 與 checks 集合(提案之持久、核對之待判與檢核紀錄);開工即驗,不等到提案出現才拋
            if (rt.conflictCheckOn && (!stores.holds || !stores.checks)) throw new Error('衝突核對(relate.standards.conflictCheck.enabled)需要 holds 與 checks 集合')
            const inPool = inRelatePool

            // 時間預算(抓取套件之 budget 單一擁有者):正向段與各選配段同一份保留時間(檔頭【時間】)——扣掉保留給後段之時間後才是本段可用:
            //   開工前判一次(fwdDeferred)、每輪開工前由 harness 以 fwdBatchStop 守門,每次呼叫以「剩餘−保留」封頂、嘗試之間(fwdStop)可中止
            const call = relateAiCallOf({ ai, callAI: opt.callAI })
            const fwdSeat = relateSeatOf(settings, 'relate')
            const fwdKeep = reserveMsOf(opt.reserveMs ?? ctx.deps.reserveMs, '關聯正向段之 reserveMs')(ctx)
            const fwdTime = reserveOf(ctx, fwdKeep)
            // 開工門檻:有保留時為席位首家之單次逾時(同選配段);未保留時為 0——守門只剩整輪逾期,與扣保留前完全相同
            const fwdMinMs = fwdKeep > 0 ? callTimeoutMsOf(settings, fwdSeat) : 0
            const fwdStop = () => fwdTime.shouldStop(fwdMinMs)
            // 批次每輪開工前之守門:有保留時,池已空(無待處理者)不報時間停止——剩餘常低於門檻,池空仍記 stopped 與 WARN 會誤導;無保留者同扣保留前
            const fwdBatchStop = fwdKeep > 0 ? () => live.some(inPool) && fwdStop() : fwdStop
            const callFwd = (p, c) => call(p, c, { spec: fwdSeat, seat: 'proposer', segment: 'forward', shouldStop: fwdStop, budgetMs: fwdTime.remainingMs() })
            // 開工前:有待處理者而扣保留後剩餘不足一次呼叫 → 本輪不開工(輪數 0:不取件、不呼叫、不記 relateTries),新筆記留在池中下輪再做;
            //   輪數不是正整數(opt.rounds 打錯)者不在此判,照舊交批次執行器檢核而拋錯,不被延後吞掉
            const fwdRounds = opt.rounds ?? settings.relate.rounds
            const fwdWaiting = live.filter(inPool).length
            const fwdDeferred = fwdKeep > 0 && Number.isInteger(fwdRounds) && fwdRounds > 0 && fwdWaiting > 0 && !fwdTime.canStart(fwdMinMs)
            if (fwdDeferred) log.info(`關聯正向段：扣保留時間後剩餘時間不足一次呼叫（${Math.round(fwdMinMs / 1000)}s），本輪延後（待處理 ${fwdWaiting} 篇）`)

            /**
             * 單項驗證:index 對得到批內之目標(itemTargetOf)、relations 為陣列,且為空或至少一條過納入閘(coveredItemOf)——皆取 stages/relateChain(與 buildEdges、
             *   評分、專案之評比同一判定)
             * @param {Map} perBatch 輸入批 → { candidateMap, resolvers }
             * @returns {Function} 回傳 (it, batch) => Boolean
             */
            const validOf = (perBatch) => (it, batch) => {
                const t = itemTargetOf(it, batch)
                if (!t) return false
                const info = perBatch.get(batch)
                const resolve = info?.resolvers.get(t.id)
                if (!resolve) return false
                const o = { target: t, resolve, candidates: new Map((info.candidateMap.get(t.id) || []).map((c) => [c.id, c])), domain, hasNote: rt.isLive, nowIso, locale: ctx.deps.locale }
                return coveredItemOf(it, o)
            }
            /**
             * 套用單項:建訊息走逐項鏈(單項拋錯被隔離記 fail、不中斷同批其餘項目)
             * @param {Object} data 輸入訊息資料
             * @param {Function} onChainFail 輸入鏈異常之落帳
             * @returns {Promise} 回傳鏈之統計
             */
            const applyVia = async (data, onChainFail) => {
                const msg = makeMsg('note', { _domain: domain, _rt: rt, _edges: [], ...data }, { stage: 'relate' })
                const r = await runChainOverMsgs({ chain, ctx, msgs: [msg], chainName: 'relate.relate' })
                if (r.fails) {
                    log.warn(`關聯：逐項鏈異常[${oneline(data.note.id, 60)}]：${r.errors.join('；')}`)
                    await onChainFail(`逐項鏈異常：${oneline(r.errors.join('；'), 120)}`)
                    return { ...r.stats, _chainFailed: true } // harness:不算進度、計 chainFailed
                }
                return r.stats
            }

            // ── 正向段:新筆記＋內容變更之筆記 ──
            /**
             * 落帳:relateTries＋1(記憶體快照同步,同輪後續各輪 pickPool 據此排序);不設上限、不改狀態
             * @param {Object} t 輸入目標筆記記錄
             * @param {String} why 輸入原因
             */
            const bumpRelateTries = async (t, why) => {
                t.relateTries = (t.relateTries || 0) + 1
                await stores.notes.patch(t.id, { relateTries: t.relateTries, relateLastError: String(why || '').slice(0, 150) })
            }
            const fwdBatch = new Map()
            const isValidFwd = validOf(fwdBatch)
            const r = await runAiBatchStage({
                log,
                batchSize: opt.batchSize ?? settings.relate.notesPerCall,
                parallel: opt.parallel ?? settings.ai.parallel,
                rounds: fwdDeferred ? 0 : fwdRounds,
                shouldStop: fwdBatchStop,
                // relateTries 升冪(隊頭防阻塞:slug 永遠解析不過、屢次未涵蓋或批次屢敗者排隊尾——不佔名額也不丟)→ createdAt 升冪
                pickPool: async (limit) => live
                    .filter(inPool)
                    .sort((a, b) => (a.relateTries || 0) - (b.relateTries || 0) || String(a.createdAt).localeCompare(String(b.createdAt)))
                    .slice(0, limit),
                buildPrompt: async (batch) => {
                    const candidateMap = new Map(batch.map((t) => [t.id, pickCandidates(t, live, K, { exclude: conflictOf(t.id), keysOf })]))
                    const resolvers = new Map(batch.map((t) => [t.id, makeSlugResolver(candidateMap.get(t.id))]))
                    fwdBatch.set(batch, { candidateMap, resolvers })
                    return domain.buildPrompt(batch, candidateMap)
                },
                checkResult: (data, batch) => Array.isArray(data) && data.some((it) => isValidFwd(it, batch)),
                isValidItem: isValidFwd,
                indexOf: (it) => it.index,
                callAI: callFwd,
                // 該項所屬之批由 harness 傳入(同一目標同階段兩度入批時不以目標反查)
                applyItem: async (item, t, helpers) => {
                    const info = fwdBatch.get(helpers?.batch)
                    return applyVia({ note: t, _aiItem: item, _resolver: info.resolvers.get(t.id), _candidates: info.candidateMap.get(t.id), _segment: 'forward', _provider: helpers?.providerId || '' },
                        (why) => bumpRelateTries(t, why))
                },
                // 未涵蓋／整批失敗皆記 relateTries(不設上限:排隊尾即不佔名額,記錄永不丟)
                onMissed: (t) => bumpRelateTries(t, '未被模型完整涵蓋（缺席或項目不合格式）'),
                onBatchFailed: async (batch, res) => {
                    for (const t of batch) await bumpRelateTries(t, `關聯批次失敗（${oneline(res?.error, 80)}）`)
                },
            })

            // ── 重評段:內容變更之筆記,其既有邊逐條裁決(stages/reevalSegment;正向之後、反向之前;停用時 null) ──
            const rv = await runReevalSegment({ ctx, rt, domain, settings, ai, allNotes: live, log, opt, chain: reevalChain })

            // ── 反向段:舊筆記為目標、候選＝其待處理之新筆記(分頁);tries 只決定排序、永不丟(執行器 stages/relateQueueSegment) ──
            let rr = null
            const rev = { deferred: false, dropped: 0 }
            if (quota > 0) {
                const runner = createRelateQueueRunner({ ctx, settings, opt, domain, log, seat: relateSeatOf(settings, 'reverse'), segment: 'reverse', label: '反向段', reserveLabel: '關聯反向段之 reserveMs', call, validOf, applyVia })
                // 出隊重驗:兩端皆在、尚無邊、o 已評估且早於 n 之內容時刻(o 若在正向池中則等它評估完)
                const groups = new Map()
                const drop = []
                for (const p of ledgers.reverse.pairs()) {
                    const o = byId.get(p.o)
                    const n = byId.get(p.n)
                    if (!o || !n || adj.get(p.o)?.has(p.n)) {
                        drop.push(p)
                        continue
                    }
                    // 刪除或還原停在中途之篇(檔頭⑤):本輪不判、留帳
                    if (isTomb(p.o) || isTomb(p.n) || inPool(o)) continue
                    if (!(String(o.relatedAt) < String(n.knowledgeChangedAt || n.createdAt || ''))) {
                        drop.push(p)
                        continue
                    }
                    if (!groups.has(p.o)) groups.set(p.o, [])
                    groups.get(p.o).push(p)
                }
                if (drop.length) {
                    const keys = new Set(drop.map((p) => `${p.o}|${p.n}`))
                    ledgers.reverse.remove((p) => keys.has(`${p.o}|${p.n}`))
                    rev.dropped = drop.length
                }
                const order = [...groups.entries()].map(([oid, ps]) => ({
                    o: byId.get(oid),
                    page: ps.sort((a, b) => b.score - a.score || String(byId.get(b.n)?.createdAt).localeCompare(String(byId.get(a.n)?.createdAt))).slice(0, K),
                    minTries: Math.min(...ps.map((x) => x.tries || 0)),
                    oldest: ps.reduce((mm, x) => (!mm || x.at < mm ? x.at : mm), ''),
                })).sort((a, b) => a.minTries - b.minTries || a.oldest.localeCompare(b.oldest) || (a.o.id < b.o.id ? -1 : 1)).slice(0, quota)
                const pageOf = new Map(order.map((g) => [g.o.id, g.page]))
                const res = await runner.run({
                    items: order.map((g) => ({ note: g.o, candidates: g.page.map((p) => byId.get(p.n)), data: { _page: g.page } })),
                    // 失敗或未涵蓋:該頁之待處理對 tries＋1(只決定排序)
                    bump: (o) => ledgers.reverse.bump(pageOf.get(o.id) || []),
                    deferredNote: () => `（待處理 ${ledgers.reverse.size()} 對）`,
                })
                rev.deferred = res.deferred
                rr = res.ran
            }

            // ── 輪巡段(檢定標準 RS10;舊×舊候選涵蓋:已關聯之舊筆記逐頁往候選清單後段比對;配額 relate.rotation.perRun,預設 0) ──
            const rotQuota = opt.rotationPerRun ?? settings.relate.rotation.perRun ?? RELATE_DEFAULT.rotation.perRun
            const rot = { deferred: false, exhausted: 0, picked: 0, ran: null }
            if (rotQuota > 0) {
                const runner = createRelateQueueRunner({ ctx, settings, opt, domain, log, seat: relateSeatOf(settings, 'rotation'), segment: 'rotation', label: '輪巡', reserveLabel: '關聯輪巡段之 reserveMs', call, validOf, applyVia })
                const idx = rt.reverseIndex()
                const isNeighbor = (a, b) => !!adj.get(a)?.has(b)
                const picked = []
                for (const n of rotationQueueOf(live, { inPool })) {
                    if (picked.length >= rotQuota) break
                    const pg = rotationPageOf(n, { scoresFor: idx.scoresFor, byId, K, page: n.relateRotation?.page ?? 1, isNeighbor })
                    if (pg.done) {
                        // 用盡(本次無候選):記下,不再排入(內容變更之重判會重置)
                        const done = rotationCursorOf(pg, { at: nowIso, done: true })
                        await stores.notes.patch(n.id, { relateRotation: done })
                        n.relateRotation = done
                        rot.exhausted++
                        continue
                    }
                    picked.push({ n, pg })
                }
                rot.picked = picked.length
                // 失敗或未涵蓋:只更新時刻(排隊尾)、不前進頁——下輪再比同一頁
                const bumpRot = async (o) => {
                    const cur = rotationBumpOf(o.relateRotation, clock.iso8())
                    await stores.notes.patch(o.id, { relateRotation: cur })
                    o.relateRotation = cur
                }
                const res = await runner.run({
                    items: picked.map((x) => ({ note: x.n, candidates: x.pg.candidates, data: { _rotation: x.pg, _rotationK: K } })),
                    bump: bumpRot,
                })
                rot.deferred = res.deferred
                rot.ran = res.ran
            }
            const rotProgress = rotQuota > 0 ? rotationProgressOf(live) : null

            // ── 既有邊覆核段(檢定標準 RS6;非衝突型既有邊之兩席覆核:待判＋存量配額;衝突核對之前;停用時 null) ──
            const er = await runEdgeReviewSegment({ ctx, rt, domain, settings, ai, log, opt })
            const erd = er?.det || {}

            // ── 衝突核對段(檢定標準 RS4;正向、重評、反向、輪巡之後:本輪新衝突提案＋待判＋存量配額;停用時 null) ──
            const cc = await runConflictCheckSegment({ ctx, rt, domain, settings, ai, log, opt })
            const ccd = cc?.det || {}

            const a = r.applied
            const ra = rr?.applied || {}
            const rvd = rv?.det || {}
            const ro = rot.ran || null
            const roa = ro?.applied || {}
            // 重評之計數(停用時不出現——外部巡檢不對停用之安裝判待重評):升為衝突併入 conflicts／conflictTouchExtracted(同口徑),
            //   改型併入 edgesChanged(可見欄位改變),撤銷另計 reevalRetired(「retired」為清除已刪筆記之邊,語意不同)
            const reevalDet = rv
                ? {
                    reevalPending: rvd.reevalPending || 0,
                    reevalTargets: rvd.reevalTargets || 0,
                    reevalPages: rvd.reevalPages || 0,
                    reevalCompleted: rvd.reevalCompleted || 0,
                    reevalZero: rvd.reevalZero || 0,
                    reevalChanged: rvd.reevalChanged || 0,
                    reevalRetired: rvd.reevalRetired || 0,
                    reevalUpgraded: rvd.reevalUpgraded || 0,
                    reevalDowngraded: rvd.reevalDowngraded || 0,
                    reevalCandidates: rvd.reevalCandidates || 0,
                    reevalDisagree: rvd.reevalDisagree || 0,
                    reevalUnsure: rvd.reevalUnsure || 0,
                    reevalSameProvider: rvd.reevalSameProvider || 0,
                    reevalThird: rvd.reevalThird || 0,
                    reevalHolds: rvd.reevalHolds || 0,
                    reevalHoldsResolved: rvd.reevalHoldsResolved || 0,
                    reevalHoldsStale: rvd.reevalHoldsStale || 0,
                    reevalRetried: rvd.reevalRetried || 0,
                    reevalStale: rvd.reevalStale || 0,
                    reevalStdRejected: rvd.reevalStdRejected || 0,
                    reevalVetoed: rvd.reevalVetoed || 0,
                    reevalInvalid: rvd.reevalInvalid || 0,
                    reevalMissing: rvd.reevalMissing || 0,
                    reevalGaveUp: rvd.reevalGaveUp || 0,
                    reevalBlocked: rvd.reevalBlocked || 0,
                    reevalMdMissing: rvd.reevalMdMissing || 0,
                    reevalDeferred: !!rvd.reevalDeferred,
                }
                : {}
            // 振盪觀察(正向＋反向＋輪巡新建者;重評停用後仍可能發生,有值即列)
            const reproposed = (a.reevalReproposed || 0) + (ra.reevalReproposed || 0) + (roa.reevalReproposed || 0)
            if (rv || reproposed) reevalDet.reevalReproposed = reproposed
            // 衝突核對之計數(停用時不出現);核對落地之邊與衝突併入 edges／conflicts／edgesChanged(同口徑);交核對之新衝突(rs4Deferred)
            //   含正向、反向、輪巡、重評與既有邊覆核之升級;豁免不重提(rs4Waived)
            const ccDet = cc
                ? Object.fromEntries(Object.entries(ccd).filter(([kk]) => kk.startsWith('rs4')).map(([kk, v]) => [kk, v]))
                : {}
            if (cc) {
                ccDet.rs4Deferred = (a.rs4Deferred || 0) + (ra.rs4Deferred || 0) + (roa.rs4Deferred || 0) + (rvd.rs4Deferred || 0) + (er?.rs4Deferred || 0)
                ccDet.rs4Waived = (a.rs4Waived || 0) + (ra.rs4Waived || 0) + (roa.rs4Waived || 0)
            }
            // 既有邊覆核之計數(停用時不出現);改寫與升為衝突併入 edgesChanged／conflicts／conflictTouchExtracted(同口徑)
            const erDet = er ? Object.fromEntries(Object.entries(erd).filter(([kk]) => kk.startsWith('rs6'))) : {}
            // 輪巡之計數(檢定標準 RS10;停用時不出現):本輪輪巡篇數、新建之邊、用盡、延後、進度(用盡篇數／已關聯篇數)
            const rotDet = rotQuota > 0
                ? { rotationTargets: roa.rotationTargets || 0, rotationEdges: roa.rotationEdges || 0, rotationExhausted: rot.exhausted, rotationDeferred: rot.deferred, rotationDone: rotProgress.done, rotationTotal: rotProgress.total }
                : {}
            const det = {
                ...base,
                targets: a.targets || 0,
                reTargets: a.reTargets || 0,
                edges: (a.edges || 0) + (ra.edges || 0) + (roa.edges || 0) + (ccd.edges || 0),
                edgeStdRejected: (a.edgeStdRejected || 0) + (ra.edgeStdRejected || 0) + (roa.edgeStdRejected || 0),
                edgeStdFixed: (a.edgeStdFixed || 0) + (ra.edgeStdFixed || 0) + (roa.edgeStdFixed || 0),
                // 過閘後之丟棄(單篇上限、同一對象多條)與浮上未過再驗之計數(檔頭;正向＋反向＋輪巡同一條逐項鏈)
                relateCapDropped: (a.relateCapDropped || 0) + (ra.relateCapDropped || 0) + (roa.relateCapDropped || 0),
                relateDupDropped: (a.relateDupDropped || 0) + (ra.relateDupDropped || 0) + (roa.relateDupDropped || 0),
                edgeSurfaceRejected: (a.edgeSurfaceRejected || 0) + (ra.edgeSurfaceRejected || 0) + (roa.edgeSurfaceRejected || 0),
                conflicts: (a.conflicts || 0) + (ra.conflicts || 0) + (roa.conflicts || 0) + (rvd.conflicts || 0) + (ccd.conflicts || 0) + (erd.conflicts || 0),
                edgesChanged: (a.edgesChanged || 0) + (ra.edgesChanged || 0) + (roa.edgesChanged || 0) + (rvd.reevalChanged || 0) + (ccd.edgesChanged || 0) + (erd.edgesChanged || 0),
                conflictTouchExtracted: (a.conflictTouchExtracted || 0) + (ra.conflictTouchExtracted || 0) + (roa.conflictTouchExtracted || 0) + (rvd.conflictTouchExtracted || 0) + (ccd.conflictTouchExtracted || 0) + (erd.conflictTouchExtracted || 0),
                ...reevalDet,
                ...ccDet,
                ...erDet,
                ...rotDet,
                forwardDeferred: fwdDeferred,
                reverseQueued: a.reverseQueued || 0,
                reverseTargets: ra.reverseTargets || 0,
                reverseEdges: ra.reverseEdges || 0,
                reverseDropped: rev.dropped,
                reverseDeferred: rev.deferred,
                reversePending: ledgers.reverse.size(),
                // 中止與未判完之彙總含各選配段(衝突核對、既有邊覆核亦在內;各段另有 rs4Aborted／rs6Aborted 等專屬鍵)
                aborted: r.aborted || !!rr?.aborted || !!ro?.aborted || !!rvd.aborted || !!ccd.rs4Aborted || !!erd.rs6Aborted,
                stopped: r.stopped || !!rr?.stopped || !!ro?.stopped || !!rvd.stopped || !!ccd.rs4Stopped || !!erd.rs6Stopped,
                failedBatches: r.failedBatches + (rr?.failedBatches || 0) + (ro?.failedBatches || 0) + (rv?.failedBatches || 0),
                missed: r.missed + (rr?.missed || 0) + (ro?.missed || 0) + (rv?.missed || 0),
                chainFailed: r.chainFailed + (rr?.chainFailed || 0) + (ro?.chainFailed || 0) + (rv?.chainFailed || 0),
                aiAttempts: r.aiAttempts + (rr?.aiAttempts || 0) + (ro?.aiAttempts || 0) + (rv?.aiAttempts || 0),
                pending: relatePendingOf(allNotes),
                changedPending: allNotes.filter((n) => isRelated(n) && needsReeval(n)).length,
                dirtyBacklog: ledgers.dirty.size(),
            }
            if (det.conflictTouchExtracted || det.changedTouchExtracted) log.info(`關聯：本輪新衝突觸及下游已處理筆記 ${det.conflictTouchExtracted} 對、內容變更觸及下游已處理筆記 ${det.changedTouchExtracted} 篇`)
            // 本輪邊之實際異動數(每筆寫入只計一次):新建＋可見欄位改變(含重評改型、核對與覆核之改寫)＋撤出(墓碑清理、重評撤銷、
            //   核對與覆核之撤出／隔離)＋衝突核對之提案只入 history 之合併
            ctx.set(RELATE_CTX_FLAGS.edgesChanged, det.edges + det.edgesChanged + det.retired + (det.reevalRetired || 0) + (cc?.removed || 0) + (cc?.historyOnly || 0) + (er?.removed || 0))
            // fail＝失敗批次＋未涵蓋項＋逐項鏈異常(正向＋重評＋反向＋輪巡);aiCalls 含重評之兩席(每頁 2 次)、既有邊覆核與衝突核對之各席
            return stdReport({
                stats: { in: det.targets + det.reverseTargets + (det.rotationTargets || 0), out: det.edges, skip: 0, fail: det.failedBatches + det.missed + det.chainFailed, aiCalls: r.aiCalls + (rr?.aiCalls || 0) + (ro?.aiCalls || 0) + (rv?.aiCalls || 0) + (cc?.aiCalls || 0) + (er?.aiCalls || 0) },
                detail: det,
            })
        },
    }
}

export default stageRelate
