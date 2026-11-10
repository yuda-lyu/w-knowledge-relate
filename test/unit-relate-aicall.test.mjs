// unit-relate-aicall.test.mjs — 關聯之 AI 呼叫形狀(六類呼叫同一形狀:正向、反向、輪巡、重評兩席與第三席、衝突核對三席、既有邊覆核三席)
// 規格:①注入之 opt.callAI 一律收 { spec, seat, segment, shouldStop, budgetMs, acceptTruncated }(席別:正向／反向／輪巡為 proposer,判定小組為
//   first／second／third);②AI 調度層 ai.callJson 一律收 { spec, shouldStop, budgetMs, acceptTruncated }——兩路皆逐次給 acceptTruncated:true
//   (回覆為陣列、逐項驗證而部分接受;截斷時救回前段完整之項);③各段之 spec 為該段之席位(正向 relate.ai、反向與輪巡 relate.reverse.ai‖relate.ai、
//   重評 relate.reeval.ai.*、衝突核對與既有邊覆核 relate.standards.ai.*);④扣保留之各段(REL-20)進門以開工門檻判、遞補鏈內(交 AI 之 shouldStop)
//   以續派門檻判且仍扣保留:chainStepMsOf(席位 minAttemptMs 優先、未給取 60 秒、不超過開工門檻、開工門檻 0 恆 0)、reservedCallOf(進門不足不送出、
//   鏈內續派門檻、呼叫預算＝扣保留後剩餘、真失敗照計)與六類呼叫之接線(任一呼叫點改回以開工門檻判即紅)
// 執行:自套件根 node <mocha> test/unit-relate-aicall.test.mjs(暫存 test/_tmp/relate-aicall-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, memStore, genClockTZ, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { resolveRelateSettings, chainStepMsOf } from '../src/core/relateSettings.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { relateAiCallOf, reservedCallOf } from '../src/stages/relateAiCall.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const C = DOMAIN.conflictType
const T0 = DOMAIN.relationTypes.find((t) => t !== C)
const V = '2026-02-01T00:00:00+08:00'
const OLD = '2026-01-05T00:00:00+08:00'
const SEATS0 = { relate: { use: 'stub:fwd' }, reverse: { use: 'stub:rev' }, reeval: { first: { use: 'stub:r1' }, second: { use: 'stub:r2' }, third: { use: 'stub:r3' } }, standards: { first: { use: 'stub:s1' }, second: { use: 'stub:s2' }, third: { use: 'stub:s3' } } }
const KEEP = 900_000
let seq = 0

/**
 * 一輪即走遍六類呼叫之環境:新筆記 n(正向,提出衝突交核對)、舊筆記 o1(反向)、共享概念 w 之 r0～r3(輪巡)、內容變更之 c 與其邊 c–d
 *   (重評兩席不一致 → 第三席;既有邊覆核兩席不一致 → 第三席);核對席判提案非衝突 → 第三席
 * @param {Object} [state] 輸入 { left:整輪剩餘毫秒 }(給了即注入保留時間 KEEP 與虛擬剩餘時間、各席逾時 300 秒;測試可隨時改 state.left;未給即無保留)
 * @param {Number} [minAttemptMs] 輸入各席位之 minAttemptMs(給了即逐席帶上;未給不帶)
 * @returns {Object} 回傳 { ctx }
 */
function env(state, minAttemptMs) {
    const withMin = (s) => (minAttemptMs ? { ...s, minAttemptMs } : s)
    const SEATS = Object.fromEntries(Object.entries(SEATS0).map(([k, v]) => [k, 'use' in v ? withMin(v) : Object.fromEntries(Object.entries(v).map(([k2, v2]) => [k2, withMin(v2)]))]))
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
            ai: state ? { parallel: 1, timeoutMs: 300_000 } : { parallel: 1 },
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
        ...(state ? { reserveMs: KEEP } : {}),
    }
    const ctx = bagCtx(deps, recLog(), state ? { remainingMs: () => state.left, expired: () => false } : undefined)
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

    it('chainStepMsOf／reservedCallOf(REL-20):進門不足開工門檻 → 不送出、回 skipped;鏈內之 shouldStop 以續派門檻(席位 minAttemptMs 優先、未給取 60 秒,不超過開工門檻)判且仍扣保留;呼叫預算＝扣保留後之剩餘;全鏈真失敗照計失敗(不因剩餘不足開工門檻改標 skipped);未保留(開工門檻 0)只看整輪逾期', async () => {
        // 續派門檻:未給席位或席位未給 minAttemptMs 取 60 秒、不超過開工門檻;開工門檻非正數恆 0
        assert.deepEqual([chainStepMsOf(360_000), chainStepMsOf(30_000), chainStepMsOf(0), chainStepMsOf(undefined), chainStepMsOf(-5)], [60_000, 30_000, 0, 0, 0])
        // 席位 minAttemptMs 優先(未給或非正數取 60 秒),仍不超過開工門檻;開工門檻 0 恆 0
        assert.deepEqual([chainStepMsOf(360_000, { minAttemptMs: 30_000 }), chainStepMsOf(360_000, { minAttemptMs: 90_000 }), chainStepMsOf(50_000, { minAttemptMs: 90_000 }), chainStepMsOf(360_000, { minAttemptMs: 0 }), chainStepMsOf(0, { minAttemptMs: 30_000 })], [30_000, 90_000, 50_000, 60_000, 0])
        // 邊界:席位為 null／非物件、minAttemptMs 非數字或負數 → 取 60 秒;開工門檻 NaN／負數 → 0;開工門檻 Infinity 依公式取 min(Infinity, 席位值或 60 秒)
        assert.deepEqual([chainStepMsOf(360_000, null), chainStepMsOf(360_000, 'x'), chainStepMsOf(360_000, { minAttemptMs: 'abc' }), chainStepMsOf(360_000, { minAttemptMs: -5 }), chainStepMsOf(NaN, { minAttemptMs: 30_000 }), chainStepMsOf(-1)], [60_000, 60_000, 60_000, 60_000, 0, 0])
        assert.deepEqual([chainStepMsOf(Infinity), chainStepMsOf(Infinity, { minAttemptMs: 30_000 }), chainStepMsOf(300_000, { minAttemptMs: Infinity })], [60_000, 30_000, 300_000])
        // sub:扣保留後之剩餘 left;shouldStop(ms)＝left < ms(保留 > 0 之情形)
        const subOf = (s) => ({ shouldStop: (ms) => s.expired === true || s.left < ms, remainingMs: () => s.left })
        // ①進門不足開工門檻:不呼叫
        const s1 = { left: 359_999 }
        const r1 = await reservedCallOf(() => assert.fail('不足開工門檻時不送出'), subOf(s1), 360_000)('p', () => true, { spec: { use: 'x:a' } })
        assert.deepEqual([r1.ok, r1.skipped, r1.attempts, r1.error], [false, true, 0, 'ABORTED'])
        // 進門回傳之完整形狀＝調度層進門即中止之形狀(判定小組、批次執行器讀 ok／data／error／providerId／attempts／skipped／errors)
        assert.deepEqual(r1, { ok: false, data: null, error: 'ABORTED', providerId: '', attempts: 0, skipped: true, errors: [] })
        // 進門之等號邊界:剩餘恰等於開工門檻 → 送出;鏈內之等號邊界:剩餘恰等於續派門檻 → 不停,少 1 毫秒 → 停
        const s1b = { left: 360_000 }
        const edge = []
        await reservedCallOf(async (p, c, o) => { edge.push('sent'); s1b.left = 60_000; edge.push(o.shouldStop()); s1b.left = 59_999; edge.push(o.shouldStop()); return { ok: true, data: [] } }, subOf(s1b), 360_000)('p', () => true, {})
        assert.deepEqual(edge, ['sent', false, true])
        // ②鏈內:主席等滿 300 秒後剩 120 秒(< 開工門檻 360、≥ 續派門檻 60)→ 不停;再耗 61 秒剩 59 秒 → 停;預算＝進門時扣保留後之剩餘;其餘選項原樣
        const s2 = { left: 420_000 }
        const seen = []
        const r2 = await reservedCallOf(async (p, c, o) => {
            seen.push(o.budgetMs, o.spec.use, o.seat, o.segment, o.shouldStop())
            s2.left -= 300_000
            seen.push(o.shouldStop())
            s2.left -= 61_000
            seen.push(o.shouldStop())
            return { ok: true, data: [], skipped: false }
        }, subOf(s2), 360_000)('p', () => true, { spec: { use: 'x:a' }, seat: 'third', segment: 'conflictCheck' })
        assert.deepEqual([r2.ok, seen], [true, [420_000, 'x:a', 'third', 'conflictCheck', false, false, true]])
        // ②b 席位 minAttemptMs:30 秒之席位,鏈內剩 45 秒不停、29.999 秒停
        const s2b = { left: 420_000 }
        const seenB = []
        await reservedCallOf(async (p, c, o) => {
            s2b.left = 45_000
            seenB.push(o.shouldStop())
            s2b.left = 29_999
            seenB.push(o.shouldStop())
            return { ok: true, data: [] }
        }, subOf(s2b), 360_000)('p', () => true, { spec: { use: 'x:a', minAttemptMs: 30_000 } })
        assert.deepEqual(seenB, [false, true])
        // ③全鏈真失敗(非中止):歸類照調度層之結果——此時已不足開工門檻亦不改標 skipped(各家皆試過而真的失敗者照計失敗;不加「全鏈失敗而不足開工門檻 → skipped」)
        const s3 = { left: 800_000 }
        const failing = (cost) => async () => { s3.left -= cost; return { ok: false, data: null, error: 'stub fail', skipped: false, attempts: 2 } }
        const r3 = await reservedCallOf(failing(100_000), subOf(s3), 360_000)('p', () => true, {})
        const r4 = await reservedCallOf(failing(400_000), subOf(s3), 360_000)('p', () => true, {})
        assert.deepEqual([r3.skipped, r4.skipped, r4.error, r4.attempts], [false, false, 'stub fail', 2])
        // ④未保留(開工門檻 0):進門與鏈內皆只看整輪逾期
        const s5 = { left: 1, expired: false }
        const stops = []
        const r5 = await reservedCallOf(async (p, c, o) => { stops.push(o.shouldStop()); s5.expired = true; stops.push(o.shouldStop()); return { ok: true, data: [] } }, { shouldStop: () => s5.expired, remainingMs: () => Infinity }, 0)('p', () => true, {})
        const r6 = await reservedCallOf(() => assert.fail('整輪逾期不送出'), { shouldStop: () => s5.expired, remainingMs: () => Infinity }, 0)('p', () => true, {})
        assert.deepEqual([r5.ok, stops, r6.skipped], [true, [false, true], true])
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

    for (const [mode, minAttemptMs, expected] of [['席位未給 minAttemptMs(續派門檻取 60 秒)', undefined, [false, true, true]], ['各席位皆給 minAttemptMs 30 秒(續派門檻取 30 秒)', 30_000, [false, false, true]]]) {
        it(`六類呼叫之接線(REL-20;${mode}):每類呼叫交 AI 之鏈內 shouldStop 皆以續派門檻判且扣保留——扣保留後剩 299.999 秒(< 開工門檻 300)不停;剩 59.999／29.999 秒依續派門檻停或不停(整輪未達保留加門檻:扣保留才停)`, async () => {
            const state = { left: KEEP + 2_000_000 }
            const e = env(state, minAttemptMs)
            const seen = new Map()
            const callAI = withCheck(async (prompt, check, co) => {
                const k = `${co.segment}/${co.seat}`
                const keep = state.left
                const probe = (rest) => { state.left = KEEP + rest; return co.shouldStop() }
                const got = [probe(299_999), probe(59_999), probe(29_999)]
                state.left = keep
                if (!seen.has(k)) seen.set(k, got)
                const who = co.seat === 'proposer' ? co.segment : co.seat
                return { ok: true, data: reply(prompt, who), error: '', skipped: false, attempts: 1, providerId: co.spec.use }
            })
            await stageRelate({ callAI }).run(e.ctx)
            assert.deepEqual([...seen.keys()].sort(), [...ALL].sort(), '十一種段／席別皆有呼叫')
            assert.deepEqual(ALL.map((k) => [k, ...seen.get(k)]), ALL.map((k) => [k, ...expected]))
        })
    }

    it('扣保留之 AI 呼叫站點全集(REL-20 盤點):原始碼不再有「鏈內仍以開工門檻判」之舊寫法;五處呼叫點各經 reservedCallOf 一次(繞過它而自組 shouldStop／budgetMs 者即紅)', () => {
        const srcDir = new URL('../src/stages/', import.meta.url)
        const read = (f) => fs.readFileSync(new URL(f, srcDir), 'utf8')
        const OLD = /shouldStop: (\(\) => sub\.shouldStop\(firstMs\)|fwdStop), budgetMs/
        const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.mjs'))
        assert.deepEqual(files.filter((f) => OLD.test(read(f))), [], '舊寫法(鏈內以開工門檻判)')
        // 把 shouldStop 與 budgetMs 同時交給 AI 呼叫者,只有 reservedCallOf 本身(relateAiCall)
        assert.deepEqual(files.filter((f) => /shouldStop:[^\n]*budgetMs:/.test(read(f))).sort(), ['relateAiCall.mjs'])
        // 五處呼叫點(正向、反向／輪巡、重評、既有邊覆核、衝突核對)各有恰一次 reservedCallOf( 呼叫
        const sites = ['relateStage.mjs', 'relateQueueSegment.mjs', 'reevalSegment.mjs', 'edgeReviewSegment.mjs', 'conflictCheckSegment.mjs']
        assert.deepEqual(sites.map((f) => [f, (read(f).match(/reservedCallOf\(/g) || []).length]), sites.map((f) => [f, 1]))
    })
})
