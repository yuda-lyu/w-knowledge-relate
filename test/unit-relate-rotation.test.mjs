// unit-relate-rotation.test.mjs — 檢定標準 RS10(候選涵蓋之召回:舊×舊公平輪巡、進度可查):純函數與輪巡段
// 規格:standards/registry.mjs 之 RS10(候選之完整性——從未比較之對——屬召回:舊×舊公平輪巡、配額、進度可查)、規則帳本 STD-20。
// 執行:自套件根 npx mocha test/unit-relate-rotation.test.mjs(暫存 test/_tmp/relate-rot-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, memStore, genClockTZ, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { makeEdge, edgeId } from '../src/stores/edgeStore.mjs'
import { rotationPageOf, rotationQueueOf, rotationProgressOf } from '../src/stores/rotationPolicy.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const T0 = DOMAIN.relationTypes.find((t) => t !== DOMAIN.conflictType)
const REASON = '兩篇皆以波動度縮放部位，乙補充甲之縮放參數'
let seq = 0

/**
 * 環境:已關聯之筆記(共享概念)、既有邊;AI 替身只回輪巡段(segment 'rotation')之關聯
 * @param {Object} o 輸入 { notes, edges, rotate:(title, candidates:Array(slug))=>relations, fail:Boolean, relate(settings.relate 之覆寫) }
 * @returns {Object} 回傳 { ctx, notes, relations, log, calls, run }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const recs = (o.notes || []).map((n) => {
        const file = `${dir}/notes/${n.id}.md`
        const title = n.title || `標題${n.id}`
        writeMd(file, { title, slug: n.id }, `# ${title}\n\n## 一句話重點\n\n${n.id} 之重點\n`)
        return { category: 'c', summary: `${n.id} 之重點`, concepts: ['p'], relatedAt: '2026-01-02T00:00:00+08:00', ...n, title, file }
    })
    const notes = memStore(recs)
    const relations = memStore(o.edges || [])
    const log = recLog()
    const calls = []
    const deps = {
        stores: { notes, relations },
        settings: resolveRelateSettings({
            ai: { parallel: 1, timeoutMs: 300_000, providerTimeouts: {} },
            relate: {
                rounds: 2, notesPerCall: 6, candidatesPerNote: 2, ai: { use: 'stub:fwd' },
                reverse: { perRun: 0 }, rotation: { perRun: 1 }, reeval: { perRun: 0 },
                standards: { conflictCheck: { enabled: false }, edgeReview: { enabled: false } },
                ...(o.relate || {}),
            },
        }),
        ai: null,
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: DOMAIN },
    }
    const ctx = bagCtx(deps, log, { remainingMs: () => Infinity, expired: () => false })
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    const callAI = withCheck(async (prompt, check, co) => {
        const blocks = prompt.split(/^--- 第(\d+)篇（待建立關聯）---$/m).slice(1).reduce((acc, x, i, arr) => (i % 2 === 0 ? [...acc, { index: Number(x), body: arr[i + 1] }] : acc), [])
        const items = blocks.map((b) => ({ index: b.index, title: b.body.match(/^標題：(.+)$/m)[1], slugs: [...b.body.matchAll(/^ {2}- slug: (\S+)｜/gm)].map((m) => m[1]) }))
        calls.push({ seg: co?.segment || 'forward', items })
        if (o.fail && co?.segment === 'rotation') return { ok: false, data: null, error: 'stub fail', skipped: false, attempts: 1 }
        const data = items.map((it) => ({ index: it.index, relations: (co?.segment === 'rotation' && o.rotate ? o.rotate(it.title, it.slugs) : []) }))
        return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: 'stub:fwd' }
    })
    const run = () => stageRelate({ callAI }).run(ctx)
    return { ctx, notes, relations, log, calls, run, callAI }
}

const detOf = (rep) => rep.result?.detail || rep.detail || {}

describe('unit-relate-rotation', function() {

    before(() => {
        TMP = tmpRoot('relate-rot')
    })
    after(() => removeRoots([TMP]))

    // ─── 純函數 ───

    it('rotationPageOf:依分數降冪、建立時刻舊到新、id 排名;頁 1 起(頁 0＝正向之前 K 名);頁內鄰居不重送、全為鄰居之頁跳過;取盡即用盡', () => {
        const byId = new Map([['t', { id: 't' }], ...['x1', 'x2', 'x3', 'x4', 'x5'].map((id, i) => [id, { id, createdAt: `2026-01-0${i + 1}` }])])
        const scores = new Map([['x1', 20], ['x2', 10], ['x3', 10], ['x4', 10], ['x5', 11]])
        const base = { scoresFor: () => scores, byId, K: 2 }
        // 排名:x1(20)、x5(11)、x2、x3、x4(10;舊到新)
        const p1 = rotationPageOf({ id: 't' }, { ...base, page: 1 })
        assert.deepEqual([p1.candidates.map((c) => c.id), p1.page, p1.next, p1.total, p1.done], [['x2', 'x3'], 1, 2, 5, false])
        assert.deepEqual(rotationPageOf({ id: 't' }, { ...base, page: 2 }).candidates.map((c) => c.id), ['x4'])
        const end = rotationPageOf({ id: 't' }, { ...base, page: 3 })
        assert.deepEqual([end.candidates, end.done], [[], true])
        const skip = rotationPageOf({ id: 't' }, { ...base, page: 1, isNeighbor: (a, b) => ['x2', 'x3'].includes(b) })
        assert.deepEqual([skip.candidates.map((c) => c.id), skip.page, skip.next], [['x4'], 2, 3], '頁 1 全為鄰居 → 跳至頁 2')
        assert.deepEqual(rotationPageOf({ id: 't' }, { ...base, page: 0 }).page, 1, '頁 0 不輪巡(正向已比)')
    })

    it('rotationQueueOf／rotationProgressOf:只排已關聯、不在正向池、未用盡者;從未輪巡者先,再依上次輪巡時刻、建立時刻;進度＝用盡／已關聯', () => {
        const ns = [
            { id: 'a', relatedAt: 'x', createdAt: '2026-01-03' },
            { id: 'b', relatedAt: 'x', createdAt: '2026-01-01', relateRotation: { page: 2, at: '2026-02-01', done: false } },
            { id: 'c', relatedAt: 'x', createdAt: '2026-01-02' },
            { id: 'd', relatedAt: '', createdAt: '2026-01-01' },
            { id: 'e', relatedAt: 'x', createdAt: '2026-01-01', relateRotation: { page: 5, at: '2026-01-15', done: true } },
            { id: 'f', relatedAt: 'x', createdAt: '2026-01-01', knowledgeChangedAt: 'v2', relatedChangeAt: 'v1' },
        ]
        const q = rotationQueueOf(ns, { inPool: (n) => !n.relatedAt || (n.knowledgeChangedAt && n.knowledgeChangedAt !== n.relatedChangeAt) })
        assert.deepEqual(q.map((n) => n.id), ['c', 'a', 'b'], '未關聯(d)、用盡(e)、正向池(f)不排;從未輪巡者(c、a)先')
        assert.deepEqual(rotationProgressOf(ns), { done: 1, total: 5 })
    })

    // ─── 段 ───

    it('停用(預設 0):不呼叫輪巡、報告無 rotation 計數', async () => {
        const e = env({ notes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], relate: { rotation: { perRun: 0 } } })
        const rep = await e.run()
        assert.equal(e.calls.filter((c) => c.seg === 'rotation').length, 0)
        assert.equal(Object.keys(detOf(rep)).some((k) => k.startsWith('rotation')), false)
    })

    it('輪巡:依配額取從未輪巡且最早建立者 → 以正向提示詞比對頁 1 之候選(前 K 名之後、非鄰居)→ 新邊落地(rotationEdges)、游標前進;次輪續頁 2;取盡即用盡、不再排;進度可查', async () => {
        // a 最早建立;與 a 共享概念者 b、c、d、f(K＝2 → 頁 0＝b、c;頁 1＝d、f——分數同、依建立時刻舊到新)
        const notes = [
            { id: 'a', createdAt: '2026-01-01' },
            { id: 'b', createdAt: '2026-01-02' },
            { id: 'c', createdAt: '2026-01-03' },
            { id: 'd', createdAt: '2026-01-04' },
            { id: 'f', createdAt: '2026-01-05' },
        ]
        const e = env({ notes, rotate: (title, slugs) => (title === '標題a' && slugs.includes('d') ? [{ to: 'd', type: T0, reason: REASON }] : []) })
        const d1 = detOf(await e.run())
        const rc = e.calls.filter((c) => c.seg === 'rotation')
        assert.deepEqual(rc.map((c) => c.items.map((it) => [it.title, it.slugs.sort()])), [[['標題a', ['d', 'f']]]], '頁 1＝第 3、4 名')
        assert.deepEqual([d1.rotationTargets, d1.rotationEdges, d1.edges, d1.rotationTotal], [1, 1, 1, 5], JSON.stringify(d1))
        assert.ok(await e.relations.get(edgeId('a', 'd')), '輪巡之新邊落地')
        assert.deepEqual([(await e.notes.get('a')).relateRotation.page, (await e.notes.get('a')).relateRotation.done], [2, true], 'a 之共享候選僅 4 篇 → 頁 1 後即用盡')
        assert.ok(e.log.lines.some((l) => /^INFO 關聯輪巡：a 第 1 頁（2 篇）→ 1 條.*已用盡/.test(l)), e.log.lines.join('\n'))
        // 次輪:a 已用盡不再排 → 輪到 b(從未輪巡、次早)
        await e.run()
        const rc2 = e.calls.filter((c) => c.seg === 'rotation').slice(1)
        assert.deepEqual(rc2.map((c) => c.items.map((it) => it.title)), [['標題b']])
        const d3 = detOf(await e.run())
        assert.ok(d3.rotationDone >= 2, JSON.stringify(d3))
    })

    it('失敗:輪巡批次失敗 → 頁不前進、只更新時刻(排隊尾);既有鄰居不重送', async () => {
        const notes = [{ id: 'a', createdAt: '2026-01-01' }, { id: 'b', createdAt: '2026-01-02' }, { id: 'c', createdAt: '2026-01-03' }, { id: 'd', createdAt: '2026-01-04' }, { id: 'f', createdAt: '2026-01-05' }]
        const e = env({ notes, fail: true, edges: [makeEdge({ from: 'a', to: 'd', type: T0, reason: REASON, nowIso: '2026-01-06T00:00:00+08:00' })] })
        await e.run()
        const rc = e.calls.filter((c) => c.seg === 'rotation')
        assert.deepEqual(rc[0].items[0].slugs, ['f'], '頁 1 之 d 已是鄰居 → 不重送')
        const ra = (await e.notes.get('a')).relateRotation
        assert.deepEqual([ra.page, ra.done, !!ra.at], [1, false, true], '頁不前進、時刻更新')
        await e.run()
        const rc2 = e.calls.filter((c) => c.seg === 'rotation')
        assert.equal(rc2.at(-1).items[0].title, '標題b', 'a 失敗後排隊尾 → 本輪輪到 b')
    })

    it('保留時間(deps.reserveMs／stageRelate 之 opt.reserveMs):扣保留後剩餘不足一次呼叫 → 本輪延後(rotationDeferred,不呼叫、游標不動);opt.reserveMs 優先', async () => {
        const notes = [{ id: 'a', createdAt: '2026-01-01' }, { id: 'b', createdAt: '2026-01-02' }, { id: 'c', createdAt: '2026-01-03' }, { id: 'd', createdAt: '2026-01-04' }, { id: 'f', createdAt: '2026-01-05' }]
        const e = env({ notes })
        // 剩 1,000 秒、首家逾時 300 秒:保留 900 秒 → 延後
        e.ctx.remainingMs = () => 1_000_000
        e.ctx.deps.reserveMs = 900_000
        const d = detOf(await e.run())
        assert.deepEqual([d.rotationDeferred, d.rotationTargets, e.calls.filter((c) => c.seg === 'rotation').length, (await e.notes.get('a')).relateRotation], [true, 0, 0, undefined], JSON.stringify(d))
        assert.ok(e.log.lines.includes('INFO 關聯輪巡：扣保留時間後剩餘時間不足一次呼叫（300s），本輪延後'), e.log.lines.join('\n'))
        const df = detOf(await stageRelate({ callAI: e.callAI, reserveMs: 0 }).run(e.ctx))
        assert.deepEqual([df.rotationDeferred, df.rotationTargets], [false, 1], 'opt.reserveMs 優先')
    })

    it('內容變更之重判:正向重評該篇後輪巡游標重置為頁 1', async () => {
        const notes = [
            { id: 'a', createdAt: '2026-01-01', knowledgeChangedAt: '2026-02-01T00:00:00+08:00', relatedChangeAt: '2026-01-01T00:00:00+08:00', relateRotation: { page: 3, at: '2026-01-20', total: 9, done: true } },
            { id: 'b', createdAt: '2026-01-02' },
        ]
        const e = env({ notes, relate: { rotation: { perRun: 0 } } })
        await e.run()
        assert.deepEqual((await e.notes.get('a')).relateRotation, { page: 1, at: '', total: 0, done: false })
    })
})
