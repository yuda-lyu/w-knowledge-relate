// unit-relate-stage.test.mjs — 關聯段(relate.relate＋relate.project＋relationIndex)之行為:正向池含內容變更之筆記且只增不刪、
//   候選排除衝突鄰居、同輪互選之合併與完成順序無關、先記 dirty 後寫邊、邊庫世代 fail-closed、墓碑驅動之懸空清理、內容變更之反應、
//   型別清單外告警、總覽待重建旗標(含同一管線內摘要套件之重標旗標)、反向段(資格、分頁、時間保留、tries 只排序、出隊重驗、停用不落帳)、物件摘要附段
// 規格出處:規則帳本 REL-02～REL-10
// 執行:自套件根 node <mocha> test/unit-relate-stage.test.mjs(暫存 test/_tmp/relate-stage-<pid>,測完即刪;不發網路、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, memStore, nullLogger, genClockTZ, setConceptFold, composeChain, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { sha1, defineMw, makeMsg, readJsonlRows } from '../src/core/capturePackage.mjs'
import { readMd, writeMd, sectionOf, SUMMARIZE_CTX_FLAGS } from '../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { mwBuildEdges, mwMarkDirty, RELATE_MAX_RELATIONS_PER_NOTE, pickRelationsOf, coveredItemOf, itemTargetOf, admitItemOf } from '../src/stages/relateChain.mjs'
import { createRelateQueueRunner } from '../src/stages/relateQueueSegment.mjs'
import { stageRelationIndex, rebuildRelationIndex, mwRebuildRelationIndex, RELATE_INDEX_TOP_N } from '../src/stages/relationIndexStage.mjs'
import { stageRelateProject } from '../src/stages/projectStage.mjs'
import { makeEdge, edgeId } from '../src/stores/edgeStore.mjs'
import { openRelateLedgers, LEDGER_FILES } from '../src/stores/relateLedgers.mjs'
import { isRelated, relatePendingOf, needsReeval, needsEdgeReview, edgesReviewedOf, inRelatePool } from '../src/stores/relatedNotes.mjs'
import { conceptKeysOf, pickCandidates, makeSlugResolver } from '../src/stores/candidates.mjs'
import { candidateScoreOf, createReverseIndex } from '../src/stores/reverseCandidates.mjs'
import { relateSeatOf, RELATE_SEAT_KEYS } from '../src/core/relateSettings.mjs'
import { RELATE_REPORT_KEYS } from '../src/logContract.mjs'
import { RELATE_STAGE_KEYS } from '../src/relateObject.mjs'
import { RELATE_CTX_FLAGS } from '../src/logContract.mjs'
import { createRelateObject } from '../src/relateObject.mjs'
// 摘要套件之件(重標子階段與其 domain、筆記組裝、frontmatter 之解析)與子階段之 ctx(bagCtx)經測試專用之橋接取得
import { stageRetag, createRetagDomain, createSummarizeDomain, buildNote, parseFrontmatter, bagCtx } from './tools/summarizeForTest.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const [T0, T1, T2, T3] = DOMAIN.relationTypes.filter((t) => t !== DOMAIN.conflictType)
const C = DOMAIN.conflictType
let seq = 0

/**
 * 測試環境:筆記(含 md)、邊、設定、依標題回腳本之 AI 替身;保留給後段之時間(deps.reserveMs)為 900 秒
 * @param {Object} o 輸入 { notes:[{id,title?,concepts,category?,createdAt,relatedAt?,knowledgeChangedAt?,extractedAt?}], edges:[], script:{標題:relations|fn}, relate:{}(settings.relate 之覆寫), ai:{}(settings.ai 之覆寫), remainingMs }
 * @returns {Object} 回傳 { ctx, notes, relations, log, prompts, run, runRelate, state, file }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const recs = (o.notes || []).map((n) => {
        const file = `${dir}/notes/${n.id}.md`
        const title = n.title || `標題${n.id}`
        writeMd(file, { title, slug: n.id }, `# ${title}\n\n## 一句話重點\n\n${n.id} 之重點\n\n## 核心知識\n\n- 要點`)
        return { category: 'c', summary: `${n.id} 之重點`, relatedAt: '', ...n, title, file }
    })
    const notes = memStore(recs)
    const relations = memStore(o.edges || [])
    const log = recLog()
    const prompts = []
    const deps = {
        stores: { notes, relations },
        settings: resolveRelateSettings({
            ai: { parallel: 1, timeoutMs: 300_000, providerTimeouts: {}, ...(o.ai || {}) },
            relate: { rounds: 2, notesPerCall: 6, candidatesPerNote: 15, ai: { use: 'stub:a' }, reverse: { perRun: 0 }, ...(o.relate || {}) },
        }),
        // 保留給後段之時間(組裝者之依賴;選配段扣之後才開工)
        reserveMs: 900_000,
        ai: null,
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: DOMAIN },
    }
    const ctx = bagCtx(deps, log, o.remainingMs ? { remainingMs: o.remainingMs, expired: () => false } : {})
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    const callAI = withCheck(async (prompt, check, co) => {
        prompts.push({ prompt, segment: co?.segment })
        const targets = [...prompt.matchAll(/^--- 第(\d+)篇（待建立關聯）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
        if (typeof o.fail === 'function' && o.fail(co?.segment, targets)) return { ok: false, data: null, error: 'stub fail', skipped: false, attempts: 1, preview: '' }
        if (o.delay) await new Promise((r) => setTimeout(r, o.delay(targets)))
        const data = targets.map((t) => {
            const s = (o.script || {})[t.title]
            return { index: t.index, relations: typeof s === 'function' ? s(co?.segment) : (s || []) }
        })
        return { ok: true, data, error: '', skipped: false, attempts: 1, preview: '' }
    })
    const runRelate = (extra = {}) => stageRelate({ callAI, ...(o.stageOpt || {}), ...extra }).run(ctx)
    const run = async (extra = {}) => {
        const r = await runRelate(extra)
        return { ...r, project: await stageRelateProject().run(ctx) }
    }
    const state = () => openRelateLedgers(ctx.deps.dirs.state)
    return { ctx, notes, relations, log, prompts, run, runRelate, state, file: (id) => `${dir}/notes/${id}.md`, dir, bag: ctx.bag }
}

const E = (from, to, type, at = '2026-01-05T00:00:00+08:00', reason = `${from}→${to}`) => makeEdge({ from, to, type, reason, nowIso: at })

describe('unit-relate-stage', function() {

    before(() => {
        TMP = tmpRoot('relate-stage')
    })
    after(() => removeRoots([TMP]))

    it('內容變更之筆記重入正向池且只增不刪:度數 19(>4、>15)之既有邊——含未展示者與他篇提出者——全數保留;新選者新增;計重判 1、relatedAt 刷新後出池', async () => {
        const nbs = Array.from({ length: 18 }, (_, i) => ({ id: `m${String(i).padStart(2, '0')}`, concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-02' }))
        const e = env({
            notes: [
                { id: 'h', title: '樞紐', concepts: ['p', 'q'], createdAt: '2026-01-01', relatedAt: '2026-01-03', knowledgeChangedAt: '2026-02-01T00:00:00+08:00' },
                { id: 'x', concepts: ['q'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
                ...nbs,
            ],
            edges: nbs.map((n, i) => (i % 2 ? E('h', n.id, T1) : E(n.id, 'h', T2))),
            script: { 樞紐: [{ to: 'x', type: T0, reason: '新內容與 x 之共同前提' }] },
        })
        const r = await e.run()
        assert.deepEqual([r.detail.targets, r.detail.reTargets, r.detail.edges, r.detail.edgesChanged], [1, 1, 1, 0], JSON.stringify(r.detail))
        const edges = await e.relations.select()
        assert.equal(edges.length, 19, '18 條既有邊全數保留＋1 條新邊')
        for (const n of nbs) assert.ok(edges.some((x) => x.id === edgeId('h', n.id)), `${n.id} 之邊未被刪`)
        const cands = (e.prompts[0].prompt.match(/slug: /g) || []).length
        assert.equal(cands, 15, '候選上限 15:有既有鄰居未展示,仍不刪')
        const h = await e.notes.get('h')
        assert.ok(h.relatedAt > h.knowledgeChangedAt, 'relatedAt 刷新');
        const r2 = await e.runRelate()
        assert.equal(r2.detail.targets, 0, '下一輪不再入池')
        assert.equal((readMd(e.file('h')).front.related || []).length, 19, '本篇投影列全部鄰居(含入邊)')
    })

    it('同輪互選:兩篇新筆記並行兩批互選同一對 → 一條邊(完整全序)、兩種完成順序結果逐欄相同;敗方入 history', async () => {
        const out = []
        for (const slowFirst of [true, false]) {
            const e = env({
                notes: [{ id: 'a', title: '甲', concepts: ['p'], createdAt: '2026-01-01' }, { id: 'b', title: '乙', concepts: ['p'], createdAt: '2026-01-01' }],
                script: { 甲: [{ to: 'b', type: T2, reason: '甲之動量訊號建立在乙之報酬拆解之上' }], 乙: [{ to: 'a', type: T0, reason: '乙之報酬拆解是甲之動量訊號之前提' }] },
                relate: { notesPerCall: 1, rounds: 1 },
                ai: { parallel: 2 },
                delay: (targets) => ((targets[0].title === '甲') === slowFirst ? 30 : 1),
            })
            const r = await e.run()
            assert.deepEqual([r.detail.targets, r.detail.edges], [2, 1], JSON.stringify(r.detail))
            const edges = await e.relations.select()
            assert.equal(edges.length, 1)
            out.push(edges[0])
        }
        const strip = ({ createdAt, updatedAt, history, ...x }) => ({ ...x, history: (history || []).map(({ createdAt: _c, ...h }) => h) })
        assert.deepEqual(strip(out[0]), strip(out[1]), '完成順序不影響結果')
        assert.equal(out[0].type, T0, '型別序較前者勝')
        assert.deepEqual(out[0].history.map((h) => h.type), [T2])
    })

    it('先記 dirty 後寫邊:寫邊拋錯 → 兩端已在待投影帳、該篇 relateTries+1、relatedAt 不寫', async () => {
        const boom = defineMw({ name: 'persistEdges', handle: async () => {
            throw new Error('寫入層故障')
        } })
        const e = env({
            notes: [{ id: 'a', title: '甲', concepts: ['p'], createdAt: '2026-01-01' }, { id: 'b', concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-02' }],
            script: { 甲: [{ to: 'b', type: T0, reason: '甲之訊號以乙之報酬拆解為前提' }] },
            stageOpt: { chain: [mwBuildEdges(), mwMarkDirty(), boom] },
        })
        await e.runRelate()
        assert.deepEqual(e.state().dirty.ids(), ['a', 'b'])
        const a = await e.notes.get('a')
        assert.deepEqual([a.relateTries, a.relatedAt], [1, ''])
        assert.equal((await e.relations.select()).length, 0)
    })

    it('邊庫世代不符(未遷移之有序對 id)→ ERROR、本段不寫(邊、relatedAt、帳皆不動)、投影略過;報告 ok:false', async () => {
        const old = { id: sha1('z|a'), from: 'z', to: 'a', type: T0, reason: 'r', createdAt: 'x' } // from>to 之有序對 id
        const e = env({ notes: [{ id: 'a', title: '甲', concepts: ['p'], createdAt: '2026-01-01' }, { id: 'z', concepts: ['p'], createdAt: '2026-01-01' }], edges: [old], script: { 甲: [{ to: 'z', type: T0, reason: 'r' }] } })
        const r = await e.run()
        assert.deepEqual([r.ok, r.detail.genMismatch, r.detail.blocked, r.project.detail.blocked], [false, 1, true, true])
        assert.deepEqual([e.bag.get(RELATE_CTX_FLAGS.blocked), e.bag.get(RELATE_CTX_FLAGS.edgesChanged)], [true, 0], '旗標名取 RELATE_CTX_FLAGS(投影子階段據 blocked 略過)')
        assert.ok(e.log.lines.some((l) => l === 'ERROR 關聯邊庫世代不符：1 條邊之 id 不是無序對雜湊（sha1(min|max)）——本輪關聯段與投影不寫入；邊 id 非無序對身分之舊世代資料，須先遷移'), e.log.lines.join('\n'))
        assert.deepEqual([(await e.relations.select()).length, (await e.notes.get('a')).relatedAt, e.prompts.length], [1, '', 0])
    })

    it('墓碑驅動之懸空清理:端點在墓碑內者刪除(稽核先記)、存活端記 dirty、總覽待重建;無墓碑之懸空只告警不刪;型別清單外告警', async () => {
        const e = env({
            notes: [{ id: 'a', concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-02' }, { id: 'b', concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-02' }],
            edges: [E('a', 'gone1', T0), E('a', 'gone2', T1), E('a', 'b', '舊型別')],
        })
        e.state().tombstones.add('gone1', '2026-01-09', '測試')
        const r = await e.run()
        assert.deepEqual([r.detail.retired, r.detail.dangling], [1, 1], JSON.stringify(r.detail))
        const ids = (await e.relations.select()).map((x) => x.id)
        assert.ok(!ids.includes(edgeId('a', 'gone1')) && ids.includes(edgeId('a', 'gone2')), '只刪墓碑內者')
        const audit = readJsonlRows(`${e.ctx.deps.dirs.state}/${LEDGER_FILES.retired}`)
        assert.deepEqual(audit.map((x) => [x.reason, x.edge.to]), [['note-deleted', 'gone1']])
        assert.ok(e.log.lines.some((l) => l === 'WARN 關聯懸空邊 1 條（端點不在筆記庫、亦無刪除紀錄）：未自動刪除——確認後以 pruneDangling（opt.apply）清理'), e.log.lines.join('\n'))
        assert.ok(e.log.lines.some((l) => /^WARN 關聯型別不在現行清單：「舊型別」1 條/.test(l)))
        assert.equal(e.state().state.get().indexDirty, true)
        assert.equal(e.bag.get(RELATE_CTX_FLAGS.edgesChanged), 1, '刪除計入總覽觸發')
    })

    it('內容變更之反應:本篇與鄰居記 dirty(鄰居之關聯章顯示新標題)、總覽待重建;評估後記下評估版本,同一變更不再反應、不再入池(與時鐘先後無關)', async () => {
        const e = env({
            notes: [
                { id: 'c', title: '改後標題', concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-03', knowledgeChangedAt: '2026-02-01T00:00:00+08:00' },
                { id: 'd', concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-03' },
            ],
            edges: [E('d', 'c', T0)],
        })
        const r = await e.run()
        assert.deepEqual([r.detail.changedSeen, r.detail.reTargets, r.project.detail.projected], [1, 1, 2])
        assert.match(sectionOf(readMd(e.file('d')).body, '關聯').text, /→ \[\[c\]\] 改後標題：/)
        assert.equal(e.state().state.get().indexDirty, true)
        assert.equal((await e.notes.get('c')).relatedChangeAt, '2026-02-01T00:00:00+08:00', '記下評估版本')
        const r2 = await e.run()
        assert.deepEqual([r2.detail.changedSeen, r2.detail.targets, r2.project.detail.projected], [0, 0, 0])
        // 再變一次(偵測時刻與上次評估同一秒亦然):版本不同即再入池
        await e.notes.patch('c', { knowledgeChangedAt: (await e.notes.get('c')).relatedAt })
        const r3 = await e.runRelate()
        assert.deepEqual([r3.detail.changedSeen, r3.detail.reTargets], [1, 1])
        // 總覽:待重建旗標 → 重建並清旗標;皆無則不動
        const idx = stageRelationIndex()
        assert.equal(idx.when(e.ctx), true)
        await idx.run(e.ctx)
        assert.deepEqual([fs.existsSync(`${e.ctx.deps.dirs.relations}/graph.json`), e.state().state.get().indexDirty], [true, false])
        e.ctx.set(RELATE_CTX_FLAGS.edgesChanged, 0)
        assert.equal(idx.when(e.ctx), false)
    })

    // 2026-10-07 摘要切換(盤查 C retag:145 之改寫):重標屬摘要套件(改名之機械改寫、tagChangedAt、md 同步與旗標值由 摘要套件 w-knowledge-summarize
    //   unit-summarize-retag「首輪只記錄;類別改名 →…」與 unit-flow-summarize「F3 ctx 旗標限同一管線…」驗);本案驗跨工作之接線——
    //   同一管線 ctx 內,摘要套件之重標所設之旗標(名取匯入點之 SUMMARIZE_CTX_FLAGS,不寫字面)觸發本套件之關聯總覽重建(總覽之節點帶類別)
    it('本輪有筆記重標 → 關聯總覽重建:同一管線 ctx 內,摘要套件之重標設 SUMMARIZE_CTX_FLAGS.tagChanged＝本輪重標篇數 → stageRelationIndex.when 為真、graph.json 之節點帶新類別;無重標之輪不設旗標 → 為假', async () => {
        const NOW = '2026-10-04T10:00:00+08:00'
        const dir = `${TMP}/retag-flag`
        const BASE = { categories: ['方法', '風險', '其他'], claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
        const V2 = { ...BASE, categories: ['方法論', '風險', '其他'], categoryRenames: { 方法: '方法論' } }
        // 筆記以摘要套件之正式組裝(buildNote)寫出 md 並入庫
        const sd = createSummarizeDomain({ vocab: BASE })
        const notes = memStore([{ title: '甲', category: '方法' }, { title: '乙', category: '風險' }].map((s, i) => {
            const k = { title: s.title, key_points: [`知識${i}`], concepts: ['概念', '概念二'], summary: `重點${i}`, category: s.category, claim_type: '實證研究', evidence_level: '中' }
            const n = buildNote({ k, doc: { id: `d${i}`, url: `https://example.com/${i}`, sourceName: 's' }, domain: sd, notesDir: `${dir}/notes`, nowIso: NOW })
            writeMd(n.file, n.front, n.body)
            return n.record
        }))
        const relations = memStore([])
        fs.mkdirSync(`${dir}/relations`, { recursive: true })
        // 一輪管線之 ctx:重標與關聯總覽共用同一個 bag(旗標只在同一管線內有效)
        const pipeCtx = (vocab) => bagCtx(
            { stores: { notes, relations }, settings: resolveRelateSettings({ ai: { parallel: 1 } }), dirs: { state: `${dir}/state`, relations: `${dir}/relations` }, clock: { iso8: () => NOW }, ai: {}, domains: { retag: createRetagDomain({ vocab }) } },
            recLog(),
            { remainingMs: () => Infinity, expired: () => false },
        )
        const idx = stageRelationIndex({})
        // 首輪:只記錄分類法,無重標 → 不設旗標、不重建
        const c0 = pipeCtx(BASE)
        const r0 = await stageRetag({}).run(c0)
        assert.deepEqual([r0.detail.initialized, c0.get(SUMMARIZE_CTX_FLAGS.tagChanged, 0), idx.when(c0)], [true, 0, false], JSON.stringify(r0.detail))
        // 次輪:類別改名(機械)→ 旗標＝本輪重標篇數 → 關聯總覽重建,節點帶新類別
        const c1 = pipeCtx(V2)
        const r1 = await stageRetag({ callAI: async () => assert.fail('改名不呼叫 AI') }).run(c1)
        assert.deepEqual([r1.detail.mechChanged, c1.get(SUMMARIZE_CTX_FLAGS.tagChanged, 0)], [1, 1], JSON.stringify(r1.detail))
        assert.equal(idx.when(c1), true, '本輪有重標 → 關聯總覽重建(graph.json 之節點帶類別)')
        await idx.run(c1)
        const g = JSON.parse(fs.readFileSync(`${dir}/relations/graph.json`, 'utf8'))
        assert.deepEqual(g.nodes.map((n) => [n.title, n.category]).sort(), [['乙', '風險'], ['甲', '方法論']])
        // 再一輪(分類法未變):無重標 → 不設旗標、不重建
        const c2 = pipeCtx(V2)
        await stageRetag({ callAI: async () => assert.fail('無工作不呼叫 AI') }).run(c2)
        assert.deepEqual([c2.get(SUMMARIZE_CTX_FLAGS.tagChanged, 0), idx.when(c2)], [0, false])
    })

    it('反向段:n 加入後,「若現在重評會把 n 排進前 K 名」且其正向評估早於 n 之舊筆記 o 以同一 prompt 判一次(候選只有 n);資格不符者不入帳', async () => {
        const e = env({
            notes: [
                { id: 'n', title: '新', concepts: ['p', 's', 't'], createdAt: '2026-02-01T00:00:00+08:00' },
                { id: 'g1', concepts: ['s', 't', 'u'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
                { id: 'g2', concepts: ['s', 't', 'v'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
                { id: 'o1', title: '舊一', concepts: ['p', 'q'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
                { id: 'o2', title: '舊二', concepts: ['s'], createdAt: '2026-01-01', relatedAt: '2026-03-01' }, // 與 n 共享 s,但評估晚於 n:已判過
            ],
            relate: { candidatesPerNote: 2, reverse: { perRun: 4 } },
            script: { 舊一: (seg) => (seg === 'reverse' ? [{ to: 'n', type: T1, reason: '舊一之風險模型延伸到新筆記之訊號' }] : []) },
        })
        const r = await e.run()
        const fwd = e.prompts.find((p) => p.segment === 'forward').prompt
        assert.ok(!fwd.includes('slug: o1'), '前提:o1 不在 n 之正向候選(K=2 被 g1、g2 佔滿)')
        const rev = e.prompts.filter((p) => p.segment === 'reverse')
        assert.equal(rev.length, 1)
        assert.match(rev[0].prompt, /標題：舊一/)
        assert.deepEqual([...rev[0].prompt.matchAll(/slug: (\S+)｜/g)].map((m) => m[1]), ['n'], '候選只有待處理之新筆記')
        assert.doesNotMatch(rev[0].prompt, /標題：舊二/, 'o2 之評估晚於 n,不入帳')
        assert.deepEqual([r.detail.reverseQueued, r.detail.reverseTargets, r.detail.reverseEdges, r.detail.reversePending], [1, 1, 1, 0], JSON.stringify(r.detail))
        const ed = await e.relations.get(edgeId('o1', 'n'))
        assert.deepEqual([ed.from, ed.to, ed.type], ['o1', 'n', T1])
        assert.equal((await e.notes.get('o1')).relatedAt, '2026-01-02', '反向段不改 o 之 relatedAt')
        assert.ok((readMd(e.file('n')).front.related || []).includes('o1'), '兩端皆投影')
    })

    it('反向段:扣保留時間(deps.reserveMs)後時間不足 → 延後(待處理對留帳);AI 失敗 → tries+1 不丟;下一輪重試成功;已有邊之對出隊即丟;停用(配額 0)不算對不落帳', async () => {
        const notes = [
            { id: 'n', title: '新', concepts: ['p', 's', 't'], createdAt: '2026-02-01T00:00:00+08:00' },
            { id: 'g1', concepts: ['s', 't', 'u'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
            { id: 'g2', concepts: ['s', 't', 'v'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
            { id: 'o1', title: '舊一', concepts: ['p', 'q'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
        ]
        let left = 1_000_000 // 扣 900 秒保留後只剩 100 秒 < 首家逾時 300 秒
        let failRev = true
        const e = env({
            notes,
            relate: { candidatesPerNote: 2, reverse: { perRun: 4 } },
            remainingMs: () => left,
            fail: (seg) => seg === 'reverse' && failRev,
            script: { 舊一: (seg) => (seg === 'reverse' ? [{ to: 'n', type: T1, reason: '舊一之風險模型延伸到新筆記之訊號' }] : []) },
        })
        const r1 = await e.run()
        assert.deepEqual([r1.detail.reverseQueued, r1.detail.reverseDeferred, r1.detail.reversePending], [1, true, 1])
        assert.ok(e.log.lines.includes('INFO 關聯反向段：扣保留時間後剩餘時間不足一次呼叫（300s），本輪延後（待處理 1 對）'), e.log.lines.join('\n'))
        left = 5_000_000
        const r2 = await e.run()
        assert.deepEqual([r2.detail.reverseTargets, r2.detail.failedBatches, r2.detail.reversePending], [0, 1, 1])
        assert.equal(e.state().reverse.pairs()[0].tries, 1, '失敗只增 tries(排序),不丟')
        failRev = false
        const r3 = await e.run()
        assert.deepEqual([r3.detail.reverseTargets, r3.detail.reverseEdges, r3.detail.reversePending], [1, 1, 0])
        // 出隊重驗:已有邊之對丟棄
        e.state().reverse.add([{ o: 'g1', n: 'g2', score: 99, at: 'x' }])
        await e.relations.insertNew([E('g1', 'g2', T0)])
        const r4 = await e.run()
        assert.deepEqual([r4.detail.reverseDropped, r4.detail.reversePending], [1, 0])
        // 停用:不算對、不落帳
        const off = env({ notes, relate: { candidatesPerNote: 2, reverse: { perRun: 0 } } })
        const r5 = await off.run()
        assert.deepEqual([r5.detail.reverseQueued, fs.existsSync(`${off.ctx.deps.dirs.state}/${LEDGER_FILES.reverse}`)], [0, false])
    })

    it('保留時間之來源:stageRelate 之 opt.reserveMs 優先於每輪依賴之 deps.reserveMs(毫秒數或 (ctx) => 毫秒數,每輪求值);皆未給為 0;不合之值於該段開工時拋錯', async () => {
        const notes = [
            { id: 'n', title: '新', concepts: ['p', 's', 't'], createdAt: '2026-02-01T00:00:00+08:00' },
            { id: 'g1', concepts: ['s', 't', 'u'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
            { id: 'g2', concepts: ['s', 't', 'v'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
            { id: 'o1', title: '舊一', concepts: ['p', 'q'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
        ]
        // 剩 1,000 秒、首家逾時 300 秒:保留 900 秒(env 之 deps.reserveMs)→ 延後;保留 0 → 開工
        const mk = () => env({ notes, relate: { candidatesPerNote: 2, reverse: { perRun: 4 } }, remainingMs: () => 1_000_000, script: { 舊一: (seg) => (seg === 'reverse' ? [{ to: 'n', type: T1, reason: '舊一之風險模型延伸到新筆記之訊號' }] : []) } })
        assert.equal((await mk().run()).detail.reverseDeferred, true, 'deps.reserveMs 生效')
        const rb = await mk().run({ reserveMs: 0 })
        assert.deepEqual([rb.detail.reverseDeferred, rb.detail.reverseTargets], [false, 1], 'opt.reserveMs 優先(0 亦為明給)')
        assert.equal((await mk().run({ reserveMs: (ctx) => (ctx.remainingMs() > 0 ? 800_000 : 0) })).detail.reverseDeferred, true, '函數形式每輪求值')
        const d = mk()
        delete d.ctx.deps.reserveMs
        assert.equal((await d.run()).detail.reverseDeferred, false, '皆未給 → 不保留')
        await assert.rejects(() => mk().run({ reserveMs: 'abc' }), /關聯反向段之 reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數，收到 abc/)
    })

    it('關聯物件摘要:「處理 N、關聯 N 條、衝突 N 組（AI N 次）」契約不變;重判、反向、刪除、投影失敗 >0 才附', async () => {
        const e = env({
            notes: [
                { id: 'n', title: '新', concepts: ['p', 's', 't'], createdAt: '2026-02-01T00:00:00+08:00' },
                { id: 'g1', concepts: ['s', 't', 'u'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
                { id: 'g2', concepts: ['s', 't', 'v'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
                { id: 'o1', title: '舊一', concepts: ['p', 'q'], createdAt: '2026-01-01', relatedAt: '2026-01-02' },
                { id: 'c', title: '改', concepts: ['z'], createdAt: '2026-01-01', relatedAt: '2026-01-02', knowledgeChangedAt: '2026-02-02T00:00:00+08:00' },
            ],
            relate: { candidatesPerNote: 2, reverse: { perRun: 4 } },
            script: { 新: [{ to: 'g1', type: C, reason: '新說動量有效、g1 說扣成本後無效' }], 舊一: (seg) => (seg === 'reverse' ? [{ to: 'n', type: T1, reason: '舊一之風險模型延伸到新筆記之訊號' }] : []) },
        })
        e.state().tombstones.add('gone', 'x', '測試')
        await e.relations.insertNew([E('c', 'gone', T0)])
        // 預設子階段(relate → project → relationIndex),AI 替身經 opt.relate.callAI 注入
        const callAI = withCheck(async (p, c, o) => {
            const targets = [...p.matchAll(/^--- 第(\d+)篇（待建立關聯）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
            const sc = { 新: [{ to: 'g1', type: C, reason: '新說動量有效、g1 說扣成本後無效' }], 舊一: o?.segment === 'reverse' ? [{ to: 'n', type: T1, reason: '舊一之風險模型延伸到新筆記之訊號' }] : [] }
            return { ok: true, data: targets.map((t) => ({ index: t.index, relations: sc[t.title] || [] })), error: '', skipped: false, attempts: 1, preview: '' }
        })
        const rep = await createRelateObject({ relate: { callAI } }).run(e.ctx)
        assert.match(rep.summary, /^處理 2、關聯 2 條、衝突 1 組（AI 2 次）｜重判 1 篇｜反向 1 篇 1 條｜刪除 1 條$/, rep.summary)
        assert.ok(fs.existsSync(`${e.ctx.deps.dirs.relations}/graph.json`), '有變化即重建總覽')
    })

    // ── 正向之逐項鏈:例外仍落帳(逐項鏈拋錯者記 tries,否則永遠排回隊頭)、同一對象之多條與跨輪升級、投影之 md 讀不到 ──
    describe('正向逐項鏈與投影', function() {
        const log = nullLogger()
        let relSeq = 0
        const boom = (why) => defineMw({
            name: 'boom',
            handle: async () => {
                throw new Error(why)
            },
        })
        /** 關聯測試環境:兩篇筆記 md(n1 為目標、n2 為候選);relations 可預置;run＝關聯段＋投影段(回傳關聯段 report,另掛 project) */
        const relateEnv = (relSeed = [], o = {}) => {
            const dir = `${TMP}/rel-${++relSeq}`
            const mk = (id, withFile = true) => {
                const file = `${dir}/${id}.md`
                if (withFile) writeMd(file, { title: id, slug: id }, `# ${id}\n\n內文`)
                return { id, title: `標題${id}`, concepts: ['x'], category: 'c', createdAt: '2026-01-01', relatedAt: id === 'n1' ? '' : '2026-01-02', file }
            }
            const notes = memStore([mk('n1'), mk('n2', o.n2File !== false)])
            const relations = memStore(relSeed)
            const logger = recLog()
            const prompts = []
            const ctx = bagCtx({ stores: { notes, relations }, settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { rounds: 1, notesPerCall: 6, candidatesPerNote: 5 } }), ai: null, clock, dirs: { state: `${dir}/state` }, domains: { relate: createRelateDomain({}) } }, logger)
            const run = async (relationsOut) => {
                const r = await stageRelate({ callAI: withCheck(async (p) => {
                    prompts.push(p)
                    return { ok: true, data: [{ index: 1, relations: relationsOut }], error: '', skipped: false, attempts: 1, preview: '' }
                }) }).run(ctx)
                return { ...r, project: await stageRelateProject().run(ctx) }
            }
            return { notes, relations, logger, run, prompts, ctx, file: (id) => `${dir}/${id}.md` }
        }

        it('關聯逐項鏈異常:記 relateTries(與摘要/預篩之 applyItem 對稱;此前只記日誌,拋錯者同輪後續與下一輪皆排回隊頭)', async () => {
            const notes = memStore([
                { id: 'n1', title: 'A', concepts: ['x'], category: 'c', createdAt: '2026-01-01', relatedAt: '' },
                { id: 'n2', title: 'B', concepts: ['x'], category: 'c', createdAt: '2026-01-02', relatedAt: '' },
            ])
            const deps = {
                stores: { notes, relations: memStore() },
                settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { rounds: 1, notesPerCall: 6, candidatesPerNote: 5 } }),
                ai: null,
                clock,
                dirs: { state: `${TMP}/rel-boom/state` },
                domains: { relate: createRelateDomain({}) },
            }
            const ctx = bagCtx(deps, log)
            await stageRelate({
                chain: [boom('寫回筆記失敗')],
                callAI: withCheck(async () => ({ ok: true, data: [{ index: 1, relations: [] }, { index: 2, relations: [] }], error: '', skipped: false, attempts: 1, preview: '' })),
            }).run(ctx)
            for (const id of ['n1', 'n2']) {
                const n = await notes.get(id)
                assert.equal(n.relateTries, 1, `${id} 須記 relateTries`)
                assert.match(n.relateLastError, /逐項鏈異常：/)
                assert.equal(n.relatedAt, '', '未完成關聯者不標 relatedAt(記錄不丟,排隊尾重試)')
            }
        })

        it('關聯 S1／S3／S10：同一 to 之多條關聯依 to 合併(衝突型優先)、型別 trim 後比對、不合格之單條剔除而其餘照收(不整則拒收);邊庫與兩端投影同一型別', async () => {
            const e = relateEnv()
            const R2 = 'n1 說動量有效、n2 說扣除成本後無效'
            const r = await e.run([
                { to: 'n2', type: '互補搭配', reason: 'n1 與 n2 共用同一組成交量指標' },
                { to: 'n2', type: ' 衝突或反例 ', reason: R2 }, // 帶空白之衝突型(此前靜默降為後備型別)
                { to: 'ghost', type: 'x', reason: 'y' }, // slug 解析不到:只剔此條(此前整則拒收)
                { to: 'n2', type: '', reason: '' },
            ])
            assert.deepEqual([r.detail.targets, r.detail.edges, r.detail.conflicts, r.detail.missed, r.detail.edgeStdRejected], [1, 1, 1, 0, 2], JSON.stringify(r.detail))
            const edges = await e.relations.select()
            assert.equal(edges.length, 1)
            assert.deepEqual([edges[0].id, edges[0].from, edges[0].to, edges[0].type, edges[0].reason], [edgeId('n1', 'n2'), 'n1', 'n2', '衝突或反例', R2])
            const md1 = readMd(e.file('n1'))
            const rel = sectionOf(md1.body, '關聯')
            assert.equal((rel.text.match(/\[\[n2\]\]/g) || []).length, 1, '關聯章同一對只有一行')
            assert.ok(rel.text.includes(`[衝突或反例] → [[n2]] 標題n2：${R2}`), rel.text)
            assert.deepEqual(md1.front.conflicts, ['n2'])
            const md2 = readMd(e.file('n2'))
            assert.deepEqual(md2.front.conflicts, ['n1'], '對方由投影得衝突章(取代此前之雙寫)')
            assert.ok(sectionOf(md2.body, '關聯').text.includes(`[衝突或反例] ← [[n1]] 標題n1：${R2}`), '入邊以 ← 列於對方之關聯章')
            assert.ok(e.logger.lines.some((l) => /關聯：\[n1\] 2 條關聯項目未達標準，不納入、其餘照收/.test(l)), e.logger.lines.join('\n'))
            assert.equal((await e.notes.get('n1')).relatedAt !== '', true)
            assert.deepEqual([(await e.notes.get('n1')).relatedCount, (await e.notes.get('n2')).relatedCount], [1, 1], 'relatedCount＝度數(投影時兩端皆寫)')
            assert.deepEqual([r.project.detail.projected, r.project.detail.failed, r.project.detail.backlog], [2, 0, 0])
        })

        it('關聯 S1 跨輪：庫內已有非衝突邊而本輪判為衝突 → 升級(提案原子、舊提案入 history;新建 0、衝突 1、改變 1);庫內已為衝突者不再當候選(無可升級)', async () => {
            const id = edgeId('n1', 'n2')
            const a = relateEnv([{ id, from: 'n1', to: 'n2', type: '互補搭配', reason: 'old', createdAt: 'x', updatedAt: 'x' }])
            const NEW = 'n1 說動量有效、n2 說扣除成本後無效'
            const ra = await a.run([{ to: 'n2', type: '衝突或反例', reason: NEW }])
            assert.ok(a.prompts[0].includes('slug: n2'), '非衝突鄰居仍入候選(第二意見可升級為衝突)')
            assert.deepEqual([ra.detail.edges, ra.detail.conflicts, ra.detail.edgesChanged], [0, 1, 1], JSON.stringify(ra.detail))
            const ea = await a.relations.get(id)
            assert.deepEqual([ea.type, ea.reason, ea.history.map((h) => [h.type, h.reason])], ['衝突或反例', NEW, [['互補搭配', 'old']]])
            assert.deepEqual(readMd(a.file('n2')).front.conflicts, ['n1'])
            assert.ok(a.logger.lines.some((l) => /升級為「衝突或反例」/.test(l)))
            const b = relateEnv([{ id, from: 'n1', to: 'n2', type: '衝突或反例', reason: 'old', createdAt: 'x', updatedAt: 'x' }])
            const rb = await b.run([])
            assert.ok(!b.prompts[0].includes('slug: n2'), '已是衝突之鄰居不入候選')
            assert.deepEqual([rb.detail.targets, rb.detail.edges, rb.detail.conflicts], [1, 0, 0])
            assert.equal((await b.relations.get(id)).type, '衝突或反例')
        })

        it('關聯 S11(投影):對方 md 讀不到 → 邊照落庫、本篇照投影、對方留待投影帳並彙總 WARN;md 恢復後補投;本篇 md 讀不到同理', async () => {
            const e = relateEnv([], { n2File: false })
            const r = await e.run([{ to: 'n2', type: '衝突或反例', reason: 'n1 說動量有效、n2 說扣除成本後無效' }])
            assert.deepEqual([r.detail.edges, r.detail.conflicts, r.project.detail.failed, r.project.detail.backlog], [1, 1, 1, 1], JSON.stringify([r.detail, r.project.detail]))
            assert.ok(e.logger.lines.some((l) => /^WARN 關聯投影：1 篇 md 讀不到（例 n2），留待下輪補投/.test(l)), e.logger.lines.join('\n'))
            assert.deepEqual(readMd(e.file('n1')).front.conflicts, ['n2'], '可寫之一端照投影(此前兩邊皆不寫)')
            writeMd(e.file('n2'), { title: 'n2', slug: 'n2' }, '# n2\n\n內文')
            const p2 = await stageRelateProject().run(e.ctx)
            assert.deepEqual([p2.detail.projected, p2.detail.backlog], [1, 0])
            assert.deepEqual(readMd(e.file('n2')).front.conflicts, ['n1'], 'md 恢復後補投')
            const f = relateEnv()
            fs.rmSync(f.file('n1'))
            const rf = await f.run([{ to: 'n2', type: '互補搭配', reason: 'n1 與 n2 共用同一組成交量指標' }])
            assert.deepEqual([rf.detail.edges, rf.project.detail.failed], [1, 1])
            assert.ok(f.logger.lines.some((l) => /^WARN 關聯投影：1 篇 md 讀不到（例 n1）/.test(l)), f.logger.lines.join('\n'))
            assert.ok((await f.notes.get('n1')).relatedAt, '正向評估已完成(relatedAt 寫入;投影另帳補)')
        })
    })

    // ── 型別檢查:每條檢查至少一個無效輸入案例＋一個有效輸入行為不變之案例 ──
    describe('型別檢查', function() {
        const log = nullLogger()

        it('pickCandidates:target 非物件 → [];allNotes 非陣列 → [];limit 非非負整數 → 不限(0 仍視為有效值);有效輸入排序不變', () => {
            assert.deepEqual(pickCandidates('x', [], 1), [])
            assert.deepEqual(pickCandidates(undefined, [{ id: 'a' }], 1), [])
            assert.deepEqual(pickCandidates({ id: 'a' }, 'not-array', 1), [])
            assert.deepEqual(pickCandidates({ id: 'a' }, null, 1), [])

            const notes = [
                { id: 'a', concepts: ['x'], category: 'c', createdAt: '2026-01-01' },
                { id: 'b', concepts: ['x'], category: 'c', createdAt: '2026-01-02' },
                { id: 'c', concepts: [], category: 'other', createdAt: '2026-01-03' },
            ]
            const target = { id: 'z', concepts: ['x'], category: 'c' }
            assert.equal(pickCandidates(target, notes, 'not-a-number').length, 3, 'limit 非非負整數:不限,回傳全部候選')
            assert.equal(pickCandidates(target, notes, -1).length, 3, '負數非非負整數:同樣不限')
            assert.deepEqual(pickCandidates(target, notes, 0), [], 'limit=0 為有效非負整數,不得誤當成「不限」')
            assert.deepEqual(pickCandidates(target, notes, 1).map((n) => n.id), ['b'], '分數依共享概念與類別排序不變:同分依 createdAt 新到舊')
        })

        it('makeSlugResolver:candidates 非陣列視為[](任何輸入皆回 null);有效陣列之完全相符/尾碼容錯不變', () => {
            const badResolve = makeSlugResolver('not-array')
            assert.equal(badResolve('anything'), null)
            const badResolve2 = makeSlugResolver(null)
            assert.equal(badResolve2('a-11112222'), null)

            const resolve = makeSlugResolver([{ id: '深度學習於蛋白質結構預測-ab12cd34' }])
            assert.equal(resolve('深度學習於蛋白質結構預測-ab12cd34'), '深度學習於蛋白質結構預測-ab12cd34')
            assert.equal(resolve('深度-學習-於蛋白質-結構預測-ab12cd34'), '深度學習於蛋白質結構預測-ab12cd34', '抄寫誤差由尾碼救回')
            assert.equal(resolve('完全捏造-ffffffff'), null, '幻想 slug 拒收')
        })

        it('makeSlugResolver(終審 D14):尾碼之解析取抓取套件之 slugSuffixOf(同一格式);候選集內同尾碼多候選 → 該尾碼不猜(只以尾碼者回 null、完全相符者照解);大寫或非 8 碼尾碼不救', () => {
            const resolve = makeSlugResolver([{ id: '甲-ab12cd34' }, { id: '乙-ab12cd34' }, { id: '丙-00aa11bb' }])
            assert.equal(resolve('甲-ab12cd34'), '甲-ab12cd34', '完全相符照解')
            assert.equal(resolve('乙-ab12cd34'), '乙-ab12cd34')
            assert.equal(resolve('甲乙-ab12cd34'), null, '同尾碼多候選:不猜')
            assert.equal(resolve('丙丙-00aa11bb'), '丙-00aa11bb', '他尾碼不受影響')
            assert.equal(resolve('丙-00AA11BB'), null, '大寫尾碼非本格式')
            assert.equal(resolve('丙-00aa11b'), null, '碼數不符')
        })

        it('conceptKeysOf(終審 D12):以抓取套件之 noteConceptsOf 取鍵(正規化、去重、空鍵不計)——空標籤不再互相命中;pickCandidates 之分數隨之(只共享空標籤者 0 分)', () => {
            assert.deepEqual([...conceptKeysOf({ concepts: [' 恆星演化 ', '', '   ', '恆星演化', '紅移'] })], ['恆星演化', '紅移'])
            assert.deepEqual([...conceptKeysOf({ concepts: 'x' })], [])
            assert.deepEqual([...conceptKeysOf(null)], [])
            const t = { id: 't', concepts: ['', '甲'], category: 'c' }
            const a = { id: 'a', concepts: [''], category: 'd', createdAt: '2026-01-01' }
            const b = { id: 'b', concepts: ['甲'], category: 'd', createdAt: '2026-01-02' }
            const c = { id: 'c', concepts: [], category: 'c', createdAt: '2026-01-03' }
            assert.deepEqual(pickCandidates(t, [a, b, c], 3).map((n) => n.id), ['b', 'c', 'a'], '共享甲 10 分 > 同類 1 分 > 只共享空標籤 0 分')
        })

        it('itemTargetOf／admitItemOf／coveredItemOf(終審 R25;項合格判準之單一來源):index 為正整數且對得到目標;relations 為陣列且為空 → 合格;非空而至少一條過納入閘 → 合格(admitted 只收過閘者、results 逐條);皆不過或非陣列或非物件 → 不合格——正向批次之單項驗證、buildEdges、評分與專案之評比同讀', () => {
            const D = createRelateDomain({})
            const target = { id: '甲-11111111', title: '甲', category: '', concepts: ['甲'], summary: '甲之重點' }
            const cand = { id: '乙-22222222', title: '乙', category: '', concepts: ['甲'], summary: '乙之重點' }
            const o = { target, resolve: makeSlugResolver([cand]), candidates: new Map([[cand.id, cand]]), domain: D, hasNote: (id) => [target.id, cand.id].includes(id), nowIso: '2026-01-01T00:00:00+08:00' }
            const good = { to: '乙-22222222', type: D.relationTypes[0], reason: '甲之推導以乙所定義之量為前提而展開' }
            const bad1 = { to: '不存在-ffffffff', type: D.relationTypes[0], reason: '甲之推導以乙所定義之量為前提而展開' }
            assert.equal(itemTargetOf({ index: 2 }, [{ id: 'a' }, { id: 'b' }]).id, 'b')
            for (const x of [[{ index: 3 }, [{ id: 'a' }]], [{ index: 0 }, [{ id: 'a' }]], [{ index: '1' }, [{ id: 'a' }]], [null, [{ id: 'a' }]], [{ index: 1 }, 'x']]) assert.equal(itemTargetOf(...x), null, JSON.stringify(x))
            assert.equal(coveredItemOf({ index: 1, relations: [] }, o), true)
            assert.equal(coveredItemOf({ index: 1, relations: [good] }, o), true)
            const two = admitItemOf({ index: 1, relations: [bad1, good] }, o)
            assert.deepEqual([two.covered, two.admitted.map((e) => e.to), two.results.map((r) => r.ok), two.results[0].reasons], [true, [cand.id], [false, true], ['slug 解析不到（不存在-ffffffff）']], '一條過即合格;results 逐條(含不過者之原因)、admitted 只收過閘者')
            assert.equal(two.results[1].rel, good, 'results 帶原條目')
            assert.equal(coveredItemOf({ index: 1, relations: [{ ...bad1, reason: 'x' }] }, o), false)
            for (const bad of [{ index: 1, relations: 'x' }, { index: 1 }, null, 'x']) {
                assert.equal(coveredItemOf(bad, o), false, JSON.stringify(bad))
                assert.deepEqual(admitItemOf(bad, o), { covered: false, admitted: [], results: [] }, JSON.stringify(bad))
            }
        })

        it('createRelateQueueRunner(終審 R24;執行器契約):只回 { run };items 空 → { deferred:false, ran:null } 且不呼叫 AI;段之附帶欄 data 不得覆寫固定欄(note、_segment、_resolver、_candidates、_provider),其餘欄照併入訊息', async () => {
            const e = env({ notes: [{ id: 'q1', concepts: ['x'], createdAt: '2026-01-01', relatedAt: '2026-01-02' }, { id: 'q2', concepts: ['x'], createdAt: '2026-01-01', relatedAt: '2026-01-02' }], relate: { reverse: { perRun: 4 } } })
            const seen = []
            const calls = []
            const runner = createRelateQueueRunner({
                ctx: e.ctx, settings: e.ctx.deps.settings, opt: {}, domain: DOMAIN, log: e.log, seat: e.ctx.deps.settings.relate.ai, segment: 'reverse', label: '反向段', reserveLabel: '測試之 reserveMs',
                call: async (prompt) => {
                    calls.push(prompt)
                    return { ok: true, data: [{ index: 1, relations: [] }], providerId: 'stub:p', skipped: false, error: '' }
                },
                validOf: () => () => true,
                applyVia: async (data) => {
                    seen.push(data)
                    return { targets: 1 }
                },
            })
            assert.deepEqual(Object.keys(runner), ['run'])
            assert.deepEqual(await runner.run({ items: [], bump: () => {} }), { deferred: false, ran: null })
            assert.equal(calls.length, 0)
            const q1 = await e.notes.get('q1')
            const q2 = await e.notes.get('q2')
            const res = await runner.run({ items: [{ note: q1, candidates: [q2], data: { _page: ['p'], _segment: 'hack', note: 'hack', _resolver: 'hack', _provider: 'hack', _candidates: 'hack' } }], bump: () => {} })
            assert.deepEqual([res.deferred, calls.length, seen.length], [false, 1, 1])
            assert.equal(seen[0].note, q1, '固定欄 note 不被覆寫')
            assert.deepEqual([seen[0]._segment, seen[0]._provider, typeof seen[0]._resolver, seen[0]._candidates.map((c) => c.id), seen[0]._page], ['reverse', 'stub:p', 'function', ['q2'], ['p']])
        })

        it('relateSeatOf(終審 R20;席位沿用之唯一規則):reverse／rotation 未設即 relate.ai;reeval.first 未設即 relate.ai、second 未設即 first、third 未設為 null;鍵不合即拋', () => {
            const s0 = resolveRelateSettings({})
            assert.deepEqual(RELATE_SEAT_KEYS, ['relate', 'reverse', 'rotation', 'reeval.first', 'reeval.second', 'reeval.third'])
            assert.equal(relateSeatOf(s0, 'relate'), s0.relate.ai)
            assert.equal(relateSeatOf(s0, 'reverse'), s0.relate.ai)
            assert.equal(relateSeatOf(s0, 'rotation'), s0.relate.ai)
            assert.equal(relateSeatOf(s0, 'reeval.first'), s0.relate.ai)
            assert.equal(relateSeatOf(s0, 'reeval.second'), s0.relate.ai)
            assert.equal(relateSeatOf(s0, 'reeval.third'), null)
            const rv = { use: 'stub:r' }
            const f1 = { use: 'stub:f' }
            const s1 = resolveRelateSettings({ relate: { reverse: { ai: rv }, reeval: { ai: { first: f1 } } } })
            assert.deepEqual([relateSeatOf(s1, 'reverse').use, relateSeatOf(s1, 'rotation').use, relateSeatOf(s1, 'reeval.first').use, relateSeatOf(s1, 'reeval.second').use], ['stub:r', 'stub:r', 'stub:f', 'stub:f'])
            assert.throws(() => relateSeatOf(s0, 'x'), /relateSeatOf 之 key 須為/)
        })

        it('日誌契約與物件同一實體(終審 R21):RELATE_STAGE_KEYS 即 RELATE_REPORT_KEYS.subStages、物件之階段名即 RELATE_REPORT_KEYS.stage', () => {
            assert.equal(RELATE_STAGE_KEYS, RELATE_REPORT_KEYS.subStages)
            assert.equal(createRelateObject().name, RELATE_REPORT_KEYS.stage)
        })

        it('筆記狀態機一處(stores/relatedNotes):isRelated、needsReeval(版本不同＝待重判)、needsEdgeReview(正向已評完此版本而既有邊未評完)、edgesReviewedOf(既有邊已評完此版本;版本須為字串)、inRelatePool(未關聯 ∪ 待重判)', () => {
            assert.equal(needsReeval({ knowledgeChangedAt: 'v2', relatedChangeAt: 'v1' }), true)
            assert.equal(needsReeval({ knowledgeChangedAt: 'v1', relatedChangeAt: 'v1' }), false)
            assert.equal(needsReeval({ relatedChangeAt: 'v1' }), false, '無版本者不待重判')
            assert.equal(needsEdgeReview({ knowledgeChangedAt: 'v', relatedChangeAt: 'v' }), true)
            assert.equal(needsEdgeReview({ knowledgeChangedAt: 'v', relatedChangeAt: '' }), false, '先正向')
            assert.equal(needsEdgeReview({ knowledgeChangedAt: 'v', relatedChangeAt: 'v', edgesReviewedChangeAt: 'v' }), false)
            assert.equal(edgesReviewedOf({ knowledgeChangedAt: 'v', edgesReviewedChangeAt: 'v' }), true)
            assert.equal(edgesReviewedOf({ knowledgeChangedAt: 'v' }), false)
            assert.equal(edgesReviewedOf({}), false, '兩欄皆缺不算已評完(版本須為字串)')
            assert.equal(edgesReviewedOf(null), false)
            assert.deepEqual([inRelatePool({ relatedAt: '' }), inRelatePool({ relatedAt: 'x', knowledgeChangedAt: 'v2', relatedChangeAt: 'v1' }), inRelatePool({ relatedAt: 'x' }), inRelatePool({ relatedAt: 'x', knowledgeChangedAt: 'v', relatedChangeAt: 'v' })], [true, true, false, false])
        })

        it('rebuildRelationIndex:cfg 非物件或缺 dir → 拋錯;stores 缺 select → 拋錯;有效輸入行為不變', async () => {
            await assert.rejects(() => rebuildRelationIndex({ relations: memStore(), notes: memStore() }, {}), /rebuildRelationIndex 需要 cfg\.dir/)
            await assert.rejects(() => rebuildRelationIndex({ relations: memStore(), notes: memStore() }, 'not-object'), /rebuildRelationIndex 需要 cfg\.dir/)
            await assert.rejects(() => rebuildRelationIndex({}, { dir: TMP }), /rebuildRelationIndex 需要 stores\.relations 與 stores\.notes/)
            await assert.rejects(() => rebuildRelationIndex({ relations: {}, notes: memStore() }, { dir: TMP }), /rebuildRelationIndex 需要 stores\.relations 與 stores\.notes/)

            const dir = `${TMP}/relidx`
            fs.mkdirSync(dir, { recursive: true })
            const stores = {
                notes: memStore([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]),
                relations: memStore([{ id: 'r1', from: 'a', to: 'b', type: '互補搭配', reason: 'x' }]),
            }
            await rebuildRelationIndex(stores, { dir, nowIso: '2026-01-01', indexTitle: '總覽' })
            assert.ok(fs.existsSync(`${dir}/index.md`))
            assert.ok(fs.existsSync(`${dir}/graph.json`))
            const g = JSON.parse(fs.readFileSync(`${dir}/graph.json`, 'utf8'))
            assert.equal(g.edges.length, 1)
        })

        it('mwBuildEdges:opt 非物件視為{},不拋錯;有效輸入組裝邊陣列不變', async () => {
            const bad = mwBuildEdges('not-object')
            assert.equal(bad.name, 'buildEdges')

            const mw = mwBuildEdges({ maxRelationsPerNote: 4 })
            const resolve = (raw) => (raw === 'b-1' ? 'b-1' : null)
            const msg = makeMsg('note', {
                note: { id: 'a-1' },
                _aiItem: { relations: [{ to: 'b-1', type: '互補搭配', reason: 'a-1 與 b-1 共用同一組成交量指標' }] },
                _resolver: resolve,
                _candidates: [{ id: 'b-1' }],
                _domain: createRelateDomain({}),
                _rt: { byId: new Map([['a-1', {}], ['b-1', {}]]) },
            })
            const { halted } = await composeChain([mw])(msg, { deps: { clock }, log })
            assert.equal(halted, '')
            assert.equal(msg.data._edges.length, 1)
            assert.equal(msg.data._edges[0].to, 'b-1')
        })

        it('mwRebuildRelationIndex/stageRelate/stageRelateProject/stageRelationIndex:opt 非物件皆視為{},不拋錯', () => {
            assert.equal(mwRebuildRelationIndex('not-object').name, 'rebuild')
            assert.equal(typeof stageRelate('not-object').run, 'function')
            assert.equal(typeof stageRelateProject('not-object').run, 'function')
            assert.equal(typeof stageRelationIndex('not-object').run, 'function')
        })

        it('stageRelate:有效輸入(筆記不足 2 篇)行為不變', async () => {
            const stage = stageRelate({ domain: { relationTypes: [] } })
            const ctx = bagCtx({ stores: { notes: memStore([{ id: 'only-one' }]), relations: memStore() }, settings: resolveRelateSettings({}), ai: null, clock, dirs: { state: `${TMP}/rel-state` } }, log)
            const r = await stage.run(ctx)
            assert.equal(r.detail.targets, 0)
            assert.equal(ctx.get(RELATE_CTX_FLAGS.edgesChanged), 0)
        })
    })

    // ── 候選比對之概念鍵(抓取套件之 normalizeConcept,其折疊為抓取套件之模組級單例)與關聯總覽 ──
    describe('候選比對與關聯總覽', function() {

        it('relate 候選比對：折疊注入後繁簡互相命中', () => {
            const FOLD = { '机': '機' }
            setConceptFold((s) => [...s].map((ch) => FOLD[ch] || ch).join(''))
            try {
                const target = { id: 't', concepts: ['注意力机制'], category: '方法與技術' }
                const cands = [
                    { id: 'a', concepts: ['注意力機制'], category: '方法與技術', createdAt: '2026-08-01' },
                    { id: 'b', concepts: ['批次正規化'], category: '方法與技術', createdAt: '2026-08-02' },
                ]
                const picked = pickCandidates(target, cands, 1)
                assert.equal(picked[0].id, 'a', '簡體目標必須命中繁體候選（共享概念計分）')
            }
            finally {
                setConceptFold(null)
            }
        })

        it('關聯總覽:frontmatter 可解析回原值、graph.json 全量;導覽依連結數排序並限量(indexTopN)', async () => {
            const NOW = '2026-09-23T10:00:00+08:00'
            const dir = `${TMP}/maint-rel`
            fs.mkdirSync(dir, { recursive: true })
            const stores = {
                notes: memStore([{ id: 'a', title: 'A', concepts: [] }, { id: 'b', title: 'B', concepts: [] }, { id: 'c', title: 'C', concepts: [] }]),
                relations: memStore([
                    { id: 'r1', from: 'a', to: 'b', type: '互補搭配', reason: 'x' },
                    { id: 'r2', from: 'c', to: 'b', type: '衝突或反例', reason: 'y' },
                ]),
            }
            await rebuildRelationIndex(stores, { dir, nowIso: NOW, indexTopN: 2, indexTitle: '總覽"一"' })
            const { front, body } = parseFrontmatter(fs.readFileSync(`${dir}/index.md`, 'utf8'))
            assert.deepEqual([front.title, front.type, front.edges, front.nodes, front.shown], ['總覽"一"', 'relation-index', 2, 3, 2])
            assert.match(body.trimStart(), /^# 總覽"一"/, 'frontmatter 後之正文以 H1 起頭')
            assert.ok(body.indexOf('## B') >= 0 && body.indexOf('## B') < body.indexOf('## A'), '連結數最多者(B:2)排最前')
            const g = JSON.parse(fs.readFileSync(`${dir}/graph.json`, 'utf8'))
            assert.equal(g.edges.length, 2)
            assert.equal(g.nodes.length, 3)
        })

        it('關聯總覽:輸出目錄不在即建;index.md 與 graph.json 皆原子寫(不留暫存檔;重寫覆蓋舊檔);未給 indexTopN 取 RELATE_INDEX_TOP_N、未給標題取 RELATE_INDEX_TITLE', async () => {
            const dir = `${TMP}/relidx-new/deep/relations`
            assert.equal(fs.existsSync(dir), false, '前提:目錄不在')
            const notes = Array.from({ length: RELATE_INDEX_TOP_N + 5 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, title: `T${i}`, concepts: [] }))
            const edges = notes.slice(1).map((n) => ({ id: `e-${n.id}`, from: 'n00', to: n.id, type: '互補搭配', reason: 'x' }))
            const stores = { notes: memStore(notes), relations: memStore(edges) }
            await rebuildRelationIndex(stores, { dir, nowIso: '2026-10-08T10:00:00+08:00' })
            assert.deepEqual(fs.readdirSync(dir).sort(), ['graph.json', 'index.md'], '只有兩檔(無 .tmp 殘留)')
            const { front, body } = parseFrontmatter(fs.readFileSync(`${dir}/index.md`, 'utf8'))
            assert.deepEqual([front.title, front.shown, RELATE_INDEX_TOP_N], ['知識關聯總覽', RELATE_INDEX_TOP_N, 40])
            assert.match(body.trimStart(), /^# 知識關聯總覽/)
            await rebuildRelationIndex({ notes: memStore(notes.slice(0, 2)), relations: memStore([edges[0]]) }, { dir, nowIso: '2026-10-08T11:00:00+08:00' })
            assert.equal(JSON.parse(fs.readFileSync(`${dir}/graph.json`, 'utf8')).edges.length, 1, '重寫覆蓋舊檔')
            assert.deepEqual(fs.readdirSync(dir).sort(), ['graph.json', 'index.md'])
        })
    })

    // ── 單一來源:候選分數(正向、反向、輪巡同一式)、已關聯之判定、單篇上限之預設與同一對象／上限之取捨(正向與評分同一函數)──
    describe('單一來源', function() {

        it('candidateScoreOf＝共享鍵數×10＋同類別 1;正向之 pickCandidates 與反向／輪巡之 scoresFor 同一分數', () => {
            assert.deepEqual([candidateScoreOf(0, false), candidateScoreOf(0, true), candidateScoreOf(1, false), candidateScoreOf(2, true)], [0, 1, 10, 21])
            const notes = [
                { id: 't', concepts: ['a', 'b'], category: 'x', createdAt: '2026-01-01' },
                { id: 'p', concepts: ['a', 'b'], category: 'x', createdAt: '2026-01-02' },
                { id: 'q', concepts: ['a'], category: 'y', createdAt: '2026-01-03' },
                { id: 'r', concepts: ['z'], category: 'x', createdAt: '2026-01-04' },
            ]
            assert.deepEqual(pickCandidates(notes[0], notes, 3).map((n) => n.id), ['p', 'q', 'r'], '21 > 10 > 1')
            const idx = createReverseIndex(notes, { keysOf: (n) => new Set(n.concepts), K: 2 })
            assert.deepEqual([...idx.scoresFor('t')], [['p', candidateScoreOf(2, true)], ['q', candidateScoreOf(1, false)]], '反向之分數與正向同式(只含共享鍵者)')
        })

        it('isRelated(relatedAt 非空)與 relatePendingOf(未關聯篇數):關聯段報告之 pending 與之同口徑;正向池含未關聯者', async () => {
            assert.deepEqual([isRelated({ relatedAt: 'x' }), isRelated({ relatedAt: '' }), isRelated({}), isRelated(null)], [true, false, false, false])
            assert.deepEqual([relatePendingOf([{ relatedAt: '' }, { relatedAt: 'x' }, {}]), relatePendingOf('x')], [2, 0])
            const e = env({ notes: [{ id: 'a', concepts: ['p'], createdAt: '2026-01-01' }, { id: 'b', concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-02' }], relate: { rounds: 1 } })
            const before = relatePendingOf(await e.notes.select())
            const r = await e.runRelate()
            assert.deepEqual([before, r.detail.targets, r.detail.pending, relatePendingOf(await e.notes.select())], [1, 1, 0, 0])
            assert.equal(RELATE_MAX_RELATIONS_PER_NOTE, 4, '單篇上限之預設(提示詞之「每篇最多選 4 個」同值)')
        })

        it('pickRelationsOf(正向逐項鏈 buildEdges 與評分同讀):同一對象只取一條(衝突優先,否則先到者)、逾單篇上限截去(衝突優先保留,其餘依先到);上限未給取 RELATE_MAX_RELATIONS_PER_NOTE', () => {
            const ct = '衝突'
            const rel = (to, type) => ({ to, type })
            const show = (xs) => xs.map((x) => `${x.to}:${x.type}`)
            // 同一對象:先到之非衝突被後到之衝突取代(被取代者入 dup);衝突先到則後到者捨去;皆非衝突取先到者
            const r1 = pickRelationsOf([rel('a', '同類'), rel('a', ct), rel('b', ct), rel('b', '同類'), rel('c', '同類'), rel('c', '互補')], { conflictType: ct })
            assert.deepEqual([show(r1.edges), show(r1.dup), r1.cut], [['a:衝突', 'b:衝突', 'c:同類'], ['a:同類', 'b:同類', 'c:互補'], []])
            // 上限:逾者截去,衝突優先保留、其餘依先到;未逾上限者原序
            const six = [rel('p', '同類'), rel('q', ct), rel('r', '同類'), rel('s', ct), rel('t', '同類'), rel('u', '同類')]
            const r2 = pickRelationsOf(six, { conflictType: ct })
            assert.deepEqual([r2.edges.map((x) => x.to), r2.cut.map((x) => x.to)], [['q', 's', 'p', 'r'], ['t', 'u']], `預設上限 ${RELATE_MAX_RELATIONS_PER_NOTE}`)
            assert.deepEqual(pickRelationsOf(six, { conflictType: ct, max: 6 }).edges.map((x) => x.to), ['p', 'q', 'r', 's', 't', 'u'], '未逾上限:原序')
            assert.deepEqual(pickRelationsOf(six, { conflictType: ct, max: 1 }).cut.map((x) => x.to), ['s', 'p', 'r', 't', 'u'])
            assert.deepEqual(pickRelationsOf('x', { conflictType: ct }), { edges: [], dup: [], cut: [] }, '非陣列視為[]')
        })
    })
})
