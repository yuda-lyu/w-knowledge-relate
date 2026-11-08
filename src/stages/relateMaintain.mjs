// relateMaintain.mjs — 關聯段開工前之維護(無 AI):型別改名之改寫與清單外告警、墓碑驅動之懸空清理、內容變更之反應
//
// 【②型別改名】(詞彙表 relationTypeRenames 宣告者;檢定標準 RS1′):既有邊現值與 history 之型別機械改寫(id 不變、updatedAt 不動、兩端重投;
//   與撤銷刪除同一規則 stores/edgeStore 之 domainTypeRenamerOf),先記後寫(帳之 touch;中途被砍亦兩端重投)。其餘不在現行清單者(未宣告之
//   改名或移除;RS1 不合格)不機械改寫(型別要判,不由程式猜):既有邊覆核(RS6)開啟且有 holds 集合時登錄 RS6 待判(負責者 pipeline;已有未結者不重登、
//   使用者已對同一問題豁免者不重開——standards/edgeQueue 之登錄件守之)交覆核重判型別(型別退役而未宣告改名者只告警,即與分類法之
//   「退役 → 重判」不對稱);懸空之邊(端點不在)不登錄(由墓碑清理或 pruneDangling 處置)。
// 【③墓碑驅動之懸空清理】只清端點在刪除墓碑內者(修補中斷之刪除 op;撤出單一實作 stores/edgeRetire),其餘懸空只告警
//   (開錯集合會讀到空的筆記庫——自動清即整批刪掉真理)。
// 【④內容變更之反應】待重判之筆記(stores/relatedNotes 之 needsReeval)本篇與鄰居記待投影、總覽待重建(每輪至評估完為止;投影內容不變即不寫,
//   成本只在讀);觸及下游已處理者另計(changedTouchExtracted)。

import isobj from 'wsemi/src/isobj.mjs'
import { noteConsumedOf } from '../core/capturePackage.mjs'
import { writeEdge, domainTypeRenamerOf, buildAdjacency } from '../stores/edgeStore.mjs'
import { stampEdge, EDGE_PRODUCED_STAGES } from '../stores/edgeProvenance.mjs'
import { LEDGER_FILES } from '../stores/relateLedgers.mjs'
import { retireEdge } from '../stores/edgeRetire.mjs'
import { needsReeval } from '../stores/relatedNotes.mjs'
import { RELATE_API_HINT, RELATE_HOLD_NEXT } from '../stores/relateHolds.mjs'
import { queueEdgeReview } from '../standards/edgeQueue.mjs'

/**
 * 開工前之維護(無 AI;見檔頭):型別改名之改寫與清單外告警(既有邊覆核開啟時另登錄 RS6 待判)、墓碑驅動之懸空清理、內容變更之反應
 *
 * @param {Object} o 輸入 { stores, edges, byId, ledgers, domain, stateDir, nowIso, log, edgeReviewOn:Boolean(relate.standards.edgeReview.enabled),
 *   prov?:Object(邊之產出鏈之產出者工廠,stores/edgeProvenance 之 createEdgeProvenance;型別改名之改寫追加 standards-fix 之產出者;未給即不寫產出鏈) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { edges(清理後), typeRenamed, typeOffList, typeOffListQueued, retired, dangling, changedSeen, changedTouchExtracted }
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let ledgers = openRelateLedgers(state)
 * let notes = [{ id: 'a', knowledgeChangedAt: 'v2', relatedChangeAt: 'v1' }, { id: 'b' }]
 * let edges = [{ id: 'e1', from: 'a', to: 'b', type: '舊型別', reason: '示範理由' }]
 * let r = await maintainRelations({
 *     stores: { relations: { replace: async () => {} } },
 *     edges,
 *     byId: new Map(notes.map((n) => [n.id, n])),
 *     ledgers,
 *     domain: createRelateDomain({}),
 *     stateDir: state,
 *     nowIso: '2026-11-02T00:00:00+08:00',
 *     log: { info: () => {}, warn: () => {} },
 *     edgeReviewOn: false,
 * })
 * console.log(r.typeOffList, r.changedSeen, r.retired, r.edges.length, ledgers.dirty.ids())
 * fs.rmSync(state, { recursive: true, force: true })
 * // => 1 1 0 1 [ 'a', 'b' ]
 */
export async function maintainRelations(o) {
    const { stores, byId, ledgers, domain, nowIso, log } = o
    let edges = o.edges
    const det = { typeRenamed: 0, typeOffList: 0, typeOffListQueued: 0, retired: 0, dangling: 0, changedSeen: 0, changedTouchExtracted: 0 }
    // 型別改名(RS1′):改名表宣告之舊型別 → 現值與 history 機械改寫(id 不變、updatedAt 不動、兩端重投;與撤銷刪除同一規則 domainTypeRenamerOf)
    const renames = isobj(domain.relationTypeRenames) ? domain.relationTypeRenames : {}
    const renameOf = domainTypeRenamerOf(domain)
    if (renameOf) {
        const out = []
        for (const e of edges) {
            const renamed = renameOf(e)
            // 產出鏈(stores/edgeProvenance):機械改寫不呼叫 AI,階段 standards-fix、seat 與 provider 同時 null(o.prov 未給即不寫)
            const next = renamed ? stampEdge(renamed, e, o.prov?.make({ stage: EDGE_PRODUCED_STAGES.standardsFix, seat: null, provider: null })) : null
            if (next) {
                // 先記後寫(帳之 touch;中途被砍亦兩端重投)
                ledgers.touch([e.from, e.to], { has: (x) => byId.has(x) })
                await writeEdge(stores.relations, next)
                det.typeRenamed++
            }
            out.push(next || e)
        }
        edges = out
        if (det.typeRenamed) {
            log.info(`關聯：依型別改名表改寫既有邊 ${det.typeRenamed} 條（${Object.entries(renames).map(([a, b]) => `${a}→${b}`).join('、')}）`)
        }
    }
    // 其餘不在現行清單者(未宣告之改名或移除;檢定標準 RS1 不合格)——不機械改寫(型別要判,不由程式猜);既有邊覆核(RS6)開啟且有 holds
    //   集合時登錄 RS6 待判(負責者 pipeline;已有未結者不重登——再登錄會累加 tries;使用者已對同一問題豁免者不重開——登錄件守之,已裁示者不重提)
    //   交覆核重判型別(型別退役之重判)。懸空之邊(端點不在)不登錄(由下方墓碑清理或 pruneDangling 處置)
    const off = new Map()
    const offEdges = []
    for (const e of edges) {
        if (domain.relationTypes.includes(e.type)) continue
        off.set(e.type, (off.get(e.type) || 0) + 1)
        offEdges.push(e)
    }
    det.typeOffList = offEdges.length
    if (o.edgeReviewOn === true && stores.holds) {
        for (const e of offEdges) {
            if (!byId.has(e.from) || !byId.has(e.to)) continue
            const r = await queueEdgeReview(stores.holds, e, {
                std: 'RS1', why: `型別「${e.type}」不在現行清單（未以 relationTypeRenames 宣告改名）`, at: nowIso,
                next: RELATE_HOLD_NEXT.edgeReviewTypeOffList,
            })
            if (r === 'queued') det.typeOffListQueued++
        }
    }
    if (off.size) log.warn(`關聯型別不在現行清單：${[...off].map(([t, n]) => `「${t}」${n} 條`).join('、')}——既有邊不自動改寫（詞彙表改名請以 relationTypeRenames 宣告${o.edgeReviewOn === true && stores.holds ? `；已交既有邊覆核重判型別，本輪新登錄待判 ${det.typeOffListQueued} 條` : '；或開啟既有邊覆核（relate.standards.edgeReview.enabled）由兩席重判型別'}）`)
    // 墓碑驅動之懸空清理(撤出單一實作)
    const retiredIds = new Set()
    for (const e of edges) {
        const missing = [e.from, e.to].filter((x) => !byId.has(x))
        if (!missing.length) continue
        if (missing.every((x) => ledgers.tombstones.has(x))) {
            await retireEdge({ relations: stores.relations, ledgers, stateDir: o.stateDir }, e, { reason: 'note-deleted', at: nowIso, note: missing.join(','), conflictTypes: domain.conflictTypeNames, hasNote: (x) => byId.has(x) })
            retiredIds.add(e.id)
        }
        else det.dangling++
    }
    if (retiredIds.size) {
        edges = edges.filter((e) => !retiredIds.has(e.id))
        det.retired = retiredIds.size
        log.info(`關聯：清除已刪筆記之殘留邊 ${retiredIds.size} 條（刪除墓碑；稽核 ${LEDGER_FILES.retired}）`)
    }
    if (det.dangling) log.warn(`關聯懸空邊 ${det.dangling} 條（端點不在筆記庫、亦無刪除紀錄）：未自動刪除——${RELATE_API_HINT.pruneDangling}`)
    // 內容變更之反應(待重判者,至評估完為止):本篇與鄰居重投(標題顯示於鄰居之關聯章)、總覽待重建
    const changed = [...byId.values()].filter(needsReeval)
    if (changed.length) {
        const adj = buildAdjacency(edges)
        const ids = new Set()
        for (const n of changed) {
            ids.add(n.id)
            for (const nb of (adj.get(n.id) || new Map()).keys()) ids.add(nb)
            if (noteConsumedOf(n)) det.changedTouchExtracted++
        }
        ledgers.touch([...ids])
        det.changedSeen = changed.length
    }
    return { ...det, edges }
}

export default { maintainRelations }
