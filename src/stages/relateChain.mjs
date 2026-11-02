// relateChain.mjs — 關聯之納入閘與逐項動作鏈(hook 錨點:relate.relate.{buildEdges, markDirty, persistEdges, queueReverse, markRelated};
//   正向、反向與輪巡同一條鏈,msg.data._segment 為 'forward'｜'reverse'｜'rotation')
//
// 【納入閘,逐條剔除(檢定標準 RS1／RS2／RS3／RS8／RS9;standards/edgeGate)】單條 slug 解析不到、指向自身、型別無對映
//   (清單外不落後備型別)、理由不合標準(空泛或佔位、正體修不好、數字不見於模型所見之兩端區塊)者剔除該條、其餘照收;可確定性修正者
//   (別名對映、簡體、逾長於句界截)修正後納入並計數。整項只在 relations 非陣列、或非空而無一條合格時不合格(coveredItemOf——批次之單項驗證、
//   評分與專案之評比同讀此判準;未涵蓋 → tries＋1,下輪再判)。
// 【過閘後之丟棄不靜默】單篇上限(maxRelationsPerNote,衝突優先保留)截去者計 relateCapDropped、同一對象之多條只取一條(衝突優先)而捨去者計
//   relateDupDropped,皆 INFO 列出被捨之對(前幾例)——不改截取規則本身(pickRelationsOf;評分同讀)。
// 【先記後寫】逐項鏈只記 dirty(帳之 touch),且先記 dirty 後寫邊(中途被砍,多記一筆 dirty 無害;反之兩端永不重投)。
// 【邊落庫】stores/edgeStore:id＝sha1(min|max)、提案全序合併、單次原子寫入＋回讀;本輪新建之邊以完整全序合併(並行批次之完成順序不影響
//   結果),跨輪之既有邊只升為衝突。衝突核對(RS4)啟用時新衝突不在此落地——提案於暫緩當下即持久為 RS4 提案待判(standards/edgeQueue 之
//   queueConflictProposal;來源記完成前已持久)並交衝突核對段。history 浮上再驗:合併時勝出身分之最優代表可為 history 條目,rt.admitSurfaced
//   不過者不升任,計 edgeSurfaceRejected。
// 【下游已處理之筆記】新衝突觸及下游處理時刻 extractedAt 非空之筆記者另計(conflictTouchExtracted;rt.touchesExtracted)——只計數與 INFO。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { oneline } from '../core/capturePackage.mjs'
import { defineMw, count } from '../core/capturePackage.mjs'
import { makeEdge, persistEdge, addToAdjacency } from '../stores/edgeStore.mjs'
import { isRelated } from '../stores/relatedNotes.mjs'
import { packIds, REEVAL_REPROPOSE_DAYS } from '../stores/reevalPolicy.mjs'
import { rotationCursorOf, ROTATION_RESET } from '../stores/rotationPolicy.mjs'
import { gateEdgeProposal, gateCtxOf } from '../standards/edgeGate.mjs'
import { queueConflictProposal } from '../standards/edgeQueue.mjs'

/** 單篇最多取用之關聯數之預設(mwBuildEdges 之 opt.maxRelationsPerNote 未給時;超過時衝突型優先保留) */
export const RELATE_MAX_RELATIONS_PER_NOTE = 4

/**
 * 單條關聯項目之納入判定(覆蓋驗證與組邊同一判準;standards/edgeGate):slug 解析、非自指 → 納入閘(型別對映、理由正規化、
 * RS1／RS2／RS3／RS8;RS8 之材料＝模型所見之目標區塊與該候選列)
 *
 * @param {*} rel 輸入 AI 回傳之單條關聯
 * @param {Object} o 輸入 { target:目標筆記, resolve:slug 解析器, candidates:Map(id → 候選筆記), domain, hasNote:(id)=>Boolean, nowIso,
 *   locale?(語言設定;納入閘之正體修正與 RS3 之適用依之,未給＝臺灣正體) }
 * @returns {Object} 回傳 { ok, edge?(正規化後之提案), fixes:Array, reasons:Array, rescued:Boolean(slug 經尾碼救回) }
 * @example
 * let domain = createRelateDomain({})
 * let a = { id: 'a', title: '波動度目標化', summary: '以波動度調整部位大小' }
 * let b = { id: 'b', title: '部位縮放', summary: '依風險預算縮放部位' }
 * let o = { target: a, resolve: (s) => (['a', 'b'].includes(s) ? s : null), candidates: new Map([['b', b]]), domain, hasNote: (id) => ['a', 'b'].includes(id), nowIso: '2026-11-02T00:00:00+08:00' }
 * let type = domain.relationTypes[0]
 * let good = admitRelation({ to: 'b', type, reason: '兩篇皆以波動度調整部位，屬同一機制之延伸' }, o)
 * console.log(good.ok, good.edge.type === type, good.rescued)
 * console.log(admitRelation({ to: 'zzz', type, reason: '任意' }, o).reasons)
 * console.log(admitRelation({ to: 'a', type, reason: '任意' }, o).reasons)
 * console.log(admitRelation({ to: 'b', type, reason: '短' }, o).ok)
 * // => true true false
 * // => [ 'slug 解析不到（zzz）' ]
 * // => [ '指向自身' ]
 * // => false
 */
export function admitRelation(rel, o) {
    if (!rel || typeof rel !== 'object') return { ok: false, fixes: [], reasons: ['項目非物件'], rescued: false }
    const raw = String(rel.to ?? '').trim()
    const to = o.resolve(raw)
    if (!to) return { ok: false, fixes: [], reasons: [`slug 解析不到（${raw.slice(0, 40)}）`], rescued: false }
    if (to === o.target.id) return { ok: false, fixes: [], reasons: ['指向自身'], rescued: false }
    const cand = o.candidates.get(to)
    const seen = new Map([[o.target.id, o.domain.seenTextOf(o.target, 'target')], [to, cand ? o.domain.seenTextOf(cand, 'candidate') : null]])
    const g = gateEdgeProposal(makeEdge({ from: o.target.id, to, type: rel.type, reason: rel.reason, nowIso: o.nowIso }), gateCtxOf(o.domain, { hasNote: o.hasNote, materialOf: (id) => (seen.has(id) ? seen.get(id) : null), locale: o.locale }))
    return { ...g, rescued: to !== raw }
}

/**
 * 一項回覆對得到之目標(項合格判準之第一步,單一來源):index 為正整數且 targets[index − 1] 存在——批次之單項驗證、評分(bench)與專案之評比同讀
 *
 * @param {*} it 輸入回覆之單項 { index, … }
 * @param {Array} targets 輸入本批(頁)之目標(依提示詞之序)
 * @returns {Object|null} 回傳目標;對不到回 null
 * @example
 * console.log(itemTargetOf({ index: 2 }, [{ id: 'a' }, { id: 'b' }]).id, itemTargetOf({ index: 3 }, [{ id: 'a' }]), itemTargetOf({ index: '1' }, [{ id: 'a' }]), itemTargetOf(null, []))
 * // => b null null null
 */
export function itemTargetOf(it, targets) {
    if (!isobj(it) || !Number.isInteger(it.index) || it.index < 1 || !isarr(targets)) return null
    return targets[it.index - 1] || null
}

/**
 * 一項回覆之逐條納入(單一迴圈;檔頭【納入閘,逐條剔除】):各條經 admitRelation,合格者收、不合格者剔除;涵蓋判準＝relations 為陣列,且為空
 *   (判無夠格之關聯,合法)或至少一條過閘——逐項鏈之組邊(buildEdges)、批次之單項驗證(coveredItemOf)、評分(bench)與專案之評比同讀此函數,不另寫一份
 *
 * @param {*} it 輸入回覆之單項 { index, relations }
 * @param {Object} o 輸入 admitRelation 之 o(target、resolve、candidates、domain、hasNote、nowIso、locale?)
 * @returns {Object} 回傳 { covered:Boolean, admitted:Array(過閘之提案), results:Array([{ rel, ...admitRelation 之結果 }];relations 非陣列時為 []) }
 * @example
 * console.log(admitItemOf({ index: 1, relations: [] }, {}).covered, admitItemOf({ index: 1, relations: 'x' }, {}).covered, admitItemOf(null, {}).covered)
 * // => true false false
 */
export function admitItemOf(it, o) {
    if (!isobj(it) || !isarr(it.relations)) return { covered: false, admitted: [], results: [] }
    const results = it.relations.map((rel) => ({ rel, ...admitRelation(rel, o) }))
    const admitted = results.filter((r) => r.ok).map((r) => r.edge)
    return { covered: it.relations.length === 0 || admitted.length > 0, admitted, results }
}

/**
 * 一項回覆是否合格(涵蓋判準;admitItemOf 之 covered):relations 為陣列,且為空或至少一條過納入閘
 *
 * @param {*} it 輸入回覆之單項 { index, relations }
 * @param {Object} o 輸入 admitRelation 之 o
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(coveredItemOf({ index: 1, relations: [] }, {}), coveredItemOf({ index: 1, relations: 'x' }, {}), coveredItemOf(null, {}))
 * // => true false false
 */
export function coveredItemOf(it, o) {
    return admitItemOf(it, o).covered
}

/**
 * 過閘之提案 → 本篇提出之邊:同一對象只取一條(衝突型優先,否則先到者);逾單篇上限者截去(衝突型優先保留,其餘依先到)——
 *   正向之逐項鏈(buildEdges)與評分(bench)同讀此函數
 *
 * @param {Array} edges 輸入過閘之提案(依回覆之序;各項含 to、type);非陣列視為[]
 * @param {Object} [o={}] 輸入 { conflictType:String(衝突型之名), max?:Integer(單篇上限;未給取 RELATE_MAX_RELATIONS_PER_NOTE) }
 * @returns {Object} 回傳 { edges:Array(提出之邊), dup:Array(同一對象而捨去者), cut:Array(逾上限而截去者) }
 * @example
 * let r = pickRelationsOf([{ to: 'a', type: '同類' }, { to: 'a', type: '衝突' }, { to: 'b', type: '同類' }], { conflictType: '衝突', max: 1 })
 * console.log(r.edges.map((e) => `${e.to}:${e.type}`), r.dup.length, r.cut.map((e) => e.to))
 * // => [ 'a:衝突' ] 1 [ 'b' ]
 */
export function pickRelationsOf(edges, o = {}) {
    const ct = o?.conflictType
    const max = o?.max ?? RELATE_MAX_RELATIONS_PER_NOTE
    const byTo = new Map()
    const dup = []
    for (const e of isarr(edges) ? edges : []) {
        const cur = byTo.get(e.to)
        // 同一對兩種型別:衝突優先(其餘捨去並回報,不靜默)
        if (!cur || (e.type === ct && cur.type !== ct)) {
            if (cur) dup.push(cur)
            byTo.set(e.to, e)
        }
        else dup.push(e)
    }
    const list = [...byTo.values()]
    if (!(list.length > max)) return { edges: list, dup, cut: [] }
    const ordered = [...list.filter((x) => x.type === ct), ...list.filter((x) => x.type !== ct)]
    return { edges: ordered.slice(0, max), dup, cut: ordered.slice(max) }
}

/**
 * 錨點:buildEdges(邊組裝:逐條過納入閘(不合格者剔除並計數,可修正者修正後納入)→ 依 to 合併(衝突型優先)與截上限(pickRelationsOf)→
 * 提案(makeEdge:無序對 id、from＝本篇),不落地)
 *
 * 讀 msg.data(note、_aiItem.relations、_resolver、_candidates、_domain、_rt.byId);寫 msg.data._edges(提案陣列);
 * 計數 edgeStdRejected(未達標準不納入之條數)、edgeStdFixed(修正後納入之條數)、relateDupDropped(同一對象之多條只取一條而捨去者)、
 * relateCapDropped(合格而逾單篇上限被截去者;檔頭【納入閘,逐條剔除】);不短路(恆呼叫 next)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Integer} [opt.maxRelationsPerNote=RELATE_MAX_RELATIONS_PER_NOTE] 輸入單篇最多取用之關聯數(超過時衝突型優先保留)
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let domain = createRelateDomain({})
 * let a = { id: 'a', title: '波動度目標化', summary: '以波動度調整部位大小' }
 * let b = { id: 'b', title: '部位縮放', summary: '依風險預算縮放部位' }
 * let type = domain.relationTypes[0]
 * let msg = {
 *     topic: 'note',
 *     data: {
 *         note: a,
 *         _aiItem: { index: 1, relations: [{ to: 'b', type, reason: '兩篇皆以波動度調整部位，屬同一機制之延伸' }, { to: 'zzz', type, reason: '任意' }] },
 *         _resolver: (s) => (['a', 'b'].includes(s) ? s : null),
 *         _candidates: [b],
 *         _domain: domain,
 *         _rt: { byId: new Map([['a', a], ['b', b]]) },
 *     },
 *     meta: {},
 *     stats: {},
 * }
 * let ctx = { deps: { clock: { iso8: () => '2026-11-02T00:00:00+08:00' } }, log: { info: () => {} } }
 * let mw = mwBuildEdges({ maxRelationsPerNote: 2 })
 * await mw.handle(msg, ctx, (m) => m)
 * console.log(mw.name, msg.data._edges.map((e) => [e.from, e.to].sort().join('-')), msg.stats)
 * // => buildEdges [ 'a-b' ] { edgeStdRejected: 1 }
 */
export const mwBuildEdges = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'buildEdges',
        handle: async (msg, ctx, next) => {
            const { clock } = ctx.deps
            const { note: t, _aiItem: item, _resolver: resolve, _candidates: cands, _domain: domain, _rt: rt } = msg.data
            const max = opt.maxRelationsPerNote ?? RELATE_MAX_RELATIONS_PER_NOTE
            const nowIso = clock.iso8()
            const o = { target: t, resolve, candidates: new Map((cands || []).map((c) => [c.id, c])), domain, hasNote: (id) => (isfun(rt?.isLive) ? rt.isLive(id) : !!rt?.byId?.has(id)), nowIso, locale: ctx.deps.locale }
            // 逐條納入(admitItemOf 之單一迴圈);不合格者計數並列出,救回與修正者各記一行
            const { admitted, results } = admitItemOf(item, o)
            const rejected = results.filter((a) => !a.ok).map((a) => a.reasons.join('、'))
            let fixed = 0
            for (const a of results.filter((x) => x.ok)) {
                if (a.rescued) ctx.log.info(`關聯：slug 尾碼救回 ${String(a.rel.to).slice(0, 60)} → ${a.edge.to}`)
                if (a.fixes.length) {
                    fixed++
                    ctx.log.info(`關聯：[[${t.id}]] → [[${a.edge.to}]] 修正後納入（${a.fixes.join('；')}）`)
                }
            }
            if (rejected.length) {
                count(msg, 'edgeStdRejected', rejected.length)
                ctx.log.info(`關聯：[${t.id}] ${rejected.length} 條關聯項目未達標準，不納入、其餘照收（${rejected.slice(0, 3).map((x) => oneline(x, 100)).join('｜')}${rejected.length > 3 ? '｜…' : ''}）`)
            }
            if (fixed) count(msg, 'edgeStdFixed', fixed)
            // 同一對象只取一條、單篇上限(皆衝突優先)——捨去與截去之合格關聯計數並列出,不靜默丟棄
            const m = pickRelationsOf(admitted, { max, conflictType: domain.conflictType })
            const pairs = (xs) => `${xs.slice(0, 3).map((x) => `[[${x.to}]]〔${x.type}〕`).join('、')}${xs.length > 3 ? '…' : ''}`
            if (m.dup.length) {
                count(msg, 'relateDupDropped', m.dup.length)
                ctx.log.info(`關聯：[[${t.id}]] 同一對象有多條合格關聯（衝突優先、否則取先到者），捨去 ${m.dup.length} 條（${pairs(m.dup)}）`)
            }
            const total = m.edges.length + m.cut.length
            if (total > max) {
                count(msg, 'relateCapDropped', m.cut.length)
                ctx.log.info(`關聯：[[${t.id}]] 合格關聯 ${total} 條逾單篇上限 ${max}（衝突優先保留），截去 ${m.cut.length} 條（${pairs(m.cut)}）`)
            }
            msg.data._edges = m.edges
            return next(msg)
        },
    })
}

/**
 * 錨點:markDirty(兩端記入待投影帳——先於寫邊:中途被砍,多記之 dirty 無害;反之邊已落庫而兩端永不重投)
 *
 * 讀 msg.data(_edges、_rt.ledgers);when:_edges 為空時原樣放行;不短路
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let touched = []
 * let msg = { topic: 'note', data: { _edges: [{ from: 'a', to: 'b' }], _rt: { ledgers: { touch: (ids) => touched.push(...ids) } } }, meta: {}, stats: {} }
 * let mw = mwMarkDirty()
 * console.log(mw.name, mw.when(msg), mw.when({ data: { _edges: [] } }))
 * await mw.handle(msg, {}, (m) => m)
 * console.log(touched)
 * // => markDirty true false
 * // => [ 'a', 'b' ]
 */
export const mwMarkDirty = () => defineMw({
    name: 'markDirty',
    when: (m) => m.data._edges.length > 0,
    handle: async (msg, ctx, next) => {
        // 先記後寫:端點記待投影＋總覽待重建(帳之 touch;總覽不只靠輪末之 ctx 旗標——中途被砍亦不漏)
        msg.data._rt.ledgers.touch(msg.data._edges.flatMap((e) => [e.from, e.to]))
        return next(msg)
    },
})

/**
 * 錨點:persistEdges(邊落庫:行程內互斥中「get → mergeEdge → insertNew｜patch(回讀驗證)」;本輪新建之邊完整全序,跨輪只升為衝突)
 *
 * 讀 msg.data(_edges、_rt、_segment、_provider);寫 msg.data._edges(落庫後之值)、_pending(交衝突核對之提案);計數 edges(新建)、
 * conflicts(新成為衝突之無序對)、edgesChanged(可見欄位改變)、reverseEdges(反向段新建)、rotationEdges(輪巡段新建)、
 * conflictTouchExtracted(新衝突觸及下游已處理之筆記——下游處理時刻 extractedAt 非空;檔頭【下游已處理之筆記】)、
 * reevalReproposed(新建之對於 REEVAL_REPROPOSE_DAYS 天內曾被重評撤銷;只觀察)、rs4Deferred(交衝突核對之新衝突)、rs4Waived(使用者已豁免而理由未變之提案,
 * 不重提)、edgeSurfaceRejected(浮上之 history 未過再驗);when:_edges 為空時原樣放行;不短路
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let domain = createRelateDomain({})
 * let rows = new Map()
 * let relations = {
 *     get: async (id) => rows.get(id) || null,
 *     insertNew: async (xs) => { xs.forEach((x) => rows.set(x.id, x)); return { addCount: xs.length } },
 *     patch: async (id, f) => { Object.assign(rows.get(id), f) },
 *     replace: async (r) => { rows.set(r.id, r) },
 * }
 * let edge = makeEdge({ from: 'a', to: 'b', type: domain.relationTypes[0], reason: '兩篇皆以波動度調整部位，屬同一機制之延伸', nowIso: '2026-11-02T00:00:00+08:00' })
 * let rt = { conflictCheckOn: false, rank: typeRankOf(domain), conflictType: domain.conflictType, mutex: createMutex(), createdThisRun: new Set(), adj: buildAdjacency([]), touchesExtracted: () => false }
 * let msg = { topic: 'note', data: { _edges: [edge], _rt: rt, _segment: 'forward', _provider: 'p1' }, meta: {}, stats: {} }
 * let ctx = { deps: { stores: { relations, holds: null }, clock: { iso8: () => '2026-11-02T00:00:00+08:00' } }, log: { info: () => {} } }
 * let mw = mwPersistEdges()
 * await mw.handle(msg, ctx, (m) => m)
 * console.log(mw.name, rows.size, msg.data._edges.length, msg.data._pending.length, msg.stats)
 * // => persistEdges 1 1 0 { edges: 1 }
 */
export const mwPersistEdges = () => defineMw({
    name: 'persistEdges',
    when: (m) => m.data._edges.length > 0,
    handle: async (msg, ctx, next) => {
        const { relations, holds } = ctx.deps.stores
        const { _edges: list, _rt: rt, _segment: seg } = msg.data
        const out = []
        const pending = []
        for (const e of list) {
            // 檢定標準 RS4(衝突核對啟用時):新衝突(新建或由非衝突升級)不在此落地,交衝突核對段(stages/conflictCheckSegment)
            //   以提案席＋核對席判定;同一對已是衝突者(再提案)照常合併。提案於暫緩當下即持久為 RS4 提案待判(先記後寫:來源記完成前已持久)
            if (rt.conflictCheckOn && e.type === rt.conflictType && rt.adj.get(e.from)?.get(e.to)?.type !== rt.conflictType) {
                const proposer = String(msg.data._provider || '')
                const q = await queueConflictProposal(holds, { from: e.from, to: e.to, reason: e.reason, reasonCut: e.reasonCut, proposer, segment: seg, proposedAt: e.createdAt, at: ctx.deps.clock.iso8() })
                if (q === 'waived') {
                    count(msg, 'rs4Waived')
                    ctx.log.info(`關聯：[[${e.from}]] ⇄ [[${e.to}]] 之衝突提案使用者已豁免（提案不落地）且理由未變，不重提`)
                    continue
                }
                rt.pendingConflicts.push({ edge: e, proposer, segment: seg })
                pending.push(e)
                count(msg, 'rs4Deferred')
                continue
            }
            // allowTypeChange 於互斥內求值:並行批次互選同一對時,後到者須看得到前者剛建之邊屬本輪;admit:浮上之 history 再驗(檔頭)
            const r = await rt.mutex(async () => {
                const res = await persistEdge(relations, e, { rank: rt.rank, conflictType: rt.conflictType, allowTypeChange: rt.createdThisRun.has(e.id), admit: rt.admitSurfaced })
                if (res.created) rt.createdThisRun.add(res.edge.id)
                if (res.changed) addToAdjacency(rt.adj, res.edge)
                return res
            })
            if (r.surfaceRejected) {
                count(msg, 'edgeSurfaceRejected')
                ctx.log.info(`關聯：[[${r.edge.from}]] ⇄ [[${r.edge.to}]] 合併時 history 條目未過檢定標準，不升任為現值（以本次提案為準）`)
            }
            const newConflict = (r.created && r.edge.type === rt.conflictType) || r.upgradedToConflict
            if (r.created) {
                count(msg, 'edges')
                if (seg === 'reverse') count(msg, 'reverseEdges')
                if (seg === 'rotation') count(msg, 'rotationEdges')
                // 振盪觀察:近期被重評撤銷之對又被提出——只計數與記錄,不擋(撤銷是否過度由此判斷)
                if (rt.reproposeIds?.has(r.edge.id)) {
                    count(msg, 'reevalReproposed')
                    ctx.log.info(`關聯：[[${r.edge.from}]] ⇄ [[${r.edge.to}]] 於重評撤銷後 ${REEVAL_REPROPOSE_DAYS} 天內再被${seg === 'reverse' ? '反向段' : seg === 'rotation' ? '輪巡段' : '正向段'}提出`)
                }
            }
            else if (r.visibleChanged) count(msg, 'edgesChanged')
            if (newConflict) {
                count(msg, 'conflicts')
                if (rt.touchesExtracted(r.edge)) count(msg, 'conflictTouchExtracted')
            }
            if (r.upgradedToConflict) ctx.log.info(`關聯：[[${r.edge.from}]] ⇄ [[${r.edge.to}]] 升級為「${r.edge.type}」`)
            out.push(r.edge)
        }
        msg.data._edges = out
        msg.data._pending = pending
        return next(msg)
    },
})

/**
 * 錨點:queueReverse(正向評估完一篇即算其反向待處理對並落帳——不受時間守門;反向段停用時不算)
 *
 * 讀 msg.data(note、_segment、_candidates、_rt);寫 _rt.ledgers.reverse;計數 reverseQueued;
 * when:正向且反向段啟用;不短路
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let notes = [
 *     { id: 'old', category: 'c', concepts: ['x', 'y'], relatedAt: '2026-10-01', createdAt: '2026-10-01' },
 *     { id: 'n', category: 'c', concepts: ['x', 'y'], relatedAt: '', createdAt: '2026-10-05' },
 * ]
 * let idx = createReverseIndex(notes, { keysOf: (note) => new Set(note.concepts), K: 2 })
 * let added = []
 * let rt = { reverseOn: true, reverseIndex: () => idx, adj: new Map(), conflictOf: () => new Set(), ledgers: { reverse: { add: (ps) => added.push(...ps) } } }
 * let msg = { topic: 'note', data: { note: notes[1], _segment: 'forward', _candidates: [], _rt: rt }, meta: {}, stats: {} }
 * let mw = mwQueueReverse()
 * console.log(mw.name, mw.when(msg), mw.when({ data: { _segment: 'reverse', _rt: rt } }))
 * await mw.handle(msg, { deps: { clock: { iso8: () => '2026-11-02T00:00:00+08:00' } } }, (m) => m)
 * console.log(added, msg.stats)
 * // => queueReverse true false
 * // => [ { o: 'old', n: 'n', score: 21, at: '2026-11-02T00:00:00+08:00' } ] { reverseQueued: 1 }
 */
export const mwQueueReverse = () => defineMw({
    name: 'queueReverse',
    when: (m) => m.data._segment === 'forward' && m.data._rt.reverseOn === true,
    handle: async (msg, ctx, next) => {
        const { note: t, _rt: rt } = msg.data
        const pairs = rt.reverseIndex().pairsFor(t, {
            forward: new Set((msg.data._candidates || []).map((c) => c.id)),
            hasEdge: (a, b) => !!rt.adj.get(a)?.has(b),
            conflictOf: rt.conflictOf,
        })
        if (pairs.length) {
            const at = ctx.deps.clock.iso8()
            rt.ledgers.reverse.add(pairs.map((p) => ({ ...p, at })))
            count(msg, 'reverseQueued', pairs.length)
        }
        return next(msg)
    },
})

/**
 * 錨點:markRelated(正向:已關聯落帳——relatedAt＝完成正向評估之時刻(零邊亦寫)、relatedChangeAt＝評估時之內容版本(stores/relatedNotes
 * 【評估版本】)——＋記憶體快照同步;反向:該頁之待處理對出帳;輪巡:游標前進)
 *
 * 讀 msg.data(note、_edges、_segment、_page、_rt);計數 targets／reTargets(內容變更重判)／reverseTargets／rotationTargets;不短路
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let note = { id: 'a', relatedAt: '', knowledgeChangedAt: '2026-11-01T00:00:00+08:00' }
 * let patches = []
 * let ctx = {
 *     deps: { stores: { notes: { patch: async (id, f) => { patches.push([id, f]) } } }, clock: { iso8: () => '2026-11-02T00:00:00+08:00' } },
 *     log: { info: () => {} },
 * }
 * let msg = { topic: 'note', data: { note, _edges: [{ from: 'a', to: 'b', type: 't' }], _segment: 'forward', _rt: {} }, meta: {}, stats: {} }
 * let mw = mwMarkRelated()
 * await mw.handle(msg, ctx, (m) => m)
 * console.log(mw.name, msg.stats, patches[0][0], patches[0][1].relatedAt, patches[0][1].relatedChangeAt === note.knowledgeChangedAt)
 * // => markRelated { targets: 1 } a 2026-11-02T00:00:00+08:00 true
 */
export const mwMarkRelated = () => defineMw({
    name: 'markRelated',
    handle: async (msg, ctx, next) => {
        const { note: t, _edges: rels, _segment: seg, _rt: rt } = msg.data
        const pend = isarr(msg.data._pending) ? msg.data._pending : []
        const pendText = pend.length ? `（另 ${pend.length} 條衝突交核對）` : ''
        if (seg === 'reverse') {
            const page = new Set((msg.data._page || []).map((p) => p.n))
            rt.ledgers.reverse.remove((p) => p.o === t.id && page.has(p.n))
            count(msg, 'reverseTargets')
            const shown = [...page].slice(0, 5)
            ctx.log.info(`關聯反向：${t.id} 判 ${page.size} 篇新筆記（${shown.join('、')}${page.size > shown.length ? '…' : ''}）→ ${rels.length} 條${rels.length ? `（${rels.map((e) => `${e.to === t.id ? e.from : e.to}:${e.type}`).join('、')}）` : ''}${pendText}`)
            return next(msg)
        }
        if (seg === 'rotation') {
            // 輪巡(檢定標準 RS10):該頁已比對 → 游標前進;取盡即用盡(stores/rotationPolicy)
            const pg = msg.data._rotation || {}
            const rot = rotationCursorOf(pg, { at: ctx.deps.clock.iso8(), K: msg.data._rotationK })
            await ctx.deps.stores.notes.patch(t.id, { relateRotation: rot })
            t.relateRotation = rot
            count(msg, 'rotationTargets')
            ctx.log.info(`關聯輪巡：${t.id} 第 ${pg.page} 頁（${(msg.data._candidates || []).length} 篇）→ ${rels.length} 條${rels.length ? `（${rels.map((e) => `${e.to === t.id ? e.from : e.to}:${e.type}`).join('、')}）` : ''}${pendText}${rot.done ? '；已用盡' : ''}`)
            return next(msg)
        }
        const wasChanged = isRelated(t)
        const at = ctx.deps.clock.iso8()
        // 內容變更之重判另記本版本選中之鄰居(重評段對其撤銷一票否決;字串而非陣列——集合 patch 為深合併,陣列變短會殘留);
        //   交衝突核對之提案亦為本版本以新內容選中者
        const picks = isestr(t.knowledgeChangedAt) ? { relatedPicks: packIds(t.knowledgeChangedAt, [...rels, ...pend].map((e) => (e.from === t.id ? e.to : e.from))) } : {}
        // 內容變更之重判:概念可能已變,輪巡之排名隨之改變 → 輪巡自頭(頁 1)重來(檢定標準 RS10)
        const rotReset = wasChanged && t.relateRotation ? { relateRotation: { ...ROTATION_RESET } } : {}
        const patch = { relatedAt: at, ...(isestr(t.knowledgeChangedAt) ? { relatedChangeAt: t.knowledgeChangedAt } : {}), ...picks, ...rotReset }
        await ctx.deps.stores.notes.patch(t.id, patch)
        Object.assign(t, patch)
        count(msg, 'targets')
        if (wasChanged) count(msg, 'reTargets')
        ctx.log.info(`關聯：${t.id} → ${rels.length} 條${pendText}${wasChanged ? '（內容變更重判）' : ''}`)
        return next(msg)
    },
})

export default { RELATE_MAX_RELATIONS_PER_NOTE, admitRelation, itemTargetOf, admitItemOf, coveredItemOf, pickRelationsOf, mwBuildEdges, mwMarkDirty, mwPersistEdges, mwQueueReverse, mwMarkRelated }
