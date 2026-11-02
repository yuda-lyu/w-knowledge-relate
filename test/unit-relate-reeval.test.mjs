// unit-relate-reeval.test.mjs — 關聯要點 3「變更」之半:內容變更後既有邊之重評(標準 RS5;定義見 standards/registry.mjs)
//   純函數(待重評、選邊之排除、分頁、裁決驗證、兩評一致、閘門分級、進度打包)、reviseEdge(身分集合語意、history 不減、真 LMDB patch 相符)、
//   重評段整段行為(正向先於重評、閘門關只記候選、兩評一致且供應者不同才套用、撤銷之稽核與事件帳、降級／改型／升衝突之計數、同一家／不一致／
//   缺項／逾限／陳舊／否決、懸空與本版本已判之邊不入頁、同輪兩端皆變更只排一頁、額度中止不記 tries、守門、停用無計數)
// 規格出處:規則帳本 REL-13
// 執行:自套件根 node <mocha> test/unit-relate-reeval.test.mjs(暫存 test/_tmp/relate-reeval-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { recLog, deepMerge, memStore, genClockTZ, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { readConflictEvents } from '../src/stores/conflictEvents.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { makeSlugResolver } from '../src/stores/candidates.mjs'
import { makeEdge, edgeId, typeRankOf, mergeEdge, reviseEdge, sameEdge, writeEdge, buildAdjacency } from '../src/stores/edgeStore.mjs'
import { openRelateLedgers, readAuditRows, recentReevalRetiredIds, LEDGER_FILES } from '../src/stores/relateLedgers.mjs'
import { packIds, unpackIds, reviewEdgesOf, pagesOf, verdictsByIndexOf, verdictsOf, decideOf, levelOf, gateAllows, REEVAL_REPROPOSE_DAYS } from '../src/stores/reevalPolicy.mjs'
import { needsEdgeReview } from '../src/stores/relatedNotes.mjs'
import { sameEdgeVerdict } from '../src/stores/edgeCheckKit.mjs'
import { needThird } from '../src/core/summarizePackage.mjs'
import { holdKey, listHolds, waiveHold, readJsonlRows } from '../src/core/capturePackage.mjs'
import { RS4 } from '../src/stores/conflictCheckPolicy.mjs'
import { requestRetry } from './tools/captureForTest.mjs'
import { deleteNote, restoreNote, reevalBaseline, reevalRequeue, restoreEdge, revertEdgeRevision } from '../src/ops/noteOps.mjs'
import { retireEdge } from '../src/stores/edgeRetire.mjs'
import { RS5 } from '../src/stores/relateHolds.mjs'
import { createRelateObject } from '../src/relateObject.mjs'
import { RELATE_CTX_FLAGS } from '../src/logContract.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const [T0, T1, T2] = DOMAIN.relationTypes.filter((t) => t !== DOMAIN.conflictType)
const C = DOMAIN.conflictType
const rank = typeRankOf({ relationTypes: DOMAIN.relationTypes, conflictType: C, fallbackType: DOMAIN.fallbackType })
const V = '2026-02-01T00:00:00+08:00' // 內容變更之版本
const OLD = '2026-01-05T00:00:00+08:00' // 變更前建立之邊
const E = (from, to, type, at = OLD, reason = `${from}與${to}之舊關聯：共用同一組參數`) => makeEdge({ from, to, type, reason, nowIso: at })
let seq = 0

/**
 * 環境:筆記(含 md)、邊、設定、待判登錄(holds;noHolds 不開);AI 替身依提示詞分正向(待建立關聯)與重評(內容已更新之筆記;第三席 third 只在設定有時呼叫)
 * @param {Object} o 輸入 { notes, edges, forward:{標題:relations}, reeval:(seat, item)=>verdicts, reply:(seat, data, { slugs })=>data(重評回覆之改寫;
 *   如加重複之項), cc:(seat, { a, b, index })=>票(衝突核對之替身;開啟衝突核對時用), providers:{first,second,third}, third:Boolean(設第三席),
 *   relate(settings.relate 之覆寫), fail:(seat)=>'skip'|'fail'|null, noHolds }
 * @returns {Object} 回傳 { ctx, notes, relations, holds, checks, log, calls, run, ledgers, dir, setNow(iso)(改用固定時鐘) }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const recs = (o.notes || []).map((n) => {
        const file = `${dir}/notes/${n.id}.md`
        const title = n.title || `標題${n.id}`
        writeMd(file, { title, slug: n.id }, `# ${title}\n\n## 一句話重點\n\n${n.id} 之重點\n\n## 核心知識\n\n- 要點`)
        return { category: 'c', summary: `${n.id} 之重點`, concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-02T00:00:00+08:00', ...n, title, file }
    })
    const notes = memStore(recs)
    const relations = memStore(o.edges || [])
    const holds = o.noHolds ? null : memStore([])
    const checks = memStore([])
    const log = recLog()
    const calls = []
    const deps = {
        stores: { notes, relations, checks, ...(holds ? { holds } : {}) },
        settings: resolveRelateSettings(deepMerge({
            ai: { parallel: 1, timeoutMs: 300_000, providerTimeouts: {} },
            relate: {
                rounds: 2, notesPerCall: 6, candidatesPerNote: 15, ai: { use: 'stub:a' }, reverse: { perRun: 0 },
                reeval: { perRun: 6, pagesPerRun: 24, pageSize: 10, apply: false, maxTries: 3, guard: 20, ai: { first: null, second: { use: 'stub:b' }, ...(o.third ? { third: { use: 'stub:c' } } : {}) } },
            },
        }, { relate: o.relate })),
        ai: null,
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: DOMAIN },
    }
    const ctx = bagCtx(deps, log)
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    const callAI = withCheck(async (prompt, check, co) => {
        if (co?.segment === 'reeval') {
            calls.push({ seg: 'reeval', seat: co.seat, prompt })
            const f = typeof o.fail === 'function' ? o.fail(co.seat) : null
            if (f === 'skip') return { ok: false, data: null, error: 'quota', skipped: true, attempts: 1 }
            if (f === 'fail') return { ok: false, data: null, error: 'stub fail', skipped: false, attempts: 1 }
            const items = [...prompt.matchAll(/^--- 第(\d+)項（內容已更新之筆記）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
            const slugs = [...prompt.matchAll(/^ {2}- slug: (\S+)｜/gm)].map((m) => m[1])
            const data0 = items.map((it) => ({ index: it.index, verdicts: o.reeval ? o.reeval(co.seat, { title: it.title, slugs }) : slugs.map((s) => ({ to: s, verdict: 'keep' })) }))
            const data = typeof o.reply === 'function' ? o.reply(co.seat, data0, { slugs }) : data0
            return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: { first: 'stub:a', second: 'stub:b', third: 'stub:c', ...(o.providers || {}) }[co.seat] }
        }
        if (co?.segment === 'conflictCheck') {
            calls.push({ seg: 'cc', seat: co.seat, prompt })
            const items = prompt.split(/^--- 第(\d+)項 ---$/m).slice(1).reduce((acc, x, i, arr) => (i % 2 === 0 ? [...acc, { index: Number(x), body: arr[i + 1] }] : acc), [])
                .map((b) => {
                    const titles = [...b.body.matchAll(/^標題：(.+)$/gm)].map((m) => m[1])
                    return { index: b.index, a: titles[0], b: titles[1] }
                })
            const data = items.map((it) => ({ index: it.index, ...(o.cc ? o.cc(co.seat, it) : { verdict: 'keep', reason: '' }) }))
            return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: { first: 'stub:a', second: 'stub:b', third: 'stub:c' }[co.seat] }
        }
        calls.push({ seg: co?.segment || 'forward', prompt })
        const targets = [...prompt.matchAll(/^--- 第(\d+)篇（待建立關聯）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
        return { ok: true, data: targets.map((t) => ({ index: t.index, relations: (o.forward || {})[t.title] || [] })), error: '', skipped: false, attempts: 1 }
    })
    const run = () => stageRelate({ callAI }).run(ctx)
    // 固定時鐘(待判之 at 與 retryRequestedAt 以時刻比先後——抓取套件之 retryRequestedOf;真時鐘同一秒內無從分先後)
    const setNow = (iso) => {
        ctx.deps.clock = { ...clock, iso8: () => iso }
    }
    return { ctx, notes, relations, holds, checks, log, calls, run, callAI, setNow, ledgers: () => openRelateLedgers(ctx.deps.dirs.state), dir, bag: ctx.bag, reevalLog: () => readJsonlRows(`${dir}/state/relate-reeval.jsonl`), retiredLog: () => readJsonlRows(`${dir}/state/relate-retired.jsonl`) }
}

describe('unit-relate-reeval', function() {

    before(() => {
        TMP = tmpRoot('relate-reeval')
    })
    after(() => removeRoots([TMP]))

    // ─── 純函數 ───

    it('needsEdgeReview:版本為字串、未評完此版本、且正向已評完此版本;packIds／unpackIds 版本不符即空集合', () => {
        assert.equal(needsEdgeReview({ knowledgeChangedAt: V, relatedChangeAt: V }), true)
        assert.equal(needsEdgeReview({ knowledgeChangedAt: V, relatedChangeAt: '' }), false, '正向未評完此版本:先正向')
        assert.equal(needsEdgeReview({ knowledgeChangedAt: V, relatedChangeAt: V, edgesReviewedChangeAt: V }), false)
        assert.equal(needsEdgeReview({ knowledgeChangedAt: '', relatedChangeAt: '' }), false)
        const p = packIds(V, ['b', 'a', 'a'])
        assert.equal(typeof p, 'string', '字串而非陣列(集合 patch 為深合併,陣列變短會殘留)')
        assert.deepEqual([...unpackIds(p, V)], ['a', 'b'])
        assert.equal(unpackIds(p, '2026-03-01T00:00:00+08:00').size, 0, '版本前進即舊進度失效')
        assert.equal(packIds(V, []), '')
    })

    it('reviewEdgesOf:排除懸空(鄰居不在或在墓碑)、本版本已判(邊時刻 ≥ 版本)、本版本已裁;同輪兩端皆待重評之對交 id 小者;pagesOf 衝突在前、新到舊、每頁 size', () => {
        const note = { id: 'n', knowledgeChangedAt: V, edgesReviewed: packIds(V, [edgeId('n', 'r')]) }
        const edges = [E('n', 'a', T0), E('n', 'gone', T0), E('n', 'tomb', T0), E('n', 'fresh', T0, '2026-03-01T00:00:00+08:00'), E('n', 'r', T0), E('a2', 'n', C), E('m', 'n', T1)]
        const byId = new Map(['n', 'a', 'tomb', 'fresh', 'r', 'a2', 'm'].map((id) => [id, { id }]))
        const r = reviewEdgesOf(note, { adj: buildAdjacency(edges), byId, isTombstoned: (id) => id === 'tomb', coSelected: new Set(['m']) })
        assert.deepEqual(r.edges.map((x) => x.nb).sort(), ['a', 'a2'])
        assert.deepEqual(r.excluded, { dangling: 2, fresh: 1, reviewed: 1, held: 0 })
        assert.deepEqual(r.deferred, [edgeId('m', 'n')], 'm 與 n 同輪皆待重評:m < n,由 m 之頁裁')
        const rh = reviewEdgesOf(note, { adj: buildAdjacency(edges), byId, isTombstoned: (id) => id === 'tomb', coSelected: new Set(['m']), isHeld: (id) => id === edgeId('n', 'a') })
        assert.deepEqual([rh.edges.map((x) => x.nb), rh.excluded.held], [['a2'], 1], '待判中之邊(交使用者判讀)不入頁')
        const pages = pagesOf([...r.edges, { nb: 'z', edge: E('n', 'z', T1, '2026-01-20T00:00:00+08:00') }], 2, C)
        assert.deepEqual(pages.map((p) => p.map((x) => x.nb)), [['a2', 'z'], ['a']], '衝突在前 → 新到舊')
    })

    it('reviewEdgesOf:邊時刻與版本同一秒(無法分先後)→ 照樣重評,不當成已判(2026-10-04 專案測試 C12 間歇失敗之成因)', () => {
        const note = { id: 'n', knowledgeChangedAt: V }
        const edges = [E('n', 'same', T0, V), E('n', 'later', T0, '2026-02-01T00:00:01+08:00')]
        const byId = new Map(['n', 'same', 'later'].map((id) => [id, { id }]))
        const r = reviewEdgesOf(note, { adj: buildAdjacency(edges), byId })
        assert.deepEqual(r.edges.map((x) => x.nb), ['same'], '同秒者入評')
        assert.deepEqual(r.excluded, { dangling: 0, fresh: 1, reviewed: 0, held: 0 }, '晚於版本者才排除')
    })

    it('verdictsByIndexOf:只採結構完整之項(index 為整數、verdicts 為陣列);同一 index 重複取第一個(同批次調度之部分接受,不取最後一個);非陣列之回覆 → 空', () => {
        const m = verdictsByIndexOf([{ index: 1, verdicts: 'x' }, { index: 1, verdicts: ['a'] }, { index: 1, verdicts: ['b'] }, { index: 2, verdicts: ['c'] }, { index: 2, verdicts: ['d'] }, { index: '3', verdicts: [] }, { index: 2.5, verdicts: [] }, null, { index: 4 }])
        assert.deepEqual([...m], [[1, ['a']], [2, ['c']]], '結構不完整之項略過且不佔位;重複者取第一個合格之項')
        for (const bad of [null, undefined, {}, 'x', 1]) assert.equal(verdictsByIndexOf(bad).size, 0, JSON.stringify(bad))
    })

    it('verdictsOf:slug 須為本頁鄰居、非自身;裁決值合法;change 之型別在白名單;型別與理由皆同現行＝沒有改、視同 keep(三標準同一規則;終審 D3 R63);change／retire 理由 ≥10 字;同 to 矛盾作廢', () => {
        const page = ['a', 'b', 'c', 'd', 'e'].map((nb) => ({ nb, edge: E('n', nb, T0) }))
        const resolve = makeSlugResolver(page.map((x) => ({ id: x.nb })))
        const raw = [
            { to: 'a', verdict: 'keep' },
            { to: 'b', verdict: 'change', type: T1, reason: '新內容改為延伸既有機制之研究' },
            { to: 'c', verdict: 'retire', reason: '太短' },
            { to: 'd', verdict: 'change', type: T0, reason: 'n與d之舊關聯：共用同一組參數' },
            { to: 'e', verdict: 'retire', reason: '新內容已轉為匯率主題，與 e 無共同機制' },
            { to: 'e', verdict: 'keep' },
            { to: 'zz', verdict: 'keep' },
            { to: 'n', verdict: 'keep' },
            { to: 'a', verdict: 'maybe' },
        ]
        const v = verdictsOf(raw, page, { resolve, relationTypes: DOMAIN.relationTypes, selfId: 'n' })
        assert.deepEqual([...v.byEdge.keys()].map((id) => page.find((x) => x.edge.id === id).nb), ['a', 'b', 'd'])
        assert.deepEqual(v.byEdge.get(page[3].edge.id), { verdict: 'keep', reason: 'n與d之舊關聯：共用同一組參數' }, 'd 型別與理由皆未變 → 視同 keep')
        assert.equal(v.invalid, 5, 'c 理由過短、e 矛盾、zz 不在頁、n 自身、maybe 非法值')
        const reasonOnly = verdictsOf([{ to: 'd', verdict: 'change', type: T0, reason: '只更新理由：新內容改以年化波動率衡量' }], page, { resolve, relationTypes: DOMAIN.relationTypes, selfId: 'n' })
        assert.equal(reasonOnly.byEdge.size, 1, '同型別而理由不同＝理由更新(合法)')
        // 型別經 domain.resolveType(RS9):別名表對映;無別名者無效(不落後備型別);理由不截斷(長度由寫入前之納入閘處置)
        const D2 = createRelateDomain({ vocab: { relationTypeAliases: { 衝突: C } } })
        const raw2 = [{ to: 'b', verdict: 'change', type: '衝突', reason: `新內容與乙之結論相反，${'甲'.repeat(250)}` }]
        const v2 = verdictsOf(raw2, page, { resolve, relationTypes: D2.relationTypes, resolveType: D2.resolveType, selfId: 'n' })
        assert.deepEqual([...v2.byEdge.values()].map((x) => [x.type, [...x.reason].length]), [[C, 261]])
        assert.equal(verdictsOf(raw2, page, { resolve, relationTypes: DOMAIN.relationTypes, resolveType: DOMAIN.resolveType, selfId: 'n' }).invalid, 1, '無別名表:無效')
        // 不確定(unsure)為合法裁決(判定小組;不須理由、不是 keep);與同 to 之明確裁決並存＝矛盾作廢
        const o0 = { resolve, relationTypes: DOMAIN.relationTypes, selfId: 'n' }
        const vu = verdictsOf([{ to: 'c', verdict: 'UNSURE' }, { to: 'a', verdict: 'unsure', reason: '' }, { to: 'a', verdict: 'unsure' }], page, o0)
        assert.deepEqual([vu.byEdge.get(page[2].edge.id), vu.byEdge.get(page[0].edge.id), vu.invalid], ['unsure', 'unsure', 0], '同 to 兩次 unsure 不算矛盾')
        const vx = verdictsOf([{ to: 'c', verdict: 'unsure' }, { to: 'c', verdict: 'keep' }], page, o0)
        assert.deepEqual([vx.byEdge.size, vx.invalid], [0, 1], 'unsure 與 keep 矛盾作廢')
    })

    it('decideOf(判定小組):兩票明確、相同(change 另須同型別)、供應者不同才成立;未成立分 disagree／missing／unsure／same-provider 不記已審;第三席只對其所送之邊投票;levelOf／gateAllows 分級', () => {
        const page = ['a', 'b', 'c', 'd', 'e', 'f'].map((nb) => ({ nb, edge: E('n', nb, nb === 'b' ? C : T0) }))
        const id = (nb) => page.find((x) => x.nb === nb).edge.id
        const a = new Map([[id('a'), { verdict: 'change', type: T1, reason: 'x'.repeat(10) }], [id('b'), { verdict: 'change', type: T0, reason: 'y'.repeat(10) }], [id('c'), { verdict: 'retire', reason: 'z'.repeat(10) }], [id('e'), 'unsure'], [id('f'), { verdict: 'change', type: T1, reason: 'f'.repeat(10) }]])
        const b = new Map([[id('a'), { verdict: 'change', type: T1, reason: 'w'.repeat(10) }], [id('b'), { verdict: 'change', type: T0, reason: 'v'.repeat(10) }], [id('c'), { verdict: 'keep', reason: '' }], [id('d'), { verdict: 'retire', reason: 'u'.repeat(10) }], [id('e'), { verdict: 'keep', reason: '' }], [id('f'), { verdict: 'change', type: T2, reason: 'g'.repeat(10) }]])
        const seats = [{ seat: 'first', provider: 'p1', byEdge: a }, { seat: 'second', provider: 'p2', byEdge: b }]
        const r = decideOf(page, seats)
        assert.deepEqual(r.map((x) => [x.nb, x.decided, x.why, x.outcome || '']), [['a', true, '', 'change'], ['b', true, '', 'change'], ['c', false, 'disagree', ''], ['d', false, 'missing', ''], ['e', false, 'unsure', ''], ['f', false, 'disagree', '']], 'f:同為 change 而新型別不同＝不一致')
        assert.equal(r[0].reason, 'x'.repeat(10), 'change 之理由取成立兩票之先者')
        assert.deepEqual([r[0].a.reason, r[0].b.reason], ['x'.repeat(10), 'w'.repeat(10)], '成立之兩票(第一席之理由不合納入閘時改用第二席者)')
        // 同一供應者之兩票不算獨立
        const same = decideOf(page.slice(0, 1), [{ seat: 'first', provider: 'p1', byEdge: a }, { seat: 'second', provider: 'p1', byEdge: b }])
        assert.deepEqual([same[0].decided, same[0].why], [false, 'same-provider'])
        assert.equal(decideOf(page.slice(0, 1), [{ seat: 'first', provider: '', byEdge: a }, { seat: 'second', provider: 'p2', byEdge: b }])[0].why, 'same-provider', '供應者不明＝不算獨立')
        // 第三席:可成立者(無缺票、至少一票明確)才叫;只對所送之邊投票,與成對之那一票供應者不同才成立
        assert.deepEqual(r.map((x) => needThird(x.votes, { same: sameEdgeVerdict })), [false, false, true, false, true, true], 'd 缺票 → 重試不叫第三席')
        assert.equal(needThird([{ seat: 'first', provider: 'p1', verdict: 'unsure' }, { seat: 'second', provider: 'p2', verdict: 'unsure' }]), false, '兩票皆不確定 → 第三席無從成立')
        const c3 = new Map([[id('c'), { verdict: 'retire', reason: 't'.repeat(10) }], [id('e'), { verdict: 'keep', reason: '' }]])
        const r3 = decideOf(page, [...seats, { seat: 'third', provider: 'p3', byEdge: c3 }])
        assert.deepEqual(r3.map((x) => [x.nb, x.decided, x.outcome || x.why]), [['a', true, 'change'], ['b', true, 'change'], ['c', true, 'retire'], ['d', false, 'missing'], ['e', true, 'keep'], ['f', false, 'disagree']], '第三席未送之 d、f 不因多一席而變(無第三席之票)')
        assert.deepEqual([r3[2].votes.length, r3[3].votes.length], [3, 2])
        const r3same = decideOf(page.slice(2, 3), [...seats, { seat: 'third', provider: 'p1', byEdge: c3 }])
        assert.equal(r3same[0].decided, false, '第三席與成對之第一席同一供應者 → 不成立')
        // 級別與閘門
        assert.deepEqual(r.slice(0, 2).map((x) => levelOf(x, C)), ['additive', 'destructive'], 'b 為衝突降級＝destructive')
        assert.equal(levelOf(r3[2], C), 'destructive', '撤銷＝destructive')
        assert.equal(levelOf(r3[4], C), 'none', '保留＝none')
        assert.equal(levelOf({ outcome: 'change', type: C, edge: E('n', 'x', T0) }, C), 'additive', '升為衝突＝additive')
        assert.deepEqual([gateAllows(false, 'additive'), gateAllows('additive', 'additive'), gateAllows('additive', 'destructive'), gateAllows('all', 'destructive'), gateAllows('all', 'none')], [false, true, false, true, false])
    })

    it('reviseEdge:新勝者身分移出 history、舊勝者入 history、同身分取最優;history 長度不減;與 mergeEdge 之後續合併相容;真 LMDB 之 patch 結果逐欄相符', async () => {
        const opt = { rank, conflictType: C }
        let st = mergeEdge(null, E('a', 'b', T0, '2026-01-01T00:00:00+08:00'), opt).edge
        st = mergeEdge(st, E('b', 'a', T1, '2026-01-02T00:00:00+08:00'), { ...opt, allowTypeChange: true }).edge
        const h0 = (st.history || []).length
        const rv = reviseEdge(st, E('a', 'b', T1, '2026-02-02T00:00:00+08:00', '新理由：改為延伸'), { rank })
        assert.deepEqual([rv.from, rv.to, rv.type, rv.reason, rv.updatedAt, rv.id], ['a', 'b', T1, '新理由：改為延伸', '2026-02-02T00:00:00+08:00', st.id])
        const keys = (rv.history || []).map((h) => `${h.from}|${h.to}|${h.type}`)
        assert.equal(new Set(keys).size, keys.length, '身分不重複')
        assert.ok(!keys.includes('a|b|' + T1), '新勝者身分不在 history')
        assert.ok((rv.history || []).length >= h0, 'history 長度不減')
        const back = reviseEdge(rv, E('a', 'b', st.type, '2026-02-03T00:00:00+08:00', '再改回'), { rank })
        assert.ok((back.history || []).length >= (rv.history || []).length, 'A→B→A 不縮短 history')
        const again = mergeEdge(back, E('b', 'a', T2, '2026-02-04T00:00:00+08:00'), { ...opt, allowTypeChange: false })
        assert.equal(again.edge.type, back.type, '其後跨輪合併仍以庫內為準')
        const rel = W.openCollection({ WOrm, path: `${TMP}/db`, db: 'knowledge', cl: 'rel' })
        try {
            await rel.insertNew([st])
            await writeEdge(rel, rv)
            assert.ok(sameEdge(await rel.get(st.id), rv), 'patch 單交易落庫逐欄相符')
        }
        finally {
            await rel.close()
        }
    })

    // ─── 整段行為 ───

    const base = (o = {}) => env({
        notes: [
            { id: 'n', title: '變更篇', knowledgeChangedAt: V },
            { id: 'a', title: '甲' }, { id: 'b', title: '乙' }, { id: 'c', title: '丙' }, { id: 'd', title: '丁' },
        ],
        edges: [E('n', 'a', T0), E('b', 'n', C), E('n', 'c', T0), E('n', 'd', T1)],
        ...o,
    })
    const plan = { 甲: { verdict: 'retire', reason: '新內容已轉為匯率主題，與甲無共同機制' }, 乙: { verdict: 'change', type: T0, reason: '兩篇結論已一致，改為互補之前提關係' }, 丙: { verdict: 'change', type: C, reason: '變更篇說動量持續，丙說動量崩潰，結論相反' }, 丁: { verdict: 'keep' } }
    const byTitle = (env0) => (seat, item) => item.slugs.map((s) => ({ to: s, ...(plan[{ a: '甲', b: '乙', c: '丙', d: '丁' }[s]] || { verdict: 'keep' }) }))

    it('閘門關(預設 false):正向先評完 → 重評兩席各一次;一致之撤銷／改型只記候選帳,邊不變;本篇評完(edgesReviewedChangeAt＝版本、進度清空)', async () => {
        const e = base({ reeval: byTitle() })
        const r = await e.run()
        assert.deepEqual(e.calls.map((x) => x.seg), ['forward', 'reeval', 'reeval'], '正向 → 重評兩席')
        assert.deepEqual(e.calls.filter((x) => x.seg === 'reeval').map((x) => x.seat).sort(), ['first', 'second'])
        assert.equal((await e.relations.select()).length, 4, '閘門關:邊不變')
        const log = e.reevalLog()
        assert.deepEqual(log.map((x) => x.outcome).sort(), ['candidate', 'candidate', 'candidate'])
        assert.ok(log.every((x) => x.edge && x.version === V && x.verdicts.length === 2), '候選帳含變更前之邊值、版本、兩份裁決')
        const n = await e.notes.get('n')
        assert.deepEqual([n.edgesReviewedChangeAt, n.edgesReviewed, n.reevalTries], [V, '', 0])
        assert.deepEqual([r.detail.reevalCandidates, r.detail.reevalCompleted, r.detail.reevalChanged, r.detail.reevalRetired], [3, 1, 0, 0], JSON.stringify(r.detail))
        assert.equal(r.stats.aiCalls, 1 + 2, '重評每頁計 2 次')
        const r2 = await e.run()
        assert.equal(r2.detail.reevalPending, 0, '評完後不再入池')
    })

    it('保留時間(deps.reserveMs／stageRelate 之 opt.reserveMs):扣保留後剩餘不足兩席之首家逾時 → 本輪延後(reevalDeferred;不呼叫、不記 tries、未評完);opt.reserveMs 優先', async () => {
        const e = base({ reeval: byTitle() })
        // 剩 1,000 秒、首家逾時 300 秒:保留 900 秒 → 延後
        e.ctx.remainingMs = () => 1_000_000
        e.ctx.expired = () => false
        e.ctx.deps.reserveMs = 900_000
        const r = await e.run()
        const n = await e.notes.get('n')
        assert.deepEqual([r.detail.reevalDeferred, e.calls.filter((x) => x.seg === 'reeval').length, n.reevalTries || 0, n.edgesReviewedChangeAt || ''], [true, 0, 0, ''], JSON.stringify(r.detail))
        assert.ok(e.log.lines.some((l) => /^INFO 關聯重評：扣保留時間後剩餘時間不足一次呼叫/.test(l)), e.log.lines.join('\n'))
        const r2 = await stageRelate({ callAI: e.callAI, reserveMs: 0 }).run(e.ctx)
        assert.deepEqual([r2.detail.reevalDeferred, r2.detail.reevalCompleted], [false, 1], 'opt.reserveMs 優先')
    })

    it('物件摘要(objects.createRelateObject):有重評頁 → 關聯段 summary 附「｜重評 N 篇（改型 a、撤銷 b、候選 c）」;無待重評之輪不附', async () => {
        const e = base({ reeval: byTitle() })
        const obj = createRelateObject({ relate: { callAI: e.callAI } })
        const rep = await obj.run(e.ctx)
        assert.match(rep.summary, /｜重評 1 篇（改型 0、撤銷 0、候選 3）/, rep.summary)
        const rep2 = await obj.run(e.ctx)
        assert.doesNotMatch(rep2.summary, /重評/, rep2.summary)
    })

    it('閘門 all＋兩評一致且供應者不同:撤銷(先稽核再刪、回驗)、衝突降級(事件帳)、升為衝突(併入 conflicts)、保留;兩端 dirty;總覽待重建;relateEdges 計改型與撤銷', async () => {
        const e = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' } } })
        const r = await e.run()
        const edges = await e.relations.select()
        assert.ok(!edges.some((x) => x.id === edgeId('n', 'a')), '甲撤銷')
        assert.equal(e.retiredLog()[0].reason, 'reeval-retire')
        assert.equal(edges.find((x) => x.id === edgeId('n', 'b')).type, T0, '乙降級為非衝突')
        const c = edges.find((x) => x.id === edgeId('n', 'c'))
        assert.deepEqual([c.type, c.from], [C, 'n'], '丙升為衝突')
        assert.equal(edges.find((x) => x.id === edgeId('n', 'd')).type, T1, '丁保留')
        const ev = readConflictEvents(e.ctx.deps.dirs.state)
        assert.deepEqual(ev.map((x) => [x.kind, x.oldType, x.newType]), [['downgrade', C, T0]], '衝突降級寫事件帳(提煉排重審)')
        assert.deepEqual([r.detail.reevalRetired, r.detail.reevalChanged, r.detail.reevalDowngraded, r.detail.reevalUpgraded, r.detail.conflicts], [1, 2, 1, 1, 1], JSON.stringify(r.detail))
        assert.equal(e.bag.get(RELATE_CTX_FLAGS.edgesChanged) >= 3, true, '改型 2＋撤銷 1 觸發總覽重建')
        assert.ok(['n', 'a', 'b', 'c'].every((id) => e.ledgers().dirty.has(id)), '兩端記 dirty')
        assert.equal(e.ledgers().state.get().indexDirty, true)
        assert.deepEqual(e.reevalLog().filter((x) => x.outcome === 'applied').length, 3)
    })

    it('目標內容讀 md 之一句話重點全文(三審 F22):記錄 summary 截 300 字者提示詞仍得全文;md 讀不到 → 本輪不入池、不記 tries、計 reevalMdMissing', async () => {
        const e = base({ reeval: byTitle() })
        const long = '新重點'.repeat(150) // 450 字
        writeMd(`${e.dir}/notes/n.md`, { title: '變更篇', slug: 'n' }, `# 變更篇\n\n## 一句話重點\n\n${long}\n\n## 核心知識\n\n- 要點`)
        await e.notes.patch('n', { summary: long.slice(0, 300) })
        await e.run()
        const p = e.calls.find((x) => x.seg === 'reeval').prompt
        assert.ok(p.includes(`一句話重點：${long}\n`), '提示詞得 md 全文(非記錄之 300 字)')
        const e2 = base({ reeval: byTitle() })
        fs.rmSync(`${e2.dir}/notes/n.md`)
        const r2 = await e2.run()
        assert.equal(e2.calls.filter((x) => x.seg === 'reeval').length, 0, '不呼叫重評')
        assert.deepEqual([r2.detail.reevalMdMissing, r2.detail.reevalTargets, r2.detail.reevalPending], [1, 0, 1], JSON.stringify(r2.detail))
        const n2 = await e2.notes.get('n')
        assert.deepEqual([n2.reevalTries || 0, n2.edgesReviewedChangeAt || ''], [0, ''], '不記 tries、未評完(md 補回即續評)')
    })

    it('振盪觀察(三審 D5):重評撤銷之對於窗內又被正向段提出 → reevalReproposed、只觀察不擋;readAuditRows／recentReevalRetiredIds 窗外與非重評撤銷不計、壞行略過', async () => {
        const fw = {}
        const e = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' } }, forward: fw })
        const r1 = await e.run()
        assert.equal(r1.detail.reevalReproposed, 0, '啟用時恆有此欄')
        assert.equal(await e.relations.get(edgeId('n', 'a')), null, '前提:甲已撤銷')
        fw['變更篇'] = [{ to: 'a', type: T0, reason: '再次變更後之變更篇又與甲共用同一動量參數' }]
        await e.notes.patch('n', { knowledgeChangedAt: '2026-03-01T00:00:00+08:00' })
        const r2 = await e.run()
        assert.ok(await e.relations.get(edgeId('n', 'a')), '只觀察、不擋:邊照建')
        assert.equal(r2.detail.reevalReproposed, 1, JSON.stringify(r2.detail))
        assert.ok(e.log.lines.some((l) => new RegExp(`於重評撤銷後 ${REEVAL_REPROPOSE_DAYS} 天內再被正向段提出`).test(l)))
        // 讀法單一實作:缺檔＝空;窗外、非重評撤銷、壞行皆不計
        const f = `${e.dir}/audit-probe.jsonl`
        assert.deepEqual(readAuditRows(f), [])
        const day = 86_400_000
        const now = Date.parse('2026-10-04T12:00:00+08:00')
        const iso = (ms) => new Date(ms).toISOString()
        fs.writeFileSync(f, [
            JSON.stringify({ at: iso(now - day), reason: 'reeval-retire', edge: { id: 'e1' } }),
            JSON.stringify({ at: iso(now - (REEVAL_REPROPOSE_DAYS + 1) * day), reason: 'reeval-retire', edge: { id: 'e2' } }),
            JSON.stringify({ at: iso(now - day), reason: 'note-deleted', edge: { id: 'e3' } }),
            '{"at":"半行',
        ].join('\n') + '\n', 'utf8')
        assert.equal(readAuditRows(f).length, 3, '壞行略過')
        assert.deepEqual([...recentReevalRetiredIds(f, now - REEVAL_REPROPOSE_DAYS * day)], ['e1'])
    })

    it('重評改型過納入閘(終審 R6-g):第一席理由不合標準(無據數字)改用第二席者;兩席皆不合 → 不套用、重評帳 std-reject、計 reevalStdRejected', async () => {
        const e = base({
            relate: { reeval: { apply: 'all' } },
            reeval: (seat, item) => item.slugs.map((s) => {
                if (s === 'b') return { to: s, verdict: 'change', type: T0, reason: seat === 'first' ? '兩篇結論已一致，夏普 1.9 之策略互補' : '兩篇結論已一致，改為互補之前提關係' }
                if (s === 'c') return { to: s, verdict: 'change', type: C, reason: seat === 'first' ? '變更篇說年化 12%，丙說 -3%' : '變更篇說年化 12%，丙說虧損' }
                return { to: s, verdict: 'keep' }
            }),
        })
        const r = await e.run()
        const b = await e.relations.get(edgeId('n', 'b'))
        assert.deepEqual([b.type, b.reason], [T0, '兩篇結論已一致，改為互補之前提關係'], '第一席之理由含無據數字 → 用第二席者')
        assert.equal((await e.relations.get(edgeId('n', 'c'))).type, T0, '兩席之理由皆含無據數字 → 不套用(維持原型別)')
        const rej = e.reevalLog().filter((x) => x.outcome === 'std-reject')
        assert.equal(rej.length, 1)
        assert.match(rej[0].problems.join('；'), /^RS8 兩端皆無之數字：12%/)
        assert.equal(r.detail.reevalStdRejected, 1, JSON.stringify(r.detail))
        const applied = e.reevalLog().find((x) => x.outcome === 'applied')
        assert.equal(applied.written.reason, '兩篇結論已一致，改為互補之前提關係', '重評帳記實際寫入之理由')
    })

    it('閘門 additive:升衝突與非衝突改型套用;撤銷與衝突降級只記候選', async () => {
        const e = base({ reeval: byTitle(), relate: { reeval: { apply: 'additive' } } })
        await e.run()
        const edges = await e.relations.select()
        assert.ok(edges.some((x) => x.id === edgeId('n', 'a')), '撤銷未套用')
        assert.equal(edges.find((x) => x.id === edgeId('n', 'b')).type, C, '降級未套用')
        assert.equal(edges.find((x) => x.id === edgeId('n', 'c')).type, C, '升衝突已套用')
        assert.deepEqual(e.reevalLog().map((x) => x.outcome).sort(), ['applied', 'candidate', 'candidate'])
    })

    it('同一家成交(second 遞補到同一供應者)→ 記 same-provider、不套用、不記已審、本篇記 tries(下輪重評);有第三席(他家)→ 與第一席成立而套用', async () => {
        const e = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' } }, providers: { first: 'stub:a', second: 'stub:a' } })
        const r = await e.run()
        assert.equal((await e.relations.select()).length, 4)
        assert.ok(e.reevalLog().every((x) => x.outcome === 'same-provider'))
        const n = await e.notes.get('n')
        assert.deepEqual([n.reevalTries, n.edgesReviewedChangeAt || '', unpackIds(n.edgesReviewed, V).size], [1, '', 0], '同一供應者之兩票不算判定:未評完、無已審')
        assert.deepEqual([r.detail.reevalSameProvider, r.detail.reevalHolds || 0], [4, 0], '同一供應者 → 重試,不入待判')
        assert.equal((await listHolds(e.holds)).length, 0)
        const e3 = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' } }, providers: { first: 'stub:a', second: 'stub:a' }, third: true })
        const r3 = await e3.run()
        assert.deepEqual(e3.calls.filter((x) => x.seg === 'reeval').map((x) => x.seat).sort(), ['first', 'second', 'third'], '第三席一次(只送未成立之邊)')
        assert.equal(r3.detail.reevalThird, 4)
        assert.equal(r3.stats.aiCalls, 1 + 2 + 1, '第三席計入呼叫數')
        assert.ok(!(await e3.relations.select()).some((x) => x.id === edgeId('n', 'a')), '第一席(stub:a)與第三席(stub:c)一致 → 甲撤銷')
        assert.ok(e3.reevalLog().find((x) => x.outcome === 'applied').verdicts.some((v) => v.seat === 'third' && v.provider === 'stub:c'), '重評帳記三席之票')
        assert.equal((await e3.notes.get('n')).edgesReviewedChangeAt, V, '全部判定 → 評完')
    })

    it('回覆之同一 index 重複:三席一律取第一個結構完整之項(同批次調度;第一席、第二席、第三席各一案——重複之項皆判 keep,取最後一個或取第一個而不驗結構者結果不同)', async () => {
        const keepAll = (slugs) => slugs.map((s) => ({ to: s, verdict: 'keep' }))
        for (const seat of ['first', 'second']) {
            const e = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' } }, reply: (s, data, { slugs }) => (s === seat ? [data[0], { index: 1, verdicts: keepAll(slugs) }] : data) })
            const r = await e.run()
            const edges = await e.relations.select()
            assert.ok(!edges.some((x) => x.id === edgeId('n', 'a')), `${seat}:取第一項(與另一席一致)→ 甲撤銷`)
            assert.deepEqual([r.detail.reevalRetired, r.detail.reevalChanged, r.detail.reevalDisagree || 0, r.detail.reevalHolds || 0], [1, 2, 0, 0], `${seat}:${JSON.stringify(r.detail)}`)
        }
        // 第三席:首項結構不完整(verdicts 非陣列)→ 略過;取其後第一個合格之項(與第一席一致)→ 成立;再後之重複項(全 keep)不採
        const e3 = base({
            reeval: byTitle(), relate: { reeval: { apply: 'all' } }, providers: { first: 'stub:a', second: 'stub:a' }, third: true,
            reply: (s, data, { slugs }) => (s === 'third' ? [{ index: 1, verdicts: '壞' }, data[0], { index: 1, verdicts: keepAll(slugs) }] : data),
        })
        const r3 = await e3.run()
        assert.deepEqual([r3.detail.reevalThird, r3.detail.reevalMissing || 0, r3.detail.reevalRetired, r3.detail.reevalChanged], [4, 0, 1, 2], JSON.stringify(r3.detail))
        assert.ok(!(await e3.relations.select()).some((x) => x.id === edgeId('n', 'a')), '第三席取第一個合格之項(與第一席一致)→ 甲撤銷')
        assert.equal((await e3.notes.get('n')).edgesReviewedChangeAt, V, '全部判定 → 評完')
    })

    it('兩評不一致／有一席不確定 → 不套用、不記已審,登錄待判(物件 edge、標準 RS5、使用者);不擋本版本評完;第三席缺票(失敗、未涵蓋)→ 照缺項(不轉使用者、記 tries、下輪重評);未開 holds → WARN、下輪重評', async () => {
        const split = (seat, item) => item.slugs.map((s) => (s === 'd' ? { to: s, verdict: seat === 'first' ? 'unsure' : 'keep' } : seat === 'first' ? { to: s, verdict: 'retire', reason: '新內容與對象已無共同機制可言' } : { to: s, verdict: 'keep' }))
        const e = base({ relate: { reeval: { apply: 'all' } }, reeval: split })
        const r = await e.run()
        assert.equal((await e.relations.select()).length, 4)
        assert.deepEqual([r.detail.reevalDisagree, r.detail.reevalUnsure, r.detail.reevalHolds], [3, 1, 4], JSON.stringify(r.detail))
        const hs = await listHolds(e.holds, { std: 'RS5' })
        assert.deepEqual(hs.map((h) => [h.object, h.owner, h.status, h.ctx.note, h.ctx.version]), Array(4).fill(['edge', 'user', 'open', 'n', V]))
        // 未成立原因之字樣取判定小組之字樣表(摘要套件之 PANEL_WHY_LABELS;摘要、關聯、提煉同用)
        assert.ok(hs.find((h) => h.oid === edgeId('n', 'd')).reason.includes('重評判不了（有席位不確定）'))
        assert.ok(hs.find((h) => h.oid === edgeId('n', 'a')).reason.includes('重評判不了（各席裁決不一致）'))
        assert.deepEqual(e.reevalLog().map((x) => x.outcome).sort(), ['disagree', 'disagree', 'disagree', 'unsure'])
        const n = await e.notes.get('n')
        assert.deepEqual([n.edgesReviewedChangeAt, unpackIds(n.edgesReviewed, V).size, n.reevalTries || 0], [V, 0, 0], '判不了之邊不記已審;交使用者後不擋評完、不記 tries')
        const r2 = await e.run()
        assert.deepEqual([r2.detail.reevalPending, e.calls.filter((x) => x.seg === 'reeval').length], [0, 2], '待判中不再自動重評')
        // 第三席缺票:呼叫失敗 → 送審之 4 條皆照缺項(與衝突核對、既有邊覆核同:第三席本可改變結果,不以前兩票之未決結果轉使用者)
        const e3 = base({ relate: { reeval: { apply: 'all' } }, reeval: split, third: true, fail: (seat) => (seat === 'third' ? 'fail' : null) })
        const r3 = await e3.run()
        assert.deepEqual([r3.detail.reevalThird, r3.detail.reevalMissing, r3.detail.reevalHolds || 0, r3.detail.reevalDisagree || 0, (await listHolds(e3.holds)).length], [4, 4, 0, 0, 0], JSON.stringify(r3.detail))
        const n3 = await e3.notes.get('n')
        assert.deepEqual([n3.reevalTries, n3.edgesReviewedChangeAt || ''], [1, ''], '記 tries、未評完(下輪重評)')
        assert.match(n3.reevalLastError, /第三席缺票/)
        // 第三席只回部分邊(未涵蓋者照缺項;有票者依三票判定)
        const e5 = base({
            relate: { reeval: { apply: 'all' } }, third: true,
            reeval: (seat, item) => (seat === 'third' ? item.slugs.filter((s) => s === 'd').map((s) => ({ to: s, verdict: 'keep' })) : split(seat, item)),
        })
        const r5 = await e5.run()
        assert.deepEqual([r5.detail.reevalThird, r5.detail.reevalMissing, r5.detail.reevalHolds || 0], [4, 3, 0], JSON.stringify(r5.detail))
        const n5 = await e5.notes.get('n')
        assert.deepEqual([unpackIds(n5.edgesReviewed, V).has(edgeId('n', 'd')), n5.reevalTries], [true, 1], '丁:第三席與第二席同判 keep → 成立、記已審;其餘缺項 → 記 tries')
        // 未開 holds:重評開啟須 holds 集合(同衝突核對、既有邊覆核;終審 D3 R68)——開工即拋,不降級、不假稱已登錄
        const e4 = base({ relate: { reeval: { apply: 'all' } }, reeval: split, noHolds: true })
        await assert.rejects(() => e4.run(), /關聯重評\(relate\.reeval\.perRun\)需要 holds 集合/)
        assert.equal(e4.calls.filter((x) => x.seg === 'reeval').length, 0, '拋於呼叫 AI 之前')
    })

    it('第三席中止(中止不計、失敗計之對照):送第三席之邊本輪不判——不計缺項、不記 tries(該篇不評完,下輪再評)、不入待判;本輪其後之頁不再叫第三席(已耗盡;其後之頁需第三席之邊同不判)、記 aborted 與 INFO 一句;下輪第三席恢復 → 判定、評完。第三席失敗(非中止)→ 照缺項、記 tries、其後之頁照叫', async () => {
        const split = (seat, item) => item.slugs.map((s) => (seat === 'first' ? { to: s, verdict: 'retire', reason: '新內容與對象已無共同機制可言' } : { to: s, verdict: 'keep' }))
        // 兩篇(各一頁、依序):各兩條邊皆兩席不一致 → 第三席
        const mk = (fail) => env({
            notes: [{ id: 'n', title: '變更篇', knowledgeChangedAt: V }, { id: 'n2', title: '變更篇二', knowledgeChangedAt: V }, { id: 'a', title: '甲' }, { id: 'b', title: '乙' }, { id: 'c', title: '丙' }, { id: 'd', title: '丁' }],
            edges: [E('n', 'a', T0), E('n', 'b', T0), E('n2', 'c', T0), E('n2', 'd', T1)],
            third: true, relate: { reeval: { apply: 'all' } }, reeval: split, fail,
        })
        const seats = (e, from = 0) => e.calls.slice(from).filter((x) => x.seg === 'reeval').map((x) => x.seat)
        // 中止:第三席只在第一次呼叫中止(其後若再叫會成交)——其後之頁仍不叫
        let n3 = 0
        const s = mk((seat) => (seat === 'third' && n3++ === 0 ? 'skip' : null))
        const rs = await s.run()
        assert.deepEqual(seats(s), ['first', 'second', 'third', 'first', 'second'], '第三席中止後,其後之頁不再叫')
        assert.deepEqual([rs.detail.reevalThird, rs.detail.reevalMissing, rs.detail.aborted, rs.stats.aiCalls], [4, 0, true, 1 + 4 + 1], JSON.stringify(rs.detail))
        for (const id of ['n', 'n2']) {
            const n = await s.notes.get(id)
            assert.deepEqual([n.reevalTries || 0, n.edgesReviewedChangeAt || '', unpackIds(n.edgesReviewed, V).size], [0, '', 0], `${id}:不記 tries、不評完(下輪再評)`)
        }
        assert.deepEqual([(await listHolds(s.holds)).length, s.reevalLog().length], [0, 0], '不入待判、不寫重評帳')
        assert.deepEqual(s.log.lines.filter((l) => /第三席額度或截止中止/.test(l)), ['INFO 關聯重評：第三席額度或截止中止（quota），送第三席之邊本輪不判、下輪再評（不計次）；本輪其後不再叫第三席'])
        // 下輪:第三席恢復 → 兩篇之邊判定(第三席與第二席同判 keep)、評完
        const before = s.calls.length
        await s.run()
        assert.deepEqual(seats(s, before), ['first', 'second', 'third', 'first', 'second', 'third'])
        for (const id of ['n', 'n2']) assert.deepEqual([((await s.notes.get(id)).reevalTries || 0), (await s.notes.get(id)).edgesReviewedChangeAt], [0, V], id)
        // 對照:第三席失敗(非中止)→ 照缺項、記 tries;其後之頁照叫
        const f = mk((seat) => (seat === 'third' ? 'fail' : null))
        const rf = await f.run()
        assert.deepEqual(seats(f), ['first', 'second', 'third', 'first', 'second', 'third'], '失敗不耗盡:其後之頁照叫')
        assert.deepEqual([rf.detail.reevalThird, rf.detail.reevalMissing, rf.detail.aborted], [4, 4, false], JSON.stringify(rf.detail))
        for (const id of ['n', 'n2']) {
            const n = await f.notes.get(id)
            assert.deepEqual([n.reevalTries, n.edgesReviewedChangeAt || ''], [1, ''], id)
            assert.match(n.reevalLastError, /第三席缺票/)
        }
    })

    it('待判之重試與結案:使用者 retry → 該篇本版本只再評該邊(已審者不重評);判定成立 → 結案;waive 者不再評;內容再變更 → 舊版本之待判結案、新版本照常評', async () => {
        let mode = 'split'
        const e = base({
            relate: { reeval: { apply: 'all' } },
            reeval: (seat, item) => item.slugs.map((s) => (mode === 'split' && (s === 'a' || s === 'c') && seat === 'first' ? { to: s, verdict: 'retire', reason: '新內容與對象已無共同機制可言' } : { to: s, verdict: 'keep' })),
        })
        e.setNow('2026-10-05T10:00:00+08:00')
        await e.run()
        const ha = holdKey('edge', edgeId('n', 'a'), 'RS5')
        const hc = holdKey('edge', edgeId('n', 'c'), 'RS5')
        assert.deepEqual([(await e.holds.get(ha)).status, (await e.holds.get(hc)).status], ['open', 'open'])
        assert.deepEqual([...unpackIds((await e.notes.get('n')).edgesReviewed, V)].sort(), [edgeId('b', 'n'), edgeId('n', 'd')].sort(), '有待判中之邊:評完時保留已審清單')
        // 使用者:甲 retry、丙 waive(保留)
        await requestRetry(e.holds, ha, { at: '2026-10-05T10:05:00+08:00' })
        await waiveHold(e.holds, hc, { by: '使用者', ruling: '保留', at: '2026-10-05T10:05:00+08:00' })
        mode = 'agree'
        e.setNow('2026-10-05T11:00:00+08:00')
        const before = e.calls.length
        const r = await e.run()
        assert.equal(r.detail.reevalRetried, 1)
        const prompts = e.calls.slice(before).filter((x) => x.seg === 'reeval').map((x) => x.prompt)
        assert.equal(prompts.length, 2)
        assert.ok(prompts.every((p) => p.includes(`slug: a｜`) && !p.includes('slug: b｜') && !p.includes('slug: c｜') && !p.includes('slug: d｜')), '只再評甲(已審者與已豁免者不重評)')
        assert.deepEqual([(await e.holds.get(ha)).status, (await e.holds.get(ha)).how, r.detail.reevalHoldsResolved], ['resolved', '重評已判定', 1])
        assert.equal((await e.notes.get('n')).edgesReviewedChangeAt, V, '再評完')
        const r2 = await e.run()
        assert.deepEqual([r2.detail.reevalPending, r2.detail.reevalRetried], [0, 0], '已結案:不再重排')
        // 內容再變更:舊版本之待判結案,新版本照常重評該邊(仍判不了 → 重開登錄、記新版本,前一段之結案留 history)
        const e2 = base({ relate: { reeval: { apply: 'all' } }, reeval: (seat, item) => item.slugs.map((s) => (s === 'a' && seat === 'first' ? { to: s, verdict: 'retire', reason: '新內容與對象已無共同機制可言' } : { to: s, verdict: 'keep' })) })
        e2.setNow('2026-10-05T10:00:00+08:00')
        await e2.run()
        assert.equal((await e2.holds.get(ha)).status, 'open')
        const V2 = '2026-03-01T00:00:00+08:00'
        await e2.notes.patch('n', { knowledgeChangedAt: V2, relatedChangeAt: V2 })
        e2.setNow('2026-10-05T12:00:00+08:00')
        const before2 = e2.calls.length
        const r3 = await e2.run()
        assert.equal(r3.detail.reevalHoldsStale, 1)
        assert.ok(e2.calls.slice(before2).filter((x) => x.seg === 'reeval').every((x) => ['a', 'b', 'c', 'd'].every((s) => x.prompt.includes(`slug: ${s}｜`))), '新版本照常重評(含甲)')
        const re = await e2.holds.get(ha)
        assert.deepEqual([re.status, re.ctx.version, re.history.at(-1).status, re.history.at(-1).how], ['open', V2, 'resolved', '內容已再變更（依新版本重評）'])
        // 豁免(waive)之邊:本版本不再評;內容再變更後照常評
        const e3 = base({ relate: { reeval: { apply: 'all' } }, reeval: (seat, item) => item.slugs.map((s) => (s === 'a' && seat === 'first' ? { to: s, verdict: 'retire', reason: '新內容與對象已無共同機制可言' } : { to: s, verdict: 'keep' })) })
        e3.setNow('2026-10-05T10:00:00+08:00')
        await e3.run()
        await waiveHold(e3.holds, ha, { by: '使用者', ruling: '保留', at: '2026-10-05T10:05:00+08:00' })
        await e3.notes.patch('n', { edgesReviewedChangeAt: '' }) // 模擬本版本因故重新待評
        const before3 = e3.calls.length
        const r5 = await e3.run()
        assert.deepEqual([e3.calls.slice(before3).filter((x) => x.seg === 'reeval').length, r5.detail.reevalZero], [0, 1], '其餘已審、甲已豁免 → 無待裁之邊、不呼叫、直接評完')
        assert.equal((await e3.notes.get('n')).edgesReviewedChangeAt, V)
        await e3.notes.patch('n', { knowledgeChangedAt: V2, relatedChangeAt: V2 })
        const before4 = e3.calls.length
        await e3.run()
        assert.ok(e3.calls.slice(before4).filter((x) => x.seg === 'reeval').some((x) => x.prompt.includes('slug: a｜')), '新版本照常評甲')
    })

    it('逾次未評完之待判(物件 note):retry 後評完 → 結案(不再每輪重排);筆記已刪 → 過時結案', async () => {
        let drop = true
        const e = base({ relate: { reeval: { maxTries: 1 } }, reeval: (seat, item) => item.slugs.filter((s) => !(drop && s === 'a')).map((s) => ({ to: s, verdict: 'keep' })) })
        e.setNow('2026-10-05T10:00:00+08:00')
        await e.run() // 甲缺項 → tries 1
        e.setNow('2026-10-05T10:30:00+08:00')
        await e.run() // 逾 1 次 → 登錄待判(note)
        const hn = holdKey('note', 'n', 'RS5')
        assert.equal((await e.holds.get(hn)).status, 'open')
        drop = false
        await requestRetry(e.holds, hn, { at: '2026-10-05T10:40:00+08:00' })
        e.setNow('2026-10-05T11:00:00+08:00')
        const r = await e.run()
        assert.equal(r.detail.reevalRetried, 1)
        assert.deepEqual([(await e.holds.get(hn)).status, (await e.holds.get(hn)).how], ['resolved', '本版本既有邊已評完'])
        assert.equal((await e.notes.get('n')).edgesReviewedChangeAt, V)
        e.setNow('2026-10-05T12:00:00+08:00')
        const r2 = await e.run()
        assert.deepEqual([r2.detail.reevalRetried, r2.detail.reevalPending], [0, 0], '已結案:不再重排')
        // 筆記已刪 → 過時結案
        const e2 = base({ relate: { reeval: { maxTries: 1 } }, reeval: (seat, item) => item.slugs.filter((s) => s !== 'a').map((s) => ({ to: s, verdict: 'keep' })) })
        e2.setNow('2026-10-05T10:00:00+08:00')
        await e2.run()
        e2.setNow('2026-10-05T10:30:00+08:00')
        await e2.run()
        assert.equal((await e2.holds.get(hn)).status, 'open')
        await deleteNote(depsOf(e2), 'n', { project: false, reason: '測試刪除' })
        e2.setNow('2026-10-05T11:00:00+08:00')
        const r3 = await e2.run()
        assert.deepEqual([r3.detail.reevalHoldsStale, (await e2.holds.get(hn)).how], [1, '筆記已不存在'])
    })

    it('缺項:未得兩份明確裁決之邊不算已裁、記 tries、保留進度;逾 maxTries → 登錄待判(物件 note、使用者)、本版本停止自動重評(不以保留靜默結案)', async () => {
        const e = base({ relate: { reeval: { maxTries: 2 } }, reeval: (seat, item) => item.slugs.filter((s) => s !== 'a').map((s) => ({ to: s, verdict: 'keep' })) })
        const r1 = await e.run()
        let n = await e.notes.get('n')
        assert.deepEqual([n.reevalTries, n.edgesReviewedChangeAt || ''], [1, ''], '甲缺項:未評完')
        assert.equal(unpackIds(n.edgesReviewed, V).size, 3, '其餘 3 條記入進度')
        assert.equal(r1.detail.reevalMissing, 1, '缺項以邊計(甲 1 條)')
        await e.run()
        n = await e.notes.get('n')
        assert.equal(n.reevalTries, 2)
        const prompts = e.calls.filter((x) => x.seg === 'reeval').map((x) => x.prompt)
        assert.ok(!prompts[prompts.length - 1].includes('slug: b｜'), '下輪只評未裁者(進度生效)')
        const r3 = await e.run()
        assert.equal(r3.detail.reevalGaveUp, 1)
        n = await e.notes.get('n')
        assert.deepEqual([n.edgesReviewedChangeAt, unpackIds(n.edgesReviewed, V).size, n.reevalTries], [V, 3, 0], '停止自動重評;已審清單保留(使用者 retry 時只再評未判者)')
        const h = await e.holds.get(holdKey('note', 'n', 'RS5'))
        assert.deepEqual([h.status, h.owner, h.ctx.version], ['open', 'user', V])
        assert.match(h.reason, /^重評逾 2 次未評完：本版本尚有 1 條既有邊未得判定/)
        assert.ok(e.log.lines.some((l) => /^WARN 關聯重評：n 逾 2 次未評完（尚有 1 條未判），已登錄待判（RS5）/.test(l)))
    })

    it('本版本已判之邊(版本後建立)與懸空邊不入頁;正向選中之鄰居撤銷一票否決;同輪兩端皆變更之對只排一頁', async () => {
        const e = env({
            notes: [{ id: 'n', title: '變更篇', knowledgeChangedAt: V }, { id: 'a', title: '甲' }, { id: 'f', title: '新' }, { id: 'm', title: '另變更', knowledgeChangedAt: V }],
            edges: [E('n', 'a', T0), E('n', 'f', T0, '2026-03-01T00:00:00+08:00'), E('n', 'ghost', T0), E('m', 'n', T1)],
            forward: { 變更篇: [{ to: 'a', type: T0, reason: '新內容仍以甲之機制為前提' }] },
            relate: { reeval: { apply: 'all' } },
            reeval: (seat, item) => item.slugs.map((s) => ({ to: s, verdict: 'retire', reason: '新內容與對象已無共同機制可言' })),
        })
        const r = await e.run()
        const prompts = e.calls.filter((x) => x.seg === 'reeval').map((x) => x.prompt).join('\n')
        assert.ok(!prompts.includes('slug: f｜') && !prompts.includes('slug: ghost｜'), '版本後建立與懸空之邊不入頁')
        assert.equal((prompts.match(/slug: n｜/g) || []).length + (prompts.match(/slug: m｜/g) || []).length, 2, 'm—n 只出現在 m 之頁(兩席各一次)')
        assert.ok((await e.relations.select()).some((x) => x.id === edgeId('n', 'a')), '甲為正向選中:撤銷被否決')
        assert.equal(r.detail.reevalVetoed, 1, '否決以邊計(甲 1 條)')
        assert.ok(!(await e.relations.select()).some((x) => x.id === edgeId('m', 'n')), 'm—n 由 m 之頁裁定撤銷')
    })

    it('任一席額度中止(skipped)→ 不記 tries、未評完;任一席失敗 → tries＋1;守門:待重評逾上限不開工、WARN;停用(perRun 0)無重評計數', async () => {
        const e = base({ fail: (seat) => (seat === 'second' ? 'skip' : null) })
        const r = await e.run()
        const n = await e.notes.get('n')
        assert.deepEqual([n.reevalTries || 0, n.edgesReviewedChangeAt || ''], [0, ''])
        assert.equal(r.detail.aborted, true)
        const e2 = base({ fail: (seat) => (seat === 'first' ? 'fail' : null) })
        await e2.run()
        assert.equal((await e2.notes.get('n')).reevalTries, 1)
        const e3 = base({ relate: { reeval: { guard: 1 } }, notes: [{ id: 'n', knowledgeChangedAt: V }, { id: 'm', knowledgeChangedAt: V }, { id: 'a' }] })
        const r3 = await e3.run()
        assert.equal(r3.detail.reevalBlocked, 2)
        assert.ok(e3.log.lines.some((l) => /^WARN 關聯重評守門/.test(l)))
        const e4 = base({ relate: { reeval: { perRun: 0 } } })
        const r4 = await e4.run()
        assert.ok(!('reevalPending' in r4.detail), '停用:不計待重評(巡檢不判)')
        assert.ok(!e4.calls.some((x) => x.seg === 'reeval'))
    })

    // ─── P3b(2026-10-29 終審 D3):兄弟段與待判生命週期 ───

    it('陳舊(終審 D3 R59;原則③未判不記已審):套用前互斥內回讀已變 → 本輪不判:不記已審、不記 tries、重評帳 stale(下輪再評)', async () => {
        const e = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' } } })
        const callAI = async (p, c, co) => {
            if (co?.segment === 'reeval' && co.seat === 'first') await e.relations.replace({ ...E('n', 'a', T0), reason: '他處改寫之理由：共用同一組參數與同一資料' })
            return e.callAI(p, c, co)
        }
        const r = await stageRelate({ callAI }).run(e.ctx)
        const n = await e.notes.get('n')
        assert.deepEqual([r.detail.reevalStale, r.detail.reevalRetired, n.reevalTries || 0, n.edgesReviewedChangeAt || '', unpackIds(n.edgesReviewed, V).has(edgeId('n', 'a')), unpackIds(n.edgesReviewed, V).size], [1, 0, 0, '', false, 3], JSON.stringify(r.detail))
        assert.ok(await e.relations.get(edgeId('n', 'a')), '甲未撤銷(陳舊不套)')
        assert.equal(e.reevalLog().filter((x) => x.outcome === 'stale').length, 1)
    })

    it('共識之改寫不過納入閘(終審 D3 R60;失敗計、原則③未判不記已審):不套用、不記已審、該篇記 tries(下輪再評)', async () => {
        const e = base({ relate: { reeval: { apply: 'all' } }, reeval: (seat, item) => item.slugs.map((s) => (s === 'c' ? { to: s, verdict: 'change', type: C, reason: '變更篇說年化 12%，丙說 -3%' } : { to: s, verdict: 'keep' })) })
        const r = await e.run()
        const n = await e.notes.get('n')
        assert.deepEqual([r.detail.reevalStdRejected, n.reevalTries, n.edgesReviewedChangeAt || '', unpackIds(n.edgesReviewed, V).has(edgeId('n', 'c')), unpackIds(n.edgesReviewed, V).size], [1, 1, '', false, 3], JSON.stringify(r.detail))
        assert.match(n.reevalLastError, /1 條改寫之理由未達標準/)
    })

    it('升為衝突於衝突核對開啟時不先寫(終審 D3 R61;原則④):提案持久為 RS4 提案待判並交本輪核對(以核對第一、二席投票)、重評帳 deferred、該邊記已審、計 rs4Deferred;核對成立 → 改為衝突型;核對判非衝突 → 邊不動(重評已記已審,不再評)', async () => {
        const cc = { standards: { conflictCheck: { enabled: true }, ai: { first: { use: 'stub:a' }, second: { use: 'stub:b' } } } }
        const e = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' }, ...cc }, cc: () => ({ verdict: 'keep', reason: '' }) })
        const r = await e.run()
        const c = await e.relations.get(edgeId('n', 'c'))
        assert.deepEqual([r.detail.rs4Deferred, r.detail.reevalUpgraded || 0, r.detail.rs4Kept, c.type, r.detail.conflicts], [1, 0, 1, C, 1], JSON.stringify(r.detail))
        assert.deepEqual(e.reevalLog().filter((x) => x.outcome === 'deferred').map((x) => x.edgeId), [edgeId('n', 'c')])
        const hp = await e.holds.get(holdKey(RS4.objectProposal, edgeId('n', 'c'), RS4.std))
        assert.deepEqual([hp.status, hp.ctx.segment, hp.ctx.proposer, hp.how], ['resolved', 'reeval', 'stub:a', '核對成立，衝突邊落地'])
        assert.equal((await e.notes.get('n')).edgesReviewedChangeAt, V, '判定成立(套用交核對)→ 記已審、評完')
        assert.deepEqual(e.calls.filter((x) => x.seg === 'cc').map((x) => x.seat), ['first', 'second'])
        const f = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' }, ...cc }, cc: () => ({ verdict: 'retire', reason: '兩篇題材撞名而無共同機制可言' }) })
        const rf = await f.run()
        assert.deepEqual([rf.detail.rs4Deferred, rf.detail.rs4Retired, (await f.relations.get(edgeId('n', 'c'))).type, (await f.notes.get('n')).edgesReviewedChangeAt], [1, 1, T0, V], JSON.stringify(rf.detail))
    })

    it('開工門檻含第三席(終審 D3 R67;原則①同衝突核對、既有邊覆核):第三席之首家逾時最長時以之判「剩餘不足一次呼叫」→ 延後;未設第三席則以前兩席計', async () => {
        const mk = (third) => {
            const e = base({ reeval: byTitle(), third })
            e.ctx.deps.settings.ai.providerTimeouts['stub:c'] = 1_500_000
            e.ctx.remainingMs = () => 1_000_000
            e.ctx.expired = () => false
            return e
        }
        const t = mk(true)
        const rt = await t.run()
        assert.deepEqual([rt.detail.reevalDeferred, t.calls.filter((x) => x.seg === 'reeval').length], [true, 0], JSON.stringify(rt.detail))
        const s = mk(false)
        const rs = await s.run()
        assert.deepEqual([rs.detail.reevalDeferred, rs.detail.reevalCompleted], [false, 1], JSON.stringify(rs.detail))
    })

    it('同篇多頁並行(終審 D3 sol A10;原則⑥先記後寫、鎖內回讀合併):兩頁同時落帳,進度不互相覆蓋,本版本評完', async () => {
        const e = base({ reeval: byTitle(), relate: { reeval: { pageSize: 2 } } })
        e.ctx.deps.settings.ai.parallel = 2
        const r = await e.run()
        const n = await e.notes.get('n')
        assert.deepEqual([r.detail.reevalPages, r.detail.reevalCompleted, n.edgesReviewedChangeAt, n.edgesReviewed], [2, 1, V, ''], JSON.stringify(r.detail))
    })

    it('委派之邊待承辦頁判定後才記已審(終審 D3 sol A11;原則③):同輪兩端皆待重評之對交 id 小者之頁裁——承辦頁缺項 → 委派方不記該邊、本輪不評完;承辦頁判定 → 委派方於收尾補記、評完(含只有委派邊之篇)', async () => {
        const mk = (drop, mTries = 0) => env({
            notes: [{ id: 'm', title: '另變更', knowledgeChangedAt: V, reevalTries: mTries }, { id: 'n', title: '變更篇', knowledgeChangedAt: V }, { id: 'q', title: '只有委派邊', knowledgeChangedAt: V }, { id: 'a', title: '甲' }],
            edges: [E('m', 'n', T1), E('m', 'q', T0), E('n', 'a', T0)],
            reeval: (seat, item) => item.slugs.filter((s) => !(drop && item.title === '另變更' && s === 'n')).map((s) => ({ to: s, verdict: 'keep' })),
        })
        // 承辦頁(m)缺 n 之裁決:m 記 tries、不評完;n 之委派邊不記已審、不評完(其餘邊已審);q 之委派邊已由 m 判定 → 收尾評完
        const d = mk(true)
        const rd = await d.run()
        const [m1, n1, q1] = await Promise.all(['m', 'n', 'q'].map((id) => d.notes.get(id)))
        assert.deepEqual([rd.detail.reevalCompleted, m1.reevalTries, m1.edgesReviewedChangeAt || '', n1.reevalTries || 0, n1.edgesReviewedChangeAt || '', [...unpackIds(n1.edgesReviewed, V)], q1.edgesReviewedChangeAt], [1, 1, '', 0, '', [edgeId('n', 'a')], V], JSON.stringify(rd.detail))
        assert.ok(d.log.lines.some((l) => /^INFO 關聯重評：q 既有邊評完（本版本 1 條；含委派承辦頁判定者）$/.test(l)), d.log.lines.join('\n'))
        // 承辦頁(m;tries 較多故排後)判定 → 三篇皆評完(n、q 於收尾補記)
        const g = mk(false, 1)
        const rg = await g.run()
        const [m2, n2, q2] = await Promise.all(['m', 'n', 'q'].map((id) => g.notes.get(id)))
        assert.deepEqual([rg.detail.reevalCompleted, m2.edgesReviewedChangeAt, n2.edgesReviewedChangeAt, q2.edgesReviewedChangeAt, m2.reevalTries], [3, V, V, V, 0], JSON.stringify(rg.detail))
        assert.ok(g.log.lines.some((l) => /^INFO 關聯重評：n 既有邊評完（本版本 2 條；含委派承辦頁判定者）$/.test(l)), g.log.lines.join('\n'))
    })

    // ─── 維運 API(ops/noteOps) ───

    const depsOf = (e) => ({ stores: { notes: e.notes, relations: e.relations }, dirs: e.ctx.deps.dirs, clock, log: recLog(), domain: DOMAIN })

    it('reevalRequeue:只重排「本版本只記候選」之筆記(預演不寫);reevalBaseline:待重評一律記為評完(預演不寫)', async () => {
        const e = base({ reeval: byTitle() })
        await e.run()
        const d = depsOf(e)
        const q0 = await reevalRequeue(d)
        assert.deepEqual([q0.notes, q0.candidates, q0.applied], [['n'], 3, 0])
        assert.equal((await e.notes.get('n')).edgesReviewedChangeAt, V, '預演不寫')
        assert.equal((await reevalRequeue(d, { apply: true })).applied, 1)
        assert.equal((await e.notes.get('n')).edgesReviewedChangeAt, '', '重排:下一輪以新鮮評估確認')
        assert.equal((await reevalBaseline(d)).pending, 1)
        await reevalBaseline(d, { apply: true, by: '測試者', ruling: '批次格式改寫，不需重評' })
        assert.equal((await e.notes.get('n')).edgesReviewedChangeAt, V)
        assert.equal((await reevalBaseline(d)).pending, 0)
    })

    it('預演純讀(STD-26):帳檔損壞時 reevalBaseline 之預演不開帳——壞檔原樣、無隔離檔、無告警(墓碑唯讀);apply 才開帳(隔離壞檔)', async () => {
        const e = base({ reeval: byTitle() })
        await e.run()
        const d = depsOf(e)
        await e.notes.patch('n', { edgesReviewedChangeAt: '' }) // 模擬本版本重新待評
        fs.mkdirSync(d.dirs.state, { recursive: true })
        const bad = `${d.dirs.state}/${LEDGER_FILES.dirty}`
        fs.writeFileSync(bad, '{not json')
        const corruptOf = () => d.log.lines.filter((l) => /關聯帳檔損壞/.test(l)).length
        const p = await reevalBaseline(d)
        assert.ok(p.pending >= 1, '前提:有待重評之筆記')
        assert.deepEqual([fs.readFileSync(bad, 'utf8'), fs.readdirSync(d.dirs.state).filter((f) => f.includes('.corrupt-')), corruptOf()], ['{not json', [], 0], '預演:壞檔原樣、無隔離檔、無告警')
        await reevalBaseline(d, { apply: true, by: '測試者', ruling: '批次格式改寫，不需重評' })
        assert.ok(fs.readdirSync(d.dirs.state).some((f) => f.startsWith(`${LEDGER_FILES.dirty}.corrupt-`)), 'apply:開帳隔離壞檔')
        assert.equal(corruptOf(), 1, 'apply:告警一次')
    })

    it('reevalBaseline 記評完須記裁示:預演列待重評篇數與本版本未判邊數(不需裁示);opt.apply 缺裁示者(opt.by)或內容(opt.ruling)→ 拋錯、不寫;給了 → 每篇一筆重評帳(outcome baseline、裁示者、內容、版本、未判邊數)、該篇本版本之 RS5 未結待判以同一裁示豁免(其後本版本不再評該邊)', async () => {
        const e = base({ relate: { reeval: { apply: 'all' } }, reeval: (seat, item) => item.slugs.map((s) => (s === 'a' && seat === 'first' ? { to: s, verdict: 'retire', reason: '新內容與對象已無共同機制可言' } : { to: s, verdict: 'keep' })) })
        e.setNow('2026-10-05T10:00:00+08:00')
        await e.run()
        const ha = holdKey('edge', edgeId('n', 'a'), 'RS5')
        assert.equal((await e.holds.get(ha)).status, 'open', '前提:甲判不了 → 待判')
        await e.notes.patch('n', { edgesReviewedChangeAt: '' }) // 模擬本版本因故重新待評(其餘三條已審、甲待判中)
        const d = { ...depsOf(e), stores: { notes: e.notes, relations: e.relations, holds: e.holds } }
        const p = await reevalBaseline(d)
        assert.deepEqual([p.pending, p.unjudged, p.applied, p.waived], [1, 1, 0, 0], '預演:不需裁示、不寫')
        await assert.rejects(() => reevalBaseline(d, { apply: true }), { message: 'reevalBaseline 之 opt.apply 須記裁示者與裁示內容（opt.by、opt.ruling）——記為評完而未判是使用者之裁示' })
        await assert.rejects(() => reevalBaseline(d, { apply: true, by: '主審' }), /須記裁示者與裁示內容/, '缺裁示內容')
        assert.equal((await e.notes.get('n')).edgesReviewedChangeAt, '', '拋錯:不寫')
        assert.equal(e.reevalLog().filter((x) => x.outcome === 'baseline').length, 0)
        const r = await reevalBaseline(d, { apply: true, by: '主審', ruling: '批次格式改寫，不需重評' })
        assert.deepEqual([r.applied, r.waived], [1, 1])
        assert.equal((await e.notes.get('n')).edgesReviewedChangeAt, V)
        const h = await e.holds.get(ha)
        assert.deepEqual([h.status, h.waivedBy, h.ruling], ['waived', '主審', 'reevalBaseline：批次格式改寫，不需重評'])
        const row = e.reevalLog().find((x) => x.outcome === 'baseline')
        assert.deepEqual([row.note, row.version, row.by, row.ruling, row.unjudged, row.waivedHolds], ['n', V, '主審', '批次格式改寫，不需重評', 1, 1])
        // 豁免之邊本版本不再評:再模擬重新待評(基準重設已清已審清單 → 其餘三條照評)→ 甲不入頁
        await e.notes.patch('n', { edgesReviewedChangeAt: '' })
        const before = e.calls.length
        await e.run()
        const prompts = e.calls.slice(before).filter((x) => x.seg === 'reeval').map((x) => x.prompt)
        assert.ok(prompts.length > 0 && prompts.every((x) => !x.includes('slug: a｜')), '已以裁示豁免之甲不再評')
    })

    it('restoreEdge:依稽核還原被撤出之邊(預演不寫;以該邊最後一筆稽核為準);還原後稽核追加 restored;已還原、端點不在(含筆記刪除之邊之一端已刪)→ 不可還原', async () => {
        const e = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' } } })
        await e.run()
        const d = depsOf(e)
        const id = edgeId('n', 'a')
        assert.ok(!(await e.relations.get(id)), '前提:甲已撤銷')
        const p = await restoreEdge(d, id)
        assert.deepEqual([p.found, p.restorable, p.applied, p.retiredAs], [true, true, false, 'reeval-retire'])
        assert.equal(await e.relations.get(id), null, '預演不寫')
        assert.equal((await restoreEdge(d, id, { apply: true })).applied, true)
        assert.equal((await e.relations.get(id)).type, T0, '以稽核之邊值重入')
        assert.deepEqual(e.retiredLog().at(-1).reason === 'restored' && e.retiredLog().at(-1).restoredFrom, 'reeval-retire', '稽核追加 restored')
        const again = await restoreEdge(d, id, { apply: true })
        assert.deepEqual([again.restorable, again.reason], [false, '稽核最後一筆為已還原'])
        assert.equal((await restoreEdge(d, 'nope')).found, false)
        // 筆記刪除之邊:一端已刪 → 由 restoreNote 還原筆記(其邊一併還原);兩端皆在後才可單獨還原(還原筆記時未過閘者之補救——unit-relate-delete)
        await deleteNote(d, 'd', { project: false, reason: '測試刪除' })
        const nd = await restoreEdge(d, edgeId('n', 'd'))
        assert.deepEqual([nd.restorable, nd.retiredAs], [false, 'note-deleted'])
        assert.equal(nd.reason, '端點筆記不在（已刪除）——請以 restoreNote（重新收件：過標準）或 undoDeleteNote（撤銷刪除：原樣放回）還原該筆記（其邊一併還原）')
    })

    it('restoreEdge 支援標準撤銷(std-retire)與懸空清理(prune-dangling);還原前過納入閘:理由不合標準 → 不可還原並列出理由;可修正者(簡體)修正後還原', async () => {
        const e = base()
        const d = depsOf(e)
        const L = e.ledgers()
        const at = '2026-02-02T00:00:00+08:00'
        const ok = E('n', 'a', T0)
        const tw = E('n', 'b', T1, OLD, '变更篇之动量参数与乙共用同一组设定')
        const bad = E('n', 'c', T0, OLD, '都與某主題有關')
        for (const [edge, reason] of [[ok, 'std-retire'], [tw, 'prune-dangling'], [bad, 'std-retire']]) {
            await retireEdge({ relations: e.relations, ledgers: L, stateDir: e.ctx.deps.dirs.state }, edge, { reason, at, conflictTypes: DOMAIN.conflictTypeNames })
        }
        assert.equal((await restoreEdge(d, ok.id, { apply: true })).applied, true, 'std-retire 可還原')
        const t = await restoreEdge(d, tw.id, { apply: true })
        assert.deepEqual([t.applied, t.retiredAs, t.fixes], [true, 'prune-dangling', ['理由轉正體']])
        assert.equal((await e.relations.get(tw.id)).reason, '變更篇之動量參數與乙共用同一組設定')
        const b = await restoreEdge(d, bad.id, { apply: true })
        assert.deepEqual([b.restorable, b.applied], [false, false])
        assert.match(b.reason, /^未達檢定標準：RS2 去空泛片語與標點後只剩 0 字/)
        assert.equal(await e.relations.get(bad.id), null)
    })

    it('AI 改寫之逆(終審 D16;ops/noteOps 之 revertEdgeRevision):重評套用之改型撤回 → 回復改寫前之值(過閘)、重評帳 reverted(含 note、version)、視為 RS5 裁示(該邊之 RS5 待判結案、updatedAt＝現在而本版本不再重評);回復之衝突型邊未經核對 → 登錄 RS4 待判;撤銷(retire)不在列(無寫入值;以 restoreEdge 還原)', async () => {
        const e = base({ reeval: byTitle(), relate: { reeval: { apply: 'all' } } })
        await e.run()
        const d = { stores: { notes: e.notes, relations: e.relations, holds: e.holds, checks: e.checks }, dirs: e.ctx.deps.dirs, clock, log: recLog(), domain: DOMAIN }
        const nc = edgeId('n', 'c')
        const nb = edgeId('n', 'b')
        assert.deepEqual([(await e.relations.get(nc)).type, (await e.relations.get(nb)).type], [C, T0], '前提:丙升為衝突、乙降級')
        // 該邊之 RS5 待判(判不了者)未結 → 撤回即結案
        const k5 = holdKey('edge', nc, RS5.std)
        await e.holds.replace({ id: k5, object: 'edge', oid: nc, std: RS5.std, status: 'open', owner: 'user', reason: 'r', next: 'n', since: OLD, at: OLD, tries: 0, ctx: {} })
        const p = await revertEdgeRevision(d, nc)
        assert.deepEqual([p.ledger, p.std, p.revertible, p.applied, p.from.type, p.to, p.ruling, p.rs4Queued], ['reeval', RS5.std, true, false, C, { type: T0, reason: `n與c之舊關聯：共用同一組參數` }, RS5.std, false])
        assert.equal(p.revertOf, e.reevalLog().find((x) => x.edgeId === nc && x.outcome === 'applied').at)
        const r = await revertEdgeRevision(d, nc, { apply: true })
        const cur = await e.relations.get(nc)
        assert.deepEqual([r.applied, r.ruling, r.rs4Queued, cur.type, cur.reason], [true, RS5.std, false, T0, `n與c之舊關聯：共用同一組參數`])
        assert.ok(cur.updatedAt >= V, '本版本不再重評(邊時刻不早於版本)')
        const h5 = await e.holds.get(k5)
        assert.deepEqual([h5.status, h5.how], ['resolved', `使用者以 revertEdgeRevision 撤回重評之改寫（${p.revertOf}）——回復改寫前之值`])
        const last = e.reevalLog().at(-1)
        assert.deepEqual([last.outcome, last.edgeId, last.revertOf, last.note, last.version, last.written, last.edge.type], ['reverted', nc, p.revertOf, 'n', V, { type: T0, reason: cur.reason }, C])
        assert.deepEqual(readConflictEvents(e.ctx.deps.dirs.state).map((x) => [x.edgeId, x.kind]).filter((x) => x[0] === nc), [[nc, 'downgrade']], '衝突型回復為非衝突型寫降級事件')
        // 乙(降級 C → T0)撤回 → 回復衝突型;檢核未涵蓋 → 登錄 RS4 待判(pipeline)
        const rb = await revertEdgeRevision(d, nb, { apply: true })
        assert.deepEqual([rb.applied, rb.ruling, rb.rs4Queued, (await e.relations.get(nb)).type], [true, RS5.std, true, C])
        const h4 = await e.holds.get(holdKey(RS4.objectEdge, nb, RS4.std))
        assert.deepEqual([h4.status, h4.owner, h4.reason], ['open', 'pipeline', 'revertEdgeRevision 撤回重評之改寫之衝突邊尚未經衝突核對（RS4）'])
        // 甲(撤銷)不在列:重評帳 applied 無 written → 無可撤回之改寫
        const ra = await revertEdgeRevision(d, edgeId('n', 'a'))
        assert.deepEqual([ra.found, ra.revertible], [false, false])
    })

    it('刪除 → 對方內容變更並評完 → 還原:帶回之邊未經對方本版本裁決 → 清對方評完標記(三審 F18)', async () => {
        const e = env({ notes: [{ id: 'x', title: '對方' }, { id: 'a', title: '被刪' }], edges: [E('x', 'a', T0)] })
        const d = depsOf(e)
        await deleteNote(d, 'a', { project: false, reason: '測試刪除' })
        const later = '2099-01-01T00:00:00+08:00'
        await e.notes.patch('x', { knowledgeChangedAt: later, relatedChangeAt: later, edgesReviewedChangeAt: later })
        await restoreNote(d, 'a', { project: false })
        const x = await e.notes.get('x')
        assert.equal(x.edgesReviewedChangeAt, '', '清除評完標記')
        assert.equal(needsEdgeReview(x), true, '下輪重評(含帶回之邊)')
    })
})
