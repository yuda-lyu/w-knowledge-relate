// unit-relate-aicall.test.mjs — 關聯之 AI 呼叫形狀(六類呼叫、12 種段／席別:正向、反向、輪巡;重評、既有邊覆核、衝突核對各 3 席)
// 規格:①注入之 opt.callAI 一律收 { spec, seat, segment, shouldStop, budgetMs, acceptTruncated }(席別:正向／反向／輪巡為 proposer,判定小組為
//   first／second／third);②AI 調度層 ai.callJson 一律收 { spec, shouldStop, budgetMs, acceptTruncated }——兩路皆逐次給 acceptTruncated:true
//   (回覆為陣列、逐項驗證而部分接受;截斷時救回前段完整之項);③各段之 spec 為該段之席位(正向 relate.ai、反向與輪巡 relate.reverse.ai‖relate.ai、
//   重評 relate.reeval.ai.*、衝突核對與既有邊覆核 relate.standards.ai.*);④扣保留之各段(REL-20)一律經抓取套件之 reservedAiCallOf:
//   段之開工門檻＝captureCallMsOf(settings, 席位或三席;席位 timeoutMs 優先)、判定小組三段之第三席逐次給 startMs＝captureCallMsOf(settings, 第三席)
//   (Gitea #132)、鏈內 shouldStop 以續派門檻判且扣保留、budgetMs＝扣保留後之剩餘、startMs 不轉交;本套件不另有包裝與門檻函數(原則 14:不留相容層)
// 執行:自套件根 node <mocha> test/unit-relate-aicall.test.mjs(暫存 test/_tmp/relate-aicall-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, memStore, genClockTZ, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import * as CapturePort from '../src/core/capturePackage.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'
import { RS4 } from '../src/stores/conflictCheckPolicy.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { relateAiCallOf } from '../src/stages/relateAiCall.mjs'
import * as RelateAiCallNs from '../src/stages/relateAiCall.mjs'
import * as RelateSettingsNs from '../src/core/relateSettings.mjs'
import WKnowledgeRelate from '../src/WKnowledgeRelate.mjs'

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
 * 一輪即走遍 12 種段／席別之環境:新筆記 n(正向,提出衝突交核對)、舊筆記 o1(反向)、共享概念 w 之 r0～r3(輪巡)、內容變更之 c 與其邊 c–d
 *   (重評兩席不一致 → 第三席;既有邊覆核兩席不一致 → 第三席);核對席判提案非衝突 → 第三席;既有衝突邊 a–b 之 RS4 待判(衝突核對之第一、第二席)
 * @param {Object} [state] 輸入 { left:整輪剩餘毫秒 }(給了即注入保留時間 KEEP 與虛擬剩餘時間、ai.timeoutMs 300 秒;測試可隨時改 state.left;未給即無保留)
 * @param {Object} [seatExtra] 輸入 { minAttemptMs?:各席位皆帶, timeoutMs?:{ 'relate'|'reverse'|'reeval.first'|…|'standards.third':毫秒 }(逐席帶上), ai?:併入 ai 段之設定(有 state 時) }
 * @returns {Object} 回傳 { ctx }
 */
function env(state, seatExtra = {}) {
    const withExtra = (k, s) => ({ ...s, ...(seatExtra.minAttemptMs ? { minAttemptMs: seatExtra.minAttemptMs } : {}), ...(seatExtra.timeoutMs?.[k] ? { timeoutMs: seatExtra.timeoutMs[k] } : {}) })
    const SEATS = Object.fromEntries(Object.entries(SEATS0).map(([k, v]) => [k, 'use' in v ? withExtra(k, v) : Object.fromEntries(Object.entries(v).map(([k2, v2]) => [k2, withExtra(`${k}.${k2}`, v2)]))]))
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
        // 既有衝突邊之兩端(概念各自獨有:不入正向、反向、輪巡之候選)
        mk('a', { concepts: ['ka'] }), mk('b', { concepts: ['kb'] }),
    ])
    const ab = makeEdge({ from: 'a', to: 'b', type: C, reason: '甲說動量於高波動期失效；乙說動量於高波動期反而更強', nowIso: OLD })
    const relations = memStore([makeEdge({ from: 'c', to: 'd', type: T0, reason: 'c 與 d 共用同一組參數設定', nowIso: OLD }), ab])
    const holdAb = { id: CapturePort.holdKey(RS4.objectEdge, ab.id, RS4.std), object: RS4.objectEdge, oid: ab.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: '提煉判為非對立', next: '關聯段兩席核對', since: OLD, at: OLD, tries: 0, ctx: { from: 'a', to: 'b', core: 'x' } }
    const deps = {
        stores: { notes, relations, holds: memStore([holdAb]), checks: memStore([]) },
        settings: resolveRelateSettings({
            ai: state ? { parallel: 1, timeoutMs: 300_000, ...(seatExtra.ai || {}) } : { parallel: 1 },
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

/** 全部之段與席別(六類呼叫、12 種) */
const ALL = ['forward/proposer', 'reverse/proposer', 'rotation/proposer', 'reeval/first', 'reeval/second', 'reeval/third', 'conflictCheck/first', 'conflictCheck/second', 'conflictCheck/third', 'edgeReview/first', 'edgeReview/second', 'edgeReview/third']

/**
 * 注入之 callAI:依段／席別回覆;每種段／席別之第一次呼叫交 onFirst(key, co) 觀察
 * @param {Function} onFirst 輸入 (key, co) => void
 * @returns {Function} 回傳 callAI
 */
const observing = (onFirst) => {
    const seen = new Set()
    return withCheck(async (prompt, check, co) => {
        const k = `${co.segment}/${co.seat}`
        if (!seen.has(k)) {
            seen.add(k)
            onFirst(k, co)
        }
        const who = co.seat === 'proposer' ? co.segment : co.seat
        return { ok: true, data: reply(prompt, who), error: '', skipped: false, attempts: 1, providerId: co.spec.use }
    })
}

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

    it('扣保留之包裝與門檻只有抓取套件一份(REL-20;原則 14 不留相容層):本套件不再有 reservedCallOf、chainStepMsOf、callTimeoutMsOf(模組與入口皆無);各段所用之 reservedAiCallOf／captureCallMsOf 取自抓取埠(其主入口之轉出;unit-relate-package ① 驗埠之名皆可自主入口解析)', () => {
        for (const k of ['reservedCallOf', 'chainStepMsOf', 'callTimeoutMsOf']) {
            assert.equal(k in WKnowledgeRelate, false, `入口:${k}`)
            assert.equal(k in RelateAiCallNs || k in RelateSettingsNs, false, `模組:${k}`)
        }
        assert.deepEqual(Object.keys(RelateAiCallNs).sort(), ['default', 'relateAiCallOf'])
        assert.deepEqual([typeof CapturePort.reservedAiCallOf, typeof CapturePort.captureCallMsOf], ['function', 'function'])
        assert.deepEqual(['reservedAiCallOf', 'captureCallMsOf'].filter((k) => k in WKnowledgeRelate), [], '不轉出抓取套件之件')
    })

    it('注入之 opt.callAI:六類呼叫(12 種段／席別)一律收同一組選項——acceptTruncated:true、席別與段名、該段之席位(startMs 不轉交)', async () => {
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
        assert.deepEqual(ALL.map(specOf), ['stub:fwd', 'stub:rev', 'stub:rev', 'stub:r1', 'stub:r2', 'stub:r3', 'stub:s1', 'stub:s2', 'stub:s3', 'stub:s1', 'stub:s2', 'stub:s3'])
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
        assert.equal(opts.length, ALL.length, '12 種段／席別各一次(輪巡與反向同席)')
        for (const co of opts) {
            assert.deepEqual(Object.keys(co).sort(), ['acceptTruncated', 'budgetMs', 'shouldStop', 'spec'], co.spec.use)
            assert.equal(co.acceptTruncated, true, co.spec.use)
        }
        assert.deepEqual(opts.map((c) => c.spec.use).sort(), ['stub:fwd', 'stub:r1', 'stub:r2', 'stub:r3', 'stub:rev', 'stub:rev', 'stub:s1', 'stub:s1', 'stub:s2', 'stub:s2', 'stub:s3', 'stub:s3'])
    })

    for (const [mode, minAttemptMs, expected] of [['席位未給 minAttemptMs(續派門檻取 60 秒)', undefined, [false, true, true]], ['各席位皆給 minAttemptMs 30 秒(續派門檻取 30 秒)', 30_000, [false, false, true]]]) {
        it(`12 種段／席別之接線(REL-20;${mode}):包裝之選項——budgetMs＝進門時扣保留後之剩餘、startMs 不轉交;鏈內 shouldStop 以續派門檻判且扣保留——扣保留後剩 299.999 秒(< 開工門檻 300)不停;剩 59.999／29.999 秒依續派門檻停或不停(整輪未達保留加門檻:扣保留才停)`, async () => {
            const state = { left: KEEP + 2_000_000 }
            const e = env(state, { minAttemptMs })
            const seen = new Map()
            const callAI = observing((k, co) => {
                const keep = state.left
                const probe = (rest) => { state.left = KEEP + rest; return co.shouldStop() }
                const got = [probe(299_999), probe(59_999), probe(29_999)]
                state.left = keep
                seen.set(k, [co.budgetMs, 'startMs' in co, ...got])
            })
            await stageRelate({ callAI }).run(e.ctx)
            assert.deepEqual([...seen.keys()].sort(), [...ALL].sort(), '12 種段／席別皆有呼叫')
            assert.deepEqual(ALL.map((k) => [k, ...seen.get(k)]), ALL.map((k) => [k, 2_000_000, false, ...expected]))
        })
    }

    it('12 種段／席別之進門門檻(REL-20〈逐次進門門檻〉;Gitea #132):段之開工門檻＝captureCallMsOf(席位 timeoutMs 優先;判定小組取三席之最大)、判定小組三段之第三席＝該席首家之逾時——以席位 minAttemptMs 遠大於各門檻,使包裝之續派門檻等於本次之進門門檻,於門檻與少 1 毫秒處各問一次 shouldStop', async () => {
        const state = { left: KEEP + 2_000_000 }
        const timeoutMs = { 'relate': 9_000, 'reverse': 9_000, 'reeval.first': 100_000, 'reeval.second': 120_000, 'reeval.third': 9_000, 'standards.first': 200_000, 'standards.second': 250_000, 'standards.third': 9_000 }
        const e = env(state, { minAttemptMs: 10_000_000, timeoutMs })
        const seen = new Map()
        const callAI = observing((k, co) => {
            const keep = state.left
            const at = (ms) => { state.left = KEEP + ms; return co.shouldStop() }
            // 找本次之進門門檻:候選值中「恰等不停、少 1 毫秒即停」者(席位逾時 9／100／120／200／250 秒、ai.timeoutMs 300 秒)
            seen.set(k, [9_000, 100_000, 120_000, 200_000, 250_000, 300_000].filter((t) => at(t) === false && at(t - 1) === true))
            state.left = keep
        })
        await stageRelate({ callAI }).run(e.ctx)
        // 席位 timeoutMs 9 秒之正向、反向、輪巡 → 9 秒(修前取 ai.timeoutMs 300 秒);判定小組前兩席 → 三席之最大(重評 120、標準 250 秒);第三席 → 9 秒(修前取三席之最大)
        const TH = { 'forward/proposer': 9_000, 'reverse/proposer': 9_000, 'rotation/proposer': 9_000, 'reeval/first': 120_000, 'reeval/second': 120_000, 'reeval/third': 9_000, 'conflictCheck/first': 250_000, 'conflictCheck/second': 250_000, 'conflictCheck/third': 9_000, 'edgeReview/first': 250_000, 'edgeReview/second': 250_000, 'edgeReview/third': 9_000 }
        assert.deepEqual(ALL.map((k) => [k, seen.get(k)]), ALL.map((k) => [k, [TH[k]]]))
    })

    it('段之開工門檻取席位 timeoutMs(REL-20;修前取 ai.timeoutMs):席位逾時 9 秒之正向、反向、輪巡於扣保留後剩恰 9 秒時開工,判定小組三段(三席之最大)延後;剩 8.999 秒 → 正向段亦延後(新筆記留池)、不呼叫', async () => {
        const timeoutMs = { 'relate': 9_000, 'reverse': 9_000, 'reeval.first': 100_000, 'reeval.second': 120_000, 'reeval.third': 9_000, 'standards.first': 200_000, 'standards.second': 250_000, 'standards.third': 9_000 }
        const run = async (rest) => {
            const e = env({ left: KEEP + rest }, { timeoutMs })
            const keys = []
            const rep = await stageRelate({ callAI: observing((k) => keys.push(k)) }).run(e.ctx)
            const d = rep.detail
            return [keys.sort(), d.forwardDeferred, d.reevalDeferred, d.rs6Deferred, d.rs4TimeDeferred]
        }
        assert.deepEqual(await run(9_000), [['forward/proposer', 'reverse/proposer', 'rotation/proposer'], false, true, true, true])
        assert.deepEqual(await run(8_999), [[], true, true, true, true])
    })

    it('段之開工門檻取 ai.extraProviders 同 id 條目自帶之逾時(REL-20;修前取 ai.timeoutMs):正向、反向／輪巡之席位未給 timeoutMs、逐家逾時未列,其 use 之條目逾時 9 秒 → 扣保留後剩恰 9 秒時開工;8.999 秒 → 正向段延後、不呼叫', async () => {
        const ai = { extraProviders: [{ id: 'stub:fwd', timeoutMs: 9_000 }, { id: 'stub:rev', timeoutMs: 9_000 }] }
        const run = async (rest) => {
            const e = env({ left: KEEP + rest }, { ai })
            const keys = []
            const rep = await stageRelate({ callAI: observing((k) => keys.push(k)) }).run(e.ctx)
            return [keys.sort(), rep.detail.forwardDeferred]
        }
        assert.deepEqual(await run(9_000), [['forward/proposer', 'reverse/proposer', 'rotation/proposer'], false])
        assert.deepEqual(await run(8_999), [[], true])
    })

    for (const big of ['first', 'second', 'third']) {
        it(`判定小組三段之段開工門檻取三席之最大(REL-20;${big} 為唯一最大,其餘兩席 100 秒):扣保留後剩 249.999 秒 → 三段皆延後;剩 250 秒 → 三段皆開工(席位集合漏任一席即紅)`, async () => {
            const timeoutMs = { 'relate': 9_000, 'reverse': 9_000 }
            for (const g of ['reeval', 'standards']) for (const s of ['first', 'second', 'third']) timeoutMs[`${g}.${s}`] = s === big ? 250_000 : 100_000
            const run = async (rest) => {
                const e = env({ left: KEEP + rest }, { timeoutMs })
                const segs = new Set()
                const rep = await stageRelate({ callAI: observing((k) => segs.add(k.split('/')[0])) }).run(e.ctx)
                const d = rep.detail
                return [d.reevalDeferred, d.rs6Deferred, d.rs4TimeDeferred, ['reeval', 'edgeReview', 'conflictCheck'].filter((s) => segs.has(s))]
            }
            assert.deepEqual(await run(249_999), [true, true, true, []])
            assert.deepEqual(await run(250_000), [false, false, false, ['reeval', 'edgeReview', 'conflictCheck']])
        })
    }

    it('扣保留之 AI 呼叫站點全集(REL-20 盤點):原始碼無「鏈內仍以開工門檻判」之舊寫法、無本套件自有之包裝與門檻函數;五處呼叫點各經抓取套件之 reservedAiCallOf 一次;判定小組三段之開工門檻取三席、第三席給 startMs', () => {
        const srcDir = new URL('../src/stages/', import.meta.url)
        // 只看程式碼(去區塊註解與整行註解;檔頭與 JSDoc 提及函數名不算呼叫)
        const read = (f) => fs.readFileSync(new URL(f, srcDir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        const OLD_CHAIN = /shouldStop: (\(\) => sub\.shouldStop\(firstMs\)|fwdStop), budgetMs/
        const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.mjs'))
        assert.deepEqual(files.filter((f) => OLD_CHAIN.test(read(f))), [], '舊寫法(鏈內以開工門檻判)')
        assert.deepEqual(files.filter((f) => /reservedCallOf|chainStepMsOf|callTimeoutMsOf/.test(read(f))), [], '本套件之舊包裝與門檻函數')
        // 把 shouldStop 與 budgetMs 同時交給 AI 呼叫者,只有 relateAiCallOf 之原樣轉交(一處)
        assert.deepEqual(files.map((f) => [f, (read(f).match(/shouldStop:[^\n]*budgetMs:/g) || []).length]).filter(([, n]) => n > 0), [['relateAiCall.mjs', 1]])
        // 五處呼叫點(正向、反向／輪巡、重評、既有邊覆核、衝突核對)各有恰一次 reservedAiCallOf( 呼叫,開工門檻皆取 captureCallMsOf
        const sites = ['relateStage.mjs', 'relateQueueSegment.mjs', 'reevalSegment.mjs', 'edgeReviewSegment.mjs', 'conflictCheckSegment.mjs']
        assert.deepEqual(sites.map((f) => [f, (read(f).match(/reservedAiCallOf\(/g) || []).length]), sites.map((f) => [f, 1]))
        assert.deepEqual(files.filter((f) => /reservedAiCallOf\(/.test(read(f))).sort(), [...sites].sort())
        // 判定小組三段:段之開工門檻仍取三席;第三席之進門門檻取該席首家之逾時、呼叫時只對第三席給 startMs
        for (const [f, third] of [['conflictCheckSegment.mjs', 'seats.third'], ['edgeReviewSegment.mjs', 'seats.third'], ['reevalSegment.mjs', 'seatC']]) {
            const s = read(f)
            assert.ok(/const firstMs = captureCallMsOf\(settings, \[[^\]]+, [^\]]+, [^\]]+\]\)/.test(s), `${f}:段之開工門檻取三席`)
            assert.ok(s.includes(`const thirdMs = captureCallMsOf(settings, ${third})`), `${f}:第三席之進門門檻取該席首家之逾時`)
            assert.equal((s.match(/startMs: which === 'third' \? thirdMs : undefined/g) || []).length, 1, `${f}:第三席之呼叫給 startMs`)
        }
    })
})
