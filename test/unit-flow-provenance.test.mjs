// unit-flow-provenance.test.mjs — 邊記錄之產出鏈(produced)於各寫邊點之行為:整輪流程(總組裝、真 LMDB、替身 AI)與各段(記憶體集合)
// 規格:跨套件規格〈知識套件之產出鏈〉§2(結構)、§2.3(歷史)、§3(邊記錄:新建、改型、判定小組改寫、標準修正)、§4(stage:relate、reverse、reeval、conflict-check、
//   edge-review、standards-fix)、§7 驗收①②④;本套件之取捨見 src/stores/edgeProvenance 檔頭(只在新建與可見欄位改變時追加、席位與成交者之取法、provider 空字串不寫)
// 本檔只 import 既有之匯出(不 import 產出鏈之新模組):修前(無產出鏈)之碼亦能載入本檔,各案因邊無 produced 而紅
// 執行:自套件根 node <mocha> test/unit-flow-provenance.test.mjs(暫存 test/_tmp/flow-prov-<pid>、relate-prov-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, deepMerge, memStore, genClockTZ, withCheck, removeRoots, STOCK_LEDGER_FILE } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import {
    tmpRoot, resetConceptFold, landNote, scriptedAi, relateAnswer, buildTestRelate, withStores, seedNotes, readJsonFile, PKG_ROOT,
} from './tools/relateTestKit.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { readJsonlRows, holdKey, stdReport } from '../src/core/capturePackage.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { rebuildRelationIndex } from '../src/stages/relationIndexStage.mjs'
import { makeEdge, edgeId, typeRankOf } from '../src/stores/edgeStore.mjs'
import { rewriteEdge } from '../src/stores/edgeRewrite.mjs'
import { openRelateLedgers } from '../src/stores/relateLedgers.mjs'
import { retireEdge } from '../src/stores/edgeRetire.mjs'
import { planRelateBench } from '../src/bench/relateBench.mjs'
import { restoreEdge, revertEdgeRevision, deleteNote, undoDeleteNote, restoreNote } from '../src/ops/noteOps.mjs'
import { edgesByProvenance } from '../src/ops/provenanceOps.mjs'
import { planEdgeStockFix, applyEdgeStockFix, readEdgeStockLedger, rollbackEdgeStockFix } from '../src/standards/stockFix.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const C = DOMAIN.conflictType
const [T0, T1] = DOMAIN.relationTypes.filter((t) => t !== C)
const STAMP1 = '20261108220000'
const STAMP2 = '20261108230000'
const OLD = '2026-01-05T00:00:00+08:00'
const R_CONFLICT = '甲說動量於高波動期失效；乙說動量於高波動期反而更強'
const R_FIX = '甲說動量於崩盤後反轉；乙說動量於崩盤後延續，結論相反'
const R_OTHER = '兩篇皆以波動度調整部位，屬同一機制之延伸'
const R_BAD = '甲說週期為 99 天；乙說週期為無規律' // 數字 99 不見於兩端 md(RS8)——過不了納入閘
const R_NEW = '甲之波動度目標化提供乙之部位縮放所需之波動度估計'
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
const PKG = JSON.parse(fs.readFileSync(`${PKG_ROOT}/package.json`, 'utf8'))
// 各角色之提示詞指紋之替身(只驗角色對應;真值之取得見「總組裝」一節)
const FP = { relate: '1111111111111111', reeval: '2222222222222222', 'conflict-check': '3333333333333333', 'edge-review': '4444444444444444' }
const SEED_P = { v: 1, stamp: '20260101000000', stage: 'relate', seat: 'relate.ai', provider: 'old:p', pkg: 'w-knowledge-relate@0.0.1', at: '2026-01-01T00:00:00+08:00' }
/** 已帶一筆舊產出者之邊(歷史 1 筆;驗「再寫入 → 歷史 +1」) */
const seeded = (edge) => ({ ...edge, produced: { ...SEED_P }, producedHistory: [{ ...SEED_P }], producedHistoryDropped: 0 })
let seq = 0

/**
 * 環境:筆記(含 md)、邊、待判、檢核紀錄;AI 替身依 segment 回覆(正向／反向／輪巡:關聯;conflictCheck／edgeReview:票;reeval:裁決);providerId 取 providers 之席別
 * @param {Object} o 輸入 { notes, edges, holds, forward:{ 標題:relations|(seg, slugs)=>relations }, check(seat, { a, b, index }), review(seat, { a, b, index }), reeval(seat, { title, slugs }),
 *   providers:{ forward, reverse, rotation, first, second, third }, relate(settings.relate 之覆寫), domain, stamp }
 * @returns {Object} 回傳 { ctx, relations, notes, holds, checks, calls, fpCalls, providers, run, ccLog, erLog, reevalLog, restoreDeps }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const recs = (o.notes || []).map((n) => {
        const file = `${dir}/notes/${n.id}.md`
        const title = n.title || `標題${n.id}`
        writeMd(file, { title, slug: n.id }, `# ${title}\n\n## 一句話重點\n\n${n.id} 之完整重點全文\n\n## 核心知識\n\n- ${n.id} 要點一\n\n## 適用條件與限制\n\n- ${n.id} 之條件`)
        return { category: 'c', summary: `${n.id} 之重點`, concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-02T00:00:00+08:00', ...n, title, file }
    })
    const notes = memStore(recs)
    const relations = memStore(o.edges || [])
    const holds = memStore(o.holds || [])
    const checks = memStore([])
    const log = recLog()
    const calls = []
    const fpCalls = []
    const providers = { forward: 'stub:fwd', reverse: 'stub:rev', rotation: 'stub:rot', first: 'stub:a', second: 'stub:b', third: 'stub:c', ...(o.providers || {}) }
    const domain = o.domain || DOMAIN
    const deps = {
        stores: { notes, relations, holds, checks },
        settings: resolveRelateSettings(deepMerge({
            ai: { parallel: 1, timeoutMs: 300_000, providerTimeouts: {} },
            relate: {
                rounds: 2, notesPerCall: 6, candidatesPerNote: 15, ai: { use: 'stub:fwd' }, reverse: { perRun: 0 }, rotation: { perRun: 0 }, reeval: { perRun: 0 },
                standards: {
                    conflictCheck: { enabled: false, perRun: 0 }, edgeReview: { enabled: false, perRun: 0 },
                    ai: { first: { use: 'stub:a' }, second: { use: 'stub:b' }, third: { use: 'stub:c' } },
                },
            },
        }, { relate: o.relate })),
        ai: null,
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: domain },
        promptFpOf: (role) => {
            fpCalls.push(role)
            return FP[role] ?? null
        },
    }
    const ctx = bagCtx(deps, log, { remainingMs: () => Infinity, expired: () => false })
    ctx.stamp = o.stamp === undefined ? STAMP1 : o.stamp
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    const panelItems = (prompt) => prompt.split(/^--- 第(\d+)項 ---$/m).slice(1).reduce((acc, x, i, arr) => (i % 2 === 0 ? [...acc, { index: Number(x), body: arr[i + 1] }] : acc), [])
        .map((b) => {
            const titles = [...b.body.matchAll(/^標題：(.+)$/gm)].map((m) => m[1])
            return { index: b.index, a: titles[0], b: titles[1] }
        })
    const callAI = withCheck(async (prompt, check, co) => {
        if (co?.segment === 'conflictCheck' || co?.segment === 'edgeReview') {
            calls.push({ seg: co.segment, seat: co.seat })
            const pick = co.segment === 'conflictCheck' ? o.check : o.review
            const data = panelItems(prompt).map((it) => ({ index: it.index, ...(pick ? pick(co.seat, it) : { verdict: 'keep', reason: '' }) }))
            return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: providers[co.seat] }
        }
        if (co?.segment === 'reeval') {
            calls.push({ seg: 'reeval', seat: co.seat })
            const items = [...prompt.matchAll(/^--- 第(\d+)項（內容已更新之筆記）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
            const slugs = [...prompt.matchAll(/^ {2}- slug: (\S+)｜/gm)].map((m) => m[1])
            const data = items.map((it) => ({ index: it.index, verdicts: o.reeval ? o.reeval(co.seat, { title: it.title, slugs }) : slugs.map((s) => ({ to: s, verdict: 'keep' })) }))
            return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: providers[co.seat] }
        }
        const seg = co?.segment || 'forward'
        calls.push({ seg })
        const blocks = prompt.split(/^--- 第(\d+)篇（待建立關聯）---$/m).slice(1).reduce((acc, x, i, arr) => (i % 2 === 0 ? [...acc, { index: Number(x), body: arr[i + 1] }] : acc), [])
        const data = blocks.map((b) => {
            const title = b.body.match(/^標題：(.+)$/m)[1]
            const slugs = [...b.body.matchAll(/^ {2}- slug: (\S+)｜/gm)].map((m) => m[1])
            const s = (o.forward || {})[title]
            return { index: b.index, relations: typeof s === 'function' ? s(seg, slugs) : (s || []) }
        })
        return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: providers[seg] }
    })
    const run = () => stageRelate({ callAI }).run(ctx)
    const state = `${dir}/state`
    return {
        ctx, notes, relations, holds, checks, log, calls, fpCalls, providers, run, callAI, dir,
        ccLog: () => readJsonlRows(`${state}/relate-conflict-check.jsonl`),
        erLog: () => readJsonlRows(`${state}/relate-edge-review.jsonl`),
        reevalLog: () => readJsonlRows(`${state}/relate-reeval.jsonl`),
        restoreDeps: { stores: { notes, relations, holds, checks }, dirs: { state, relations: ctx.deps.dirs.relations }, domain, clock },
    }
}

const fresh = (ids) => ids.map((id) => ({ id, relatedAt: '' }))
const done = (ids) => ids.map((id) => ({ id, relatedAt: '2026-01-02T00:00:00+08:00' }))
const ids = (xs) => xs.map((id) => ({ id }))
const edge = (from, to, type = T0, reason = R_OTHER, at = OLD) => makeEdge({ from, to, type, reason, nowIso: at })
const byPair = (map) => (seat, it) => (map[seat] ? map[seat](it) : { verdict: 'keep', reason: '' })
/** 產出者之共同形狀(§2.1):鍵序、結構版本、套件版、寫入時刻之格式 */
const assertShape = (p, expected, msg = '') => {
    assert.deepEqual(Object.keys(p).filter((k) => k !== 'promptFp'), ['v', 'stamp', 'stage', 'seat', 'provider', 'pkg', 'at'], `${msg}鍵序`)
    assert.equal(p.v, 1, `${msg}v`)
    assert.equal(p.pkg, `${PKG.name}@${PKG.version}`, `${msg}pkg＝本套件之 name@version`)
    assert.match(p.at, LOCAL_ISO, `${msg}at 為本地時區 ISO(秒級、帶偏移)`)
    assert.deepEqual({ stamp: p.stamp, stage: p.stage, seat: p.seat, provider: p.provider, promptFp: p.promptFp }, expected, `${msg}`)
}
/** 邊記錄之產出鏈三欄 */
const chainOf = (e) => ({ produced: e.produced, producedHistory: e.producedHistory, producedHistoryDropped: e.producedHistoryDropped })
/** 稽核列之票(seat、provider)是否含產出者之 seat 與 provider(同名同值) */
const voteIn = (rows, p) => rows.some((r) => (r.votes || r.verdicts || []).some((v) => v.seat === p.seat && v.provider === p.provider))

describe('unit-flow-provenance', function() {

    this.timeout(120_000)

    before(() => {
        TMP = tmpRoot('relate-prov')
    })
    after(() => removeRoots([TMP]))

    // ══════════════════ 各段(記憶體集合):每個寫邊點之 stage、seat、provider、promptFp、歷史 ══════════════════
    describe('正向、反向、輪巡(stage 層)', () => {

        it('正向:新建之邊帶產出鏈——stamp＝各段 ctx.stamp、stage relate、seat＝設定路徑 relate.ai、provider＝該批呼叫之 providerId、promptFp＝relate 角色、歷史 1 筆;邊不另加 at、createdAt 保留', async () => {
            const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: T0, reason: R_OTHER }] } })
            await e.run()
            const ed = await e.relations.get(edgeId('n', 'm'))
            assert.ok(ed, '邊已落庫')
            assertShape(ed.produced, { stamp: STAMP1, stage: 'relate', seat: 'relate.ai', provider: 'stub:fwd', promptFp: FP.relate })
            assert.deepEqual(ed.producedHistory, [ed.produced], '歷史最末筆＝produced')
            assert.equal(ed.producedHistoryDropped, 0)
            assert.equal(Object.hasOwn(ed, 'at'), false, '邊不另加 at(produced.at 即寫入時刻)')
            assert.match(ed.createdAt, /^\d{4}-\d{2}-\d{2}T/, '既有之 createdAt 保留')
            assert.deepEqual(e.fpCalls, ['relate'], '指紋以 relate 角色取得')
        })

        it('遞補:provider 取該次呼叫結果之 providerId(遞補者),不是席位之主席(use);providerId 為空(調度層未回成交者)→ 邊照寫、不寫產出鏈', async () => {
            const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: T0, reason: R_OTHER }] }, providers: { forward: 'oc:fallback-x' } })
            await e.run()
            const ed = await e.relations.get(edgeId('n', 'm'))
            assert.equal(ed.produced.provider, 'oc:fallback-x')
            assert.notEqual(ed.produced.provider, e.ctx.deps.settings.relate.ai.use, '席位之主席為 stub:fwd,成交者為遞補者')
            const none = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: T0, reason: R_OTHER }] }, providers: { forward: '' } })
            await none.run()
            const ed2 = await none.relations.get(edgeId('n', 'm'))
            assert.deepEqual([ed2.type, Object.hasOwn(ed2, 'produced'), Object.hasOwn(ed2, 'producedHistory'), Object.hasOwn(ed2, 'producedHistoryDropped')], [T0, false, false, false])
        })

        it('跨輪:新 stamp 之輪升為衝突(可見欄位改變)→ 歷史 +1、produced 換成本輪之 stamp 與成交者;再提案落敗而只入 history(可見欄位不變)→ 產出鏈原樣不追加', async () => {
            const forward = { 標題n: [{ to: 'm', type: T0, reason: R_OTHER }, { to: 'k', type: T0, reason: R_OTHER }] }
            const e = env({ notes: [...fresh(['n']), ...done(['m', 'k'])], forward })
            await e.run()
            const m1 = await e.relations.get(edgeId('n', 'm'))
            const k1 = await e.relations.get(edgeId('n', 'k'))
            assert.deepEqual([m1.produced.stamp, k1.produced.stamp, m1.producedHistory.length], [STAMP1, STAMP1, 1])
            // 第二輪:n 內容變更 → 重判;對 m 提衝突(跨輪只升為衝突:改寫)、對 k 提另一非衝突型(落敗:入 history)
            e.ctx.stamp = STAMP2
            e.providers.forward = 'stub:fwd2'
            forward.標題n = [{ to: 'm', type: C, reason: R_CONFLICT }, { to: 'k', type: T1, reason: R_NEW }]
            await e.notes.patch('n', { knowledgeChangedAt: '2026-02-01T00:00:00+08:00' })
            const r2 = await e.run()
            assert.equal(r2.detail.reTargets, 1, '前提:n 為內容變更之重判')
            const m2 = await e.relations.get(edgeId('n', 'm'))
            const k2 = await e.relations.get(edgeId('n', 'k'))
            assert.equal(m2.type, C, '前提:m 升為衝突(可見欄位改變)')
            assertShape(m2.produced, { stamp: STAMP2, stage: 'relate', seat: 'relate.ai', provider: 'stub:fwd2', promptFp: FP.relate })
            assert.deepEqual([m2.producedHistory.length, m2.producedHistory[0].stamp, m2.producedHistory[1].stamp], [2, STAMP1, STAMP2], '歷史 +1(舊→新)')
            assert.equal(k2.type, T0, '前提:k 之型別不變(再提案落敗)')
            assert.equal(k2.history.length, 1, '前提:落敗之提案入 history')
            assert.deepEqual(chainOf(k2), chainOf(k1), '可見欄位未變:產出鏈一字不動(撤回某輪之邊不會誤傷只是被再提案之舊邊)')
        })

        it('反向:stage reverse、seat＝實際使用之設定路徑(未設 relate.reverse.ai 即 relate.ai)、provider＝反向批之成交者;設了 relate.reverse.ai → seat relate.reverse.ai', async () => {
            const notes = [
                { id: 'n', title: '新', concepts: ['p', 's', 't'], createdAt: '2026-02-01T00:00:00+08:00', relatedAt: '' },
                { id: 'g1', concepts: ['s', 't', 'u'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
                { id: 'g2', concepts: ['s', 't', 'v'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
                { id: 'o1', title: '舊一', concepts: ['p', 'q'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
            ]
            const forward = { 舊一: (seg) => (seg === 'reverse' ? [{ to: 'n', type: T1, reason: '舊一之風險模型延伸到新筆記之訊號' }] : []) }
            const e = env({ notes, forward, relate: { candidatesPerNote: 2, reverse: { perRun: 4 } } })
            await e.run()
            const ed = await e.relations.get(edgeId('o1', 'n'))
            assert.ok(ed, '前提:反向段落邊')
            assertShape(ed.produced, { stamp: STAMP1, stage: 'reverse', seat: 'relate.ai', provider: 'stub:rev', promptFp: FP.relate })
            const e2 = env({ notes, forward, relate: { candidatesPerNote: 2, reverse: { perRun: 4, ai: { use: 'stub:rev' } } } })
            await e2.run()
            assert.equal((await e2.relations.get(edgeId('o1', 'n'))).produced.seat, 'relate.reverse.ai')
        })

        it('輪巡:規格未列,記為 relate(輪巡為正向提示詞比對候選之後段);seat 同反向之沿用規則、provider＝輪巡批之成交者', async () => {
            const notes = ['a', 'b', 'c', 'd', 'f'].map((id, i) => ({ id, createdAt: `2026-01-0${i + 1}` }))
            const forward = { 標題a: (seg, slugs) => (seg === 'rotation' && slugs.includes('d') ? [{ to: 'd', type: T0, reason: R_OTHER }] : []) }
            const e = env({ notes, forward, relate: { candidatesPerNote: 2, rotation: { perRun: 1 } } })
            await e.run()
            const ed = await e.relations.get(edgeId('a', 'd'))
            assert.ok(ed, '前提:輪巡段落邊')
            assertShape(ed.produced, { stamp: STAMP1, stage: 'relate', seat: 'relate.ai', provider: 'stub:rot', promptFp: FP.relate })
        })
    })

    describe('判定小組之改寫(衝突核對、既有邊覆核、重評)', () => {

        it('衝突核對:新提案原樣落地(keep)→ stage conflict-check、seat proposer、provider＝提案之成交者(與稽核列 votes 之 proposer 列同名同值)、promptFp＝relate(提案來自正向提示詞)', async () => {
            const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] }, relate: { standards: { conflictCheck: { enabled: true } } } })
            await e.run()
            const ed = await e.relations.get(edgeId('n', 'm'))
            assert.equal(ed.type, C)
            assertShape(ed.produced, { stamp: STAMP1, stage: 'conflict-check', seat: 'proposer', provider: 'stub:fwd', promptFp: FP.relate })
            assert.equal(ed.producedHistory.length, 1)
            assert.ok(voteIn(e.ccLog(), ed.produced), `稽核列之票:${JSON.stringify(e.ccLog().map((r) => r.votes))}`)
        })

        it('衝突核對:核對席改寫理由(reason)而新建 → seat／provider＝被採用之那一票(first／stub:a),與稽核列 votes 同名同值;promptFp＝conflict-check', async () => {
            const e = env({
                notes: [...fresh(['n']), ...done(['m'])],
                forward: { 標題n: [{ to: 'm', type: C, reason: '兩篇對動量之看法不同，可互相參照' }] },
                relate: { standards: { conflictCheck: { enabled: true } } },
                check: byPair({ first: () => ({ verdict: 'change', type: C, reason: R_FIX }), third: () => ({ verdict: 'change', type: C, reason: R_FIX }) }),
            })
            await e.run()
            const ed = await e.relations.get(edgeId('n', 'm'))
            assert.deepEqual([ed.type, ed.reason], [C, R_FIX], '前提:以核對席之新理由落地')
            assertShape(ed.produced, { stamp: STAMP1, stage: 'conflict-check', seat: 'first', provider: 'stub:a', promptFp: FP['conflict-check'] })
            assert.ok(voteIn(e.ccLog(), ed.produced))
        })

        it('衝突核對:既有衝突邊改寫(兩席皆判真衝突、第一席之改寫理由過不了納入閘、第二席之合格)→ 採用第二票(second／stub:b),歷史 +1(舊 1 筆 → 2 筆);稽核列同名同值', async () => {
            const e0 = seeded(edge('a', 'b', C, R_CONFLICT))
            const hold = { id: holdKey('edge', e0.id, 'RS4'), object: 'edge', oid: e0.id, std: 'RS4', status: 'open', owner: 'pipeline', reason: '提煉判為非對立', next: '關聯段兩席核對', since: OLD, at: OLD, tries: 0, ctx: { from: 'a', to: 'b', core: 'x' } }
            const e = env({
                notes: ids(['a', 'b']), edges: [e0], holds: [hold],
                relate: { standards: { conflictCheck: { enabled: true } } },
                check: byPair({ first: () => ({ verdict: 'change', type: C, reason: R_BAD }), second: () => ({ verdict: 'change', type: C, reason: R_FIX }) }),
            })
            await e.run()
            const cur = await e.relations.get(e0.id)
            assert.equal(cur.reason, R_FIX, '前提:改寫為第二票之理由')
            assertShape(cur.produced, { stamp: STAMP1, stage: 'conflict-check', seat: 'second', provider: 'stub:b', promptFp: FP['conflict-check'] })
            assert.deepEqual([cur.producedHistory.length, cur.producedHistory[0].provider, cur.producedHistory[1].provider], [2, 'old:p', 'stub:b'])
            assert.ok(voteIn(e.ccLog(), cur.produced))
        })

        it('既有邊覆核:改寫理由／改型 → stage edge-review、seat／provider＝被採用之票(第一席之理由不過閘則取第二票)、歷史 +1;與稽核列 votes 同名同值;無改寫(keep)者不寫', async () => {
            const e1 = seeded(edge('a', 'b')) // 兩席同改理由 → 採第一票
            const e2 = seeded(edge('c', 'd', T1)) // 第一席之理由過不了納入閘 → 採第二票
            const e3 = seeded(edge('e', 'f')) // 兩席 keep:不改寫
            const review = (seat, it) => (it.a === '標題a' ? { verdict: 'change', type: T0, reason: R_NEW }
                : it.a === '標題c' ? { verdict: 'change', type: T1, reason: seat === 'first' ? R_BAD : R_NEW }
                    : { verdict: 'keep', reason: '' })
            const e = env({ notes: ids(['a', 'b', 'c', 'd', 'e', 'f']), edges: [e1, e2, e3], review, relate: { standards: { edgeReview: { enabled: true, perRun: 10 } } } })
            await e.run()
            const [n1, n2, n3] = await Promise.all([e1, e2, e3].map((x) => e.relations.get(x.id)))
            assert.deepEqual([n1.reason, n2.reason], [R_NEW, R_NEW], '前提:兩條皆改寫')
            assertShape(n1.produced, { stamp: STAMP1, stage: 'edge-review', seat: 'first', provider: 'stub:a', promptFp: FP['edge-review'] }, 'e1 ')
            assertShape(n2.produced, { stamp: STAMP1, stage: 'edge-review', seat: 'second', provider: 'stub:b', promptFp: FP['edge-review'] }, 'e2 ')
            assert.deepEqual([n1.producedHistory.length, n2.producedHistory.length], [2, 2], '歷史 +1')
            assert.ok(voteIn(e.erLog().filter((r) => r.edgeId === e1.id), n1.produced) && voteIn(e.erLog().filter((r) => r.edgeId === e2.id), n2.produced), '稽核列同名同值')
            assert.deepEqual(chainOf(n3), chainOf(e3), 'keep:邊不改寫、產出鏈一字不動')
        })

        it('重評(閘門 all):改型、升為衝突、降級之改寫 → stage reeval、seat／provider＝被採用之票(first／stub:a)、promptFp＝reeval、歷史 +1;撤銷之邊無寫入;與重評帳 verdicts 同名同值', async () => {
            const E = (from, to, type) => seeded(edge(from, to, type, `${from}與${to}之舊關聯：共用同一組參數`))
            const plan = { 甲: { verdict: 'retire', reason: '新內容已轉為匯率主題，與甲無共同機制' }, 乙: { verdict: 'change', type: T0, reason: '兩篇結論已一致，改為互補之前提關係' }, 丙: { verdict: 'change', type: C, reason: '變更篇說動量持續，丙說動量崩潰，結論相反' } }
            const e = env({
                notes: [{ id: 'n', title: '變更篇', knowledgeChangedAt: '2026-02-01T00:00:00+08:00' }, ...[['a', '甲'], ['b', '乙'], ['c', '丙']].map(([id, title]) => ({ id, title }))],
                edges: [E('n', 'a', T0), E('b', 'n', C), E('n', 'c', T0)],
                relate: { reeval: { perRun: 6, apply: 'all', ai: { second: { use: 'stub:b' } } } },
                reeval: (seat, item) => item.slugs.map((s) => ({ to: s, ...(plan[{ a: '甲', b: '乙', c: '丙' }[s]] || { verdict: 'keep' }) })),
            })
            await e.run()
            const edges = await e.relations.select()
            const down = edges.find((x) => x.id === edgeId('n', 'b'))
            const up = edges.find((x) => x.id === edgeId('n', 'c'))
            assert.deepEqual([down.type, up.type, edges.some((x) => x.id === edgeId('n', 'a'))], [T0, C, false], '前提:乙降級、丙升級、甲撤銷')
            for (const x of [down, up]) {
                assertShape(x.produced, { stamp: STAMP1, stage: 'reeval', seat: 'first', provider: 'stub:a', promptFp: FP.reeval }, `${x.id.slice(0, 6)} `)
                assert.deepEqual([x.producedHistory.length, x.producedHistory[0].provider], [2, 'old:p'], '歷史 +1')
                assert.ok(voteIn(e.reevalLog().filter((r) => r.edgeId === x.id), x.produced), '重評帳 verdicts 同名同值')
            }
        })
    })

    describe('重評之第二票、撤回之維運', () => {

        it('重評:第一席之改寫理由過不了納入閘、第二席之合格 → 採用第二票(seat second／provider stub:b);重評帳 verdicts 同名同值', async () => {
            const e0 = seeded(edge('n', 'b', T0, 'n與b之舊關聯：共用同一組參數'))
            const e = env({
                notes: [{ id: 'n', title: '變更篇', knowledgeChangedAt: '2026-02-01T00:00:00+08:00' }, { id: 'b', title: '乙' }],
                edges: [e0],
                relate: { reeval: { perRun: 6, apply: 'all', ai: { second: { use: 'stub:b' } } } },
                reeval: (seat, item) => item.slugs.map((s) => ({ to: s, verdict: 'change', type: T1, reason: seat === 'first' ? R_BAD : '兩篇結論已一致，改為互補之前提關係' })),
            })
            await e.run()
            const cur = await e.relations.get(e0.id)
            assert.deepEqual([cur.type, cur.reason], [T1, '兩篇結論已一致，改為互補之前提關係'], '前提:以第二票之理由改寫')
            assertShape(cur.produced, { stamp: STAMP1, stage: 'reeval', seat: 'second', provider: 'stub:b', promptFp: FP.reeval })
            assert.ok(voteIn(e.reevalLog().filter((r) => r.edgeId === e0.id), cur.produced))
        })

    })

    // ══════════ 撤回判定小組之改寫(revertEdgeRevision;三段帳):撤銷該次改寫所留之產出鏈,不追加 ══════════
    // 規格句:produced＝現行可見內容之產出者(撤回後可見內容為改寫前之值,其產出者為改寫前之那一筆)
    describe('revertEdgeRevision:撤回＝撤銷該次改寫所留之產出鏈(三段帳)', () => {

        const NEW_REASON = '兩篇結論已一致，改為互補之前提關係'
        /** 三段帳各一情境:改寫一條邊(seed:改寫前已帶一筆產出鏈)。回傳 { e, e0, id, ledger(帳檔名), stage, writer(改寫者 provider), restoreDeps } */
        const SCEN = {
            cc: ({ seed }) => {
                const e0 = (seed ? seeded : (x) => x)(edge('a', 'b', C, R_CONFLICT))
                const hold = { id: holdKey('edge', e0.id, 'RS4'), object: 'edge', oid: e0.id, std: 'RS4', status: 'open', owner: 'pipeline', reason: '提煉判為非對立', next: '關聯段兩席核對', since: OLD, at: OLD, tries: 0, ctx: { from: 'a', to: 'b', core: 'x' } }
                const e = env({
                    notes: ids(['a', 'b']), edges: [e0], holds: [hold], relate: { standards: { conflictCheck: { enabled: true } } },
                    check: byPair({ first: () => ({ verdict: 'change', type: C, reason: R_FIX }), second: () => ({ verdict: 'change', type: C, reason: R_FIX }) }),
                })
                return { e, e0, ledger: 'relate-conflict-check.jsonl', stage: 'conflict-check', writer: 'stub:a', after: { reason: R_FIX } }
            },
            er: ({ seed }) => {
                const e0 = (seed ? seeded : (x) => x)(edge('a', 'b', T0, R_OTHER))
                const e = env({
                    notes: ids(['a', 'b']), edges: [e0], relate: { standards: { edgeReview: { enabled: true, perRun: 10 } } },
                    review: () => ({ verdict: 'change', type: T0, reason: R_NEW }),
                })
                return { e, e0, ledger: 'relate-edge-review.jsonl', stage: 'edge-review', writer: 'stub:a', after: { reason: R_NEW } }
            },
            reeval: ({ seed }) => {
                const e0 = (seed ? seeded : (x) => x)(edge('n', 'b', T0, 'n與b之舊關聯：共用同一組參數'))
                const e = env({
                    notes: [{ id: 'n', title: '變更篇', knowledgeChangedAt: '2026-02-01T00:00:00+08:00' }, { id: 'b', title: '乙' }], edges: [e0],
                    relate: { reeval: { perRun: 6, apply: 'all', ai: { second: { use: 'stub:b' } } } },
                    reeval: (seat, item) => item.slugs.map((s) => ({ to: s, verdict: 'change', type: T1, reason: NEW_REASON })),
                })
                return { e, e0, ledger: 'relate-reeval.jsonl', stage: 'reeval', writer: 'stub:a', after: { type: T1, reason: NEW_REASON } }
            },
        }
        const fileOf = (s) => `${s.e.dir}/state/${s.ledger}`
        const rowsOf = (s) => readJsonlRows(fileOf(s))
        /** 舊帳列之模擬:把帳檔各列 edge 之產出鏈三欄拿掉(本版本以前之列無此欄) */
        const stripChain = (s) => {
            const rows = rowsOf(s).map((r) => {
                const { produced, producedHistory, producedHistoryDropped, ...rest } = r.edge || {}
                return { ...r, edge: rest }
            })
            fs.writeFileSync(fileOf(s), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)
        }
        const prov = (s, q) => edgesByProvenance({ stores: { relations: s.e.relations } }, q).then((r) => r.map((x) => x.edgeId))
        /** 跑一輪使邊被改寫,回傳改寫後之邊 */
        const rewritten = async (s) => {
            await s.e.run()
            const mid = await s.e.relations.get(s.e0.id)
            for (const [k, v] of Object.entries(s.after)) assert.equal(mid[k], v, `前提:已被判定小組改寫(${k})`)
            return mid
        }
        const revert = (s, apply = true) => revertEdgeRevision(s.e.restoreDeps, s.e0.id, { apply })

        for (const k of ['cc', 'er', 'reeval']) {

            it(`${k} 帳(改寫前帶產出鏈):撤回後 produced＝改寫前之那一筆、producedHistory 少該次改寫之一筆(三欄同改寫前);不追加新紀錄;edgesByProvenance 以改寫前之成交者取得、以被撤回之成交者(含 history)取不到;稽核之改寫列 edge 帶改寫前之三欄、reverted 列帶 producedUndo`, async () => {
                const s = SCEN[k]({ seed: true })
                const mid = await rewritten(s)
                assert.deepEqual([mid.produced.stage, mid.produced.provider, mid.producedHistory.length], [s.stage, s.writer, 2], '前提:改寫追加了一筆')
                assert.deepEqual(await prov(s, { provider: s.writer }), [s.e0.id], '前提:撤回前以改寫者取得')
                const row = rowsOf(s).find((r) => r.edgeId === s.e0.id && r.written)
                assert.deepEqual(chainOf(row.edge), chainOf(s.e0), '改寫列 edge 帶改寫前之產出鏈三欄')
                const r = await revert(s)
                assert.equal(r.applied, true, JSON.stringify(r))
                assert.deepEqual(r.producedUndo, { done: true, how: 'row' })
                const back = await s.e.relations.get(s.e0.id)
                assert.deepEqual([back.type, back.reason], [s.e0.type, s.e0.reason], '前提:可見內容回到改寫前')
                assert.deepEqual(chainOf(back), chainOf(s.e0), '產出鏈三欄＝改寫前(未追加「無人產出」之紀錄)')
                assert.deepEqual(await prov(s, { provider: 'old:p' }), [s.e0.id], '以改寫前之成交者取得該邊')
                assert.deepEqual(await prov(s, { provider: s.writer }), [], '以被撤回之成交者取不到')
                assert.deepEqual(await prov(s, { provider: s.writer, history: true }), [], '歷史亦無被撤回之紀錄')
                assert.deepEqual(await prov(s, { provider: null }), [], '亦無 null／null 之追加紀錄')
                const rev = rowsOf(s).find((x) => x.outcome === 'reverted')
                assert.deepEqual(rev.producedUndo, { done: true, how: 'row' }, '稽核之 reverted 列帶 producedUndo(新增欄位)')
            })

            it(`${k} 帳(改寫前無產出鏈之邊):撤回後三欄皆無(退回「舊邊」之狀態);列無三欄 → 由現行邊判(how history);舊邊不出現在選件結果`, async () => {
                const s = SCEN[k]({ seed: false })
                const mid = await rewritten(s)
                assert.deepEqual([mid.produced.stage, mid.producedHistory.length], [s.stage, 1], '前提:舊邊經改寫而有一筆產出鏈')
                const row = rowsOf(s).find((r) => r.edgeId === s.e0.id && r.written)
                assert.deepEqual(chainOf(row.edge), { produced: undefined, producedHistory: undefined, producedHistoryDropped: undefined }, '前提:改寫前無產出鏈者列不帶三欄')
                const r = await revert(s)
                assert.equal(r.applied, true, JSON.stringify(r))
                assert.deepEqual(r.producedUndo, { done: true, how: 'history' })
                const back = await s.e.relations.get(s.e0.id)
                assert.deepEqual([Object.hasOwn(back, 'produced'), Object.hasOwn(back, 'producedHistory'), Object.hasOwn(back, 'producedHistoryDropped')], [false, false, false])
                assert.deepEqual([back.type, back.reason], [s.e0.type, s.e0.reason], '前提:可見內容回到改寫前')
                assert.deepEqual(await prov(s), [], '舊邊不出現')
            })

            it(`${k} 帳(舊帳列:列之 edge 無產出鏈三欄,改寫前帶一筆):依現行邊判而退一筆(how history);結果同新帳列`, async () => {
                const s = SCEN[k]({ seed: true })
                await rewritten(s)
                stripChain(s)
                const r = await revert(s)
                assert.equal(r.applied, true, JSON.stringify(r))
                assert.deepEqual(r.producedUndo, { done: true, how: 'history' })
                assert.deepEqual(chainOf(await s.e.relations.get(s.e0.id)), chainOf(s.e0), '退一筆:produced＝改寫前之那一筆、歷史少一筆')
            })
        }

        it('舊帳列而判不了者不動產出鏈、撤回照做,回傳帶可辨識之原因字樣:現行 produced 之階段非該段(stage-mismatch)、寫入時刻晚於該列(newer-than-row)、非歷史末筆(history-mismatch)、時刻不可解析(at-unverifiable);預演亦帶、不寫', async () => {
            const cases = [
                ['stage-mismatch', (p) => ({ ...p, stage: 'relate' })],
                ['newer-than-row', (p) => ({ ...p, at: '2099-01-01T00:00:00+08:00' })],
                ['at-unverifiable', (p) => ({ ...p, at: 'T1' })],
            ]
            for (const [why, tweak] of cases) {
                const s = SCEN.cc({ seed: true })
                const mid = await rewritten(s)
                const p = tweak(mid.produced)
                await s.e.relations.patch(s.e0.id, { produced: p, producedHistory: [...mid.producedHistory.slice(0, -1), p] })
                stripChain(s)
                const before = chainOf(await s.e.relations.get(s.e0.id))
                const dry = await revert(s, false)
                assert.deepEqual([dry.revertible, dry.applied, dry.producedUndo], [true, false, { done: false, how: 'none', why }], `預演:${why}`)
                assert.deepEqual(chainOf(await s.e.relations.get(s.e0.id)), before, '預演不寫')
                const r = await revert(s)
                assert.deepEqual([r.applied, r.producedUndo], [true, { done: false, how: 'none', why }], why)
                const back = await s.e.relations.get(s.e0.id)
                assert.equal(back.reason, R_CONFLICT, `${why}:撤回照做(可見內容回到改寫前)`)
                assert.deepEqual(chainOf(back), before, `${why}:產出鏈不動`)
                assert.equal(rowsOf(s).find((x) => x.outcome === 'reverted').producedUndo.why, why, 'reverted 列帶原因字樣')
            }
            const s = SCEN.cc({ seed: true })
            const mid = await rewritten(s)
            await s.e.relations.patch(s.e0.id, { producedHistory: [{ ...mid.produced, provider: 'other' }] })
            stripChain(s)
            assert.equal((await revert(s, false)).producedUndo.why, 'history-mismatch')
        })

        it('邊無產出鏈且列亦無(未帶產出者之改寫,如成交者空字串不寫):無須動(how none、done true);撤回後仍無', async () => {
            // 模擬「改寫而未留產出鏈」:不跑管線,直接改邊並手寫一列改寫列(列之 edge 無三欄)
            const s = SCEN.er({ seed: false })
            const e0 = s.e0
            await s.e.relations.patch(e0.id, { reason: R_NEW, updatedAt: '2026-11-08T22:00:00+08:00' })
            fs.mkdirSync(`${s.e.dir}/state`, { recursive: true })
            fs.writeFileSync(fileOf(s), `${JSON.stringify({ at: '2026-11-08T22:00:00+08:00', entry: 'stock', edgeId: e0.id, edge: { from: e0.from, to: e0.to, type: e0.type, reason: e0.reason }, votes: [], outcome: 'reason', written: { type: e0.type, reason: R_NEW } })}\n`)
            const r = await revert(s)
            assert.equal(r.applied, true, JSON.stringify(r))
            assert.deepEqual(r.producedUndo, { done: true, how: 'none' })
            const back = await s.e.relations.get(e0.id)
            assert.deepEqual([back.reason, Object.hasOwn(back, 'produced')], [R_OTHER, false])
        })
    })

    describe('標準修正(不呼叫 AI)與維運件', () => {

        it('型別改名之機械改寫(開工前維護):stage standards-fix、seat 與 provider 同時 null、stamp＝本輪、無 promptFp;updatedAt 不動、歷史 +1', async () => {
            const domain = createRelateDomain({ vocab: { relationTypeRenames: { 舊互補搭配: '互補搭配' } } })
            const e0 = seeded({ ...edge('a', 'b', '舊互補搭配', R_OTHER), updatedAt: OLD })
            const e = env({ notes: ids(['a', 'b']), edges: [e0], domain })
            await e.run()
            const cur = await e.relations.get(e0.id)
            assert.equal(cur.type, '互補搭配', '前提:已改名')
            assertShape(cur.produced, { stamp: STAMP1, stage: 'standards-fix', seat: null, provider: null, promptFp: undefined })
            assert.deepEqual([cur.updatedAt, cur.producedHistory.length], [OLD, 2])
            assert.equal(e.fpCalls.includes('relate'), false, '不呼叫 AI 者不取指紋')
        })

        it('存量處置(RS3 確定性修正):stage standards-fix、seat 與 provider 同時 null、stamp null(輪次外);處置帳 after 為帶產出鏈之邊值;回退全數還原(含產出鏈:撤銷該次處置之效果)', async () => {
            const dir = `${TMP}/stock${++seq}`
            writeMd(`${dir}/notes/n1.md`, { title: '標題n1', slug: 'n1' }, '# 標題n1\n\n## 一句話重點\n\n軌道之量測\n\n## 核心知識\n\n- 軌道之量測方法\n')
            const eA = seeded({ ...edge('n1', 'n2', '互補搭配', '两篇都讨论轨道之量测方法', '2026-10-01T00:00:00+08:00') })
            const notes = memStore(['n1', 'n2'].map((id) => ({ id, title: `標題${id}`, concepts: ['軌道'], category: 'c', file: `${dir}/notes/${id}.md`, createdAt: OLD, relatedAt: OLD })))
            const relations = memStore([eA])
            const deps = { stores: { notes, relations }, dirs: { state: `${dir}/state` }, clock, domain: DOMAIN }
            const AT = '2026-10-08T04:00:00+08:00'
            const plan = await planEdgeStockFix(deps, { at: AT, stds: ['RS3'] })
            assert.equal(plan.items.length, 1, '前提:RS3 一件')
            const r = await applyEdgeStockFix(deps, plan, { at: AT })
            assert.equal(r.errors.length, 0, JSON.stringify(r.errors))
            const fixed = await relations.get(eA.id)
            assert.equal(fixed.reason, '兩篇都討論軌道之量測方法', '前提:已轉正體')
            assertShape(fixed.produced, { stamp: null, stage: 'standards-fix', seat: null, provider: null, promptFp: undefined })
            assert.equal(fixed.produced.at, AT, '寫入時刻同處置帳之 at')
            assert.deepEqual([fixed.producedHistory.length, fixed.producedHistory[0].provider], [2, 'old:p'])
            const ledger = `${dir}/state/${STOCK_LEDGER_FILE}`
            const rows = readEdgeStockLedger(ledger)
            assert.deepEqual(rows[0].after.edge.produced, fixed.produced, '帳列 after 為寫入之邊值')
            const rb = await rollbackEdgeStockFix(deps, rows, { at: '2026-10-08T05:00:00+08:00' })
            assert.equal(rb.restored, 1)
            assert.deepEqual(await relations.get(eA.id), eA, '回退全數還原:邊與處置前逐欄相同(產出鏈隨之撤銷,回退不是新的產出)')
        })

        it('舊邊(無產出鏈)經存量處置 → 帶一筆 standards-fix;回退 → 產出鏈三欄移除(舊邊仍是舊邊)', async () => {
            const dir = `${TMP}/stock${++seq}`
            writeMd(`${dir}/notes/n1.md`, { title: '標題n1', slug: 'n1' }, '# 標題n1\n\n## 一句話重點\n\n軌道之量測\n')
            const eA = edge('n1', 'n2', '互補搭配', '两篇都讨论轨道之量测方法', '2026-10-01T00:00:00+08:00')
            const notes = memStore(['n1', 'n2'].map((id) => ({ id, title: `標題${id}`, concepts: ['軌道'], category: 'c', file: `${dir}/notes/${id}.md`, createdAt: OLD, relatedAt: OLD })))
            const relations = memStore([eA])
            const deps = { stores: { notes, relations }, dirs: { state: `${dir}/state` }, clock, domain: DOMAIN }
            const AT = '2026-10-08T04:00:00+08:00'
            await applyEdgeStockFix(deps, await planEdgeStockFix(deps, { at: AT, stds: ['RS3'] }), { at: AT })
            const fixed = await relations.get(eA.id)
            assert.deepEqual([fixed.producedHistory.length, fixed.produced.stage], [1, 'standards-fix'])
            await rollbackEdgeStockFix(deps, readEdgeStockLedger(`${dir}/state/${STOCK_LEDGER_FILE}`), { at: '2026-10-08T05:00:00+08:00' })
            const back = await relations.get(eA.id)
            assert.deepEqual([Object.hasOwn(back, 'produced'), Object.hasOwn(back, 'producedHistory'), Object.hasOwn(back, 'producedHistoryDropped')], [false, false, false])
            assert.deepEqual(back, eA)
        })

        it('undoDeleteNote／restoreNote(刪除後之撤銷與還原):原樣放回之邊帶撤出前之產出鏈(不追加);型別改名之機械改寫、納入閘之確定性修正(簡體轉正體)為標準修正 → 追加 standards-fix(seat 與 provider 同時 null)', async () => {
            const mkEnv = (extra = []) => {
                const dir = `${TMP}/del${++seq}`
                const mk = (id) => {
                    const file = `${dir}/notes/${id}.md`
                    writeMd(file, { title: `標題${id}`, slug: id }, `# 標題${id}\n\n## 一句話重點\n\n${id} 之重點\n\n## 核心知識\n\n- ${id} 要點`)
                    return { id, title: `標題${id}`, concepts: ['p'], category: 'c', createdAt: '2026-01-01', relatedAt: '2026-01-02', file }
                }
                const ab = seeded(edge('a', 'b', T0, R_OTHER))
                const rest = extra.map((x) => seeded(x))
                const notes = memStore(['a', 'b', 'd'].map(mk))
                const relations = memStore([ab, ...rest])
                return { ab, rest, notes, relations, deps: { stores: { notes, relations }, dirs: { state: `${dir}/state` }, clock, log: recLog(), domain: DOMAIN } }
            }
            // undoDeleteNote:型別改名
            const RN = createRelateDomain({ vocab: { relationTypeRenames: { 舊互補搭配: '互補搭配' } } })
            const u = mkEnv([edge('a', 'd', '舊互補搭配', R_OTHER)])
            await deleteNote(u.deps, 'a', { reason: '測試刪除', project: false })
            assert.equal((await u.relations.select()).length, 0, '前提:刪除後邊皆撤出')
            await undoDeleteNote({ ...u.deps, domain: RN }, 'a', { project: false })
            const ab = await u.relations.get(u.ab.id)
            const ad = await u.relations.get(u.rest[0].id)
            assert.deepEqual(chainOf(ab), chainOf(u.ab), '原樣放回:產出鏈同撤出前')
            assert.equal(ad.type, '互補搭配', '前提:改名')
            assert.deepEqual([ad.produced.stage, ad.produced.seat, ad.produced.provider, ad.produced.stamp, ad.producedHistory.length], ['standards-fix', null, null, null, 2])
            // restoreNote:納入閘之確定性修正(簡體理由轉正體)
            const s = mkEnv([edge('a', 'd', T0, '两篇都讨论波动度之调整方法与其误差来源')])
            await deleteNote(s.deps, 'a', { reason: '測試刪除', project: false })
            await restoreNote(s.deps, 'a', { project: false })
            const sab = await s.relations.get(s.ab.id)
            const sad = await s.relations.get(s.rest[0].id)
            assert.deepEqual(chainOf(sab), chainOf(s.ab), '無修正者原樣放回:產出鏈同撤出前')
            assert.equal(sad.reason, '兩篇都討論波動度之調整方法與其誤差來源', '前提:簡體轉正體')
            assert.deepEqual([sad.produced.stage, sad.produced.seat, sad.produced.provider, sad.producedHistory.length], ['standards-fix', null, null, 2])
        })

        it('restoreEdge:撤出理由 reprocess(使用端選件後重處理)可依稽核還原;原樣還原者帶撤出前之產出鏈(不追加);使用者給新理由者追加 standards-fix', async () => {
            const e0 = seeded(edge('a', 'b'))
            const e = env({ notes: ids(['a', 'b']), edges: [e0] })
            const ledgers = openRelateLedgers(e.restoreDeps.dirs.state)
            await retireEdge({ relations: e.relations, ledgers, stateDir: e.restoreDeps.dirs.state }, e0, { reason: 'reprocess', at: '2026-11-08T22:30:00+08:00', detail: '依產出鏈選件重處理' })
            assert.equal(await e.relations.get(e0.id), null, '前提:已撤出')
            const r = await restoreEdge(e.restoreDeps, e0.id, { apply: true })
            assert.deepEqual([r.restorable, r.applied], [true, true], JSON.stringify(r))
            const back = await e.relations.get(e0.id)
            assert.deepEqual(chainOf(back), chainOf(e0), '原樣還原:產出鏈同撤出前')
            // 使用者給新理由:邊值已非當時產出者所出
            const e1 = seeded(edge('c', 'd'))
            const f = env({ notes: ids(['c', 'd']), edges: [e1] })
            const ledgers2 = openRelateLedgers(f.restoreDeps.dirs.state)
            await retireEdge({ relations: f.relations, ledgers: ledgers2, stateDir: f.restoreDeps.dirs.state }, e1, { reason: 'reprocess', at: '2026-11-08T22:30:00+08:00' })
            const r2 = await restoreEdge(f.restoreDeps, e1.id, { apply: true, reason: R_NEW })
            assert.equal(r2.applied, true, JSON.stringify(r2))
            const back2 = await f.relations.get(e1.id)
            assert.deepEqual([back2.reason, back2.produced.stage, back2.produced.seat, back2.produced.provider, back2.producedHistory.length], [R_NEW, 'standards-fix', null, null, 2])
        })
    })

    // ══════════════════ 整輪流程(總組裝、真 LMDB、替身 AI):stamp 等於 run.json、provider 為遞補者、指紋為評比機制之值、graph.json ══════════════════
    describe('總組裝(真 LMDB)', () => {

        let root = ''
        let rep = null
        let flow = null
        let edges = []
        const REASON_AB = '兩篇皆以三角視差法量測恆星距離並討論其誤差來源'
        const REASON_CA = '甲說星等與距離無關；乙說視差誤差主導距離之估計'
        const FALLBACK = 'oc:fallback-model'

        before(async () => {
            root = tmpRoot('flow-prov')
            const notesDir = `${root}/knowledge/notes`
            const a = landNote(notesDir, { doc: 'a', title: '恆星視差之量測', concepts: ['視差', '觀測誤差'] })
            const b = landNote(notesDir, { doc: 'b', title: '視差誤差之修正', concepts: ['視差', '觀測誤差'] })
            const c = landNote(notesDir, { doc: 'c', title: '星等之定義', concepts: ['星等', '觀測誤差'] })
            const base = scriptedAi((role, prompt, o, items) => (role === 'relate'
                ? relateAnswer(items, { 恆星視差之量測: [{ to: '視差誤差之修正', type: T0, reason: REASON_AB }], 星等之定義: [{ to: '恆星視差之量測', type: C, reason: REASON_CA }] })
                : undefined))
            // 遞補:調度層回傳之成交者(providerId)為遞補條目,不是席位之主席(spec.use)
            const ai = { ...base, callJson: async (...args) => {
                const r = await base.callJson(...args)
                return r?.ok ? { ...r, providerId: FALLBACK } : r
            } }
            ;({ flow } = buildTestRelate(root, { aiAdapter: ai, scheduleLimitMin: 55 }))
            await seedNotes(flow, [a, b, c])
            rep = await flow.run()
            edges = await withStores(flow, (s) => s.relations.select())
        })
        after(() => {
            resetConceptFold()
            removeRoots([root])
        })

        it('一輪關聯(假 AI)後,新邊皆有產出鏈:stamp＝該輪 run.json 之 stamp、provider＝遞補者之 providerId、seat＝relate.ai、promptFp＝評比機制(relate 角色)之現行指紋、歷史 1 筆', () => {
            const run = readJsonFile(rep.summaryFile)
            assert.match(run.stamp, /^\d{14}$/, '前提:run.json 帶 14 碼 stamp')
            assert.equal(edges.length, 2)
            const fp = planRelateBench('relate', { vocab: flow.info().vocab }).promptFp
            assert.match(fp, /^[0-9a-f]{16}$/, '前提:relate 角色有指紋(內建題組)')
            for (const e of edges) {
                assertShape(e.produced, { stamp: run.stamp, stage: 'relate', seat: 'relate.ai', provider: FALLBACK, promptFp: fp }, `${e.type} `)
                assert.deepEqual([e.producedHistory.length, e.producedHistoryDropped, Object.hasOwn(e, 'at')], [1, 0, false])
            }
        })

        it('真 LMDB 之 patch 合併不刪鍵:produced 之鍵集縮減(promptFp 消失)與歷史滿 50 筆後輪替(陣列依索引合併)→ writeEdge 回讀不符而走 replace,終值正確、邊不遺失;歷史上限 50、捨去數累計', async () => {
            const dirs = flow.info().dirs
            const ledgers = openRelateLedgers(dirs.state)
            const target = edges.find((e) => e.type === T0)
            assert.match(target.produced.promptFp, /^[0-9a-f]{16}$/, '前提:既有產出者帶 promptFp')
            const mkP = (i) => ({ v: 1, stamp: null, stage: 'reeval', seat: 'first', provider: `x:p${i}`, pkg: `${PKG.name}@${PKG.version}`, at: '2026-11-08T23:00:00+08:00' })
            const rank = typeRankOf(DOMAIN)
            const rewrite = async (s, i) => {
                const cur = await s.relations.get(target.id)
                const proposal = makeEdge({ from: cur.from, to: cur.to, type: cur.type, reason: `${cur.reason.split('，補充')[0]}，補充說明${i}`, nowIso: '2026-11-08T23:00:00+08:00' })
                await rewriteEdge({ relations: s.relations, ledgers, stateDir: dirs.state }, cur, proposal, { rank, at: '2026-11-08T23:00:00+08:00', produced: mkP(i) })
            }
            await withStores(flow, (s) => rewrite(s, 1))
            const one = await withStores(flow, (s) => s.relations.get(target.id))
            assert.equal(Object.hasOwn(one.produced, 'promptFp'), false, '終值:新一筆無 promptFp(舊一筆之鍵不殘留)')
            assert.deepEqual([one.producedHistory.length, Object.hasOwn(one.producedHistory[0], 'promptFp'), Object.hasOwn(one.producedHistory[1], 'promptFp'), one.producedHistory[1].provider], [2, true, false, 'x:p1'], '歷史各筆各自之鍵集')
            await withStores(flow, async (s) => {
                for (let i = 2; i <= 51; i++) await rewrite(s, i)
            })
            const full = await withStores(flow, (s) => s.relations.get(target.id))
            assert.deepEqual([full.producedHistory.length, full.producedHistoryDropped, full.producedHistory[0].provider, full.producedHistory[49].provider, full.produced.provider], [50, 2, 'x:p2', 'x:p51', 'x:p51'], '共 52 筆寫入:留 50、捨 2(最舊者:既有一筆與 x:p1)')
            assert.equal(Object.hasOwn(full.producedHistory[0], 'promptFp'), false, '輪替後無舊筆之鍵殘留')
            assert.equal((await withStores(flow, (s) => s.relations.select())).length, 2, '邊皆在')
        })

        it('每輪依賴之 promptFpOf:四個評比角色(relate、reeval、conflict-check、edge-review)皆取得指紋,與各自之 planRelateBench 同值、互不相同;同一輪重取同值;下一輪重算', async () => {
            const root3 = tmpRoot('flow-prov-fp')
            try {
                const seen = []
                const probe = { name: 'probe', run: async (ctx) => {
                    const roles = ['relate', 'reeval', 'conflict-check', 'edge-review']
                    seen.push({ fps: roles.map((r) => ctx.deps.promptFpOf(r)), again: roles.map((r) => ctx.deps.promptFpOf(r)), fn: ctx.deps.promptFpOf })
                    return stdReport()
                } }
                const { flow: f3 } = buildTestRelate(root3, { stages: [probe] })
                await f3.run()
                await f3.run()
                const want = ['relate', 'reeval', 'conflict-check', 'edge-review'].map((r) => planRelateBench(r, { vocab: f3.info().vocab }).promptFp)
                assert.deepEqual(seen[0].fps, want)
                assert.ok(want.every((x) => /^[0-9a-f]{16}$/.test(x)))
                assert.equal(new Set(want).size, 4, '四角色之指紋互不相同')
                assert.deepEqual(seen[0].again, want, '同一輪重取同值')
                assert.notEqual(seen[0].fn, seen[1].fn, '每輪一個快取實例(下一輪重算,現行設定若變指紋跟著變)')
            }
            finally {
                resetConceptFold()
                removeRoots([root3])
            }
        })

        it('graph.json 預設逐位元組不變:邊只有 from、to、type、reason(不帶產出鏈);與「邊無產出鏈時」之輸出位元組相同', async () => {
            const file = `${root}/knowledge/relations/graph.json`
            const bytes = fs.readFileSync(file)
            const g = JSON.parse(bytes.toString('utf8'))
            assert.equal(g.edges.length, 2)
            for (const e of g.edges) assert.deepEqual(Object.keys(e), ['from', 'to', 'type', 'reason'])
            const stripped = edges.map(({ produced, producedHistory, producedHistoryDropped, ...rest }) => rest)
            const notes = await withStores(flow, (s) => s.notes.select())
            const dir = `${TMP}/graph${++seq}`
            await rebuildRelationIndex({ relations: { select: async () => stripped }, notes: { select: async () => notes } }, { dir, nowIso: g.updatedAt })
            assert.ok(fs.readFileSync(`${dir}/graph.json`).equals(bytes), '產出鏈不外洩到預設之 graph.json')
        })

        it('開關 relate.graphProduced 開啟:邊帶 produced 純量摘要 { stamp, stage, provider };關閉時同一批邊不帶', async () => {
            const root2 = tmpRoot('flow-prov-graph')
            try {
                const a = landNote(`${root2}/knowledge/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差'] })
                const b = landNote(`${root2}/knowledge/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差'] })
                const ai = scriptedAi((role, prompt, o, items) => (role === 'relate' ? relateAnswer(items, { 恆星視差之量測: [{ to: '視差誤差之修正', type: T0, reason: REASON_AB }] }) : undefined))
                const { flow: f2 } = buildTestRelate(root2, { aiAdapter: ai, relate: { graphProduced: true } })
                await seedNotes(f2, [a, b])
                const rep2 = await f2.run()
                const g = readJsonFile(`${root2}/knowledge/relations/graph.json`)
                assert.equal(g.edges.length, 1)
                assert.deepEqual(Object.keys(g.edges[0]), ['from', 'to', 'type', 'reason', 'produced'])
                const rec = (await withStores(f2, (s) => s.relations.select()))[0]
                assert.deepEqual(g.edges[0].produced, { stamp: readJsonFile(rep2.summaryFile).stamp, stage: 'relate', provider: rec.produced.provider }, '純量摘要:stamp、stage、provider 三鍵')
                assert.equal(rec.produced.provider, f2.info().settings.relate.ai.use, '替身之成交者取席位之 use')
            }
            finally {
                resetConceptFold()
                removeRoots([root2])
            }
        })
    })
})
