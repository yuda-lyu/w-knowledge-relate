// unit-relate-conflictcheck.test.mjs — 檢定標準 RS4(衝突型之邊須為真衝突且理由陳述雙方):純函數與衝突核對段整段行為
// 規格:standards/registry.mjs 之 RS4——新衝突寫入前兩席核對、存量全量;兩席不一致 → 第三席;仍判不了 → 列待判;
//   新進未能判定 → 不納入、入待判;存量未能判定 → 隔離可還原、入待判。
// 執行:自套件根 npx mocha test/unit-relate-conflictcheck.test.mjs(暫存 test/_tmp/relate-cc-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, deepMerge, memStore, genClockTZ, withCheck, silentLog, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { readConflictEvents } from '../src/stores/conflictEvents.mjs'
import { PANEL_UNSURE } from '../src/core/summarizePackage.mjs'
import { holdKey, readJsonlRows } from '../src/core/capturePackage.mjs'
import { checkKey, recordCheck } from '../src/core/stores/checks.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { makeEdge, edgeId } from '../src/stores/edgeStore.mjs'
import { openRelateLedgers } from '../src/stores/relateLedgers.mjs'
import { retireEdge } from '../src/stores/edgeRetire.mjs'
import { RS4, checkVerdictOf, stockQueueOf, stockProgressOf, rs4ClassOf, rs4DecisionOf } from '../src/stores/conflictCheckPolicy.mjs'
import { seatVotesOf, edgeCheckHashOf, relationTypesVersionOf } from '../src/stores/edgeCheckKit.mjs'
import { createCheckHasher } from '../src/stores/checkMaterial.mjs'
import { restoreEdge, deleteNote, restoreNote, revertEdgeRevision } from '../src/ops/noteOps.mjs'
import { createRelateObject } from '../src/relateObject.mjs'
import { RELATE_CTX_FLAGS } from '../src/logContract.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const C = DOMAIN.conflictType
const [T0, T1] = DOMAIN.relationTypes.filter((t) => t !== C)
const OLD = '2026-01-05T00:00:00+08:00'
const R_CONFLICT = '甲說動量於高波動期失效；乙說動量於高波動期反而更強'
const R_FIX = '甲說動量於崩盤後反轉；乙說動量於崩盤後延續，結論相反'
const R_OTHER = '兩篇皆以波動度調整部位，屬同一機制之延伸'
let seq = 0

/**
 * 環境:筆記(含 md 之一句話重點、核心知識、適用條件)、邊、待判、檢核紀錄;AI 替身依 segment 分正向與衝突核對
 * @param {Object} o 輸入 { notes, edges, holds, checks, forward:{ 標題:relations }, check:(seat, { a, b, index })=>票|'unsure'|null,
 *   providers:{ forward, first, second, third }, relate(settings.relate 之覆寫), seats(relate.standards.ai 整組), fail:(seat)=>'skip'|'fail'|null, lowTimeAfterForward }
 * @returns {Object} 回傳 { ctx, relations, holds, checks, log, calls, run, ccLog, retiredLog, events }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const recs = (o.notes || []).map((n) => {
        const file = `${dir}/notes/${n.id}.md`
        const title = n.title || `標題${n.id}`
        writeMd(file, { title, slug: n.id }, `# ${title}\n\n## 一句話重點\n\n${n.id} 之完整重點全文\n\n## 核心知識\n\n- ${n.id} 要點一\n- ${n.id} 要點二\n\n## 適用條件與限制\n\n- ${n.id} 之條件`)
        return { category: 'c', summary: `${n.id} 之重點`, concepts: ['p'], createdAt: '2026-01-01', ...n, title, file }
    })
    const notes = memStore(recs)
    const relations = memStore(o.edges || [])
    const holds = memStore(o.holds || [])
    const checks = memStore(o.checks || [])
    const log = recLog()
    const calls = []
    let low = false
    const providers = { forward: 'stub:fwd', first: 'stub:a', second: 'stub:b', third: 'stub:c', ...(o.providers || {}) }
    const deps = {
        stores: { notes, relations, holds, checks },
        settings: resolveRelateSettings(deepMerge({
            ai: { parallel: 1, timeoutMs: 300_000, providerTimeouts: {} },
            relate: {
                rounds: 2, notesPerCall: 6, candidatesPerNote: 15, ai: { use: 'stub:fwd' }, reverse: { perRun: 0 }, reeval: { perRun: 0 },
                standards: {
                    conflictCheck: { enabled: true, perRun: 0, pageSize: 10, maxTries: 3 },
                    ai: o.seats || { first: { use: 'stub:a' }, second: { use: 'stub:b' }, third: { use: 'stub:c' } },
                },
            },
        }, { relate: o.relate })),
        ai: null,
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: DOMAIN },
    }
    const ctx = bagCtx(deps, log, { remainingMs: () => (low ? 1_000 : Infinity), expired: () => false })
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    const callAI = withCheck(async (prompt, check, co) => {
        if (co?.segment === 'conflictCheck') {
            calls.push({ seg: 'cc', seat: co.seat, prompt })
            const f = typeof o.fail === 'function' ? o.fail(co.seat) : null
            if (f === 'skip') return { ok: false, data: null, error: 'quota', skipped: true, attempts: 1 }
            if (f === 'fail') return { ok: false, data: null, error: 'stub fail', skipped: false, attempts: 1 }
            const items = prompt.split(/^--- 第(\d+)項 ---$/m).slice(1).reduce((acc, x, i, arr) => (i % 2 === 0 ? [...acc, { index: Number(x), body: arr[i + 1] }] : acc), [])
                .map((b) => {
                    const titles = [...b.body.matchAll(/^標題：(.+)$/gm)].map((m) => m[1])
                    return { index: b.index, a: titles[0], b: titles[1] }
                })
            const data = items.map((it) => {
                const v = o.check ? o.check(co.seat, it) : { verdict: 'keep', reason: '' }
                if (v === null) return null
                return v === PANEL_UNSURE ? { index: it.index, verdict: 'unsure', reason: '材料不足以判斷是否同一問題' } : { index: it.index, ...v }
            }).filter(Boolean)
            return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: providers[co.seat] }
        }
        calls.push({ seg: co?.segment || 'forward', prompt })
        const targets = [...prompt.matchAll(/^--- 第(\d+)篇（待建立關聯）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
        if (o.lowTimeAfterForward) low = true
        return { ok: true, data: targets.map((t) => ({ index: t.index, relations: (o.forward || {})[t.title] || [] })), error: '', skipped: false, attempts: 1, providerId: providers.forward }
    })
    const run = () => stageRelate({ callAI }).run(ctx)
    return {
        ctx, notes, relations, holds, checks, log, calls, run, bag: ctx.bag, callAI,
        ccLog: () => readJsonlRows(`${dir}/state/relate-conflict-check.jsonl`),
        retiredLog: () => readJsonlRows(`${dir}/state/relate-retired.jsonl`),
        events: () => readConflictEvents(`${dir}/state`),
        restoreDeps: { stores: { notes, relations }, dirs: { state: `${dir}/state`, relations: `${dir}/relations` }, domain: DOMAIN, clock },
        // 含待判與檢核紀錄之維運 deps(還原之邊與 AI 標準——ops/noteOps 檔頭【還原之邊與 AI 標準】)
        opsDeps: { stores: { notes, relations, holds, checks }, dirs: { state: `${dir}/state`, relations: `${dir}/relations` }, domain: DOMAIN, clock, log: silentLog },
    }
}

const fresh = (ids) => ids.map((id) => ({ id, relatedAt: '' }))
const done = (ids) => ids.map((id) => ({ id, relatedAt: '2026-01-02T00:00:00+08:00' }))
const byPair = (map) => (seat, it) => (map[seat] ? map[seat](it) : { verdict: 'keep', reason: '' })
// 檢核雜湊與關聯段同一算法、同一素材讀法(含兩端 md 之核對席所見區塊;stores/checkMaterial.createCheckHasher)
const hashOf = async (e, edge) => createCheckHasher({ byId: new Map([[edge.from, await e.notes.get(edge.from)], [edge.to, await e.notes.get(edge.to)]]), domain: DOMAIN, typesVer: relationTypesVersionOf(DOMAIN) }).hashOf(edge)

describe('unit-relate-conflictcheck', function() {

    before(() => {
        TMP = tmpRoot('relate-cc')
    })
    after(() => removeRoots([TMP]))

    // ─── 純函數 ───

    it('checkVerdictOf:keep;change 之型別經對映須在清單、理由 ≥10 字;衝突型且理由與現行相同＝keep;retire 理由 ≥10;unsure 合法;其餘＝缺票', () => {
        const o = { relationTypes: DOMAIN.relationTypes, resolveType: DOMAIN.resolveType, conflictType: C, current: { type: C, reason: R_CONFLICT } }
        assert.deepEqual(checkVerdictOf({ verdict: 'keep', reason: 'x' }, o), { verdict: 'keep', reason: 'x' })
        assert.deepEqual(checkVerdictOf({ verdict: 'change', type: C, reason: R_FIX }, o), { verdict: 'change', type: C, reason: R_FIX })
        assert.deepEqual(checkVerdictOf({ verdict: 'change', type: C, reason: R_CONFLICT }, o), { verdict: 'keep', reason: R_CONFLICT }, '衝突型＋同理由＝沒改')
        assert.deepEqual(checkVerdictOf({ verdict: 'CHANGE', type: T0, reason: R_OTHER }, o), { verdict: 'change', type: T0, reason: R_OTHER })
        assert.equal(checkVerdictOf({ verdict: 'change', type: '清單外型別', reason: R_OTHER }, o), null)
        assert.equal(checkVerdictOf({ verdict: 'change', type: T0, reason: '太短' }, o), null)
        assert.equal(checkVerdictOf({ verdict: 'retire', reason: '短' }, o), null)
        assert.deepEqual(checkVerdictOf({ verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }, o).verdict, 'retire')
        assert.equal(checkVerdictOf({ verdict: 'unsure' }, o), PANEL_UNSURE)
        assert.equal(checkVerdictOf({ verdict: 'maybe' }, o), null)
        assert.equal(checkVerdictOf(null, o), null)
    })

    it('seatVotesOf:以項編號對應、本席未見之編號略過、同編號矛盾 → 缺票(null)、同編號一致 → 取一', () => {
        const o = { relationTypes: DOMAIN.relationTypes, resolveType: DOMAIN.resolveType, conflictType: C, verdictOf: checkVerdictOf, indices: new Set([1, 2, 3]), currentOf: () => ({ type: C, reason: R_CONFLICT }) }
        const m = seatVotesOf([{ index: 1, verdict: 'keep' }, { index: 2, verdict: 'keep' }, { index: 2, verdict: 'retire', reason: '兩篇題材撞名而無共同機制' }, { index: 3, verdict: 'keep' }, { index: 3, verdict: 'keep', reason: '再說一次' }, { index: 9, verdict: 'keep' }], o)
        assert.deepEqual([m.get(1)?.verdict, m.get(2), m.get(3)?.verdict, m.has(9)], ['keep', null, 'keep', false])
    })

    it('edgeCheckHashOf:型別、理由、任一端內容版本變即變;stockQueueOf:只取衝突型、須(重)核者、排除既有項、觸及已提煉者先再依時刻舊到新、取配額', () => {
        const a = { id: 'a', createdAt: '2026-01-01' }
        const b = { id: 'b', createdAt: '2026-01-01', knowledgeChangedAt: '2026-02-01T00:00:00+08:00' }
        const e = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const h = edgeCheckHashOf(e, a, b)
        assert.notEqual(h, edgeCheckHashOf({ ...e, reason: R_FIX }, a, b))
        assert.notEqual(h, edgeCheckHashOf({ ...e, type: T0 }, a, b))
        assert.notEqual(h, edgeCheckHashOf(e, a, { ...b, knowledgeChangedAt: '2026-03-01T00:00:00+08:00' }))
        const byId = new Map(['a', 'b', 'c', 'd', 'x'].map((id) => [id, { id, createdAt: '2026-01-01', extractedAt: id === 'd' ? '2026-01-03' : '' }]))
        const e1 = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: '2026-01-02T00:00:00+08:00' })
        const e2 = makeEdge({ from: 'a', to: 'c', type: C, reason: R_CONFLICT, nowIso: '2026-01-01T00:00:00+08:00' })
        const e3 = makeEdge({ from: 'c', to: 'd', type: C, reason: R_CONFLICT, nowIso: '2026-01-09T00:00:00+08:00' })
        const e4 = makeEdge({ from: 'b', to: 'c', type: T0, reason: R_OTHER, nowIso: OLD })
        const e5 = makeEdge({ from: 'a', to: 'gone', type: C, reason: R_CONFLICT, nowIso: OLD })
        const e6 = makeEdge({ from: 'b', to: 'x', type: C, reason: R_CONFLICT, nowIso: OLD })
        const checked = { id: checkKey(RS4.objectEdge, e6.id), object: RS4.objectEdge, oid: e6.id, hash: edgeCheckHashOf(e6, byId.get('b'), byId.get('x')), results: { RS4: { v: RS4.v, status: 'pass' } } }
        const q = stockQueueOf({ edges: [e1, e2, e3, e4, e5, e6], conflictType: C, byId, checkOf: (id) => (id === e6.id ? checked : null), extracted: (id) => !!byId.get(id)?.extractedAt, exclude: new Set(), quota: 5 })
        assert.deepEqual(q.map((x) => x.edge.id), [e3.id, e2.id, e1.id], '觸及已提煉者先(e3)→ 舊到新;非衝突、懸空、已核者不入')
        assert.deepEqual(stockQueueOf({ edges: [e1, e2, e3], conflictType: C, byId, checkOf: () => null, extracted: () => false, exclude: new Set([e2.id]), quota: 1 }).map((x) => x.edge.id), [e1.id])
        assert.deepEqual(stockQueueOf({ edges: [e1], conflictType: C, byId, quota: 0 }), [])
    })

    it('rs4DecisionOf 兩層:①類別(keep、change 衝突型＝衝突;change 非衝突型、retire＝非衝突)成立 ②衝突 → keep,有一票改寫 → reason;非衝突 → 兩家裁決完全相同才 downgrade／retire,否則 not-split(叫第三席)', () => {
        const V2 = (a, b, pa = 'p1', pb = 'p2') => [{ seat: 'first', provider: pa, verdict: a }, { seat: 'second', provider: pb, verdict: b }]
        const keep = { verdict: 'keep', reason: '' }
        const fix = { verdict: 'change', type: C, reason: R_FIX }
        const toT0 = { verdict: 'change', type: T0, reason: R_OTHER }
        const toT1 = { verdict: 'change', type: T1, reason: R_OTHER }
        const ret = { verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }
        assert.deepEqual([rs4ClassOf(keep, C), rs4ClassOf(fix, C), rs4ClassOf(toT0, C), rs4ClassOf(ret, C), rs4ClassOf(PANEL_UNSURE, C), rs4ClassOf(null, C)], ['conflict', 'conflict', 'not', 'not', PANEL_UNSURE, null])
        assert.equal(rs4DecisionOf(V2(keep, keep), C).action, 'keep')
        const r = rs4DecisionOf(V2(keep, fix), C)
        assert.deepEqual([r.action, r.verdicts], ['reason', [fix]], '是衝突已定;有一票要求改寫 → 採改寫(過不了納入閘由段維持原理由)')
        assert.deepEqual([rs4DecisionOf(V2(toT0, toT0), C).action, rs4DecisionOf(V2(ret, ret), C).action], ['downgrade', 'retire'])
        const split = rs4DecisionOf(V2(toT0, toT1), C)
        assert.deepEqual([split.action, split.needThird], ['not-split', true], '非衝突已定而型別不同 → not-split、叫第三席')
        assert.equal(rs4DecisionOf([...V2(toT0, toT1), { seat: 'third', provider: 'p3', verdict: toT1 }], C).action, 'downgrade', '第三席與其一同型 → 成立')
        assert.equal(rs4DecisionOf(V2(toT0, ret), C).action, 'not-split')
        const und = rs4DecisionOf(V2(keep, toT0), C)
        assert.deepEqual([und.action, und.why, und.needThird], ['undetermined', 'disagree', true], '是否衝突不一致 → 叫第三席')
        assert.deepEqual([rs4DecisionOf(V2(keep, null), C).action, rs4DecisionOf(V2(keep, keep, 'p1', 'p1'), C).action, rs4DecisionOf(V2(PANEL_UNSURE, keep), C).action], ['retry', 'retry', 'undetermined'])
    })

    // ─── 段 ───

    it('停用(套件預設 false):正向之衝突提案直接落地(舊行為)、不呼叫核對、報告無 rs4 計數', async () => {
        const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] }, relate: { standards: { conflictCheck: { enabled: false } } } })
        const rep = await e.run()
        assert.equal((await e.relations.get(edgeId('n', 'm')))?.type, C)
        assert.equal(e.calls.filter((c) => c.seg === 'cc').length, 0)
        assert.equal(Object.keys(rep.result?.detail || rep.detail || {}).some((k) => k.startsWith('rs4')), false)
    })

    it('新衝突:核對席(與提案席不同家)判 keep → 落地為衝突邊、計 conflicts、檢核紀錄合格、核對帳 written、無待判;提示詞含兩端 md 之一句話重點全文、核心知識與條件', async () => {
        const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] } })
        const rep = await e.run()
        const edge = await e.relations.get(edgeId('n', 'm'))
        assert.deepEqual([edge?.type, edge?.reason], [C, R_CONFLICT])
        const det = rep.result?.detail || rep.detail
        assert.deepEqual([det.conflicts, det.rs4Deferred, det.rs4Checked, det.rs4Kept, det.rs4Written], [1, 1, 1, 1, 1])
        const cc = e.calls.filter((c) => c.seg === 'cc')
        assert.deepEqual(cc.map((c) => c.seat), ['first'], '新衝突只叫核對第一席(提案席算一票)')
        assert.match(cc[0].prompt, /一句話重點：n 之完整重點全文/)
        assert.match(cc[0].prompt, /核心知識：\n- n 要點一/)
        assert.match(cc[0].prompt, /適用條件與限制：\n- m 之條件/)
        const chk = await e.checks.get(checkKey(RS4.objectEdge, edge.id))
        assert.deepEqual([chk?.results?.RS4?.status, chk?.results?.RS4?.seats], ['pass', 'stub:fwd|stub:a'])
        assert.deepEqual(e.ccLog().map((r) => [r.entry, r.outcome]), [['proposal', 'written']])
        // 提案於暫緩當下即持久為 RS4 提案待判(終審 D3 A3:先記後寫),核對成立即結案
        assert.deepEqual((await e.holds.select()).map((h) => [h.object, h.status, h.how, h.ctx.proposer, h.ctx.segment]), [[RS4.objectProposal, 'resolved', '核對成立，衝突邊落地', 'stub:fwd', 'forward']])
    })

    it('新衝突:核對席判非衝突(改型 T0)→ 第三席同判 → 以 T0 落地(非衝突)、計 rs4Downgraded、rs4Third;第三席只收未成立之項', async () => {
        const e = env({
            notes: [...fresh(['n']), ...done(['m', 'k'])],
            forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }, { to: 'k', type: C, reason: R_CONFLICT }] },
            check: byPair({ first: (it) => (it.b === '標題m' || it.a === '標題m' ? { verdict: 'change', type: T0, reason: R_OTHER } : { verdict: 'keep' }), third: () => ({ verdict: 'change', type: T0, reason: R_OTHER }) }),
        })
        const rep = await e.run()
        const det = rep.result?.detail || rep.detail
        assert.equal((await e.relations.get(edgeId('n', 'm')))?.type, T0)
        assert.equal((await e.relations.get(edgeId('n', 'k')))?.type, C)
        assert.deepEqual([det.rs4Downgraded, det.rs4Kept, det.rs4Third, det.conflicts], [1, 1, 1, 1])
        const third = e.calls.filter((c) => c.seg === 'cc' && c.seat === 'third')
        assert.equal(third.length, 1)
        assert.equal((third[0].prompt.match(/^--- 第\d+項 ---$/gm) || []).length, 1, '第三席只送未成立之項')
    })

    it('新衝突:核對席判真衝突但理由未陳述雙方(衝突型＋新理由)→ 提案 keep 與之不同 → 第三席同判 → 以新理由落地、計 rs4ReasonFixed', async () => {
        const e = env({
            notes: [...fresh(['n']), ...done(['m'])],
            forward: { 標題n: [{ to: 'm', type: C, reason: '兩篇對動量之看法不同，可互相參照' }] },
            check: byPair({ first: () => ({ verdict: 'change', type: C, reason: R_FIX }), third: () => ({ verdict: 'change', type: C, reason: R_FIX }) }),
        })
        const rep = await e.run()
        const det = rep.result?.detail || rep.detail
        const edge = await e.relations.get(edgeId('n', 'm'))
        assert.deepEqual([edge?.type, edge?.reason, det.rs4ReasonFixed], [C, R_FIX, 1])
    })

    it('非衝突已定而改正之型別各席不一致(2026-10-05 真實 AI 驗收之案):提案 → 不落地、無待判、核對帳 not-conflict-split;既有衝突邊 → 撤出(rs4-retire,可還原)、待判結案', async () => {
        const e = env({
            notes: [...fresh(['n']), ...done(['m'])],
            forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] },
            check: byPair({ first: () => ({ verdict: 'change', type: T0, reason: R_OTHER }), third: () => ({ verdict: 'change', type: T1, reason: R_OTHER }) }),
        })
        const rep = await e.run()
        assert.deepEqual([await e.relations.get(edgeId('n', 'm')), rep.detail.rs4NotSplit, (await e.holds.select()).filter((h) => h.status === 'open').length], [null, 1, 0], '提案待判(持久者)結案、無未結')
        assert.deepEqual(e.ccLog().map((r) => r.outcome), ['not-conflict-split'])
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} }
        const e2 = env({ notes: done(['a', 'b']), edges: [edge], holds: [hold], check: byPair({ first: () => ({ verdict: 'change', type: T0, reason: R_OTHER }), second: () => ({ verdict: 'change', type: T1, reason: R_OTHER }), third: () => ({ verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }) }) })
        await e2.run()
        assert.equal(await e2.relations.get(edge.id), null)
        assert.match(e2.retiredLog()[0].detail, /改正之型別各席不一致/)
        assert.equal((await e2.holds.get(hold.id)).status, 'resolved')
        assert.equal((await restoreEdge(e2.restoreDeps, edge.id, { at: '2026-03-01T00:00:00+08:00', dryRun: true })).restorable, true)
    })

    it('真衝突而改寫之理由過不了納入閘(數字不見於材料)→ 維持原理由落地(是否衝突已定;改寫只是補強),計 rs4StdRejected、核對帳 reason-std-reject', async () => {
        const e = env({
            notes: [...fresh(['n']), ...done(['m'])],
            forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] },
            check: byPair({ first: () => ({ verdict: 'change', type: C, reason: '甲說年化報酬 37.5%；乙說同期為負 12.25%' }) }),
        })
        const rep = await e.run()
        const edge = await e.relations.get(edgeId('n', 'm'))
        assert.deepEqual([edge?.type, edge?.reason, rep.detail.rs4StdRejected, rep.detail.rs4Kept], [C, R_CONFLICT, 1, 1])
        assert.deepEqual(e.ccLog().map((r) => r.outcome), ['reason-std-reject', 'written'])
    })

    it('新衝突:判不了(一席不確定、第三席又不同)→ 不落地、待判 edge-proposal 負責者 user、核對帳 undetermined;關聯段照常完成', async () => {
        const e = env({
            notes: [...fresh(['n']), ...done(['m'])],
            forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] },
            check: byPair({ first: () => PANEL_UNSURE, third: () => ({ verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }) }),
        })
        const rep = await e.run()
        const det = rep.result?.detail || rep.detail
        assert.equal(await e.relations.get(edgeId('n', 'm')), null)
        const h = await e.holds.get(holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std))
        assert.deepEqual([h?.status, h?.owner, h?.ctx?.from, h?.ctx?.reason, h?.ctx?.proposer], ['open', 'user', 'n', R_CONFLICT, 'stub:fwd'])
        assert.deepEqual([det.rs4Undetermined, det.conflicts, det.targets], [1, 0, 1])
        assert.deepEqual(e.ccLog().map((r) => r.outcome), ['undetermined'])
    })

    it('新衝突:核對席與提案席同一供應者且無第三席 → retry(待判 pipeline);下輪換家 → 成立落地、待判結案', async () => {
        const seats = { first: { use: 'stub:a' }, second: { use: 'stub:b' }, third: null }
        const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] }, seats, providers: { first: 'stub:fwd' } })
        await e.run()
        const id = holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std)
        assert.deepEqual([(await e.holds.get(id))?.owner, await e.relations.get(edgeId('n', 'm'))], ['pipeline', null])
        // 下輪:核對席換家(正向已評完,不再提案)→ 待判之提案重核
        const e2 = { ...e }
        const providers = { first: 'stub:a2' }
        const ctx2 = e.ctx
        const callAI = withCheck(async (prompt, check, co) => {
            const items = prompt.split(/^--- 第(\d+)項 ---$/m).slice(1).filter((x, i) => i % 2 === 0).map(Number)
            return { ok: true, data: items.map((index) => ({ index, verdict: 'keep' })), error: '', skipped: false, attempts: 1, providerId: providers[co.seat] }
        })
        await stageRelate({ callAI }).run(ctx2)
        assert.equal((await e2.relations.get(edgeId('n', 'm')))?.type, C)
        const h = await e.holds.get(id)
        assert.deepEqual([h.status, h.how], ['resolved', '核對成立，衝突邊落地'])
    })

    it('提煉之 RS4 待判(既有衝突邊):兩席皆判非衝突(同型)→ 降級:事件帳 downgrade 先寫、邊改型、待判結案、檢核紀錄 violation', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: '提煉判為非對立', next: '關聯段兩席核對', since: OLD, at: OLD, tries: 0, ctx: { from: 'a', to: 'b', core: 'x' } }
        const e = env({ notes: done(['a', 'b']), edges: [edge], holds: [hold], check: () => ({ verdict: 'change', type: T1, reason: R_OTHER }) })
        const rep = await e.run()
        const det = rep.result?.detail || rep.detail
        const cur = await e.relations.get(edge.id)
        assert.deepEqual([cur.type, cur.reason], [T1, R_OTHER])
        assert.deepEqual(e.events().map((x) => [x.kind, x.oldType, x.newType]), [['downgrade', C, T1]])
        assert.deepEqual([(await e.holds.get(hold.id)).status, det.rs4Downgraded, det.rs4Holds], ['resolved', 1, 1])
        assert.deepEqual(e.calls.filter((c) => c.seg === 'cc').map((c) => c.seat).sort(), ['first', 'second'])
        const chk = await e.checks.get(checkKey(RS4.objectEdge, edge.id))
        assert.equal(chk.results.RS4.status, 'violation')
    })

    it('既有衝突邊:兩席皆判無關聯 → retireEdge(rs4-retire;事件帳 retire、稽核)→ restore-edge 可還原', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} }
        const e = env({ notes: done(['a', 'b']), edges: [edge], holds: [hold], check: () => ({ verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }) })
        await e.run()
        assert.equal(await e.relations.get(edge.id), null)
        assert.deepEqual(e.retiredLog().map((r) => r.reason), ['rs4-retire'])
        assert.deepEqual(e.events().map((x) => x.kind), ['retire'])
        const r = await restoreEdge(e.restoreDeps, edge.id, { at: '2026-03-01T00:00:00+08:00' })
        assert.equal(r.restorable, true, r.reason)
    })

    it('既有衝突邊判不了(兩席不一致、第三席不確定)→ 隔離 retireEdge(rs4-quarantine,可還原)＋待判負責者 user＋檢核紀錄 undetermined', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: { core: 'x' } }
        const e = env({
            notes: done(['a', 'b']), edges: [edge], holds: [hold],
            check: byPair({ first: () => ({ verdict: 'keep' }), second: () => ({ verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }), third: () => PANEL_UNSURE }),
        })
        const rep = await e.run()
        const det = rep.result?.detail || rep.detail
        assert.equal(await e.relations.get(edge.id), null)
        assert.deepEqual(e.retiredLog().map((r) => r.reason), ['rs4-quarantine'])
        const h = await e.holds.get(hold.id)
        assert.deepEqual([h.status, h.owner, h.ctx.core], ['open', 'user', 'x'])
        assert.deepEqual([det.rs4Undetermined, det.rs4Quarantined], [1, 1])
        assert.equal((await e.checks.get(checkKey(RS4.objectEdge, edge.id))).results.RS4.status, 'undetermined')
        assert.equal((await restoreEdge(e.restoreDeps, edge.id, { at: '2026-03-01T00:00:00+08:00', dryRun: true })).restorable, true)
    })

    it('存量(配額):觸及已提煉者先;兩席成立 → 檢核紀錄合格;下一輪內容未變 → 不再核(不呼叫);關聯段摘要句附衝突核對', async () => {
        const e1 = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const e2 = makeEdge({ from: 'c', to: 'd', type: C, reason: R_CONFLICT, nowIso: '2026-01-09T00:00:00+08:00' })
        const e = env({ notes: [...done(['a', 'b', 'c']), { id: 'd', relatedAt: '2026-01-02T00:00:00+08:00', extractedAt: '2026-01-03' }], edges: [e1, e2], relate: { standards: { conflictCheck: { perRun: 1 } } } })
        // 經物件(createRelateObject)跑:摘要句附衝突核對(有核對才附)
        const rep = await createRelateObject({ relate: { callAI: e.callAI } }).run(e.ctx)
        assert.match(rep.summary, /｜衝突核對 1 條（成立 1、改理由 0、非衝突 0、無關聯 0、理由修不了而撤出 0、判不了 0）/, rep.summary)
        assert.equal((await e.checks.get(checkKey(RS4.objectEdge, e2.id)))?.results?.RS4?.status, 'pass', '觸及已提煉者(d)先')
        assert.equal(await e.checks.get(checkKey(RS4.objectEdge, e1.id)), null)
        const r2 = await e.run()
        assert.deepEqual([r2.detail.rs4Stock, r2.detail.rs4Kept], [1, 1], '第二輪核另一條')
        const n2 = e.calls.filter((c) => c.seg === 'cc').length
        await e.run()
        assert.equal(e.calls.filter((c) => c.seg === 'cc').length, n2, '兩條皆已核、內容未變 → 不再呼叫')
    })

    it('額度中止(skipped):本輪新衝突全入待判(pipeline)、不落地、不計 fail、記 rs4Aborted;時間不足同(rs4TimeDeferred;未呼叫 → rs4Aborted 為 false)', async () => {
        const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] }, fail: () => 'skip' })
        const rep = await e.run()
        assert.equal(await e.relations.get(edgeId('n', 'm')), null)
        assert.equal((await e.holds.get(holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std)))?.owner, 'pipeline')
        assert.equal((rep.result?.stats || rep.stats).fail, 0)
        assert.equal(rep.detail.rs4Aborted, true, '額度中止入報告(不只記於日誌)')
        const t = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] }, lowTimeAfterForward: true })
        const rt = await t.run()
        const dt = rt.result?.detail || rt.detail
        assert.deepEqual([dt.rs4TimeDeferred, dt.rs4Aborted, await t.relations.get(edgeId('n', 'm')), t.calls.filter((c) => c.seg === 'cc').length], [true, false, null, 0])
        assert.equal((await t.holds.get(holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std)))?.status, 'open')
        // 第三席中止亦記 rs4Aborted;中止不是該項之失敗——送第三席之提案本輪不判:入待判(本輪未及核對、tries 0),不記重試
        const g = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] }, check: byPair({ first: () => ({ verdict: 'change', type: T0, reason: R_OTHER }) }), fail: (seat) => (seat === 'third' ? 'skip' : null) })
        const rg = await g.run()
        const hg = await g.holds.get(holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std))
        assert.deepEqual([rg.detail.rs4Aborted, rg.detail.rs4Retry, rg.detail.rs4Checked, hg?.owner, hg?.reason, hg?.next, hg?.tries], [true, 0, 0, 'pipeline', '新衝突之提案待兩席核對（衝突核對開啟）', '下輪衝突核對', 0], JSON.stringify(rg.detail))
        assert.deepEqual(g.ccLog(), [], '未判之項不寫核對帳')
    })

    it('第三席中止(多提案頁;中止不計、失敗計之對照):送第三席之項本輪不判——新提案入待判(本輪未及核對、tries 0)、既有邊之待判一字不動(tries 不增、不因中止而轉使用者)、不寫核對帳;同頁其餘項照判、其後之頁仍以前兩席判而不再叫第三席(終審 D5 R62;原則②中止不計)、記 rs4Aborted 與 INFO 一句。第三席失敗(非中止)→ 該些項照缺票重試:新提案待判(缺票)、既有邊待判 tries＋1(逾 maxTries 轉使用者)、其後之頁照核', async () => {
        const ab = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const cd = makeEdge({ from: 'c', to: 'd', type: C, reason: R_FIX, nowIso: OLD })
        // 待判依 since 入列:a—b 先(與三則提案同在第一頁)、c—d 後(第二頁)
        const hold = (e, tries) => ({ id: holdKey(RS4.objectEdge, e.id, RS4.std), object: RS4.objectEdge, oid: e.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: e === ab ? '2026-01-04T00:00:00+08:00' : OLD, at: OLD, tries, ctx: {} })
        const toT0 = { verdict: 'change', type: T0, reason: R_OTHER }
        const toT1 = { verdict: 'change', type: T1, reason: R_OTHER }
        const retire = { verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }
        // 第一頁:提案 m(第一席判非衝突 → 不一致 → 第三席)、k(第一席判真衝突 → 成立)、j(同 m)、既有衝突邊 a—b(兩席不一致 → 第三席);第二頁:c—d(兩席成立)
        const check = (seat, it) => {
            const has = (t) => it.a === `標題${t}` || it.b === `標題${t}`
            if (seat === 'first') return has('m') ? toT0 : has('j') ? toT1 : { verdict: 'keep', reason: '' }
            if (seat === 'second') return has('a') ? retire : { verdict: 'keep', reason: '' }
            return { verdict: 'keep', reason: '' }
        }
        const mk = (third) => env({
            notes: [...fresh(['n']), ...done(['m', 'k', 'j', 'a', 'b', 'c', 'd'])], edges: [ab, cd], holds: [hold(ab, 1), hold(cd, 0)],
            forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }, { to: 'k', type: C, reason: R_CONFLICT }, { to: 'j', type: C, reason: R_FIX }] },
            relate: { standards: { conflictCheck: { pageSize: 4 } } }, check, fail: (seat) => (seat === 'third' ? third : null),
        })
        const hp = (e, id) => e.holds.get(holdKey(RS4.objectProposal, id, RS4.std))
        const he = (e, x) => e.holds.get(holdKey(RS4.objectEdge, x.id, RS4.std))
        // 中止
        const s = mk('skip')
        const rs = await s.run()
        const ds = rs.detail
        assert.deepEqual(s.calls.filter((c) => c.seg === 'cc').map((c) => c.seat), ['first', 'second', 'third', 'first', 'second'], '第三席中止 → 其後之頁仍以前兩席判、不再叫第三席')
        assert.deepEqual([ds.rs4Aborted, ds.rs4Third, ds.rs4Checked, ds.rs4Kept, ds.rs4Retry, ds.rs4Written], [true, 3, 2, 2, 0, 1], JSON.stringify(ds))
        for (const id of [edgeId('n', 'm'), edgeId('n', 'j')]) {
            const h = await hp(s, id)
            assert.deepEqual([h?.owner, h?.reason, h?.next, h?.tries], ['pipeline', '新衝突之提案待兩席核對（衝突核對開啟）', '下輪衝突核對', 0], id)
            assert.equal(await s.relations.get(id), null, '提案不落地')
        }
        assert.deepEqual(await he(s, ab), hold(ab, 1), '既有邊之待判一字不動(tries 不增、不轉使用者)')
        assert.equal((await he(s, cd)).status, 'resolved', '其後之頁以前兩席判:兩席成立 → 結案')
        assert.equal((await s.relations.get(edgeId('n', 'k')))?.type, C, '同頁其餘項照判(成立落地)')
        assert.deepEqual(s.ccLog().map((r) => [r.edgeId, r.outcome]), [[edgeId('n', 'k'), 'written'], [cd.id, 'keep']], '未判之項不寫核對帳')
        assert.ok(s.log.lines.includes('INFO 衝突核對：第三席額度或截止中止（quota），該些項留待下輪；本輪其後不再叫第三席'), s.log.lines.join('\n'))
        // 對照:第三席失敗(非中止)→ 照缺票重試、計次;其後之頁照核
        const f = mk('fail')
        const rf = await f.run()
        const df = rf.detail
        assert.deepEqual(f.calls.filter((c) => c.seg === 'cc').map((c) => c.seat), ['first', 'second', 'third', 'first', 'second'], '失敗不中止:其後之頁照核')
        assert.deepEqual([df.rs4Aborted, df.rs4Third, df.rs4Checked, df.rs4Kept, df.rs4Retry], [false, 3, 5, 2, 3], JSON.stringify(df))
        for (const id of [edgeId('n', 'm'), edgeId('n', 'j')]) {
            const h = await hp(f, id)
            assert.deepEqual([h?.owner, h?.tries], ['pipeline', 1], `${id}:失敗次數＝再登錄之 tries(暫緩當下之持久不算一次)`)
            assert.equal(h.reason, '判定小組未成立（缺票（呼叫失敗或回覆不合格））', '字樣取判定小組之字樣表')
        }
        const hab = await he(f, ab)
        assert.deepEqual([hab.tries, hab.owner, hab.next], [2, 'user', '逾 3 次未得判定，改由使用者：要求重試（requestRetry：換席重判）或豁免（waiveHold：維持現值）'], '失敗計次:tries＋1,逾 maxTries 轉使用者')
        assert.equal((await he(f, cd)).status, 'resolved')
        assert.deepEqual(f.ccLog().filter((r) => r.outcome === 'retry').map((r) => r.why), ['missing', 'missing', 'missing'])
    })

    it('第三席失敗(呼叫失敗):前兩票未成立而可成立之項照缺票重試(待判 pipeline、核對帳 retry why missing)——不以前兩票之未決結果處置', async () => {
        const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] }, check: byPair({ first: () => ({ verdict: 'change', type: T0, reason: R_OTHER }) }), fail: (seat) => (seat === 'third' ? 'fail' : null) })
        const rep = await e.run()
        assert.deepEqual([rep.detail.rs4Third, rep.detail.rs4Retry, rep.detail.rs4Undetermined, rep.detail.rs4Aborted], [1, 1, 0, false], JSON.stringify(rep.detail))
        const h = await e.holds.get(holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std))
        assert.deepEqual([h.owner, h.status], ['pipeline', 'open'])
        assert.equal(h.reason, '判定小組未成立（缺票（呼叫失敗或回覆不合格））')
        assert.deepEqual(e.ccLog().map((r) => [r.outcome, r.why]), [['retry', 'missing']])
        assert.equal(await e.relations.get(edgeId('n', 'm')), null, '提案不落地')
    })

    it('未設第二席時,既有衝突邊之待判不入本輪(計 rs4HoldsNoSecond、INFO 一行、待判維持未結、不呼叫);新衝突之提案照常核對;設第二席後即核', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} }
        const seats = { first: { use: 'stub:a' }, second: null, third: null }
        const e = env({ notes: [...done(['a', 'b', 'm']), ...fresh(['n'])], edges: [edge], holds: [hold], seats, forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] } })
        const rep = await e.run()
        assert.deepEqual([rep.detail.rs4HoldsNoSecond, rep.detail.rs4Holds, rep.detail.rs4Proposals, rep.detail.rs4Kept], [1, 0, 1, 1], JSON.stringify(rep.detail))
        assert.ok(e.log.lines.some((l) => l === 'INFO 衝突核對：未設第二席（relate.standards.ai.second），既有衝突邊之待判與既有邊之升級提案 1 條本輪不核（待判維持未結）'), e.log.lines.join('\n'))
        const cc = e.calls.filter((c) => c.seg === 'cc')
        assert.equal(cc.length, 1, '只核新衝突之提案(核對第一席)')
        assert.doesNotMatch(cc[0].prompt, /標題：標題a/)
        assert.deepEqual([(await e.holds.get(hold.id)).status, (await e.holds.get(hold.id)).tries, (await e.relations.get(edge.id)).type], ['open', 0, C], '待判維持未結、不累加 tries、邊不動')
        e.ctx.deps.settings.relate.standards.ai = { first: { use: 'stub:a' }, second: { use: 'stub:b' }, third: null }
        const r2 = await e.run()
        assert.deepEqual([r2.detail.rs4HoldsNoSecond, r2.detail.rs4Holds, r2.detail.rs4Kept, (await e.holds.get(hold.id)).status], [0, 1, 1, 'resolved'], JSON.stringify(r2.detail))
    })

    it('ctx 旗標 RELATE_CTX_FLAGS.edgesChanged＝本輪邊之實際異動數(每筆寫入只計一次):新衝突落地 1＋既有衝突邊撤出 1＝2', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} }
        const e = env({
            notes: [...done(['a', 'b', 'm']), ...fresh(['n'])], edges: [edge], holds: [hold], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] },
            check: (seat, it) => (it.a === '標題a' || it.b === '標題a' ? { verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' } : { verdict: 'keep', reason: '' }),
        })
        const rep = await e.run()
        assert.deepEqual([rep.detail.edges, rep.detail.edgesChanged, rep.detail.rs4Retired, rep.detail.rs4Kept], [1, 0, 1, 1], JSON.stringify(rep.detail))
        assert.equal(e.bag.get(RELATE_CTX_FLAGS.edgesChanged), 2)
        assert.deepEqual(RELATE_CTX_FLAGS, { edgesChanged: 'relateEdges', blocked: 'relateBlocked' })
    })

    it('restoreNote／restoreEdge 之衝突核對預設:opt.conflictCheck 未給時依 deps.settings 之 relate.standards.conflictCheck.enabled(關閉 → 不登錄 RS4 待判);明給者優先;皆無 → 登錄', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const e = env({ notes: done(['a', 'b']), edges: [edge] })
        const L = openRelateLedgers(e.ctx.deps.dirs.state)
        const retire = async () => retireEdge({ relations: e.relations, ledgers: L, stateDir: e.ctx.deps.dirs.state }, await e.relations.get(edge.id), { reason: 'std-retire', at: OLD, conflictTypes: DOMAIN.conflictTypeNames })
        const off = { ...e.opsDeps, settings: resolveRelateSettings({ relate: { standards: { conflictCheck: { enabled: false } } } }) }
        const on = { ...e.opsDeps, settings: resolveRelateSettings({ relate: { standards: { conflictCheck: { enabled: true } } } }) }
        await retire()
        assert.equal((await restoreEdge(off, edge.id)).rs4Queued, false, '設定關閉:預演即不登錄')
        assert.equal((await restoreEdge(off, edge.id, { conflictCheck: true })).rs4Queued, true, '明給者優先')
        assert.equal((await restoreEdge(on, edge.id)).rs4Queued, true, '設定開啟:登錄')
        assert.equal((await restoreEdge(e.opsDeps, edge.id)).rs4Queued, true, '無設定:照登錄')
        const r = await restoreEdge(off, edge.id, { apply: true })
        assert.deepEqual([r.applied, r.rs4Queued, await e.holds.get(holdKey(RS4.objectEdge, edge.id, RS4.std))], [true, false, null])
        // restoreNote 帶回之衝突邊同一規則
        const f = env({ notes: done(['x', 'y']), edges: [makeEdge({ from: 'x', to: 'y', type: C, reason: R_CONFLICT, nowIso: OLD })] })
        await deleteNote(f.opsDeps, 'x', { reason: '測試刪除', project: false })
        const rn = await restoreNote({ ...f.opsDeps, settings: resolveRelateSettings({ relate: { standards: { conflictCheck: { enabled: false } } } }) }, 'x', { project: false })
        assert.deepEqual([rn.edgesRestored, rn.rs4Queued, (await f.holds.select()).length], [1, 0, 0])
    })

    it('保留時間(deps.reserveMs／stageRelate 之 opt.reserveMs):扣保留後剩餘不足三席之首家逾時 → 本輪延後(rs4TimeDeferred;新提案入待判、不落地、不呼叫);opt.reserveMs 優先', async () => {
        const mk = () => {
            const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] } })
            // 剩 1,000 秒、核對席首家逾時 300 秒:保留 900 秒 → 延後(正向席首家逾時 60 秒:正向段亦扣保留〔REL-18〕,剩餘 100 秒仍夠,才有新提案可供核對段判延後)
            e.ctx.deps.settings.ai.providerTimeouts['stub:fwd'] = 60_000
            e.ctx.remainingMs = () => 1_000_000
            e.ctx.deps.reserveMs = 900_000
            return e
        }
        const e = mk()
        const r = await e.run()
        assert.deepEqual([r.detail.rs4TimeDeferred, e.calls.filter((c) => c.seg === 'cc').length, await e.relations.get(edgeId('n', 'm'))], [true, 0, null], JSON.stringify(r.detail))
        assert.equal((await e.holds.get(holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std)))?.owner, 'pipeline')
        assert.ok(e.log.lines.some((l) => /^INFO 衝突核對：扣保留時間後剩餘時間不足一次呼叫/.test(l)), e.log.lines.join('\n'))
        const f = mk()
        const rf = await stageRelate({ callAI: f.callAI, reserveMs: 0 }).run(f.ctx)
        assert.deepEqual([rf.detail.rs4TimeDeferred, (await f.relations.get(edgeId('n', 'm')))?.type], [false, C], 'opt.reserveMs 優先')
    })

    it('鏈內續派(保留時間;REL-20):第三席主席等滿逾時後,扣保留之剩餘已不足開工門檻(三席首家逾時之最大值)而仍夠一次遞補 → 鏈內不中止、遞補成交、該項照判(不記 rs4Aborted);剩餘連鏈內門檻亦不足 → 中止(同修前);全鏈皆試過而真的失敗 → 照計失敗(retry、不記中止),不因剩餘不足開工門檻改標中止', async () => {
        // 替身模擬調度層之遞補鏈:第三席之主席「掛起 hangMs」(推進假時鐘)後,於嘗試之間問 co.shouldStop()——true 即回中止(ABORTED),否則由遞補成交
        const mk = (o) => {
            let now = 0
            const e = env({
                notes: [...fresh(['n']), ...done(['m'])],
                forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] },
                check: byPair({ first: () => ({ verdict: 'change', type: T0, reason: R_OTHER }), third: () => ({ verdict: 'change', type: T0, reason: R_OTHER }) }),
            })
            e.ctx.deps.settings.ai.providerTimeouts['stub:fwd'] = 60_000
            e.ctx.deps.settings.ai.providerTimeouts['stub:b'] = 360_000   // 開工門檻＝三席首家逾時之最大值 360 秒
            e.ctx.remainingMs = () => o.totalMs - now
            e.ctx.deps.reserveMs = 900_000
            const seen = []
            const callAI = async (prompt, check, co) => {
                if (co?.segment === 'conflictCheck' && co.seat === 'third') {
                    now += o.hangMs
                    const stop = co.shouldStop()
                    seen.push(stop)
                    if (stop) return { ok: false, data: null, error: 'ABORTED', skipped: true, attempts: 1 }
                    if (o.chainFails) return { ok: false, data: null, error: 'stub fail', skipped: false, attempts: 2 }
                }
                return e.callAI(prompt, check, co)
            }
            return { e, seen, run: () => stageRelate({ callAI }).run(e.ctx) }
        }
        // ①進門時扣保留後剩 420 秒(≥360);主席掛起 300 秒 → 剩 120 秒:不足開工門檻 360、仍夠鏈內門檻 60 → 遞補成交
        const a = mk({ totalMs: 900_000 + 420_000, hangMs: 300_000 })
        const ra = await a.run()
        assert.deepEqual([a.seen, ra.detail.rs4Aborted, ra.detail.rs4Third, ra.detail.rs4Downgraded, (await a.e.relations.get(edgeId('n', 'm')))?.type], [[false], false, 1, 1, T0], JSON.stringify(ra.detail))
        // ②主席掛起 400 秒 → 剩 20 秒:連鏈內門檻亦不足 → 中止、該項留待下輪(不落地、入待判、不計次)
        const b = mk({ totalMs: 900_000 + 420_000, hangMs: 400_000 })
        const rb = await b.run()
        assert.deepEqual([b.seen, rb.detail.rs4Aborted, await b.e.relations.get(edgeId('n', 'm'))], [[true], true, null], JSON.stringify(rb.detail))
        assert.equal((await b.e.holds.get(holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std)))?.owner, 'pipeline')
        // ③全鏈皆試過而真的失敗(非中止;此時剩 120 秒 ≥ 續派門檻)→ 照計失敗:該項 retry(rs4Retry 1、不記 rs4Aborted、不落地),不因剩餘不足開工門檻而改標中止
        const c = mk({ totalMs: 900_000 + 420_000, hangMs: 300_000, chainFails: true })
        const rc = await c.run()
        assert.deepEqual([c.seen, rc.detail.rs4Aborted, rc.detail.rs4Retry, await c.e.relations.get(edgeId('n', 'm'))], [[false], false, 1, null], JSON.stringify(rc.detail))
    })

    it('鏈內續派(既有衝突邊之待判,第一、第二席並行;REL-20):兩席交 AI 之 shouldStop 同以續派門檻判且扣保留——扣保留後剩 299.999 秒(< 開工門檻 300)不停、剩 59.999 秒停', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: '提煉判為非對立', next: '關聯段兩席核對', since: OLD, at: OLD, tries: 0, ctx: { from: 'a', to: 'b', core: 'x' } }
        const e = env({ notes: done(['a', 'b']), edges: [edge], holds: [hold], check: () => ({ verdict: 'change', type: T1, reason: R_OTHER }) })
        const KEEP = 900_000
        const state = { left: KEEP + 2_000_000 }
        e.ctx.remainingMs = () => state.left
        e.ctx.deps.reserveMs = KEEP
        const probes = []
        const callAI = async (prompt, check, co) => {
            if (co?.segment === 'conflictCheck') {
                const keep = state.left
                state.left = KEEP + 299_999
                const a = co.shouldStop()
                state.left = KEEP + 59_999
                const b = co.shouldStop()
                state.left = keep
                probes.push([co.seat, a, b])
            }
            return e.callAI(prompt, check, co)
        }
        await stageRelate({ callAI }).run(e.ctx)
        assert.deepEqual(probes.map((p) => p[0]).sort(), ['first', 'second'])
        assert.deepEqual(probes.map((p) => p.slice(1)), [[false, true], [false, true]])
    })

    it('既有衝突之再提案照常合併(不交核對);既有非衝突邊之升級提案交核對,判非衝突 → 原非衝突邊不變', async () => {
        const c0 = makeEdge({ from: 'n', to: 'm', type: C, reason: R_CONFLICT, nowIso: OLD })
        const t0 = makeEdge({ from: 'n', to: 'k', type: T0, reason: R_OTHER, nowIso: OLD })
        const e = env({
            notes: [{ id: 'n', relatedAt: '2026-01-02T00:00:00+08:00', knowledgeChangedAt: '2026-02-01T00:00:00+08:00' }, ...done(['m', 'k'])],
            edges: [c0, t0],
            forward: { 標題n: [{ to: 'm', type: C, reason: R_FIX }, { to: 'k', type: C, reason: R_CONFLICT }] },
            check: byPair({ first: () => ({ verdict: 'change', type: T0, reason: R_OTHER }), third: () => ({ verdict: 'change', type: T0, reason: R_OTHER }) }),
        })
        const rep = await e.run()
        const det = rep.result?.detail || rep.detail
        assert.equal(det.rs4Deferred, 1, '只有 k 之升級交核對')
        assert.equal((await e.relations.get(t0.id)).type, T0)
        assert.equal((await e.relations.get(c0.id)).type, C)
        const n = await e.notes.get('n')
        assert.match(n.relatedPicks, /\bk\b/, '交核對之提案仍記為本版本選中之鄰居(重評否決用)')
    })

    // ─── 還原之邊與 RS4(2026-10-05 審查 A-A3;relate/ops/noteOps 檔頭【還原之邊與 AI 標準】) ───

    it('隔離之衝突邊:待判之下一步寫 restoreEdge(邊 id、opt.apply)或 waiveHold;使用者以 restoreEdge 還原＝裁示為真衝突 → 待判結案、檢核記合格(seats user)、存量不再重排、不再派兩席(不再隔離而迴圈)', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} }
        let judge = true
        const e = env({
            notes: done(['a', 'b']), edges: [edge], holds: [hold], relate: { standards: { conflictCheck: { perRun: 5 } } },
            check: byPair({ first: () => (judge ? { verdict: 'keep' } : { verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }), second: () => ({ verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }), third: () => PANEL_UNSURE }),
        })
        await e.run()
        assert.equal(await e.relations.get(edge.id), null, '前提:判不了 → 隔離')
        const h1 = await e.holds.get(hold.id)
        assert.deepEqual([h1.status, h1.owner], ['open', 'user'])
        assert.equal(h1.next, `使用者判讀：確認為真衝突者以 restoreEdge（邊 ${edge.id}，opt.apply）還原（即裁示為真衝突：本待判結案、記檢核，不再自動核對此值）；否則豁免（waiveHold：維持隔離）`)
        // 預演:可還原、將視為裁示,不寫
        const p = await restoreEdge(e.opsDeps, edge.id)
        assert.deepEqual([p.restorable, p.applied, p.ruling, (await e.holds.get(hold.id)).status], [true, false, 'RS4', 'open'])
        const r = await restoreEdge(e.opsDeps, edge.id, { apply: true })
        assert.deepEqual([r.applied, r.retiredAs, r.ruling, r.rs4Queued], [true, 'rs4-quarantine', 'RS4', false])
        const h2 = await e.holds.get(hold.id)
        assert.equal(h2.status, 'resolved')
        assert.equal(h2.how, '使用者以 restoreEdge 還原（撤出理由 rs4-quarantine）——裁示為真衝突；此值不再自動核對')
        const chk = await e.checks.get(checkKey(RS4.objectEdge, edge.id))
        assert.deepEqual([chk.results.RS4.status, chk.results.RS4.seats, chk.hash], ['pass', 'user', await hashOf(e, await e.relations.get(edge.id))], '還原路徑之雜湊與關聯段同一算法(含素材)')
        // 下一輪(存量配額 5;核對席此時會判撤出):不重排、不呼叫、邊仍在
        judge = false
        const n0 = e.calls.filter((c) => c.seg === 'cc').length
        const rep = await e.run()
        assert.equal(e.calls.filter((c) => c.seg === 'cc').length, n0, '已裁示之值不再派兩席')
        assert.ok(await e.relations.get(edge.id), '不再隔離(無迴圈)')
        assert.deepEqual([rep.detail.rs4Done, rep.detail.rs4Total], [1, 1])
    })

    it('其餘還原之衝突邊(他種撤出理由之 restoreEdge、還原筆記帶回):檢核紀錄未涵蓋現值 → 登錄 RS4 待判(pipeline)→ 下輪兩席核對;已核合格之同一值不登錄;conflictCheck:false 不登錄;未開 holds／checks 略過', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const e = env({ notes: done(['a', 'b', 'c']), edges: [edge] })
        const L = openRelateLedgers(e.ctx.deps.dirs.state)
        await retireEdge({ relations: e.relations, ledgers: L, stateDir: e.ctx.deps.dirs.state }, edge, { reason: 'std-retire', at: OLD, conflictTypes: DOMAIN.conflictTypeNames })
        const pv = await restoreEdge(e.opsDeps, edge.id)
        assert.deepEqual([pv.ruling, pv.rs4Queued, await e.holds.get(holdKey(RS4.objectEdge, edge.id, RS4.std))], ['', true, null], '預演:將登錄、不寫')
        assert.equal((await restoreEdge(e.opsDeps, edge.id, { apply: true, conflictCheck: false })).rs4Queued, false, '衝突核對未開啟:不登錄')
        await retireEdge({ relations: e.relations, ledgers: L, stateDir: e.ctx.deps.dirs.state }, edge, { reason: 'std-retire', at: OLD, conflictTypes: DOMAIN.conflictTypeNames })
        const r = await restoreEdge(e.opsDeps, edge.id, { apply: true })
        assert.deepEqual([r.applied, r.ruling, r.rs4Queued], [true, '', true])
        const h = await e.holds.get(holdKey(RS4.objectEdge, edge.id, RS4.std))
        assert.deepEqual([h.status, h.owner, h.ctx.restoredFrom], ['open', 'pipeline', 'std-retire'])
        assert.equal(h.reason, 'restoreEdge 還原（撤出理由 std-retire）之衝突邊尚未經衝突核對（RS4）')
        assert.equal(h.next, '下輪衝突核對兩席核對（relate.standards.conflictCheck.enabled 開啟時）')
        // 下輪:衝突核對段以兩席核對 → 成立 → 待判結案、檢核合格
        const rep = await e.run()
        assert.deepEqual([rep.detail.rs4Holds, rep.detail.rs4Kept, (await e.holds.get(h.id)).status], [1, 1, 'resolved'])
        assert.equal((await e.checks.get(checkKey(RS4.objectEdge, edge.id))).results.RS4.status, 'pass')
        // 未開 holds／checks(舊 deps):照常還原、不登錄
        await retireEdge({ relations: e.relations, ledgers: L, stateDir: e.ctx.deps.dirs.state }, await e.relations.get(edge.id), { reason: 'std-retire', at: OLD, conflictTypes: DOMAIN.conflictTypeNames })
        const r0 = await restoreEdge(e.restoreDeps, edge.id, { apply: true })
        assert.deepEqual([r0.applied, r0.rs4Queued], [true, false])
        // 還原筆記帶回之衝突邊:已核合格之同一值 → 不登錄;未核者 → 登錄
        const f = env({ notes: done(['x', 'y', 'z']), edges: [makeEdge({ from: 'x', to: 'y', type: C, reason: R_CONFLICT, nowIso: OLD }), makeEdge({ from: 'x', to: 'z', type: C, reason: R_FIX, nowIso: OLD })] })
        const xy = await f.relations.get(edgeId('x', 'y'))
        await recordCheck(f.checks, { object: RS4.objectEdge, oid: xy.id, hash: await hashOf(f, xy), std: RS4.std, v: RS4.v, at: OLD, status: 'pass', seats: 'p1|p2' })
        await deleteNote(f.opsDeps, 'x', { reason: '測試刪除', project: false })
        const rn = await restoreNote(f.opsDeps, 'x', { project: false })
        assert.deepEqual([rn.edgesRestored, rn.rs4Queued], [2, 1])
        assert.equal(await f.holds.get(holdKey(RS4.objectEdge, xy.id, RS4.std)), null, '已核合格之同一值不登錄')
        assert.match((await f.holds.get(holdKey(RS4.objectEdge, edgeId('x', 'z'), RS4.std))).reason, /^還原筆記 x 帶回之衝突邊尚未經衝突核對/)
    })

    it('存量進度 rs4Done／rs4Total(與 RS6 同口徑;審查 A-B14、B-M6):各返回點皆計;核一條即進度前進;檢核雜湊含型別定義版本;stockProgressOf 純函數', async () => {
        const e1 = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const e2 = makeEdge({ from: 'c', to: 'd', type: C, reason: R_CONFLICT, nowIso: '2026-01-09T00:00:00+08:00' })
        const e = env({ notes: done(['a', 'b', 'c', 'd']), edges: [e1, e2, makeEdge({ from: 'a', to: 'd', type: T0, reason: R_OTHER, nowIso: OLD })], relate: { standards: { conflictCheck: { perRun: 1 } } } })
        const r1 = await e.run()
        assert.deepEqual([r1.detail.rs4Stock, r1.detail.rs4Done, r1.detail.rs4Total], [1, 1, 2], '非衝突邊不計;核一條')
        const r2 = await e.run()
        assert.deepEqual([r2.detail.rs4Done, r2.detail.rs4Total], [2, 2])
        const r3 = await e.run()
        assert.deepEqual([r3.detail.rs4Checked, r3.detail.rs4Done, r3.detail.rs4Total], [0, 2, 2], '無項可核之早返回亦計進度')
        const chk = await e.checks.get(checkKey(RS4.objectEdge, e1.id))
        assert.equal(chk.hash, await hashOf(e, e1))
        const byId = new Map(['a', 'b', 'c'].map((id) => [id, { id, createdAt: '2026-01-01' }]))
        assert.deepEqual(stockProgressOf({ edges: [e1, e2], conflictType: C, byId, checkOf: () => null, typesVer: 'v' }), { total: 1, done: 0 }, '懸空不計')
    })

    it('既有衝突邊而現行理由確定不合格(RS2／RS8;與既有邊覆核之 keep 對稱):送審時該項附「須以 change 改寫、不可 keep」(其餘項不附);兩席改寫(change 衝突型)→ 過閘改寫(rs4StdFixed、檢核合格);仍判 keep → 其 reason 不當理由用,std-retire(檢核不合格、待判結案、restoreEdge 給 opt.reason 可還原);存量 RS2／RS8 之衝突型邊由既有邊覆核轉交(RS4 待判,同輪核對)', async () => {
        // ①兩席依指示改寫(第一席之理由含兩端皆無之數字而不過閘(RS8)、第二席可用 → 依序)
        const ph = makeEdge({ from: 'a', to: 'b', type: C, reason: 'placeholder', nowIso: OLD })
        const ok = makeEdge({ from: 'c', to: 'd', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = (e, ctx = {}) => ({ id: holdKey(RS4.objectEdge, e.id, RS4.std), object: RS4.objectEdge, oid: e.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx })
        const e = env({ notes: done(['a', 'b', 'c', 'd']), edges: [ph, ok], holds: [hold(ph), hold(ok)], check: byPair({ first: (it) => (it.a === '標題a' ? { verdict: 'change', type: C, reason: '甲說動量年化 37.5% 有效；乙說動量扣成本後無效' } : { verdict: 'keep', reason: '' }), second: (it) => (it.a === '標題a' ? { verdict: 'change', type: C, reason: R_FIX } : { verdict: 'keep', reason: '' }) }) })
        const r = await e.run()
        const p = e.calls.find((c) => c.seg === 'cc' && c.seat === 'first').prompt
        const blockOf = (title) => p.split(/^--- 第\d+項 ---$/m).find((b) => b.includes(`標題：${title}`))
        assert.ok(blockOf('標題a').includes(`現行理由：placeholder（現行理由未達標準：RS2 佔位理由「placeholder」——是真衝突者須以 change（type 填「${C}」）改寫為「甲說…；乙說…」，不可 keep）`), blockOf('標題a'))
        assert.doesNotMatch(blockOf('標題c'), /未達標準/, '現行理由合格之項不附指示(逐字不變)')
        assert.deepEqual([r.detail.rs4StdFixed, r.detail.rs4ReasonFixed, r.detail.rs4Kept, (await e.relations.get(ph.id)).reason], [1, 1, 1, R_FIX], JSON.stringify(r.detail))
        assert.equal((await e.checks.get(checkKey(RS4.objectEdge, ph.id))).results.RS4.status, 'pass')
        assert.equal((await e.holds.get(holdKey(RS4.objectEdge, ph.id, RS4.std))).status, 'resolved')
        // ②仍判 keep(附了看似可用之理由亦不採——keep 之 reason 未定義為理由)→ 撤出、不記合格;可以新理由還原(不視為 AI 標準之裁示)
        const f = env({ notes: done(['a', 'b']), edges: [ph], holds: [hold(ph)], check: () => ({ verdict: 'keep', reason: R_FIX }) })
        const rf = await f.run()
        assert.deepEqual([rf.detail.rs4StdRetired, rf.detail.rs4Kept, await f.relations.get(ph.id)], [1, 0, null])
        assert.equal((await f.checks.get(checkKey(RS4.objectEdge, ph.id))).results.RS4.status, 'violation')
        assert.match((await f.holds.get(holdKey(RS4.objectEdge, ph.id, RS4.std))).how, new RegExp(`已撤出（std-retire；可 restoreEdge（邊 ${ph.id}，opt\\.reason＝新理由、opt\\.apply）還原）$`))
        assert.deepEqual([f.retiredLog().at(-1).reason, f.events().map((x) => x.kind)], ['std-retire', ['retire']], '衝突邊之撤出寫事件帳')
        const back = await restoreEdge(f.opsDeps, ph.id, { apply: true, reason: R_FIX })
        assert.deepEqual([back.applied, back.ruling, back.rs4Queued], [true, '', true], '新理由之值未經核對 → 登錄 RS4 待判')
        // ③既有邊覆核(RS6)之存量 RS2 待判落在衝突型邊 → 轉登錄 RS4 待判(同輪由衝突核對處置),RS6 待判結案並記轉交
        const g = env({ notes: done(['a', 'b']), edges: [ph], relate: { standards: { edgeReview: { enabled: true } } }, check: byPair({ first: () => ({ verdict: 'change', type: C, reason: R_FIX }), second: () => ({ verdict: 'change', type: C, reason: R_FIX }) }) })
        await g.holds.replace({ id: holdKey('edge', ph.id, 'RS6'), object: 'edge', oid: ph.id, std: 'RS6', status: 'open', owner: 'pipeline', reason: '存量 RS2：佔位理由「placeholder」', next: 'n', since: OLD, at: OLD, tries: 0, ctx: { stockStd: 'RS2' } })
        const rg = await g.run()
        const h6 = await g.holds.get(holdKey('edge', ph.id, 'RS6'))
        assert.deepEqual([h6.status, h6.how], ['resolved', '邊為衝突型，存量 RS2 已轉交衝突核對（RS4 待判）'])
        const h4 = await g.holds.get(holdKey(RS4.objectEdge, ph.id, RS4.std))
        assert.deepEqual([h4.ctx.stockStd, h4.status, rg.detail.rs4StdFixed, (await g.relations.get(ph.id)).reason], ['RS2', 'resolved', 1, R_FIX], JSON.stringify(rg.detail))
    })

    it('既有衝突邊之現行理由先做確定性正規化再判(standards/edgeGate 之 reasonRewriteProblemsOf;與既有邊覆核同一函數):簡體而過短者只附 RS2(不附 RS3);簡體而其餘合格者不附指示、兩席 keep → 成立(邊不動)', async () => {
        // 現行理由經正規化仍有 RS3 者於現行字表下不可達(見 unit-relate-standards 之 reasonRewriteProblemsOf 定義案);段內無注入處,不以假字形
        //   冒充——列出之問題之處置與 RS2／RS8 同一路徑(上一案)
        const eS = makeEdge({ from: 'a', to: 'b', type: C, reason: '两篇相关', nowIso: OLD })
        const eF = makeEdge({ from: 'c', to: 'd', type: C, reason: '甲说动量于高波动期失效；乙说动量于高波动期反而更强', nowIso: OLD })
        const hold = (e0) => ({ id: holdKey(RS4.objectEdge, e0.id, RS4.std), object: RS4.objectEdge, oid: e0.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} })
        const e = env({ notes: done(['a', 'b', 'c', 'd']), edges: [eS, eF], holds: [hold(eS), hold(eF)], check: (seat, it) => (it.a === '標題a' ? { verdict: 'change', type: C, reason: R_FIX } : { verdict: 'keep', reason: '' }) })
        const r = await e.run()
        const p = e.calls.find((c) => c.seg === 'cc' && c.seat === 'first').prompt
        const blockOf = (title) => p.split(/^--- 第\d+項 ---$/m).find((b) => b.includes(`標題：${title}`))
        assert.ok(blockOf('標題a').includes(`（現行理由未達標準：RS2 去空泛片語與標點後只剩 4 字（須 ≥10）——是真衝突者須以 change（type 填「${C}」）改寫為「甲說…；乙說…」，不可 keep）`), blockOf('標題a'))
        assert.doesNotMatch(blockOf('標題a'), /RS3/, '正體可修者不列')
        assert.doesNotMatch(blockOf('標題c'), /未達標準/, '只有正體之違反(可確定性修正)→ 不附指示')
        assert.deepEqual([r.detail.rs4StdFixed, r.detail.rs4Kept, r.detail.rs4StdRetired], [1, 1, 0], JSON.stringify(r.detail))
        assert.deepEqual([(await e.relations.get(eS.id)).reason, (await e.relations.get(eF.id)).reason], [R_FIX, eF.reason], '成立 → 邊不動')
        assert.equal((await e.checks.get(checkKey(RS4.objectEdge, eF.id))).results.RS4.status, 'pass')
    })

    it('既有邊覆核轉交衝突型之存量待判時依存量之豁免規則(standards/edgeQueue 之 stockWaiverKeyOf):RS4 待判已豁免而其來源即同一標準 → 不重開(RS6 待判結案並記之、不派兩席);豁免無來源(他問題)→ 照轉交,前段之裁示留於 RS4 待判之 history', async () => {
        const ph = makeEdge({ from: 'a', to: 'b', type: C, reason: 'placeholder', nowIso: OLD })
        const rs6 = { id: holdKey('edge', ph.id, 'RS6'), object: 'edge', oid: ph.id, std: 'RS6', status: 'open', owner: 'pipeline', reason: '存量 RS2：佔位理由「placeholder」', next: 'n', since: OLD, at: OLD, tries: 0, ctx: { stockStd: 'RS2' } }
        const rs4 = (ctx) => ({ id: holdKey(RS4.objectEdge, ph.id, RS4.std), object: RS4.objectEdge, oid: ph.id, std: RS4.std, status: 'waived', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, waivedBy: '使用者', ruling: '維持現行理由', waivedAt: OLD, ctx })
        const votes = byPair({ first: () => ({ verdict: 'change', type: C, reason: R_FIX }), second: () => ({ verdict: 'change', type: C, reason: R_FIX }) })
        // 同一問題(來源 RS2)已豁免 → 不重開
        const g = env({ notes: done(['a', 'b']), edges: [ph], holds: [rs6, rs4({ stockStd: 'RS2' })], relate: { standards: { edgeReview: { enabled: true } } }, check: votes })
        await g.run()
        const h6 = await g.holds.get(rs6.id)
        assert.deepEqual([h6.status, h6.how], ['resolved', '邊為衝突型，存量 RS2 之同一問題使用者已於衝突核對豁免（不重開）'])
        assert.deepEqual([(await g.holds.get(rs4({}).id)).status, g.calls.filter((c) => c.seg === 'cc').length, (await g.relations.get(ph.id)).reason], ['waived', 0, 'placeholder'])
        // 豁免無來源(如型別判不了之裁示)→ 照轉交(同輪核對),前段之豁免留存
        const f = env({ notes: done(['a', 'b']), edges: [ph], holds: [rs6, rs4({})], relate: { standards: { edgeReview: { enabled: true } } }, check: votes })
        const rf = await f.run()
        assert.equal((await f.holds.get(rs6.id)).how, '邊為衝突型，存量 RS2 已轉交衝突核對（RS4 待判）')
        const h4 = await f.holds.get(rs4({}).id)
        assert.deepEqual([h4.status, h4.ctx.stockStd, h4.history.map((x) => [x.status, x.ruling]), rf.detail.rs4StdFixed], ['resolved', 'RS2', [['waived', '維持現行理由']], 1], JSON.stringify(rf.detail))
    })

    it('逾次改由使用者之待判:下一步寫 requestRetry／waiveHold(本段只消化 pipeline 或要求重試者;不再寫「下輪衝突核對重判」)', async () => {
        const seats = { first: { use: 'stub:a' }, second: { use: 'stub:b' }, third: null }
        const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] }, seats, providers: { first: 'stub:fwd' }, relate: { standards: { conflictCheck: { maxTries: 2 } } } })
        await e.run()
        const id = holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std)
        assert.deepEqual([(await e.holds.get(id)).owner, (await e.holds.get(id)).next], ['pipeline', '下輪衝突核對重判'])
        await e.run()
        const h = await e.holds.get(id)
        assert.equal(h.owner, 'user')
        assert.equal(h.next, '逾 2 次未得判定，改由使用者：要求重試（requestRetry：換席重判）或豁免（waiveHold：提案不落地）')
    })

    // ─── P3b(2026-10-29 終審 D3):兄弟段與待判生命週期 ───

    it('待判生命週期(終審 D3 R57／A2／R58／R66;原則①同一處境同一處置、⑤使用者之裁示不被自動流程推翻):存量不重排有未結待判(任何負責者)或豁免仍涵蓋現值之邊,豁免後邊再變者重排;過時待判不分負責者結案(已非衝突、已撤出、端點不在),隔離之使用者待判除外;使用者要求重試而又未得判定 → 負責者與下一步不改、只記原因與 tries', async () => {
        const T6 = '2026-01-06T00:00:00+08:00'
        const ab = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const cd = makeEdge({ from: 'c', to: 'd', type: C, reason: R_CONFLICT, nowIso: OLD })
        const ef = makeEdge({ from: 'e', to: 'f', type: C, reason: R_CONFLICT, nowIso: '2026-01-09T00:00:00+08:00' })
        const gh = makeEdge({ from: 'g', to: 'h', type: T0, reason: R_OTHER, nowIso: OLD })
        const ij = makeEdge({ from: 'i', to: 'j', type: C, reason: R_CONFLICT, nowIso: OLD })
        const kl = makeEdge({ from: 'k', to: 'l', type: C, reason: R_CONFLICT, nowIso: OLD })
        const mn = makeEdge({ from: 'm', to: 'n', type: C, reason: R_CONFLICT, nowIso: OLD })
        const op = makeEdge({ from: 'o', to: 'p', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = (e0, o = {}) => ({ id: holdKey(RS4.objectEdge, e0.id, RS4.std), object: RS4.objectEdge, oid: e0.id, std: RS4.std, status: 'open', owner: 'user', reason: 'r', next: 'N', since: OLD, at: OLD, tries: 2, ctx: {}, ...o })
        const waived = (e0) => ({ ...hold(e0), status: 'waived', owner: 'pipeline', waivedAt: T6, waivedBy: '使用者', ruling: '維持' })
        const e = env({
            notes: done(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'k', 'l', 'm', 'n', 'o', 'p']), edges: [ab, cd, ef, gh, ij, kl, mn, op],
            holds: [hold(ab), waived(cd), waived(ef), hold(gh), hold(ij), hold(kl, { retryRequestedAt: T6 }), hold(mn), hold(op)],
            relate: { standards: { conflictCheck: { perRun: 9, maxTries: 3 } } },
            check: (seat, it) => (seat === 'second' && it.a === '標題k' ? null : { verdict: 'keep', reason: '' }),
        })
        // mn 已隔離(稽核最後一列 rs4-quarantine):使用者待判之問題「是否還原」仍成立,不結案;op 以他理由撤出 → 結案「邊已撤出」
        const ro = { relations: e.relations, ledgers: openRelateLedgers(e.ctx.deps.dirs.state), stateDir: e.ctx.deps.dirs.state }
        await retireEdge(ro, mn, { reason: 'rs4-quarantine', at: OLD, conflictTypes: DOMAIN.conflictTypeNames })
        await retireEdge(ro, op, { reason: 'std-retire', at: OLD, conflictTypes: DOMAIN.conflictTypeNames })
        const r = await e.run()
        const H = (e0) => e.holds.get(hold(e0).id)
        // 存量:ab 有未結(使用者)不重排;cd 之豁免晚於邊時刻 → 不重排;ef 之邊時刻晚於豁免 → 重排;kl 為要求重試之使用者待判(入列,非存量)
        assert.deepEqual([r.detail.rs4Stock, r.detail.rs4Holds, r.detail.rs4Kept, r.detail.rs4Retry], [1, 1, 1, 1], JSON.stringify(r.detail))
        const seen = e.calls.filter((c) => c.seg === 'cc').map((c) => c.prompt).join('\n')
        assert.ok(seen.includes('標題：標題e') && seen.includes('標題：標題k') && !seen.includes('標題：標題a') && !seen.includes('標題：標題c'), '只送 ef(存量)與 kl(要求重試)')
        assert.deepEqual([(await H(ab)).status, (await H(ab)).tries, (await H(cd)).status], ['open', 2, 'waived'], '使用者待判與豁免原樣')
        assert.deepEqual([(await H(gh)).status, (await H(gh)).how], ['resolved', `邊已非衝突（現為「${T0}」）`], '不分負責者結案')
        assert.deepEqual([(await H(ij)).status, (await H(ij)).how], ['resolved', '端點筆記已不在'])
        assert.deepEqual([(await H(mn)).status, (await H(op)).status, (await H(op)).how], ['open', 'resolved', '邊已撤出'], '隔離者不結案、他理由撤出者結案')
        const hk = await H(kl)
        assert.deepEqual([hk.status, hk.owner, hk.next, hk.tries, hk.reason], ['open', 'user', 'N', 3, '判定小組未成立（缺票（呼叫失敗或回覆不合格））'], '要求重試而未得判定:負責者與下一步不改、只記原因與 tries')
    })

    it('陳舊(終審 D3 R59;原則③未判不記已審):核對期間邊已被改寫 → 本輪不判:不記 tries、待判一字不動、不寫核對帳、不記檢核、邊不動(下輪再核)', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 1, ctx: {} }
        const e = env({ notes: done(['a', 'b']), edges: [edge], holds: [hold], check: () => ({ verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }) })
        const callAI = async (p, c, co) => {
            if (co?.segment === 'conflictCheck' && co.seat === 'first') await e.relations.replace({ ...edge, reason: R_FIX }) // 核對期間他處改寫
            return e.callAI(p, c, co)
        }
        const rep = await stageRelate({ callAI }).run(e.ctx)
        assert.deepEqual([rep.detail.rs4Stale, rep.detail.rs4Checked, rep.detail.rs4Retired], [1, 1, 0], JSON.stringify(rep.detail))
        assert.deepEqual(await e.holds.get(hold.id), hold, '待判一字不動')
        assert.deepEqual([e.ccLog(), e.retiredLog(), await e.checks.get(checkKey(RS4.objectEdge, edge.id)), (await e.relations.get(edge.id)).reason], [[], [], null, R_FIX])
    })

    it('待判重建之提案判 keep 亦過納入閘(終審 D3 R72;原則④未能判定不得算合格):理由含兩端皆無之數字 → std-reject、待判重試(tries＋1);截短原字數 reasonCut 存於 ctx、重建時帶回、落地之邊保留、提案時刻不變', async () => {
        const bad = { id: holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std), object: RS4.objectProposal, oid: edgeId('n', 'm'), std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: { from: 'n', to: 'm', reason: '甲說年化 37.5%；乙說同期 -12.25%', proposer: 'stub:fwd', segment: 'forward', proposedAt: OLD } }
        const e = env({ notes: done(['n', 'm']), holds: [bad] })
        const r = await e.run()
        const h = await e.holds.get(bad.id)
        assert.deepEqual([r.detail.rs4StdRejected, r.detail.rs4Written, h.status, h.owner, h.tries, await e.relations.get(edgeId('n', 'm'))], [1, 0, 'open', 'pipeline', 1, null], JSON.stringify(r.detail))
        assert.match(h.reason, /^提案之理由未達標準（RS8 /)
        assert.deepEqual(e.ccLog().map((x) => [x.entry, x.outcome]), [['hold:edge-proposal', 'std-reject']])
        const cut = { ...bad, ctx: { ...bad.ctx, reason: R_CONFLICT, reasonCut: '260' } }
        const f = env({ notes: done(['n', 'm']), holds: [cut] })
        await f.run()
        const w = await f.relations.get(edgeId('n', 'm'))
        assert.deepEqual([w?.type, w?.reasonCut, w?.createdAt], [C, 260, OLD], '帶回截短原字數、提案時刻不變')
    })

    it('同邊多提案依提案全序取最優(終審 D3 sol A4;與完成順序無關):前輪持久之提案(較早)與本輪正向之提案同對 → 取提案時刻早者核對,同一登錄結案(不重登、不累加 tries)', async () => {
        const old = { id: holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std), object: RS4.objectProposal, oid: edgeId('n', 'm'), std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: { from: 'n', to: 'm', reason: R_FIX, proposer: 'stub:old', segment: 'reverse', proposedAt: OLD } }
        const e = env({ notes: [...fresh(['n']), ...done(['m'])], holds: [old], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] } })
        const r = await e.run()
        const w = await e.relations.get(edgeId('n', 'm'))
        assert.deepEqual([r.detail.rs4Proposals, r.detail.rs4Holds, r.detail.rs4Checked, w?.reason, w?.createdAt], [1, 0, 1, R_FIX, OLD], JSON.stringify(r.detail))
        const h = await e.holds.get(old.id)
        assert.deepEqual([h.status, h.how, h.tries, h.history?.length || 0], ['resolved', '核對成立，衝突邊落地', 0, 0])
        assert.deepEqual(e.ccLog().map((x) => [x.entry, x.outcome, x.segment]), [['proposal', 'written', 'reverse']])
    })

    it('使用者豁免之提案(提案不落地)而理由未變者不重提(終審 D3 A3;原則⑤值變了才重提):計 rs4Waived、不呼叫核對、INFO 一句;理由已變 → 重提(登錄重開,前段裁示留於 history)', async () => {
        const wv = { id: holdKey(RS4.objectProposal, edgeId('n', 'm'), RS4.std), object: RS4.objectProposal, oid: edgeId('n', 'm'), std: RS4.std, status: 'waived', owner: 'user', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, waivedAt: OLD, waivedBy: '使用者', ruling: '提案不落地', ctx: { from: 'n', to: 'm', reason: R_CONFLICT, proposer: 'stub:fwd', segment: 'forward', proposedAt: OLD } }
        const e = env({ notes: [...fresh(['n']), ...done(['m'])], holds: [wv], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] } })
        const r = await e.run()
        assert.deepEqual([r.detail.rs4Waived, r.detail.rs4Deferred, r.detail.rs4Proposals, e.calls.filter((c) => c.seg === 'cc').length, await e.relations.get(edgeId('n', 'm')), (await e.holds.get(wv.id)).status], [1, 0, 0, 0, null, 'waived'], JSON.stringify(r.detail))
        assert.ok(e.log.lines.some((l) => /^INFO 關聯：\[\[n\]\] ⇄ \[\[m\]\] 之衝突提案使用者已豁免（提案不落地）且理由未變，不重提$/.test(l)), e.log.lines.join('\n'))
        const f = env({ notes: [...fresh(['n']), ...done(['m'])], holds: [wv], forward: { 標題n: [{ to: 'm', type: C, reason: R_FIX }] } })
        const rf = await f.run()
        const h = await f.holds.get(wv.id)
        assert.deepEqual([rf.detail.rs4Waived, rf.detail.rs4Deferred, (await f.relations.get(edgeId('n', 'm')))?.reason, h.status, h.history.map((x) => [x.status, x.ruling])], [0, 1, R_FIX, 'resolved', [['waived', '提案不落地']]])
    })

    it('隔離先登錄使用者待判、記檢核(未能判定),後撤邊(終審 D3 opusB A4／sol A9;原則⑥先記後寫)', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const hold = { id: holdKey(RS4.objectEdge, edge.id, RS4.std), object: RS4.objectEdge, oid: edge.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} }
        const e = env({ notes: done(['a', 'b']), edges: [edge], holds: [hold], check: byPair({ first: () => ({ verdict: 'keep' }), second: () => ({ verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }), third: () => PANEL_UNSURE }) })
        const ops = []
        for (const [store, name] of [[e.holds, 'hold'], [e.checks, 'check']]) {
            const f = store.replace.bind(store)
            store.replace = async (x) => {
                ops.push(name)
                return f(x)
            }
        }
        const del = e.relations.del.bind(e.relations)
        e.relations.del = async (id) => {
            ops.push('del')
            return del(id)
        }
        const r = await e.run()
        assert.deepEqual([r.detail.rs4Quarantined, await e.relations.get(edge.id)], [1, null])
        assert.deepEqual(ops.filter((x, i) => ops.indexOf(x) === i), ['hold', 'check', 'del'], `先登錄、記檢核,後撤邊:${ops.join('→')}`)
    })

    it('中止與未判完之彙總含衝突核對(終審 R73):額度中止 → rs4Aborted、rs4Stopped 與關聯段之 aborted、stopped 皆真', async () => {
        const e = env({ notes: [...fresh(['n']), ...done(['m'])], forward: { 標題n: [{ to: 'm', type: C, reason: R_CONFLICT }] }, fail: () => 'skip' })
        const rep = await e.run()
        assert.deepEqual([rep.detail.rs4Aborted, rep.detail.rs4Stopped, rep.detail.aborted, rep.detail.stopped], [true, true, true, true])
    })

    it('入項前預檢(終審 D8;與既有邊覆核同一件 standards/edgeQueue 之 stockSourceResolvedOf):存量排入之 RS4 待判(ctx.stockStd)而來源標準現值已合格 → 結案(rs4SourceResolved)、不送兩席、不記檢核;仍違反 → 照送兩席改寫', async () => {
        const fixed = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const still = makeEdge({ from: 'c', to: 'd', type: C, reason: 'placeholder', nowIso: OLD })
        const hold = (x) => ({ id: holdKey(RS4.objectEdge, x.id, RS4.std), object: RS4.objectEdge, oid: x.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: '存量 RS2（衝突型）：佔位理由', next: 'n', since: OLD, at: OLD, tries: 0, ctx: { from: x.from, to: x.to, stockStd: 'RS2' } })
        const e = env({ notes: done(['a', 'b', 'c', 'd']), edges: [fixed, still], holds: [hold(fixed), hold(still)], check: () => ({ verdict: 'change', type: C, reason: R_FIX }) })
        const r = await e.run()
        assert.deepEqual([r.detail.rs4SourceResolved, r.detail.rs4Holds, r.detail.rs4Checked, r.detail.rs4StdFixed], [1, 1, 1, 1], JSON.stringify(r.detail))
        const hf = await e.holds.get(holdKey(RS4.objectEdge, fixed.id, RS4.std))
        assert.deepEqual([hf.status, hf.how, await e.checks.get(checkKey(RS4.objectEdge, fixed.id))], ['resolved', '存量 RS2 之違反已不在（現值已合格），不送兩席', null])
        assert.deepEqual([(await e.holds.get(holdKey(RS4.objectEdge, still.id, RS4.std))).status, (await e.relations.get(still.id)).reason], ['resolved', R_FIX])
        const p = e.calls.find((c) => c.seg === 'cc' && c.seat === 'first').prompt
        assert.deepEqual([p.includes('標題：標題a'), p.includes('標題：標題c')], [false, true], '已合格者不送審')
    })

    it('AI 改寫之逆(終審 D16;ops/noteOps 之 revertEdgeRevision):核對降級後撤回 → 回復衝突型(過閘)、核對帳 reverted、視為 RS4 裁示(檢核 user 合格、下輪不再核對);不另寫衝突事件;改寫前之值不合標準(存量 RS2 之改寫)→ 不可逆', async () => {
        const edge = makeEdge({ from: 'a', to: 'b', type: C, reason: R_CONFLICT, nowIso: OLD })
        const ph = makeEdge({ from: 'c', to: 'd', type: C, reason: 'placeholder', nowIso: OLD })
        const hold = (x, ctx = {}) => ({ id: holdKey(RS4.objectEdge, x.id, RS4.std), object: RS4.objectEdge, oid: x.id, std: RS4.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx })
        const e = env({ notes: done(['a', 'b', 'c', 'd']), edges: [edge, ph], holds: [hold(edge), hold(ph)], relate: { standards: { conflictCheck: { perRun: 5 } } }, check: (seat, it) => (it.a === '標題a' ? { verdict: 'change', type: T1, reason: R_OTHER } : { verdict: 'change', type: C, reason: R_FIX }) })
        const r0 = await e.run()
        assert.deepEqual([r0.detail.rs4Downgraded, r0.detail.rs4StdFixed, (await e.relations.get(edge.id)).type], [1, 1, T1], '前提:降級與存量改寫已落地')
        const p = await revertEdgeRevision(e.opsDeps, edge.id)
        assert.deepEqual([p.ledger, p.std, p.revertible, p.applied, p.from, p.to, p.ruling, p.rs4Queued], ['conflictCheck', RS4.std, true, false, { type: T1, reason: R_OTHER }, { type: C, reason: R_CONFLICT }, RS4.std, false])
        assert.equal(p.revertOf, e.ccLog().find((x) => x.edgeId === edge.id && x.outcome === 'downgrade').at)
        const r = await revertEdgeRevision(e.opsDeps, edge.id, { apply: true })
        const cur = await e.relations.get(edge.id)
        assert.deepEqual([r.applied, r.ruling, cur.type, cur.reason], [true, RS4.std, C, R_CONFLICT])
        assert.deepEqual(e.events().map((x) => x.kind), ['downgrade'], '回復衝突型不寫事件(事件只記撤銷與降級)')
        const chk = await e.checks.get(checkKey(RS4.objectEdge, edge.id))
        assert.deepEqual([chk.results.RS4.status, chk.results.RS4.seats, chk.hash], ['pass', 'user', await hashOf(e, cur)])
        assert.deepEqual([e.ccLog().at(-1).outcome, e.ccLog().at(-1).revertOf, e.ccLog().at(-1).written], ['reverted', p.revertOf, { type: C, reason: R_CONFLICT }])
        // 下一輪(存量配額 5):已裁示之值不再核對、不呼叫
        const n0 = e.calls.filter((c) => c.seg === 'cc').length
        const rep = await e.run()
        assert.deepEqual([e.calls.filter((c) => c.seg === 'cc').length, (await e.relations.get(edge.id)).type, rep.detail.rs4Done], [n0, C, 2])
        // 存量 RS2 之改寫(placeholder → R_FIX):改寫前之值不過閘 → 不可逆
        const rq = await revertEdgeRevision(e.opsDeps, ph.id, { apply: true })
        assert.deepEqual([rq.ledger, rq.revertible, rq.applied], ['conflictCheck', false, false])
        assert.match(rq.reason, /^改寫前之值未達檢定標準：RS2 佔位理由「placeholder」/)
        assert.equal((await e.relations.get(ph.id)).reason, R_FIX)
    })

})
