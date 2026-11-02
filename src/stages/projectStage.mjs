// projectStage.mjs — 關聯物件子階段 project:待投影帳之筆記依邊庫重算 md 之兩章與 frontmatter
//
// 【做什麼】讀待投影帳(dirs.state/relate-dirty.json:關聯段逐項鏈、刪除 op、內容變更反應所記;前輪殘留者一併補投)→ 記錄已不存在者出帳
//   → 逐篇 projectNote(純計算＋手改偵測＋原子寫)→ 成功者 patch 記錄 { projHash, relatedCount(＝度數) } 並出帳;md 讀不到者留帳
//   (下輪再補)、每輪一行彙總告警(逐篇告警會灌爆外部巡檢之未知警告)。帳空即不讀邊庫(多數輪次之成本為零)。逐篇之投影與出帳在
//   stores/noteProjection 之 projectNotes(子階段與維運同一份)。
// 【世代】關聯段判定邊庫世代不符(ctx 旗標 RELATE_CTX_FLAGS.blocked)即略過;自組物件未跑關聯段者自行檢核。
// 【手改另存之告警在投影本身】projectNotes 逐篇發「關聯投影手改另存」(必看字樣;deps.log)——子階段與維運之投影(刪除、還原、撤銷、
//   存量處置之連鎖、projectAll)同一處發出,不只子階段。

import isobj from 'wsemi/src/isobj.mjs'
import { defineMw, applyTaps, makeMsg, count, runChainOverMsgs, stdReport, stageFields } from '../core/capturePackage.mjs'
import { generationMismatchOf } from '../stores/edgeStore.mjs'
import { projectNotes } from '../stores/noteProjection.mjs'
import { openRelateLedgers } from '../stores/relateLedgers.mjs'
import { RELATE_API_HINT } from '../stores/relateHolds.mjs'
import { RELATE_CTX_FLAGS } from '../logContract.mjs'

/**
 * 錨點:project(投影待投影帳之筆記;hook 錨點 relate.project.project)
 *
 * 不讀 msg.data(以 maintenance 空訊息觸發);寫 msg.data._result(統計);計數 projected／changed／failed／gone／manual;不短路
 *
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * openRelateLedgers(state).touch(['n-gone'])
 * let mem = (rows) => ({ get: async (id) => rows.find((r) => r.id === id) || null, select: async () => rows })
 * let ctx = {
 *     deps: { stores: { notes: mem([]), relations: mem([]) }, dirs: { state }, clock: { stamp8: () => '20261102', iso8: () => '2026-11-02T00:00:00+08:00' } },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 * }
 * let msg = { topic: 'maintenance', data: { _domain: createRelateDomain({}) }, meta: {}, stats: {} }
 * let mw = mwProjectDirty()
 * await mw.handle(msg, ctx, (m) => m)
 * console.log(mw.name, msg.data._result, msg.stats)
 * fs.rmSync(state, { recursive: true, force: true })
 * // => project { projected: 0, changed: 0, failed: 0, gone: 1, manual: 0, backlog: 0 } { projected: 0, changed: 0, failed: 0, gone: 1, manual: 0 }
 */
export const mwProjectDirty = () => defineMw({
    name: 'project',
    handle: async (msg, ctx, next) => {
        const { stores, dirs, clock } = ctx.deps
        const log = ctx.log
        const domain = msg.data._domain
        const ledgers = openRelateLedgers(dirs.state, { stamp: clock.stamp8(), log })
        const ids = ledgers.dirty.ids()
        if (!ids.length) {
            msg.data._result = { projected: 0, changed: 0, failed: 0, gone: 0, manual: 0, backlog: 0 }
            return next(msg)
        }
        const edges = await stores.relations.select()
        const mismatch = generationMismatchOf(edges)
        if (mismatch > 0) {
            log.error(`關聯邊庫世代不符：${mismatch} 條邊之 id 不是無序對雜湊——本輪不投影；${RELATE_API_HINT.migrate}`)
            msg.data._result = { blocked: true, backlog: ids.length }
            return next(msg)
        }
        const det = await projectNotes({ stores, dirs, clock, log, domain }, ids, { ledger: ledgers.dirty, edges })
        if (det.failed) log.warn(`關聯投影：${det.failed} 篇 md 讀不到（例 ${det.failedSample.join('、')}），留待下輪補投`)
        for (const k of ['projected', 'changed', 'failed', 'gone', 'manual']) count(msg, k, det[k])
        const { failedSample: _s, manualFiles: _f, ...rest } = det
        msg.data._result = { ...rest, backlog: ledgers.dirty.size() }
        return next(msg)
    },
})

/**
 * 投影子階段(hook 錨點:relate.project.project)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.chain] 輸入自組動作鏈，未給則以 tap 組裝預設鏈
 * @param {Object} [opt.tap] 輸入認名掛載規格
 * @param {Object} [opt.domain] 輸入關聯領域物件(取 relationTypes、conflictType、fallbackType)，未給則用 ctx.deps.domains.relate
 * @returns {Object} 回傳 stage 物件 { name, run }
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => ({ get: async (id) => rows.find((r) => r.id === id) || null, select: async () => rows })
 * let bag = new Map()
 * let ctx = {
 *     deps: { stores: { notes: mem([]), relations: mem([]) }, dirs: { state }, clock: { stamp8: () => '20261102', iso8: () => '2026-11-02T00:00:00+08:00' }, domains: { relate: createRelateDomain({}) } },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     get: (k, fallback) => (bag.has(k) ? bag.get(k) : fallback),
 *     set: (k, v) => bag.set(k, v),
 * }
 * let stage = stageRelateProject()
 * let r = await stage.run(ctx)
 * console.log(stage.name, r.ok, r.stats, r.detail)
 * fs.rmSync(state, { recursive: true, force: true })
 * // => project true { in: 0, out: 0, skip: 0, fail: 0, aiCalls: 0 } { projected: 0, changed: 0, failed: 0, gone: 0, manual: 0, backlog: 0 }
 */
export function stageRelateProject(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps([mwProjectDirty(opt)], opt.tap, { chainName: 'relate.project' })
    return {
        ...stageFields(opt, { name: 'project' }),
        run: async (ctx) => {
            if (ctx.get(RELATE_CTX_FLAGS.blocked, false)) return stdReport({ detail: { blocked: true } })
            const msg = makeMsg('maintenance', { _domain: opt.domain || ctx.deps.domains.relate })
            const r = await runChainOverMsgs({ chain, ctx, msgs: [msg], chainName: 'relate.project' })
            const d = msg.data._result || {}
            return stdReport({ ok: r.fails === 0 && !d.blocked, stats: { in: d.projected || 0, out: d.changed || 0, skip: 0, fail: (d.failed || 0) + r.fails + (d.blocked ? 1 : 0), aiCalls: 0 }, detail: d })
        },
    }
}

export default stageRelateProject
