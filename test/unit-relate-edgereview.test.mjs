// unit-relate-edgereview.test.mjs — 檢定標準 RS6(內容未變之非衝突型既有邊:仍成立、型別正確——含漏標之衝突——、理由具體):純函數與既有邊覆核段
// 規格:standards/registry.mjs 之 RS6(未變邊從不覆核 → 另寫覆核提示詞與題組、逐邊檢核紀錄、配額與完成期限;漏標與具體與否併入裁決;
//   未判之邊以 quarantine 撤出、可還原)、規則帳本 STD-19。
// 執行:自套件根 npx mocha test/unit-relate-edgereview.test.mjs(暫存 test/_tmp/relate-er-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, deepMerge, memStore, genClockTZ, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { PANEL_UNSURE } from '../src/core/summarizePackage.mjs'
import { checkKey } from '../src/core/stores/checks.mjs'
import { holdKey, waiveHold, sha1, readJsonlRows } from '../src/core/capturePackage.mjs'
import { openRelateLedgers } from '../src/stores/relateLedgers.mjs'
import { retireEdge } from '../src/stores/edgeRetire.mjs'
import { RS4 } from '../src/stores/conflictCheckPolicy.mjs'
import { RELATE_HOLD_NEXT } from '../src/stores/relateHolds.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { makeEdge, edgeId } from '../src/stores/edgeStore.mjs'
import { edgeCheckHashOf, relationTypesVersionOf } from '../src/stores/edgeCheckKit.mjs'
import { createCheckHasher } from '../src/stores/checkMaterial.mjs'
import { RS6, reviewVerdictOf, rs6ClassOf, rs6DecisionOf, reviewQueueOf } from '../src/stores/edgeReviewPolicy.mjs'
import { restoreEdge, revertEdgeRevision } from '../src/ops/noteOps.mjs'
import { queueEdgeReview } from '../src/standards/edgeQueue.mjs'
import { readConflictEvents } from '../src/stores/conflictEvents.mjs'
import { RELATE_CTX_FLAGS } from '../src/logContract.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const C = DOMAIN.conflictType
const [T0, T1, T2] = DOMAIN.relationTypes.filter((t) => t !== C)
// 型別角色(封閉清單:同族／互補 → 實作／延伸;預設詞彙表為 同類方法／互補搭配 → 實作範例／延伸深化)
const ROLES = DOMAIN.relationTypeRoles
const [SIB, COMP, IMPL, EXT] = [ROLES.sibling, ROLES.complement, ROLES.implementation, ROLES.extension]
const OLD = '2026-01-05T00:00:00+08:00'
const R0 = '兩篇皆以波動度調整部位，屬同一機制之延伸'
const R_NEW = '甲之波動度目標化提供乙之部位縮放所需之波動度估計'
const R_C = '甲說動量於高波動期失效；乙說動量於高波動期反而更強'
const R_RET = '兩篇只是題材撞名，沒有共同的機制或參數'
let seq = 0

/**
 * 環境:已關聯之筆記(md 含一句話重點、核心知識、適用條件)與既有邊;AI 替身依 segment 'edgeReview' 回票
 * @param {Object} o 輸入 { notes, edges, holds, checks, review:(seat, { a, b, index })=>票|'unsure'|null, cc:(seat, { a, b, index })=>票(衝突核對之替身;開啟衝突核對時用),
 *   providers, relate(settings.relate 之覆寫), seats(relate.standards.ai 整組), fail:(seat)=>'skip'|'fail'|null }
 * @returns {Object} 回傳 { ctx, relations, holds, checks, log, calls, run, erLog, retiredLog, restoreDeps }
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
    const checks = memStore(o.checks || [])
    const log = recLog()
    const calls = []
    const providers = { first: 'stub:a', second: 'stub:b', third: 'stub:c', ...(o.providers || {}) }
    const deps = {
        stores: { notes, relations, holds, checks },
        settings: resolveRelateSettings(deepMerge({
            ai: { parallel: 1, timeoutMs: 300_000, providerTimeouts: {} },
            relate: {
                rounds: 2, notesPerCall: 6, candidatesPerNote: 15, ai: { use: 'stub:fwd' }, reverse: { perRun: 0 }, reeval: { perRun: 0 },
                standards: {
                    conflictCheck: { enabled: false },
                    edgeReview: { enabled: true, perRun: 10, pageSize: 10, maxTries: 3 },
                    ai: o.seats || { first: { use: 'stub:a' }, second: { use: 'stub:b' }, third: { use: 'stub:c' } },
                },
            },
        }, { relate: o.relate })),
        ai: null,
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: DOMAIN },
    }
    const ctx = bagCtx(deps, log, { remainingMs: () => Infinity, expired: () => false })
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    const callAI = withCheck(async (prompt, check, co) => {
        if (co?.segment === 'edgeReview') {
            calls.push({ seg: 'er', seat: co.seat, prompt })
            const f = typeof o.fail === 'function' ? o.fail(co.seat) : null
            if (f === 'skip') return { ok: false, data: null, error: 'quota', skipped: true, attempts: 1 }
            if (f === 'fail') return { ok: false, data: null, error: 'stub fail', skipped: false, attempts: 1 }
            const items = prompt.split(/^--- 第(\d+)項 ---$/m).slice(1).reduce((acc, x, i, arr) => (i % 2 === 0 ? [...acc, { index: Number(x), body: arr[i + 1] }] : acc), [])
                .map((b) => {
                    const titles = [...b.body.matchAll(/^標題：(.+)$/gm)].map((m) => m[1])
                    return { index: b.index, a: titles[0], b: titles[1] }
                })
            const data = items.map((it) => {
                const v = o.review ? o.review(co.seat, it) : { verdict: 'keep', reason: '' }
                if (v === null) return null
                return v === PANEL_UNSURE ? { index: it.index, verdict: 'unsure', reason: '材料不足以判斷兩篇是否談同一機制' } : { index: it.index, ...v }
            }).filter(Boolean)
            return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: providers[co.seat] }
        }
        if (co?.segment === 'conflictCheck') {
            calls.push({ seg: 'cc', seat: co.seat, prompt })
            const items = prompt.split(/^--- 第(\d+)項 ---$/m).slice(1).reduce((acc, x, i, arr) => (i % 2 === 0 ? [...acc, { index: Number(x), body: arr[i + 1] }] : acc), [])
                .map((b) => {
                    const titles = [...b.body.matchAll(/^標題：(.+)$/gm)].map((m) => m[1])
                    return { index: b.index, a: titles[0], b: titles[1] }
                })
            const data = items.map((it) => ({ index: it.index, ...(o.cc ? o.cc(co.seat, it) : { verdict: 'keep', reason: '' }) }))
            return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: providers[co.seat] }
        }
        calls.push({ seg: co?.segment || 'forward', prompt })
        return { ok: true, data: [], error: '', skipped: false, attempts: 1, providerId: 'stub:fwd' }
    })
    const run = () => stageRelate({ callAI }).run(ctx)
    return {
        ctx, notes, relations, holds, checks, log, calls, run, bag: ctx.bag, callAI,
        erLog: () => readJsonlRows(`${dir}/state/relate-edge-review.jsonl`),
        retiredLog: () => readJsonlRows(`${dir}/state/relate-retired.jsonl`),
        // 還原 AI 標準撤出之邊即裁示,須記檢核紀錄(未開 checks 集合即於寫前拋——終審 D1)
        restoreDeps: { stores: { notes, relations, holds, checks }, dirs: { state: `${dir}/state`, relations: `${dir}/relations` }, domain: DOMAIN, clock },
    }
}

const ids = (xs) => xs.map((id) => ({ id }))
const edge = (from, to, type = T0, reason = R0, at = OLD) => makeEdge({ from, to, type, reason, nowIso: at })
// 檢核雜湊與關聯段同一算法、同一素材讀法(stores/checkMaterial.createCheckHasher)
const hashOf = async (e, x) => createCheckHasher({ byId: new Map([[x.from, await e.notes.get(x.from)], [x.to, await e.notes.get(x.to)]]), domain: DOMAIN, typesVer: relationTypesVersionOf(DOMAIN) }).hashOf(x)
const all = (v) => () => v
const detOf = (rep) => rep.result?.detail || rep.detail || {}

describe('unit-relate-edgereview', function() {

    before(() => {
        TMP = tmpRoot('relate-er')
    })
    after(() => removeRoots([TMP]))

    // ─── 純函數 ───

    it('reviewVerdictOf:keep;change 之型別經對映須在清單、理由 ≥10 字;與現行同型同理由＝keep;retire 理由 ≥10;unsure 合法;其餘＝缺票', () => {
        const o = { relationTypes: DOMAIN.relationTypes, resolveType: DOMAIN.resolveType, current: { type: T0, reason: R0 } }
        assert.deepEqual(reviewVerdictOf({ verdict: 'keep', reason: '' }, o), { verdict: 'keep', reason: '' })
        assert.deepEqual(reviewVerdictOf({ verdict: 'change', type: T0, reason: R0 }, o), { verdict: 'keep', reason: R0 }, '同型同理由＝沒改')
        assert.deepEqual(reviewVerdictOf({ verdict: 'change', type: T0, reason: R_NEW }, o), { verdict: 'change', type: T0, reason: R_NEW })
        assert.deepEqual(reviewVerdictOf({ verdict: 'Change', type: C, reason: R_C }, o), { verdict: 'change', type: C, reason: R_C })
        assert.equal(reviewVerdictOf({ verdict: 'change', type: '清單外', reason: R_NEW }, o), null)
        assert.equal(reviewVerdictOf({ verdict: 'change', type: T1, reason: '太短' }, o), null)
        assert.equal(reviewVerdictOf({ verdict: 'retire', reason: '短' }, o), null)
        assert.equal(reviewVerdictOf({ verdict: 'retire', reason: R_RET }, o).verdict, 'retire')
        assert.equal(reviewVerdictOf({ verdict: 'unsure' }, o), PANEL_UNSURE)
        assert.equal(reviewVerdictOf({ verdict: 'maybe' }, o), null)
        // 型別改正之封閉清單:同族／互補 → 實作／延伸才算改型;其餘非衝突改型 → 同型改理由(保留理由、標 normalized);改為衝突型不受限
        const r = { ...o, conflictType: C, roles: ROLES }
        assert.deepEqual(reviewVerdictOf({ verdict: 'change', type: IMPL, reason: R_NEW }, { ...r, current: { type: SIB, reason: R0 } }), { verdict: 'change', type: IMPL, reason: R_NEW })
        assert.deepEqual(reviewVerdictOf({ verdict: 'change', type: EXT, reason: R_NEW }, { ...r, current: { type: COMP, reason: R0 } }), { verdict: 'change', type: EXT, reason: R_NEW })
        assert.deepEqual(reviewVerdictOf({ verdict: 'change', type: COMP, reason: R_NEW }, { ...r, current: { type: T0, reason: R0 } }), { verdict: 'change', type: T0, reason: R_NEW, normalized: true }, '說得通之型別換成另一個 → 同型改理由')
        assert.deepEqual(reviewVerdictOf({ verdict: 'change', type: C, reason: R_C }, { ...r, current: { type: T0, reason: R0 } }), { verdict: 'change', type: C, reason: R_C })
        assert.deepEqual(reviewVerdictOf({ verdict: 'change', type: T1, reason: R_NEW }, { ...o, current: { type: T0, reason: R0 } }), { verdict: 'change', type: T1, reason: R_NEW }, '無角色表 → 不設限')
    })

    it('rs6DecisionOf 兩層:①類別(related／conflict／none)成立 ②related 再以型別(keep 之型別＝現行)成立 → keep／reason／retype,型別未成立 → type-split(叫第三席);conflict → upgrade;none → retire', () => {
        const cur = { type: T0, reason: R0 }
        const D = (votes) => rs6DecisionOf(votes, { conflictType: C, current: cur })
        const V = (a, b, pa = 'p1', pb = 'p2') => [{ seat: 'first', provider: pa, verdict: a }, { seat: 'second', provider: pb, verdict: b }]
        const keep = { verdict: 'keep', reason: '' }
        const fix = { verdict: 'change', type: T0, reason: R_NEW }
        const toT1 = { verdict: 'change', type: T1, reason: R_NEW }
        const toT2 = { verdict: 'change', type: T2, reason: R_NEW }
        const toC = { verdict: 'change', type: C, reason: R_C }
        const ret = { verdict: 'retire', reason: R_RET }
        assert.deepEqual([rs6ClassOf(keep, C), rs6ClassOf(fix, C), rs6ClassOf(toT1, C), rs6ClassOf(toC, C), rs6ClassOf(ret, C), rs6ClassOf(PANEL_UNSURE, C), rs6ClassOf(null, C)], ['related', 'related', 'related', 'conflict', 'none', PANEL_UNSURE, null])
        assert.equal(D(V(keep, keep)).action, 'keep')
        assert.deepEqual([D(V(keep, fix)).action, D(V(keep, fix)).verdicts], ['reason', [fix]], '型別同現行、一票要求改寫理由 → reason')
        assert.deepEqual([D(V(toT1, toT1)).action, D(V(toT1, toT1)).type], ['retype', T1])
        const split = D(V(keep, toT1))
        assert.deepEqual([split.action, split.needThird], ['type-split', true], '關聯成立、型別不一致 → 叫第三席')
        assert.deepEqual([D([...V(keep, toT1), { seat: 'third', provider: 'p3', verdict: toT1 }]).action, D([...V(keep, toT1), { seat: 'third', provider: 'p3', verdict: keep }]).action], ['retype', 'keep'])
        assert.equal(D([...V(keep, toT1), { seat: 'third', provider: 'p3', verdict: toT2 }]).action, 'type-split', '三席三型 → 仍判不了型別')
        assert.deepEqual([D(V(toC, toC)).action, D(V(ret, ret)).action], ['upgrade', 'retire'])
        const und = D(V(keep, ret))
        assert.deepEqual([und.action, und.why, und.needThird], ['undetermined', 'disagree', true], '是否有關聯不一致 → 叫第三席')
        assert.equal(D([...V(keep, ret), { seat: 'third', provider: 'p3', verdict: ret }]).action, 'retire')
        assert.deepEqual([D(V(keep, null)).action, D(V(keep, keep, 'p1', 'p1')).action, D(V(PANEL_UNSURE, keep)).action], ['retry', 'retry', 'undetermined'])
    })

    it('reviewQueueOf:只取非衝突型、須(重)核者(與 RS4 同一雜湊)、排除既有項、觸及已提煉者先再舊到新、取配額;回報受檢總數與已核數', () => {
        const byId = new Map(['a', 'b', 'c', 'd'].map((id) => [id, { id, createdAt: '2026-01-01', extractedAt: id === 'd' ? '2026-01-03' : '' }]))
        const e1 = edge('a', 'b', T0, R0, '2026-01-02T00:00:00+08:00')
        const e2 = edge('a', 'c', T0, R0, '2026-01-01T00:00:00+08:00')
        const e3 = edge('c', 'd', T1, R0, '2026-01-09T00:00:00+08:00')
        const e4 = edge('b', 'c', C, R_C)
        const e5 = edge('a', 'gone', T0, R0)
        const e6 = edge('b', 'd', T0, R0)
        const rec6 = { id: checkKey(RS6.objectEdge, e6.id), object: RS6.objectEdge, oid: e6.id, hash: edgeCheckHashOf(e6, byId.get('b'), byId.get('d')), results: { RS6: { v: RS6.v, status: 'pass' } } }
        const q = reviewQueueOf({ edges: [e1, e2, e3, e4, e5, e6], conflictType: C, byId, checkOf: (id) => (id === e6.id ? rec6 : null), extracted: (id) => !!byId.get(id)?.extractedAt, exclude: new Set(), quota: 5 })
        assert.deepEqual(q.queue.map((x) => x.edge.id), [e3.id, e2.id, e1.id], '觸及已提煉者先 → 舊到新;衝突、懸空、已核者不入')
        assert.deepEqual([q.total, q.done], [4, 1])
        const rs4Only = { ...rec6, results: { RS4: { v: 1, status: 'pass' } } }
        assert.equal(reviewQueueOf({ edges: [e6], conflictType: C, byId, checkOf: () => rs4Only, quota: 1 }).queue.length, 1, '只有 RS4 之結果 → 仍須 RS6')
        assert.deepEqual(reviewQueueOf({ edges: [e1, e2], conflictType: C, byId, exclude: new Set([e2.id]), quota: 2 }).queue.map((x) => x.edge.id), [e1.id])
        assert.deepEqual(reviewQueueOf({ edges: [e1], conflictType: C, byId, quota: 0 }).queue, [], '配額 0 → 不排(仍回報進度)')
    })

    it('提示詞:列兩方區塊(與 RS4 同一組)、現行型別與理由;裁決含漏標之衝突、理由具體之判準、unsure', () => {
        const p = DOMAIN.buildEdgeReviewPrompt([{ index: 3, a: { note: { title: '甲篇', category: 'c', concepts: ['x'] }, extra: { summary: '甲之重點', keyPoints: ['要點'] } }, b: { note: { title: '乙篇', category: 'c', concepts: ['y'] }, extra: { summary: '乙之重點' } }, edge: { type: T0, reason: R0 } }])
        assert.match(p, /^你是知識庫的既有關聯覆核器。/, '首句與重評(「的關聯覆核器」)可區分——替身與評比依首句分角色')
        assert.ok(!/的關聯覆核器/.test(p))
        assert.match(p, /--- 第3項 ---\n【甲】\n標題：甲篇[\s\S]*一句話重點：甲之重點\n核心知識：\n- 要點\n【乙】\n標題：乙篇/)
        assert.match(p, new RegExp(`現行型別：${T0}\n現行理由：${R0}`))
        // 步驟式判準(2026-10-05 題組驗收後):有無關聯 → 是否衝突 → 型別改正之封閉清單 → 理由具體
        assert.match(p, new RegExp(`2\\. 是不是衝突：[^\\n]*是衝突而現行未標為衝突 → change，type 填「${C}」`))
        assert.match(p, new RegExp(`\\(a\\) [^\\n]*現行卻標為「${SIB}」或「${COMP}」→ 改為「${IMPL}」`))
        assert.match(p, new RegExp(`\\(b\\) [^\\n]*現行卻標為「${SIB}」或「${COMP}」→ 改為「${EXT}」`))
        assert.match(p, /其餘一律維持現行型別——兩篇之關係常可用不只一種型別描述，不要改成另一個也說得通的型別/)
        assert.match(p, /4\. 理由是否具體：理由須點出甲乙各自的具體內容/)
        assert.match(p, /只因理由不具體而 change 時，type 填現行型別（只改理由）/)
        assert.match(p, /4\. unsure：材料不足以判斷/)
        // 型別角色從缺 → 封閉清單停用,改以「明顯不符」判(提示詞與 retypeAllowed 同步)
        const noRole = createRelateDomain({ vocab: { relationTypes: ['相關', '衝突或反例'], conflictType: '衝突或反例', fallbackType: '相關' } })
        assert.deepEqual(noRole.relationTypeRoles, {})
        assert.match(noRole.buildEdgeReviewPrompt([]), /3\. 型別是否錯（只有型別與兩篇之關係明顯不符才算型別錯/)
    })

    // ─── 段 ───

    it('停用(套件預設 false):不呼叫覆核、報告無 rs6 計數;啟用而缺第二席 → 拋錯', async () => {
        const e = env({ notes: ids(['a', 'b']), edges: [edge('a', 'b')], relate: { standards: { edgeReview: { enabled: false } } } })
        const rep = await e.run()
        assert.equal(e.calls.filter((c) => c.seg === 'er').length, 0)
        assert.equal(Object.keys(detOf(rep)).some((k) => k.startsWith('rs6')), false)
        const bad = env({ notes: ids(['a', 'b']), edges: [edge('a', 'b')], seats: { first: { use: 'stub:a' } } })
        // 訊息為功能表之格式(與執行期件之啟動期檢核同一字樣)
        await assert.rejects(() => bad.run(), (e) => e.message === '既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但缺席位 settings.relate.standards.ai.second')
    })

    it('成立:兩席 keep → 檢核合格(與 RS4 同一雜湊)、邊不動、帳記 keep;下一輪不重核;進度 1／1', async () => {
        const e0 = edge('a', 'b')
        const e = env({ notes: ids(['a', 'b']), edges: [e0] })
        const rep = await e.run()
        const d = detOf(rep)
        assert.deepEqual([d.rs6Checked, d.rs6Kept, d.rs6Done, d.rs6Total], [1, 1, 1, 1], JSON.stringify(d))
        assert.deepEqual(e.calls.filter((c) => c.seg === 'er').map((c) => c.seat).sort(), ['first', 'second'])
        const rec = await e.checks.get(checkKey(RS6.objectEdge, e0.id))
        assert.deepEqual([rec.results.RS6.status, rec.results.RS6.seats], ['pass', 'stub:a|stub:b'])
        assert.deepEqual(e.erLog().map((r) => r.outcome), ['keep'])
        const n = e.calls.length
        await e.run()
        assert.equal(e.calls.length, n, '已核且未變 → 不重核')
    })

    it('改寫:同型改理由 → reason;兩席同改為封閉清單內之型別(互補 → 實作)→ retype;不屬清單之改型 → 同型改理由;兩席判漏標之衝突 → 升為衝突(計入 conflicts);改寫後之值記檢核合格', async () => {
        const e1 = edge('a', 'b')
        const e2 = edge('c', 'd', COMP)
        const e3 = edge('e', 'f')
        const e4 = edge('g', 'h')
        const review = (seat, it) => (it.a === '標題a' ? { verdict: 'change', type: T0, reason: R_NEW }
            : it.a === '標題c' ? { verdict: 'change', type: IMPL, reason: R_NEW }
                : it.a === '標題g' ? { verdict: 'change', type: COMP, reason: R_NEW }
                    : { verdict: 'change', type: C, reason: R_C })
        const e = env({ notes: ids(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), edges: [e1, e2, e3, e4], review })
        const rep = await e.run()
        const d = detOf(rep)
        assert.deepEqual([d.rs6ReasonFixed, d.rs6Retyped, d.rs6Upgraded, d.conflicts, d.edgesChanged], [2, 1, 1, 1, 4], JSON.stringify(d))
        const [n1, n2, n3, n4] = await Promise.all([e1, e2, e3, e4].map((x) => e.relations.get(x.id)))
        assert.deepEqual([n1.type, n1.reason, n2.type, n3.type, n3.reason, n4.type, n4.reason], [T0, R_NEW, IMPL, C, R_C, T0, R_NEW], '不屬清單之改型(T0 → 互補)只改理由')
        const rec = await e.checks.get(checkKey(RS6.objectEdge, e2.id))
        assert.equal(rec.hash, await hashOf(e, n2), '記改寫後之值(下輪不重核;雜湊含關聯型別定義之版本與素材)')
        assert.ok(e.log.lines.some((l) => /^INFO 既有邊覆核：\[\[e\]\] ⇄ \[\[f\]\] 升為衝突/.test(l)), e.log.lines.join('\n'))
    })

    it('無關聯:兩席 retire → 撤出(rs6-retire,稽核、可 restore-edge)、檢核記不合格', async () => {
        const e0 = edge('a', 'b')
        const e = env({ notes: ids(['a', 'b']), edges: [e0], review: all({ verdict: 'retire', reason: R_RET }) })
        const d = detOf(await e.run())
        assert.equal(d.rs6Retired, 1)
        assert.equal(await e.relations.get(e0.id), null)
        assert.deepEqual(e.retiredLog().map((r) => [r.reason, r.edge.id]), [['rs6-retire', e0.id]])
        await assert.rejects(() => restoreEdge({ ...e.restoreDeps, stores: { notes: e.notes, relations: e.relations } }, e0.id, { apply: true }), /須 stores\.checks 記檢核紀錄/, '裁示而未開 checks 集合:寫前拋')
        assert.equal(await e.relations.get(e0.id), null)
        const r = await restoreEdge(e.restoreDeps, e0.id, { apply: true })
        assert.deepEqual([r.restorable, r.applied, r.retiredAs, r.ruling], [true, true, 'rs6-retire', RS6.std])
        const rec = (await e.checks.get(checkKey(RS6.objectEdge, e0.id))).results.RS6
        assert.deepEqual([rec.status, rec.seats], ['pass', 'user'], '裁示記檢核(合格、seats user)')
    })

    it('型別判不了:現行同族、一席 keep、一席改實作、第三席改延伸(皆屬封閉清單)→ 邊不動、檢核記未能判定、待判 user;判不了是否有關聯 → 隔離(rs6-quarantine,可還原)＋待判 user', async () => {
        const e1 = edge('a', 'b', SIB)
        const e2 = edge('c', 'd')
        const review = (seat, it) => {
            if (it.a === '標題a') return seat === 'first' ? { verdict: 'keep', reason: '' } : seat === 'second' ? { verdict: 'change', type: IMPL, reason: R_NEW } : { verdict: 'change', type: EXT, reason: R_NEW }
            return seat === 'first' ? { verdict: 'keep', reason: '' } : seat === 'second' ? { verdict: 'retire', reason: R_RET } : PANEL_UNSURE
        }
        const e = env({ notes: ids(['a', 'b', 'c', 'd']), edges: [e1, e2], review })
        const d = detOf(await e.run())
        assert.deepEqual([d.rs6TypeSplit, d.rs6Undetermined, d.rs6Quarantined, d.rs6Third], [1, 1, 1, 2], JSON.stringify(d))
        assert.equal((await e.relations.get(e1.id)).type, SIB, '型別判不了:邊不動')
        assert.equal((await e.checks.get(checkKey(RS6.objectEdge, e1.id))).results.RS6.status, 'undetermined')
        const h1 = await e.holds.get(holdKey(RS6.objectEdge, e1.id, RS6.std))
        assert.deepEqual([h1.owner, h1.status], ['user', 'open'])
        assert.equal(await e.relations.get(e2.id), null, '判不了 → 隔離')
        assert.deepEqual(e.retiredLog().map((r) => r.reason), ['rs6-quarantine'])
        assert.equal((await e.holds.get(holdKey(RS6.objectEdge, e2.id, RS6.std))).owner, 'user')
    })

    it('重試:第二席失敗 → 待判 pipeline(不隔離、不記檢核);下一輪由待判重判 → 成立結案;存量不重排有待判之邊', async () => {
        const e0 = edge('a', 'b')
        let failSecond = true
        const e = env({ notes: ids(['a', 'b']), edges: [e0], fail: (seat) => (seat === 'second' && failSecond ? 'fail' : null) })
        const d1 = detOf(await e.run())
        assert.equal(d1.rs6Retry, 1)
        assert.ok(await e.relations.get(e0.id))
        assert.equal(await e.checks.get(checkKey(RS6.objectEdge, e0.id)), null)
        const h = await e.holds.get(holdKey(RS6.objectEdge, e0.id, RS6.std))
        assert.deepEqual([h.owner, h.status], ['pipeline', 'open'])
        failSecond = false
        const d2 = detOf(await e.run())
        assert.deepEqual([d2.rs6Holds, d2.rs6Stock, d2.rs6Kept], [1, 0, 1], JSON.stringify(d2))
        assert.equal((await e.holds.get(holdKey(RS6.objectEdge, e0.id, RS6.std))).status, 'resolved')
    })

    it('共識之改寫(retype)之理由未達標準(RS8:數字不見於兩方區塊)→ 該次判定失敗(終審 D3 R60;失敗計):不改、不記檢核、待判 pipeline 重試(記 tries)、覆核帳 std-reject', async () => {
        const e0 = edge('a', 'b', COMP)
        const e = env({ notes: ids(['a', 'b']), edges: [e0], review: all({ verdict: 'change', type: IMPL, reason: '甲之年化報酬 37.5% 與乙之夏普比率 2.1 相互印證' }) })
        const d = detOf(await e.run())
        assert.equal(d.rs6StdRejected, 1)
        assert.equal((await e.relations.get(e0.id)).type, COMP)
        assert.equal(await e.checks.get(checkKey(RS6.objectEdge, e0.id)), null, '失敗不是未能判定:不記檢核(與衝突核對同一處置)')
        const h = await e.holds.get(holdKey(RS6.objectEdge, e0.id, RS6.std))
        assert.deepEqual([h.owner, h.status, h.tries], ['pipeline', 'open', 0])
        assert.deepEqual(e.erLog().map((r) => [r.outcome, r.action]), [['std-reject', 'retype']])
        // 建議性改寫(reason:一席之 change)不過閘 → 依現行理由之確定性狀態分流:現行合格 → 保留記合格(與衝突核對同)
        const e1 = edge('c', 'd', T0, R0)
        const f = env({ notes: ids(['c', 'd']), edges: [e1], review: (seat) => (seat === 'first' ? { verdict: 'change', type: T0, reason: '甲之年化報酬 37.5% 與乙之夏普比率 2.1 相互印證' } : { verdict: 'keep', reason: '' }) })
        const df = detOf(await f.run())
        assert.deepEqual([df.rs6StdRejected, df.rs6Kept, df.rs6Retry, (await f.relations.get(e1.id)).reason], [1, 1, 0, R0], JSON.stringify(df))
        assert.equal((await f.checks.get(checkKey(RS6.objectEdge, e1.id))).results.RS6.status, 'pass', '是否成立已定,補強失敗不影響')
        assert.deepEqual(f.erLog().map((r) => r.outcome), ['std-reject', 'keep'])
    })

    it('存量排入(standards/edgeQueue):RS2 佔位理由之邊入 RS6 待判(不重登);兩席 keep 而現行理由不過納入閘、keep 決策下無改寫之票 → 撤出(std-retire、檢核不合格、待判結案,不記未能判定);restoreEdge 須給 opt.reason 新理由才可還原;兩席改理由 → 落地、結案', async () => {
        // 規格:審查 A-A10(F 盤查 R2)——確定性違反不是「判不了」:修正(改寫理由)不成即移除(可還原)
        const at = '2026-10-05T00:00:00+08:00'
        const e0 = edge('a', 'b', T0, 'placeholder')
        const e = env({ notes: ids(['a', 'b']), edges: [e0], relate: { standards: { edgeReview: { perRun: 0 } } } })
        assert.equal(await queueEdgeReview(e.holds, e0, { std: 'RS2', why: '佔位理由「placeholder」', at }), 'queued')
        assert.equal(await queueEdgeReview(e.holds, e0, { std: 'RS2', why: '佔位理由「placeholder」', at }), 'exists')
        const d = detOf(await e.run())
        assert.deepEqual([d.rs6Holds, d.rs6Kept, d.rs6StdRetired, d.rs6StdRejected, d.rs6Undetermined], [1, 0, 1, 0, 0], JSON.stringify(d))
        assert.equal(await e.relations.get(e0.id), null, '修不了即移除')
        assert.equal((await e.checks.get(checkKey(RS6.objectEdge, e0.id))).results.RS6.status, 'violation', '確定性違反記不合格(不記未能判定、不記合格)')
        const h = await e.holds.get(holdKey(RS6.objectEdge, e0.id, RS6.std))
        assert.equal(h.status, 'resolved')
        assert.equal(h.how, `現行理由未達標準（RS2 佔位理由「placeholder」）且無可用之改寫理由（席位未附改寫，或所附理由亦未達標準），已撤出（std-retire；可 restoreEdge（邊 ${e0.id}，opt.reason＝新理由、opt.apply）還原）`)
        assert.deepEqual([e.erLog().at(-1).outcome, e.retiredLog().at(-1).reason], ['std-retire', 'std-retire'])
        // 可還原:原理由必不過閘 → 不可還原並提示 opt.reason;新理由(過閘)→ 還原;新理由不合標準 → 不可還原
        const r0 = await restoreEdge(e.restoreDeps, e0.id, { apply: true })
        assert.deepEqual([r0.restorable, r0.applied], [false, false])
        assert.match(r0.reason, /^未達檢定標準：RS2 佔位理由.*（撤出時之理由本身不合標準者，可給 opt\.reason（新理由）以新理由還原）$/)
        const rBad = await restoreEdge(e.restoreDeps, e0.id, { apply: true, reason: '同上' })
        assert.deepEqual([rBad.restorable, rBad.reasonReplaced], [false, true])
        const r1 = await restoreEdge(e.restoreDeps, e0.id, { apply: true, reason: R_NEW })
        assert.deepEqual([r1.applied, r1.retiredAs, r1.ruling, r1.edge.reason], [true, 'std-retire', '', R_NEW], '標準撤出非 AI 標準之裁示')
        assert.deepEqual([(await e.relations.get(e0.id)).reason, e.retiredLog().at(-1).reasonReplaced], [R_NEW, true])
        // 兩席改理由 → 落地、結案(原行為)
        const e1 = edge('a', 'b', T0, '...')
        const f = env({ notes: ids(['a', 'b']), edges: [e1], relate: { standards: { edgeReview: { perRun: 0 } } }, review: all({ verdict: 'change', type: T0, reason: R_NEW }) })
        await queueEdgeReview(f.holds, e1, { std: 'RS2', why: '佔位理由「...」', at })
        const d2 = detOf(await f.run())
        assert.deepEqual([d2.rs6ReasonFixed, (await f.relations.get(e1.id)).reason, (await f.holds.get(holdKey(RS6.objectEdge, e1.id, RS6.std))).status], [1, R_NEW, 'resolved'])
    })

    it('現行理由確定不合格(含一般存量,不限存量排入者):送審時該項附「須以 change 改寫理由、不可 keep」(其餘項不附);兩席依指示改寫 → 過閘改寫(rs6StdFixed、檢核合格、待判結案);仍判 keep → 其 reason 不當理由用,std-retire;RS8 以兩端存量材料判(數字見於內容章者不誤判)、材料不可得之未能判定不據以撤出', async () => {
        // 規格:審查 A-A10;類別擴及一般存量——RS6「理由具體」之合格不得掩蓋 RS2／RS8 之確定性違反。keep 之 reason 未定義為關聯理由
        //   (提示詞只對 change 定義),不得拿來改寫邊(2026-10-05 主代理審核 R2 後改)
        const at = '2026-10-05T00:00:00+08:00'
        const ePh = edge('a', 'b', T0, 'placeholder')
        const eOk = edge('c', 'd', T0, R0)
        const e = env({ notes: ids(['a', 'b', 'c', 'd']), edges: [ePh, eOk], review: (seat, it) => (it.a === '標題a' ? { verdict: 'change', type: T0, reason: seat === 'first' ? '甲之年化報酬 37.5% 與乙之組合相互印證' : R_NEW } : { verdict: 'keep', reason: '' }) })
        const d = detOf(await e.run())
        const p = e.calls.find((c) => c.seg === 'er' && c.seat === 'first').prompt
        const blockOf = (title) => p.split(/^--- 第\d+項 ---$/m).find((b) => b.includes(`標題：${title}`))
        assert.ok(blockOf('標題a').includes('現行理由：placeholder（現行理由未達標準：RS2 佔位理由「placeholder」——有知識關聯者須以 change 改寫理由，不可 keep；只因理由不合格者 type 填現行型別）'), blockOf('標題a'))
        assert.doesNotMatch(blockOf('標題c'), /未達標準/, '現行理由合格之項不附指示(逐字不變)')
        assert.deepEqual([d.rs6StdFixed, d.rs6ReasonFixed, d.rs6Kept, d.rs6StdRetired], [1, 1, 1, 0], JSON.stringify(d))
        assert.equal((await e.relations.get(ePh.id)).reason, R_NEW, '第一席之理由不過閘(RS8)→ 第二席之理由(依序)')
        assert.equal((await e.checks.get(checkKey(RS6.objectEdge, ePh.id))).results.RS6.status, 'pass')
        // 仍判 keep(附了看似可用之理由亦不採)→ 修不了即移除
        const k0 = env({ notes: ids(['a', 'b']), edges: [ePh], review: all({ verdict: 'keep', reason: R_NEW }) })
        const dk0 = detOf(await k0.run())
        assert.deepEqual([dk0.rs6StdRetired, dk0.rs6StdFixed, await k0.relations.get(ePh.id)], [1, 0, null], JSON.stringify(dk0))
        // 待判(存量 RS8)同一處置並結案
        const e8 = edge('c', 'd', T0, '兩篇皆以 37 個月回看期建構動量組合')
        const g = env({ notes: ids(['c', 'd']), edges: [e8], relate: { standards: { edgeReview: { perRun: 0 } } }, review: all({ verdict: 'change', type: T0, reason: R_NEW }) })
        await queueEdgeReview(g.holds, e8, { std: 'RS8', why: '兩端皆無之數字：37', at })
        const d8 = detOf(await g.run())
        assert.deepEqual([d8.rs6StdFixed, (await g.relations.get(e8.id)).reason, (await g.holds.get(holdKey(RS6.objectEdge, e8.id, RS6.std))).status], [1, R_NEW, 'resolved'])
        // RS8 之存量材料＝內容章(含方法章)＋原文標題:數字只見於方法章(覆核席所見之區塊沒有)→ 合格,照常 keep
        const k = env({ notes: ids(['m', 'n']), edges: [edge('m', 'n', T0, '兩篇皆以 12 個月回看期建構動量組合')] })
        writeMd((await k.notes.get('m')).file, { title: '標題m', slug: 'm' }, '# 標題m\n\n## 一句話重點\n\nm 之重點\n\n## 方法與步驟\n\n- 回看 12 個月')
        const dk = detOf(await k.run())
        assert.deepEqual([dk.rs6Kept, dk.rs6StdFixed, dk.rs6StdRetired], [1, 0, 0], JSON.stringify(dk))
        // 材料不可得(md 讀不到)而理由含數字 → RS8 未能判定:不據以撤出,照常 keep(交符合度掃描列未能判定)
        const u = env({ notes: ids(['p', 'q']), edges: [edge('p', 'q', T0, '兩篇皆以 37 個月回看期建構動量組合')] })
        fs.rmSync((await u.notes.get('p')).file)
        const du = detOf(await u.run())
        assert.deepEqual([du.rs6Kept, du.rs6StdRetired, du.rs6MdMissing], [1, 0, 1], JSON.stringify(du))
    })

    it('現行理由之確定性違反先做確定性正規化再判(standards/edgeGate 之 reasonRewriteProblemsOf;與衝突核對、納入閘同一函數):正體可確定性修正者不算——簡體而過短者只附 RS2(不附 RS3);簡體而其餘合格者不附指示、兩席 keep → 成立(不撤出,字形交存量處置之 RS3 修正)', async () => {
        // 現行理由經正規化仍有 RS3 者(附「RS3」之指示)於現行字表下不可達:找遍字表無「簡體而轉正體後不變」之字形(見 unit-relate-standards 之
        //   reasonRewriteProblemsOf 定義案);段內無注入處,不以假字形冒充——列出之問題之處置與 RS2／RS8 同一路徑(上兩案)
        const eS = edge('a', 'b', T0, '两篇相关')
        const eF = edge('c', 'd', T0, '两篇皆以波动度调整部位，属同一机制之延伸')
        const e = env({ notes: ids(['a', 'b', 'c', 'd']), edges: [eS, eF], review: (seat, it) => (it.a === '標題a' ? { verdict: 'change', type: T0, reason: R_NEW } : { verdict: 'keep', reason: '' }) })
        const d = detOf(await e.run())
        const p = e.calls.find((c) => c.seg === 'er' && c.seat === 'first').prompt
        const blockOf = (title) => p.split(/^--- 第\d+項 ---$/m).find((b) => b.includes(`標題：${title}`))
        assert.ok(blockOf('標題a').includes('（現行理由未達標準：RS2 去空泛片語與標點後只剩 4 字（須 ≥10）——有知識關聯者須以 change 改寫理由，不可 keep；只因理由不合格者 type 填現行型別）'), blockOf('標題a'))
        assert.doesNotMatch(blockOf('標題a'), /RS3/, '正體可修者不列')
        assert.doesNotMatch(blockOf('標題c'), /未達標準/, '只有正體之違反(可確定性修正)→ 不附指示')
        assert.deepEqual([d.rs6StdFixed, d.rs6Kept, d.rs6StdRetired], [1, 1, 0], JSON.stringify(d))
        assert.deepEqual([(await e.relations.get(eS.id)).reason, (await e.relations.get(eF.id)).reason], [R_NEW, eF.reason], '成立 → 邊不動')
        assert.equal((await e.checks.get(checkKey(RS6.objectEdge, eF.id))).results.RS6.status, 'pass')
    })

    it('清單外之現行型別(型別退役而未宣告改名;審查 A-B9):覆核開啟 → 關聯段維護登錄 RS6 待判(不重登);兩席改為清單內型別 → 改型(不受封閉清單約束);兩席 keep(未給清單內型別)→ type-split 交使用者;提示詞只對該項附指示;覆核未開 → 只告警不登錄', async () => {
        const off = edge('a', 'b', '舊型別', R0)
        const e = env({ notes: ids(['a', 'b', 'c', 'd']), edges: [off, edge('c', 'd', '舊型別', R0)], relate: { standards: { edgeReview: { perRun: 0 } } }, review: (seat, it) => (it.a === '標題a' ? { verdict: 'change', type: T1, reason: R0 } : { verdict: 'keep', reason: '' }) })
        const d = detOf(await e.run())
        assert.deepEqual([d.typeOffList, d.typeOffListQueued, d.rs6Holds, d.rs6Retyped, d.rs6TypeSplit], [2, 2, 2, 1, 1], JSON.stringify(d))
        assert.equal((await e.relations.get(off.id)).type, T1, '清單外 → 清單內任一型別皆屬改正')
        const h1 = await e.holds.get(holdKey(RS6.objectEdge, off.id, RS6.std))
        assert.deepEqual([h1.status, h1.ctx.stockStd], ['resolved', 'RS1'])
        const h2 = await e.holds.get(holdKey(RS6.objectEdge, edgeId('c', 'd'), RS6.std))
        assert.deepEqual([h2.status, h2.owner], ['open', 'user'])
        assert.match(h2.reason, /關聯成立而未得清單內之型別（現行「舊型別」已不在清單）——邊不動/)
        const p = e.calls.find((c) => c.seg === 'er').prompt
        assert.match(p, /現行型別：舊型別（「舊型別」已不在型別清單：有知識關聯者須 change 為清單內最符合兩篇關係之型別，不可 keep）/)
        assert.ok(e.log.lines.some((l) => /^WARN 關聯型別不在現行清單：「舊型別」2 條.*已交既有邊覆核重判型別，本輪新登錄待判 2 條/.test(l)), e.log.lines.join('\n'))
        // 再一輪:未結者(使用者)不重登、不重判(tries 不累加)
        const tries0 = h2.tries
        const d2 = detOf(await e.run())
        assert.deepEqual([d2.typeOffList, d2.typeOffListQueued, d2.rs6Holds], [1, 0, 0])
        assert.equal((await e.holds.get(holdKey(RS6.objectEdge, edgeId('c', 'd'), RS6.std))).tries, tries0)
        // 使用者豁免(維持現值)→ 每輪之維護不重開(已裁示者不重提;否則豁免 → 重登 → 再判 → 再交使用者之迴圈)
        await waiveHold(e.holds, h2.id, { by: '使用者', ruling: '舊型別暫留', at: '2026-10-05T12:00:00+08:00' })
        const d3 = detOf(await e.run())
        assert.deepEqual([d3.typeOffListQueued, d3.rs6Holds, (await e.holds.get(h2.id)).status], [0, 0, 'waived'])
        // 覆核未開:只告警(維持舊行為),不登錄
        const f = env({ notes: ids(['a', 'b']), edges: [off], relate: { standards: { edgeReview: { enabled: false } } } })
        const df = detOf(await f.run())
        assert.deepEqual([df.typeOffList, df.typeOffListQueued, (await f.holds.select()).length], [1, 0, 0])
        assert.ok(f.log.lines.some((l) => /^WARN 關聯型別不在現行清單：「舊型別」1 條.*或開啟既有邊覆核/.test(l)))
        // 純函數:現行型別不在清單者,change 至清單內任一型別不被「同型改理由」正規化;keep 於型別層視同不確定
        const o = { relationTypes: DOMAIN.relationTypes, resolveType: DOMAIN.resolveType, conflictType: C, roles: ROLES, current: { type: '舊型別', reason: R0 } }
        assert.deepEqual(reviewVerdictOf({ verdict: 'change', type: T2, reason: R_NEW }, o), { verdict: 'change', type: T2, reason: R_NEW })
        const V = (a, b) => [{ seat: 'first', provider: 'p1', verdict: a }, { seat: 'second', provider: 'p2', verdict: b }]
        const D = (votes) => rs6DecisionOf(votes, { conflictType: C, current: { type: '舊型別', reason: R0 }, relationTypes: DOMAIN.relationTypes })
        const keep = { verdict: 'keep', reason: '' }
        assert.deepEqual([D(V(keep, keep)).action, D(V(keep, keep)).needThird], ['type-split', false], '兩席皆未給清單內型別:第三席無從成立,不叫')
        assert.deepEqual([D(V(keep, { verdict: 'change', type: T1, reason: R_NEW })).action, D(V(keep, { verdict: 'change', type: T1, reason: R_NEW })).needThird], ['type-split', true])
        assert.equal(D(V({ verdict: 'change', type: T1, reason: R_NEW }, { verdict: 'change', type: T1, reason: R0 })).action, 'retype')
    })

    it('檢核雜湊含關聯型別定義之版本(審查 A-B9):清單成員(不計列序)、衝突型、型別角色任一變 → 版本變 → 既有 RS6 檢核作廢、存量重排重核', async () => {
        const v0 = relationTypesVersionOf(DOMAIN)
        assert.equal(relationTypesVersionOf({ ...DOMAIN, relationTypes: [...DOMAIN.relationTypes].reverse() }), v0, '列序不計')
        assert.notEqual(relationTypesVersionOf({ ...DOMAIN, relationTypes: [...DOMAIN.relationTypes, '新型別'] }), v0, '新增型別')
        assert.notEqual(relationTypesVersionOf({ ...DOMAIN, relationTypes: DOMAIN.relationTypes.filter((t) => t !== T2) }), v0, '退役型別')
        assert.notEqual(relationTypesVersionOf({ ...DOMAIN, relationTypeRoles: { ...ROLES, implementation: T2 } }), v0, '型別角色(RS6 封閉清單)')
        const a = { id: 'a', createdAt: '2026-01-01' }
        const b = { id: 'b', createdAt: '2026-01-01' }
        assert.notEqual(edgeCheckHashOf(edge('a', 'b'), a, b, v0), edgeCheckHashOf(edge('a', 'b'), a, b, relationTypesVersionOf({ ...DOMAIN, relationTypes: [...DOMAIN.relationTypes, '新型別'] })))
        // 段:現行版本下已核 → 不重核;換一份型別清單(多一型)之 domain → 版本變 → 重排、重核
        const e0 = edge('a', 'b')
        const e = env({ notes: ids(['a', 'b']), edges: [e0] })
        await e.run()
        const n = e.calls.length
        const d1 = detOf(await e.run())
        assert.deepEqual([e.calls.length, d1.rs6Done, d1.rs6Total], [n, 1, 1], '版本未變不重核')
        e.ctx.deps.domains.relate = createRelateDomain({ vocab: { relationTypes: [...DOMAIN.relationTypes, '新型別'] } })
        const d2 = detOf(await e.run())
        assert.ok(e.calls.length > n, '型別清單變更 → 重核')
        assert.deepEqual([d2.rs6Stock, d2.rs6Done, d2.rs6Total], [1, 1, 1])
    })

    // 設定值之預設與值域('' 或 ISO 日期;錯即啟動期拋錯)由 unit-settings 之「完成期限」案驗(設定之斷言集中於一處)
    it('完成期限(審查 A-B14、B-M6):relate.standards.edgeReview.deadline 給了即隨 detail 帶出 rs6Deadline(未給不帶)', async () => {
        const e = env({ notes: ids(['a', 'b']), edges: [edge('a', 'b')], relate: { standards: { edgeReview: { deadline: '2026-12-31' } } } })
        assert.equal(detOf(await e.run()).rs6Deadline, '2026-12-31')
        const f = env({ notes: ids(['a', 'b']), edges: [edge('a', 'b')] })
        assert.equal('rs6Deadline' in detOf(await f.run()), false)
    })

    it('待判之下一步須為負責者可完成之處置:隔離 → 寫 restoreEdge(邊 id、opt.apply;即裁示關聯成立)或 waiveHold;逾次改由使用者 → 寫 requestRetry／waiveHold(不再寫「下輪重判」)', async () => {
        const q = env({ notes: ids(['a', 'b']), edges: [edge('a', 'b')], review: (seat) => (seat === 'first' ? { verdict: 'keep', reason: '' } : PANEL_UNSURE), seats: { first: { use: 'stub:a' }, second: { use: 'stub:b' } } })
        await q.run()
        const hq = await q.holds.get(holdKey(RS6.objectEdge, edgeId('a', 'b'), RS6.std))
        assert.equal(hq.next, `使用者判讀：確認關聯成立者以 restoreEdge（邊 ${edgeId('a', 'b')}，opt.apply）還原（即裁示關聯成立：本待判結案、記檢核，不再自動覆核此值）；否則豁免（waiveHold：維持撤出）`)
        assert.doesNotMatch(hq.next, /requestRetry/, '邊已撤出:要求重試只會因「邊已撤出」結案,不列為處置')
        const e0 = edge('c', 'd')
        const r = env({ notes: ids(['c', 'd']), edges: [e0], fail: (seat) => (seat === 'second' ? 'fail' : null), relate: { standards: { edgeReview: { maxTries: 2 } } } })
        await r.run()
        const h1 = await r.holds.get(holdKey(RS6.objectEdge, e0.id, RS6.std))
        assert.deepEqual([h1.owner, h1.next], ['pipeline', '下輪既有邊覆核重判'])
        await r.run()
        const h2 = await r.holds.get(holdKey(RS6.objectEdge, e0.id, RS6.std))
        assert.equal(h2.owner, 'user')
        assert.equal(h2.next, '逾 2 次未得判定，改由使用者：要求重試（requestRetry：換席重判）或豁免（waiveHold：維持現值）')
    })

    it('保留時間(deps.reserveMs／stageRelate 之 opt.reserveMs):扣保留後剩餘不足三席之首家逾時 → 本輪不核(rs6Deferred,不呼叫、不記結果,存量不丟);opt.reserveMs 優先', async () => {
        const mk = () => {
            const e = env({ notes: ids(['a', 'b']), edges: [edge('a', 'b')] })
            // 剩 1,000 秒、首家逾時 300 秒:保留 900 秒 → 延後
            e.ctx.remainingMs = () => 1_000_000
            e.ctx.deps.reserveMs = 900_000
            return e
        }
        const e = mk()
        const d = detOf(await e.run())
        assert.deepEqual([d.rs6Deferred, e.calls.filter((c) => c.seg === 'er').length, (await e.checks.select()).length], [true, 0, 0], JSON.stringify(d))
        assert.ok(e.log.lines.some((l) => /^INFO 既有邊覆核：扣保留時間後剩餘時間不足一次呼叫/.test(l)), e.log.lines.join('\n'))
        const f = mk()
        const df = detOf(await stageRelate({ callAI: f.callAI, reserveMs: 0 }).run(f.ctx))
        assert.deepEqual([df.rs6Deferred, df.rs6Kept], [false, 1], 'opt.reserveMs 優先')
    })

    it('配額與優先:每輪至多 relate.standards.edgeReview.perRun 條、觸及已提煉者先;額度中止 → 不記任何結果、存量下輪再排', async () => {
        const e1 = edge('a', 'b', T0, R0, '2026-01-01T00:00:00+08:00')
        const e2 = edge('c', 'd', T0, R0, '2026-01-09T00:00:00+08:00')
        const e = env({ notes: [...ids(['a', 'b', 'c']), { id: 'd', extractedAt: '2026-01-10' }], edges: [e1, e2], relate: { standards: { edgeReview: { perRun: 1 } } } })
        const d = detOf(await e.run())
        assert.deepEqual([d.rs6Stock, d.rs6Kept, d.rs6Done, d.rs6Total], [1, 1, 1, 2])
        assert.ok(await e.checks.get(checkKey(RS6.objectEdge, e2.id)), '觸及已提煉者(e2)先')
        const s = env({ notes: ids(['a', 'b']), edges: [edge('a', 'b')], fail: () => 'skip' })
        const ds = detOf(await s.run())
        assert.deepEqual([ds.rs6Checked, ds.rs6Aborted, (await s.checks.select()).length], [0, true, 0])
        assert.ok(s.log.lines.some((l) => /^INFO 既有邊覆核：額度或截止中止/.test(l)))
        assert.equal(detOf(await env({ notes: ids(['a', 'b']), edges: [edge('a', 'b')] }).run()).rs6Aborted, false, '未中止 → false(恆有此鍵)')
    })

    it('第三席失敗(呼叫失敗):類別未成立而可成立之項照缺票重試(待判 pipeline、覆核帳 retry why missing)——不隔離、不記檢核', async () => {
        const e0 = edge('a', 'b')
        const e = env({ notes: ids(['a', 'b']), edges: [e0], review: (seat) => (seat === 'first' ? { verdict: 'keep', reason: '' } : { verdict: 'retire', reason: R_RET }), fail: (seat) => (seat === 'third' ? 'fail' : null) })
        const d = detOf(await e.run())
        assert.deepEqual([d.rs6Third, d.rs6Retry, d.rs6Undetermined, d.rs6Quarantined, d.rs6Aborted], [1, 1, 0, 0, false], JSON.stringify(d))
        assert.ok(await e.relations.get(e0.id), '不隔離')
        const h = await e.holds.get(holdKey(RS6.objectEdge, e0.id, RS6.std))
        assert.deepEqual([h.owner, h.status], ['pipeline', 'open'])
        assert.equal(h.reason, '判定小組未成立（缺票（呼叫失敗或回覆不合格））', '字樣取判定小組之字樣表')
        assert.deepEqual(e.erLog().map((r) => [r.outcome, r.why]), [['retry', 'missing']])
        assert.equal(await e.checks.get(checkKey(RS6.objectEdge, e0.id)), null)
    })

    it('第三席中止(中止不計、失敗計之對照):送第三席之項本輪不判——待判一字不動(tries 不增、不因中止而轉使用者)、存量不立待判、不記檢核、不寫覆核帳;其後之頁仍以前兩席判而不再叫第三席、需第三席者同不判(終審 D5 R62;原則②中止不計)、記 rs6Aborted 與 INFO 一句。第三席失敗(非中止)→ 該些項照缺票重試:待判 tries＋1(逾 maxTries 轉使用者)、存量立待判、其後之頁照核', async () => {
        // 第一頁:待判之 c—d(tries 1)、存量 a—b;第二頁:存量 e—f(邊時刻較新,排後)——三條皆兩席不一致(第一席 keep、第二席撤)→ 第三席
        const e1 = edge('a', 'b')
        const e2 = edge('c', 'd')
        const e3 = edge('e', 'f', T0, R0, '2026-01-09T00:00:00+08:00')
        const h2 = { id: holdKey(RS6.objectEdge, e2.id, RS6.std), object: RS6.objectEdge, oid: e2.id, std: RS6.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 1, ctx: {} }
        const mk = (third) => env({
            notes: ids(['a', 'b', 'c', 'd', 'e', 'f']), edges: [e1, e2, e3], holds: [h2], relate: { standards: { edgeReview: { pageSize: 2 } } },
            review: (seat) => (seat === 'first' ? { verdict: 'keep', reason: '' } : { verdict: 'retire', reason: R_RET }), fail: (seat) => (seat === 'third' ? third : null),
        })
        const hOf = (e, x) => e.holds.get(holdKey(RS6.objectEdge, x.id, RS6.std))
        // 中止
        const s = mk('skip')
        const ds = detOf(await s.run())
        assert.deepEqual(s.calls.filter((c) => c.seg === 'er').map((c) => c.seat), ['first', 'second', 'third', 'first', 'second'], '第三席中止 → 其後之頁仍以前兩席判、不再叫第三席')
        assert.deepEqual([ds.rs6Aborted, ds.rs6Third, ds.rs6Checked, ds.rs6Retry, ds.rs6Holds, ds.rs6Stock], [true, 3, 0, 0, 1, 2], '其後之頁需第三席之 e—f 同不判(計入送第三席)' + JSON.stringify(ds))
        assert.deepEqual(await hOf(s, e2), h2, '待判一字不動(tries 不增、不轉使用者)')
        assert.deepEqual([await hOf(s, e1), await hOf(s, e3)], [null, null], '存量不立待判(下輪再排)')
        assert.deepEqual([(await s.checks.select()).length, s.erLog().length, (await s.relations.select()).length], [0, 0, 3], '不記檢核、不寫覆核帳、邊不動')
        assert.ok(s.log.lines.includes('INFO 既有邊覆核：第三席額度或截止中止（quota），該些項留待下輪；本輪其後不再叫第三席'), s.log.lines.join('\n'))
        // 對照:第三席失敗(非中止)→ 照缺票重試、計次;其後之頁照核
        const f = mk('fail')
        const df = detOf(await f.run())
        assert.deepEqual(f.calls.filter((c) => c.seg === 'er').map((c) => c.seat), ['first', 'second', 'third', 'first', 'second', 'third'], '失敗不中止:其後之頁照核')
        assert.deepEqual([df.rs6Aborted, df.rs6Third, df.rs6Checked, df.rs6Retry], [false, 3, 3, 3], JSON.stringify(df))
        const f2 = await hOf(f, e2)
        assert.deepEqual([f2.tries, f2.owner, f2.next], [2, 'user', '逾 3 次未得判定，改由使用者：要求重試（requestRetry：換席重判）或豁免（waiveHold：維持現值）'], '失敗計次:tries＋1,逾 maxTries 轉使用者')
        for (const x of [e1, e3]) {
            const h = await hOf(f, x)
            assert.deepEqual([h?.owner, h?.tries], ['pipeline', 0])
            assert.equal(h.reason, '判定小組未成立（缺票（呼叫失敗或回覆不合格））')
        }
        assert.deepEqual(f.erLog().map((r) => [r.outcome, r.why]), [['retry', 'missing'], ['retry', 'missing'], ['retry', 'missing']])
    })

    it('判定小組之單頁執行取摘要套件之 runPanelPage(終審 D5;stages/checkPanelPages 只剩分頁迴圈):第二席之項序依 sha1(`rs6|<邊 id>`) 逐項打亂、編號隨項不變;第一席為原序', async () => {
        const es = [edge('a', 'b'), edge('c', 'd', T0, R0, '2026-01-06T00:00:00+08:00'), edge('e', 'f', T0, R0, '2026-01-07T00:00:00+08:00'), edge('g', 'h', T0, R0, '2026-01-08T00:00:00+08:00')]
        const e = env({ notes: ids(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), edges: es, review: all({ verdict: 'keep', reason: '' }) })
        await e.run()
        const idxOf = (p) => [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))
        const [p1, p2] = ['first', 'second'].map((s) => e.calls.find((c) => c.seg === 'er' && c.seat === s).prompt)
        assert.deepEqual(idxOf(p1), [1, 2, 3, 4], '第一席為原序(存量舊到新)')
        const expect = es.map((x, i) => ({ i: i + 1, h: sha1(`rs6|${x.id}`) })).sort((a, b) => (a.h < b.h ? -1 : 1)).map((x) => x.i)
        assert.deepEqual(idxOf(p2), expect, '第二席依 sha1(rs6|邊 id) 逐項打亂、編號不變')
        assert.notDeepEqual(expect, [1, 2, 3, 4], '前提:此四條之打亂與原序不同')
    })

    it('ctx 旗標 RELATE_CTX_FLAGS.edgesChanged 每筆寫入只計一次:改理由 1＋撤出 1＝2', async () => {
        const e1 = edge('a', 'b')
        const e2 = edge('c', 'd')
        const e = env({ notes: ids(['a', 'b', 'c', 'd']), edges: [e1, e2], review: (seat, it) => (it.a === '標題a' ? { verdict: 'change', type: T0, reason: R_NEW } : { verdict: 'retire', reason: R_RET }) })
        const d = detOf(await e.run())
        assert.deepEqual([d.edgesChanged, d.rs6ReasonFixed, d.rs6Retired], [1, 1, 1], JSON.stringify(d))
        assert.equal(e.bag.get(RELATE_CTX_FLAGS.edgesChanged), 2)
    })

    // ─── P3b(2026-10-29 終審 D3):兄弟段與待判生命週期 ───

    it('升為衝突於衝突核對開啟時不先寫(終審 D3 R61;原則④未能判定不得算合格):提案持久為 RS4 提案待判並交本輪核對(以核對第一、二席投票——提案席即首席,不再投)、本邊之 RS6 檢核記未能判定、覆核帳 upgrade-deferred、待判結案、計 rs4Deferred;核對成立 → 改為衝突型、RS4 檢核合格;核對判非衝突 → 邊不動、另登錄 RS6 使用者待判(兩段之判定不一致)', async () => {
        const e0 = edge('a', 'b')
        const hold6 = { id: holdKey(RS6.objectEdge, e0.id, RS6.std), object: RS6.objectEdge, oid: e0.id, std: RS6.std, status: 'open', owner: 'pipeline', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} }
        const mk = (cc) => env({ notes: ids(['a', 'b']), edges: [e0], holds: [hold6], relate: { standards: { conflictCheck: { enabled: true }, edgeReview: { perRun: 0 } } }, review: all({ verdict: 'change', type: C, reason: R_C }), cc })
        const e = mk(() => ({ verdict: 'keep', reason: '' }))
        const d = detOf(await e.run())
        assert.deepEqual([d.rs6Upgraded, d.rs4Deferred, d.rs4Checked, d.rs4Kept, d.conflicts, (await e.relations.get(e0.id)).type], [0, 1, 1, 1, 1, C], JSON.stringify(d))
        assert.deepEqual(e.calls.filter((c) => c.seg === 'cc').map((c) => c.seat), ['first', 'second'], '既有邊之升級提案以第一、二席投票')
        assert.deepEqual(e.erLog().map((r) => r.outcome), ['upgrade-deferred'])
        assert.deepEqual([(await e.holds.get(hold6.id)).status, (await e.holds.get(hold6.id)).how], ['resolved', '兩席判為漏標之衝突，已交衝突核對（RS4 提案待判）'])
        const hp = await e.holds.get(holdKey(RS4.objectProposal, e0.id, RS4.std))
        assert.deepEqual([hp.status, hp.ctx.segment, hp.how], ['resolved', 'edgeReview', '核對成立，衝突邊落地'])
        assert.equal((await e.checks.get(checkKey(RS4.objectEdge, e0.id))).results.RS4.status, 'pass')
        // 核對判非衝突(無關聯)→ 提案不落地、邊不動;兩段之判定不一致 → RS6 使用者待判(重開,前段結案留於 history)
        const f = mk(() => ({ verdict: 'retire', reason: R_RET }))
        const df = detOf(await f.run())
        assert.deepEqual([df.rs4Deferred, df.rs4Retired, (await f.relations.get(e0.id)).type, (await f.checks.get(checkKey(RS6.objectEdge, e0.id))).results.RS6.status], [1, 1, T0, 'undetermined'], JSON.stringify(df))
        const h6 = await f.holds.get(hold6.id)
        assert.deepEqual([h6.status, h6.owner, h6.next, h6.reason], ['open', 'user', RELATE_HOLD_NEXT.typeSplit, '既有邊覆核兩席判為漏標之衝突，衝突核對判無知識關聯——兩段之判定不一致'])
        assert.equal(h6.history.at(-1).how, '兩席判為漏標之衝突，已交衝突核對（RS4 提案待判）')
        // 衝突核對未開:照舊直接改為衝突型
        const g = env({ notes: ids(['a', 'b']), edges: [e0], review: all({ verdict: 'change', type: C, reason: R_C }) })
        const dg = detOf(await g.run())
        assert.deepEqual([dg.rs6Upgraded, 'rs4Deferred' in dg, (await g.relations.get(e0.id)).type], [1, false, C])
    })

    it('待判生命週期(終審 D3 R57／R58／R66／R59;原則①③⑤):存量不重排有未結待判(任何負責者)或豁免仍涵蓋現值之邊(值變後重排);過時待判不分負責者結案(已成衝突型、已撤出、端點不在),隔離之使用者待判除外;使用者要求重試而未得判定 → 負責者與下一步不改、只記原因與 tries;陳舊 → 本輪不判、待判一字不動、不記檢核、不寫覆核帳', async () => {
        const T6 = '2026-01-06T00:00:00+08:00'
        const [ab, cd, gh, ij, kl, mn, op, qr] = [edge('a', 'b'), edge('c', 'd'), edge('g', 'h', C, R_C), edge('i', 'j'), edge('k', 'l'), edge('m', 'n'), edge('o', 'p'), edge('q', 'r')]
        const ef = edge('e', 'f', T0, R0, '2026-01-09T00:00:00+08:00')
        const hold = (e0, o = {}) => ({ id: holdKey(RS6.objectEdge, e0.id, RS6.std), object: RS6.objectEdge, oid: e0.id, std: RS6.std, status: 'open', owner: 'user', reason: 'r', next: 'N', since: OLD, at: OLD, tries: 2, ctx: {}, ...o })
        const waived = (e0) => ({ ...hold(e0), status: 'waived', owner: 'pipeline', waivedAt: T6, waivedBy: '使用者', ruling: '維持' })
        const e = env({
            notes: ids(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r']), edges: [ab, cd, ef, gh, ij, kl, mn, op, qr],
            holds: [hold(ab), waived(cd), waived(ef), hold(gh), hold(ij), hold(kl, { retryRequestedAt: T6 }), hold(mn), hold(op), hold(qr, { owner: 'pipeline', tries: 0 })],
            review: (seat, it) => (seat === 'second' && it.a === '標題k' ? null : (it.a === '標題q' ? { verdict: 'retire', reason: R_RET } : { verdict: 'keep', reason: '' })),
        })
        const ro = { relations: e.relations, ledgers: openRelateLedgers(e.ctx.deps.dirs.state), stateDir: e.ctx.deps.dirs.state }
        await retireEdge(ro, mn, { reason: 'rs6-quarantine', at: OLD, conflictTypes: DOMAIN.conflictTypeNames })
        await retireEdge(ro, op, { reason: 'reeval-retire', at: OLD, conflictTypes: DOMAIN.conflictTypeNames })
        const callAI = async (p, c, co) => {
            if (co?.segment === 'edgeReview' && co.seat === 'first') await e.relations.replace({ ...qr, reason: R_NEW }) // 覆核期間 qr 被他處改寫
            return e.callAI(p, c, co)
        }
        const d = detOf(await stageRelate({ callAI }).run(e.ctx))
        const H = (e0) => e.holds.get(hold(e0).id)
        // 存量:只有 ef(豁免早於邊時刻);ab 未結(使用者)、cd 豁免涵蓋現值 → 不重排;入列之待判:kl(要求重試)、qr(pipeline)
        assert.deepEqual([d.rs6Stock, d.rs6Holds, d.rs6Kept, d.rs6Retry, d.rs6Stale, d.rs6Retired], [1, 2, 1, 1, 1, 0], JSON.stringify(d))
        const seen = e.calls.filter((c) => c.seg === 'er').map((c) => c.prompt).join('\n')
        assert.ok(seen.includes('標題：標題e') && seen.includes('標題：標題k') && seen.includes('標題：標題q') && !seen.includes('標題：標題a') && !seen.includes('標題：標題c'))
        assert.deepEqual([(await H(ab)).status, (await H(ab)).tries, (await H(cd)).status], ['open', 2, 'waived'])
        assert.deepEqual([(await H(gh)).status, (await H(gh)).how], ['resolved', '邊已為衝突型（由衝突核對 RS4 負責）'], '不分負責者結案')
        assert.deepEqual([(await H(ij)).status, (await H(ij)).how], ['resolved', '端點筆記已不在'])
        assert.deepEqual([(await H(mn)).status, (await H(op)).status, (await H(op)).how], ['open', 'resolved', '邊已撤出'], '隔離者不結案、他理由撤出者結案')
        const hk = await H(kl)
        assert.deepEqual([hk.status, hk.owner, hk.next, hk.tries, hk.reason], ['open', 'user', 'N', 3, '判定小組未成立（缺票（呼叫失敗或回覆不合格））'])
        assert.deepEqual(await H(qr), hold(qr, { owner: 'pipeline', tries: 0 }), '陳舊:待判一字不動')
        assert.deepEqual([await e.checks.get(checkKey(RS6.objectEdge, qr.id)), (await e.relations.get(qr.id)).reason, e.erLog().map((r) => r.outcome).sort()], [null, R_NEW, ['keep', 'retry']])
    })

    it('入項前預檢(終審 D8;standards/edgeQueue 之 stockSourceResolvedOf):存量排入之待判(ctx.stockStd)而來源標準現值已合格 → 結案(how 一句、rs6SourceResolved)、不送兩席、不記檢核;仍違反 → 照送;RS8 材料不可得(未能判定)→ 照送;負責者 user 要求重試 → 不預檢、照送;維護登錄之清單外型別(RS1)回到清單 → 結案', async () => {
        const at = '2026-10-05T00:00:00+08:00'
        const fixedAb = edge('a', 'b', T0, R_NEW) // 存量 RS2 排入後理由已被他途改好
        const stillCd = edge('c', 'd', T0, 'placeholder') // 仍違反 → 送兩席
        const userEf = edge('e', 'f', T0, R_NEW) // 負責者 user 要求重試 → 不預檢
        const numGh = edge('g', 'h', T0, '兩篇皆以 37 個月回看期建構動量組合') // RS8;材料不可得 → 未能判定 → 照送
        const typeIj = edge('i', 'j', T0, R0) // 維護登錄之 RS1(型別不在清單)而型別已回清單
        const e = env({ notes: ids(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']), edges: [fixedAb, stillCd, userEf, numGh, typeIj], relate: { standards: { edgeReview: { perRun: 0 } } }, review: (seat, it) => (it.a === '標題c' ? { verdict: 'change', type: T0, reason: R_NEW } : { verdict: 'keep', reason: '' }) })
        for (const [x, std, why] of [[fixedAb, 'RS2', '佔位理由「placeholder」'], [stillCd, 'RS2', '佔位理由「placeholder」'], [userEf, 'RS2', '佔位理由「placeholder」'], [numGh, 'RS8', '兩端皆無之數字：37']]) assert.equal(await queueEdgeReview(e.holds, x, { std, why, at }), 'queued')
        assert.equal(await queueEdgeReview(e.holds, typeIj, { std: 'RS1', why: '型別「舊型」不在現行清單', at, next: RELATE_HOLD_NEXT.edgeReviewTypeOffList }), 'queued')
        const kEf = holdKey(RS6.objectEdge, userEf.id, RS6.std)
        await e.holds.patch(kEf, { owner: 'user', retryRequestedAt: '2026-10-06T00:00:00+08:00' })
        fs.rmSync((await e.notes.get('g')).file)
        const d = detOf(await e.run())
        assert.deepEqual([d.rs6SourceResolved, d.rs6Holds, d.rs6Checked, d.rs6Kept, d.rs6ReasonFixed, d.rs6MdMissing], [2, 3, 3, 2, 1, 1], JSON.stringify(d))
        const how = (x) => e.holds.get(holdKey(RS6.objectEdge, x.id, RS6.std)).then((h) => [h.status, h.how])
        assert.deepEqual(await how(fixedAb), ['resolved', '存量 RS2 之違反已不在（現值已合格），不送兩席'])
        assert.deepEqual(await how(typeIj), ['resolved', '存量 RS1 之違反已不在（現值已合格），不送兩席'])
        assert.deepEqual([await e.checks.get(checkKey(RS6.objectEdge, fixedAb.id)), await e.checks.get(checkKey(RS6.objectEdge, typeIj.id))], [null, null], '預檢結案不記檢核(未經判定不記合格)')
        assert.deepEqual(await how(stillCd), ['resolved', '理由改寫落地'])
        assert.deepEqual(await how(userEf), ['resolved', '兩席判關聯成立'])
        assert.deepEqual(await how(numGh), ['resolved', '兩席判關聯成立'])
        const p = e.calls.find((c) => c.seg === 'er' && c.seat === 'first').prompt
        for (const [title, sent] of [['標題a', false], ['標題i', false], ['標題c', true], ['標題e', true], ['標題g', true]]) assert.equal(p.includes(`標題：${title}`), sent, `${title} ${sent ? '送審' : '不送審'}`)
    })

    it('AI 改寫之逆(終審 D16;ops/noteOps 之 revertEdgeRevision):覆核改理由後撤回 → 回復改寫前之值(過閘)、覆核帳 reverted(revertOf＝該列 at)、視為 RS6 裁示(檢核 user 合格、存量不再重排不派兩席);再撤回 → 最後一筆已是撤回;升為衝突後撤回 → 回復非衝突型、寫降級事件;現值其後另被改動 → 不覆寫;改寫前之值不合標準 → 不可逆', async () => {
        const e1 = edge('a', 'b')
        const e3 = edge('e', 'f')
        const ePh = edge('g', 'h', T0, 'placeholder')
        const e = env({ notes: ids(['a', 'b', 'e', 'f', 'g', 'h']), edges: [e1, e3, ePh], review: (seat, it) => (it.a === '標題e' ? { verdict: 'change', type: C, reason: R_C } : { verdict: 'change', type: T0, reason: R_NEW }) })
        const d = detOf(await e.run())
        assert.deepEqual([d.rs6ReasonFixed, d.rs6Upgraded, d.rs6StdFixed], [2, 1, 1], JSON.stringify(d))
        // 預演:可逆、將視為 RS6 裁示、不寫
        const p = await revertEdgeRevision(e.restoreDeps, e1.id)
        assert.deepEqual([p.found, p.ledger, p.std, p.revertible, p.applied, p.from, p.to, p.ruling, p.rs4Queued], [true, 'edgeReview', RS6.std, true, false, { type: T0, reason: R_NEW }, { type: T0, reason: R0 }, RS6.std, false])
        assert.equal(p.revertOf, e.erLog().find((r) => r.edgeId === e1.id && r.outcome === 'reason').at)
        assert.equal((await e.relations.get(e1.id)).reason, R_NEW, '預演不寫')
        // 套用
        const r = await revertEdgeRevision(e.restoreDeps, e1.id, { apply: true })
        const cur = await e.relations.get(e1.id)
        assert.deepEqual([r.applied, r.ruling, cur.type, cur.reason, cur.history?.some((h) => h.reason === R_NEW) || false], [true, RS6.std, T0, R0, false], '同方向同型別之理由更新不入 history(與 reviseEdge 同)')
        assert.ok(cur.updatedAt > OLD, 'updatedAt 推進(重評以之挑邊)')
        const last = e.erLog().at(-1)
        assert.deepEqual([last.entry, last.edgeId, last.outcome, last.revertOf, last.edge, last.written], ['user', e1.id, 'reverted', p.revertOf, { from: 'a', to: 'b', type: T0, reason: R_NEW }, { type: T0, reason: R0 }])
        const chk = await e.checks.get(checkKey(RS6.objectEdge, e1.id))
        assert.deepEqual([chk.results.RS6.status, chk.results.RS6.seats, chk.hash], ['pass', 'user', await hashOf(e, cur)], '裁示記檢核(雜湊含素材)')
        assert.ok(r.projected && r.projected.projected >= 0)
        // 下一輪(配額 10):已裁示之值不再重排、不派兩席
        const n0 = e.calls.filter((c) => c.seg === 'er').length
        await e.run()
        assert.equal(e.calls.filter((c) => c.seg === 'er').length, n0)
        assert.equal((await e.relations.get(e1.id)).reason, R0)
        // 再撤回 → 最後一筆已是撤回
        const again = await revertEdgeRevision(e.restoreDeps, e1.id, { apply: true })
        assert.deepEqual([again.revertible, again.reason], [false, '最後一筆已是撤回（其後無新改寫）'])
        // 升為衝突後撤回 → 回復非衝突型、降級事件、RS6 裁示
        const r3 = await revertEdgeRevision(e.restoreDeps, e3.id, { apply: true })
        const c3 = await e.relations.get(e3.id)
        assert.deepEqual([r3.applied, r3.ruling, c3.type, c3.reason], [true, RS6.std, T0, R0])
        assert.deepEqual(readConflictEvents(e.ctx.deps.dirs.state).map((x) => [x.edgeId, x.kind, x.oldType, x.newType]), [[e3.id, 'downgrade', C, T0]])
        // 現值其後另被改動 → 不覆寫;改寫前之值不合標準(佔位理由)→ 不可逆;無紀錄 → found false
        await e.relations.patch(ePh.id, { reason: '使用者其後改寫之理由，兩篇都談波動度之部位縮放' })
        const rp = await revertEdgeRevision(e.restoreDeps, ePh.id, { apply: true })
        assert.deepEqual([rp.revertible, rp.reason], [false, '現值已非該次改寫之結果（其後另被改動，不覆寫）'])
        await e.relations.patch(ePh.id, { reason: R_NEW })
        const rq = await revertEdgeRevision(e.restoreDeps, ePh.id, { apply: true })
        assert.deepEqual([rq.revertible, rq.applied], [false, false])
        assert.match(rq.reason, /^改寫前之值未達檢定標準：RS2 佔位理由「placeholder」/)
        assert.deepEqual((await revertEdgeRevision(e.restoreDeps, 'nope')).found, false)
        assert.deepEqual(e.erLog().filter((x) => x.outcome === 'reverted').map((x) => x.edgeId), [e1.id, e3.id], '不可逆者不記帳')
    })

    it('各返回點皆重算未結待判與進度(終審 F6;原則①同衝突核對):時間不足而延後時,入口已結案之過時待判不再計入 rs6Pending', async () => {
        const gone = edge('a', 'b')
        const hold = { id: holdKey(RS6.objectEdge, gone.id, RS6.std), object: RS6.objectEdge, oid: gone.id, std: RS6.std, status: 'open', owner: 'user', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} }
        const e = env({ notes: ids(['a', 'b', 'c', 'd']), edges: [edge('c', 'd')], holds: [hold] })
        e.ctx.remainingMs = () => 1_000_000
        e.ctx.deps.reserveMs = 900_000
        const d = detOf(await e.run())
        assert.deepEqual([d.rs6Deferred, d.rs6Pending, d.rs6Total, d.rs6Done, (await e.holds.get(hold.id)).how], [true, 0, 1, 0, '邊已撤出'], JSON.stringify(d))
    })
})
