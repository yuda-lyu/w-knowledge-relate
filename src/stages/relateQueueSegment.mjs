// relateQueueSegment.mjs — 佇列型關聯段(反向段、輪巡段)之執行器:時間守門、分批呼叫、逐項鏈、失敗與未涵蓋之排隊尾(同一規則一份,
//   兩段只給 items 與差異)
//
// 【兩段同一骨架】舊筆記為目標、候選＝一頁(K 篇;反向為其待處理之新筆記、輪巡為候選清單之某一頁),同一條逐項鏈落邊(msg.data._segment 為
//   'reverse'｜'rotation');批次參數(每批目標數、並行批數)同正向;輪數＝剛好跑完佇列;失敗或未涵蓋只排隊尾(反向 tries 只決定排序、輪巡只更新時刻),
//   永不丟。
// 【時間】扣掉保留給後段之時間(opt.reserveMs,未給取每輪依賴之 deps.reserveMs;由組裝者注入,本段不讀他工作之設定)後須夠一次呼叫
//   (callTimeoutMsOf:席位首家之單次逾時)才開工(有目標而不夠即本輪延後,記 deferred),每次呼叫以「剩餘−保留」封頂(抓取套件之 reserveOf)。
//   執行器於 items 算出之前建立(sub 與 firstMs 之求值時點與各段原碼同),run 時才守門。
// 【席位】反向段與輪巡段同一席位(core/relateSettings 之 relateSeatOf:relate.reverse.ai,未設即 relate.ai)。

import { reserveOf, reserveMsOf } from '../core/capturePackage.mjs'
import { runAiBatchStage } from '../core/summarizePackage.mjs'
import { callTimeoutMsOf } from '../core/relateSettings.mjs'
import { makeSlugResolver } from '../stores/candidates.mjs'

/**
 * 建立佇列型關聯段之執行器(見檔頭)
 *
 * @param {Object} o 輸入 {
 *   ctx, settings, opt(stageRelate 之 opt:batchSize、parallel、reserveMs), domain, log,
 *   seat:席位(relateSeatOf 之產物), segment:'reverse'|'rotation', label:日誌之段名('反向段'|'輪巡'), reserveLabel:reserveMs 不合時之錯誤字樣之段名,
 *   call:(prompt, check, callOpt)=>Promise(stages/relateAiCall 之呼叫函數), validOf:(perBatch:Map)=>(it, batch)=>Boolean(單項驗證之工廠),
 *   applyVia:(data, onChainFail)=>Promise(建訊息走逐項鏈) }
 * @returns {Object} 回傳 { run }——run({ items:[{ note, candidates:Array, data?:Object(併入訊息之欄位;逐項鏈之固定欄 note／_aiItem／_resolver／_candidates／_segment／_provider
 *   不可被覆寫) }], bump:(note)=>Promise|void, deferredNote?:()=>String(延後訊息之附註) }) → Promise<{ deferred:Boolean, ran:runAiBatchStage 之結果|null }>
 * @throws {Error} reserveMs 不合時於 reserveMsOf 拋出
 * @example
 * let settings = resolveRelateSettings({ ai: { parallel: 1 }, relate: { ai: { use: 'stub:a' } } })
 * let notes = [{ id: 'old', title: '舊筆記', category: 'c', summary: 'old 之重點', concepts: ['p'] }, { id: 'new', title: '新筆記', category: 'c', summary: 'new 之重點', concepts: ['p'] }]
 * let applied = []
 * let bumped = []
 * let runner = createRelateQueueRunner({
 *     ctx: { deps: {} },
 *     settings,
 *     opt: {},
 *     domain: createRelateDomain({}),
 *     log: { info: () => {}, warn: () => {} },
 *     seat: relateSeatOf(settings, 'reverse'),
 *     segment: 'reverse',
 *     label: '反向段',
 *     reserveLabel: '關聯反向段之 reserveMs',
 *     call: async (prompt, check, c) => ({ ok: true, providerId: 'p1', data: [{ index: 1, relations: [] }], attempts: 1 }),
 *     validOf: () => (it) => Number.isInteger(it?.index) && Array.isArray(it.relations),
 *     applyVia: async (data, onChainFail) => {
 *         applied.push([data.note.id, data._segment, data._candidates.map((c) => c.id)])
 *         return { reverseTargets: 1 }
 *     },
 * })
 * let res = await runner.run({ items: [{ note: notes[0], candidates: [notes[1]] }], bump: (n) => bumped.push(n.id) })
 * console.log(res.deferred, res.ran.applied, applied, bumped)
 * console.log(await runner.run({ items: [], bump: () => {} }))
 * // => false { reverseTargets: 1 } [ [ 'old', 'reverse', [ 'new' ] ] ] []
 * // => { deferred: false, ran: null }
 */
export function createRelateQueueRunner(o) {
    const { ctx, settings, opt, domain, log, seat, segment, label, reserveLabel, call, validOf, applyVia } = o
    const firstMs = callTimeoutMsOf(settings, seat)
    const sub = reserveOf(ctx, reserveMsOf(opt.reserveMs ?? ctx.deps.reserveMs, reserveLabel)(ctx))
    const run = async ({ items, bump, deferredNote }) => {
        if (!items.length) return { deferred: false, ran: null }
        if (!sub.canStart(firstMs)) {
            log.info(`關聯${label}：扣保留時間後剩餘時間不足一次呼叫（${Math.round(firstMs / 1000)}s），本輪延後${typeof deferredNote === 'function' ? deferredNote() : ''}`)
            return { deferred: true, ran: null }
        }
        const byNote = new Map(items.map((x) => [x.note.id, x]))
        const queue = items.map((x) => x.note)
        const perBatch = new Map()
        const isValid = validOf(perBatch)
        const batchSize = opt.batchSize ?? settings.relate.notesPerCall
        const parallel = opt.parallel ?? settings.ai.parallel
        const callSeg = (p, c) => call(p, c, { spec: seat, seat: 'proposer', segment, shouldStop: () => sub.shouldStop(firstMs), budgetMs: sub.remainingMs() })
        const ran = await runAiBatchStage({
            log,
            batchSize,
            parallel,
            rounds: Math.ceil(queue.length / (batchSize * parallel)),
            shouldStop: () => sub.shouldStop(firstMs),
            pickPool: async (limit) => queue.splice(0, limit),
            buildPrompt: async (batch) => {
                const candidateMap = new Map(batch.map((n) => [n.id, byNote.get(n.id).candidates]))
                const resolvers = new Map(batch.map((n) => [n.id, makeSlugResolver(candidateMap.get(n.id))]))
                perBatch.set(batch, { candidateMap, resolvers })
                return domain.buildPrompt(batch, candidateMap)
            },
            checkResult: (data, batch) => Array.isArray(data) && data.some((it) => isValid(it, batch)),
            isValidItem: isValid,
            indexOf: (it) => it.index,
            callAI: callSeg,
            applyItem: async (item, n, helpers) => {
                const info = perBatch.get(helpers?.batch)
                // 段之附帶欄(data)在前、逐項鏈之固定欄在後:呼叫端給同名鍵不得靜默改掉 note／_segment 等
                return applyVia({ ...(byNote.get(n.id).data || {}), note: n, _aiItem: item, _resolver: info.resolvers.get(n.id), _candidates: info.candidateMap.get(n.id), _segment: segment, _provider: helpers?.providerId || '' },
                    async () => bump(n))
            },
            onMissed: async (n) => bump(n),
            onBatchFailed: async (batch) => {
                for (const n of batch) await bump(n)
            },
        })
        return { deferred: false, ran }
    }
    return { run }
}

export default { createRelateQueueRunner }
