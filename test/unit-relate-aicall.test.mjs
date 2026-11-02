// unit-relate-aicall.test.mjs — 關聯之 AI 呼叫形狀(六類呼叫同一形狀:正向、反向、輪巡、重評兩席與第三席、衝突核對三席、既有邊覆核三席)
// 規格:①注入之 opt.callAI 一律收 { spec, seat, segment, shouldStop, budgetMs, acceptTruncated }(席別:正向／反向／輪巡為 proposer,判定小組為
//   first／second／third);②AI 調度層 ai.callJson 一律收 { spec, shouldStop, budgetMs, acceptTruncated }——兩路皆逐次給 acceptTruncated:true
//   (回覆為陣列、逐項驗證而部分接受;截斷時救回前段完整之項);③各段之 spec 為該段之席位(正向 relate.ai、反向與輪巡 relate.reverse.ai‖relate.ai、
//   重評 relate.reeval.ai.*、衝突核對與既有邊覆核 relate.standards.ai.*)
// 執行:自套件根 node <mocha> test/unit-relate-aicall.test.mjs(暫存 test/_tmp/relate-aicall-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, memStore, genClockTZ, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { relateAiCallOf } from '../src/stages/relateAiCall.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const C = DOMAIN.conflictType
const T0 = DOMAIN.relationTypes.find((t) => t !== C)
const V = '2026-02-01T00:00:00+08:00'
const OLD = '2026-01-05T00:00:00+08:00'
const SEATS = { relate: { use: 'stub:fwd' }, reverse: { use: 'stub:rev' }, reeval: { first: { use: 'stub:r1' }, second: { use: 'stub:r2' }, third: { use: 'stub:r3' } }, standards: { first: { use: 'stub:s1' }, second: { use: 'stub:s2' }, third: { use: 'stub:s3' } } }
let seq = 0

/**
 * 一輪即走遍六類呼叫之環境:新筆記 n(正向,提出衝突交核對)、舊筆記 o1(反向)、共享概念 w 之 r0～r3(輪巡)、內容變更之 c 與其邊 c–d
 *   (重評兩席不一致 → 第三席;既有邊覆核兩席不一致 → 第三席);核對席判提案非衝突 → 第三席
 * @returns {Object} 回傳 { ctx }
 */
function env() {
    const dir = `${TMP}/e${++seq}`
    const mk = (id, extra = {}) => {
        const file = `${dir}/notes/${id}.md`
        writeMd(file, { title: `標題${id}`, slug: id }, `# 標題${id}\n\n## 一句話重點\n\n${id} 之重點\n\n## 核心知識\n\n- ${id} 要點`)
        return { id, title: `標題${id}`, category: 'c', summary: `${id} 之重點`, concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-02T00:00:00+08:00', file, ...extra }
    }
    const notes = memStore([
        mk('n', { concepts: ['p', 's', 't'], createdAt: '2026-02-01T00:00:00+08:00', relatedAt: '' }),
        mk('g1', { concepts: ['s', 't', 'u'] }),
        mk('g2', { concepts: ['s', 't', 'v'] }),
        mk('o1', { concepts: ['p', 'q'] }),
        mk('c', { concepts: ['z'], knowledgeChangedAt: V, relatedChangeAt: V }),
        mk('d', { concepts: ['z'] }),
        mk('r0', { concepts: ['w'], createdAt: '2025-12-01' }),
        mk('r1', { concepts: ['w'] }), mk('r2', { concepts: ['w'] }), mk('r3', { concepts: ['w'] }),
    ])
    const relations = memStore([makeEdge({ from: 'c', to: 'd', type: T0, reason: 'c 與 d 共用同一組參數設定', nowIso: OLD })])
    const deps = {
        stores: { notes, relations, holds: memStore([]), checks: memStore([]) },
        settings: resolveRelateSettings({
            ai: { parallel: 1 },
            relate: {
                candidatesPerNote: 2, ai: SEATS.relate,
                reverse: { perRun: 4, ai: SEATS.reverse }, rotation: { perRun: 1 },
                reeval: { perRun: 2, ai: SEATS.reeval },
                standards: { conflictCheck: { enabled: true }, edgeReview: { enabled: true, perRun: 10 }, ai: SEATS.standards },
            },
        }),
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: DOMAIN },
    }
    const ctx = bagCtx(deps, recLog())
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    return { ctx }
}

/**
 * 依提示詞之角色與席別回覆(兩路共用):正向對 n 提出與 g1 之衝突;反向與輪巡不提;重評第一席撤銷、其餘保留;核對席判提案非衝突;
 *   既有邊覆核第一席保留、第二席撤除、第三席保留
 * @param {String} prompt 輸入提示詞
 * @param {String} who 輸入席別(first／second／third／proposer)
 * @returns {Array} 回傳回覆資料
 */
function reply(prompt, who) {
    const items = [...prompt.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))
    if (/的既有關聯覆核器/.test(prompt)) return items.map((index) => (who === 'second' ? { index, verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' } : { index, verdict: 'keep', reason: '' }))
    if (/的衝突核對器/.test(prompt)) return items.map((index) => ({ index, verdict: 'change', type: T0, reason: '兩篇共用同一組成交量指標與回看期設定' }))
    if (/的關聯覆核器/.test(prompt)) {
        const slugs = [...prompt.matchAll(/^ {2}- slug: (\S+)｜/gm)].map((m) => m[1])
        return [{ index: 1, verdicts: slugs.map((s) => (who === 'first' ? { to: s, verdict: 'retire', reason: '新內容與對象已無共同機制可言' } : { to: s, verdict: 'keep' })) }]
    }
    const targets = [...prompt.matchAll(/^--- 第(\d+)篇（待建立關聯）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
    return targets.map((t) => ({ index: t.index, relations: t.title === '標題n' && who === 'forward' ? [{ to: 'g1', type: C, reason: 'n 說動量有效、g1 說扣除成本後無效' }] : [] }))
}

/** 全部之段與席別(六類呼叫) */
const ALL = ['forward/proposer', 'reverse/proposer', 'rotation/proposer', 'reeval/first', 'reeval/second', 'reeval/third', 'conflictCheck/first', 'conflictCheck/third', 'edgeReview/first', 'edgeReview/second', 'edgeReview/third']

describe('unit-relate-aicall', function() {

    before(() => {
        TMP = tmpRoot('relate-aicall')
    })
    after(() => removeRoots([TMP]))

    it('relateAiCallOf:注入之 callAI 收 { spec, seat, segment, shouldStop, budgetMs, acceptTruncated:true };調度層 ai.callJson 收 { spec, shouldStop, budgetMs, acceptTruncated:true }', async () => {
        const got = []
        const stop = () => false
        const viaInject = relateAiCallOf({ ai: { callJson: () => assert.fail('有注入時不走調度層') }, callAI: async (p, c, o) => got.push(['inject', p, o]) })
        await viaInject('p1', () => true, { spec: { use: 'x:a' }, seat: 'first', segment: 'reeval', shouldStop: stop, budgetMs: 5 })
        const viaAi = relateAiCallOf({ ai: { callJson: async (p, c, o) => got.push(['ai', p, o]) } })
        await viaAi('p2', () => true, { spec: { use: 'x:b' }, seat: 'proposer', segment: 'forward', shouldStop: stop, budgetMs: 7 })
        assert.deepEqual(got, [
            ['inject', 'p1', { spec: { use: 'x:a' }, shouldStop: stop, budgetMs: 5, acceptTruncated: true, seat: 'first', segment: 'reeval' }],
            ['ai', 'p2', { spec: { use: 'x:b' }, shouldStop: stop, budgetMs: 7, acceptTruncated: true }],
        ])
    })

    it('注入之 opt.callAI:六類呼叫(正向、反向、輪巡、重評三席、衝突核對、既有邊覆核三席)一律收同一組選項——acceptTruncated:true、席別與段名、該段之席位', async () => {
        const e = env()
        const calls = []
        const callAI = withCheck(async (prompt, check, co) => {
            calls.push(co)
            const who = co.seat === 'proposer' ? co.segment : co.seat
            return { ok: true, data: reply(prompt, who), error: '', skipped: false, attempts: 1, providerId: co.spec.use }
        })
        const rep = await stageRelate({ callAI }).run(e.ctx)
        assert.deepEqual([...new Set(calls.map((c) => `${c.segment}/${c.seat}`))].sort(), [...ALL].sort(), JSON.stringify(rep.detail))
        for (const c of calls) {
            assert.deepEqual(Object.keys(c).sort(), ['acceptTruncated', 'budgetMs', 'seat', 'segment', 'shouldStop', 'spec'], `${c.segment}/${c.seat}`)
            assert.deepEqual([c.acceptTruncated, typeof c.shouldStop, typeof c.budgetMs], [true, 'function', 'number'], `${c.segment}/${c.seat}`)
        }
        const specOf = (k) => calls.find((c) => `${c.segment}/${c.seat}` === k).spec.use
        assert.deepEqual(ALL.map(specOf), ['stub:fwd', 'stub:rev', 'stub:rev', 'stub:r1', 'stub:r2', 'stub:r3', 'stub:s1', 'stub:s3', 'stub:s1', 'stub:s2', 'stub:s3'])
    })

    it('AI 調度層 ai.callJson(未注入時):同一流程之每次呼叫皆收 { spec, shouldStop, budgetMs, acceptTruncated:true }(與注入路徑同次數)', async () => {
        const seatOf = { 'stub:r1': 'first', 'stub:r2': 'second', 'stub:r3': 'third', 'stub:s1': 'first', 'stub:s2': 'second', 'stub:s3': 'third' }
        const e = env()
        const opts = []
        e.ctx.deps.ai = {
            callJson: async (prompt, check, co) => {
                opts.push(co)
                const who = seatOf[co.spec.use] || (co.spec.use === 'stub:fwd' ? 'forward' : 'reverse')
                return { ok: true, data: reply(prompt, who), error: '', skipped: false, attempts: 1, providerId: co.spec.use }
            },
        }
        await stageRelate({}).run(e.ctx)
        assert.equal(opts.length, ALL.length, '六類呼叫各一次(輪巡與反向同席)')
        for (const co of opts) {
            assert.deepEqual(Object.keys(co).sort(), ['acceptTruncated', 'budgetMs', 'shouldStop', 'spec'], co.spec.use)
            assert.equal(co.acceptTruncated, true, co.spec.use)
        }
        assert.deepEqual(opts.map((c) => c.spec.use).sort(), ['stub:fwd', 'stub:r1', 'stub:r2', 'stub:r3', 'stub:rev', 'stub:rev', 'stub:s1', 'stub:s1', 'stub:s2', 'stub:s3', 'stub:s3'])
    })
})
