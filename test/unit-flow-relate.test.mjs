// unit-flow-relate.test.mjs — 關聯之整合流程:總組裝於真 LMDB 上以替身 AI 跑兩輪(關聯 → 投影 → 總覽)
// 規則(出自 createKnowledgeRelate、relateObject 與各子階段之檔頭):
//   F1 第一輪:摘要交出之新筆記(relatedAt 空)皆入正向池,一次批次 AI(關聯提示詞;替身依首句判角色)→ 納入閘 → 邊入邊庫(無序對 id、衝突型優先)
//      → 已關聯落帳(relatedAt);待投影帳之筆記之 md 重算「關聯」「⚠ 衝突與反例」兩章與 frontmatter;本輪邊有異動 → 總覽(index.md、graph.json)重建
//   F2 固定格式摘要(對外契約)逐字;run.start.json 先宣告本輪上限、run.json 結構化落地;日誌檔之字樣可由日誌契約之正則解析
//   F3 第二輪(增量):只有新加入之筆記與內容變更之筆記(knowledgeChangedAt 與上次評估時記下者不同)入正向池——已關聯而未變者不再送 AI;
//      既有邊只增不刪;內容變更者記 relatedChangeAt 並重判(計 reTargets);受影響者(新邊兩端、內容變更者與其鄰居)重投、總覽重建
//   F4 同一管線內之 ctx 旗標:關聯總覽之重建與下游讀 RELATE_CTX_FLAGS.edgesChanged＝本輪邊之實際異動數(每筆寫入只計一次)
// 執行:自套件根 node <mocha> test/unit-flow-relate.test.mjs(暫存 test/_tmp/flow-relate-<pid>,測完即刪;不連網、不呼叫真 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readMd, writeMd } from '../src/core/summarizePackage.mjs'
import { stdReport } from '../src/core/capturePackage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { stageRelationIndex } from '../src/stages/relationIndexStage.mjs'
import { stageRelateProject } from '../src/stages/projectStage.mjs'
import { edgeId } from '../src/stores/edgeStore.mjs'
import { LEDGER_FILES, indexDirtyOf } from '../src/stores/relateLedgers.mjs'
import { RELATE_LOG_PARSE, RELATE_CTX_FLAGS } from '../src/logContract.mjs'
import {
    tmpRoot, removeRoots, resetConceptFold, landNote, scriptedAi, relateAnswer, buildTestRelate, withStores, seedNotes, subReport, findFiles, readJsonFile, fileLogFactory, CLOCK,
} from './tools/relateTestKit.mjs'
import { sleep, assertSubStagesOk } from './tools/captureForTest.mjs'

const MIN = 60_000
const DOMAIN = createRelateDomain({})
const [T0, T1] = DOMAIN.relationTypes.filter((t) => t !== DOMAIN.conflictType)
const C = DOMAIN.conflictType

describe('unit-flow-relate', function() {

    this.timeout(120_000)

    let root = ''
    let round = 1
    let rep1 = null
    let rep2 = null
    let flow2 = null
    const probeSeen = []
    const N = {}
    const titlesOfRound = { 1: [], 2: [] }
    const REASON_AB = '兩篇皆以三角視差法量測恆星距離並討論其誤差來源'
    const REASON_CA = '甲說星等與距離無關；乙說視差誤差主導距離之估計'
    const REASON_DB = '新方法沿用同一組視差誤差之修正步驟'

    // 替身 AI:依角色(提示詞首句)與輪次作答;記下各輪送進關聯提示詞之目標標題
    const ai = scriptedAi((role, prompt, o, items) => {
        if (role !== 'relate') return undefined
        titlesOfRound[round].push(...items.map((t) => t.title))
        return round === 1
            ? relateAnswer(items, { 恆星視差之量測: [{ to: '視差誤差之修正', type: T0, reason: REASON_AB }], 星等之定義: [{ to: '恆星視差之量測', type: C, reason: REASON_CA }] })
            : relateAnswer(items, { 視差量測之新方法: [{ to: '視差誤差之修正', type: T1, reason: REASON_DB }] })
    })

    before(async () => {
        root = tmpRoot('flow-relate')
        const notesDir = `${root}/knowledge/notes`
        N.a = landNote(notesDir, { doc: 'a', title: '恆星視差之量測', concepts: ['視差', '觀測誤差'] })
        N.b = landNote(notesDir, { doc: 'b', title: '視差誤差之修正', concepts: ['視差', '觀測誤差'] })
        N.c = landNote(notesDir, { doc: 'c', title: '星等之定義', concepts: ['星等', '觀測誤差'] })
        // ── 第一輪(預設子階段)──
        let flow1 = null
        ;({ flow: flow1 } = buildTestRelate(root, { aiAdapter: ai, scheduleLimitMin: 55, logFactory: fileLogFactory(() => flow1) }))
        await seedNotes(flow1, [N.a, N.b, N.c])
        rep1 = await flow1.run()
        // ── 兩輪之間:新筆記加入;使用者改了 a 之一句話重點(摘要套件之內容同步寫 knowledgeChangedAt)──
        N.d = landNote(notesDir, { doc: 'd', title: '視差量測之新方法', concepts: ['視差'] })
        const changedAt = CLOCK.iso8()
        await withStores(flow1, async (s) => {
            await s.notes.insertNew([N.d])
            const md = readMd(N.a.file)
            writeMd(N.a.file, md.front, md.body.replace('恆星視差之量測之重點', '修訂：以三角視差法量測恆星距離'))
            await s.notes.patch(N.a.id, { knowledgeChangedAt: changedAt, summary: '修訂：以三角視差法量測恆星距離' })
        })
        await sleep(1100) // 時間戳為秒級:兩輪之日誌、開工標記與執行摘要各一份
        round = 2
        // ── 第二輪(內建子階段＋觀察 ctx 旗標之自寫子階段;同一管線)──
        const probe = { name: 'probe', run: async (ctx) => {
            probeSeen.push({ edges: ctx.get(RELATE_CTX_FLAGS.edgesChanged, null), blocked: ctx.get(RELATE_CTX_FLAGS.blocked, false) })
            return stdReport()
        } }
        ;({ flow: flow2 } = buildTestRelate(root, {
            aiAdapter: ai, scheduleLimitMin: 55, logFactory: fileLogFactory(() => flow2),
            stages: [stageRelate(), stageRelateProject(), stageRelationIndex(), probe],
        }))
        rep2 = await flow2.run()
    })

    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    const logText = (rep) => fs.readFileSync(rep.summaryFile.replace(/-run\.json$/, '-run.log'), 'utf8')

    it('F1 第一輪:三篇新筆記皆送一次批次 AI;過閘之兩條邊入邊庫(無序對 id;衝突型照收),三篇皆已關聯(relatedAt)', async () => {
        assertSubStagesOk(rep1, assert)
        const d = subReport(rep1, '關聯', 'relate').detail
        assert.deepEqual([d.targets, d.reTargets, d.edges, d.conflicts, d.pending, d.edgeStdRejected], [3, 0, 2, 1, 0, 0])
        assert.deepEqual(titlesOfRound[1].sort(), ['恆星視差之量測', '星等之定義', '視差誤差之修正'])
        await withStores(flow2, async (s) => {
            const e1 = await s.relations.get(edgeId(N.a.id, N.b.id))
            assert.deepEqual([e1.from, e1.to, e1.type, e1.reason], [N.a.id, N.b.id, T0, REASON_AB])
            const e2 = await s.relations.get(edgeId(N.c.id, N.a.id))
            assert.deepEqual([e2.from, e2.to, e2.type, e2.reason], [N.c.id, N.a.id, C, REASON_CA])
            for (const id of [N.b.id, N.c.id]) assert.match((await s.notes.get(id)).relatedAt, /^\d{4}-\d{2}-\d{2}T/, id)
        })
    })

    it('F1 投影:兩端 md 之「關聯」章(→＝本篇提出、←＝對方提出;衝突在前)與「⚠ 衝突與反例」章、frontmatter related／conflicts／related_at;記錄之 projHash 與 relatedCount', async () => {
        const mdC = readMd(N.c.file)
        assert.deepEqual([mdC.front.related, mdC.front.conflicts], [[N.a.id], [N.a.id]])
        assert.match(mdC.body, new RegExp(`## 關聯\\n\\n- \\[${C}\\] → \\[\\[${N.a.id}\\]\\] 恆星視差之量測：${REASON_CA}`))
        assert.match(mdC.body, new RegExp(`## ⚠ 衝突與反例\\n\\n- 與 \\[\\[${N.a.id}\\]\\] 恆星視差之量測：${REASON_CA}`))
        const mdB1 = fs.readFileSync(N.b.file, 'utf8')
        assert.ok(mdB1.includes(`- [${T0}] ← [[${N.a.id}]] 恆星視差之量測：${REASON_AB}`), mdB1)
        assert.ok(!/## ⚠ 衝突與反例/.test(mdB1), '無衝突者無衝突章')
        await withStores(flow2, async (s) => {
            const c = await s.notes.get(N.c.id)
            assert.deepEqual([typeof c.projHash, c.relatedCount], ['string', 1])
        })
        assert.deepEqual(subReport(rep1, '關聯', 'project').detail, { projected: 3, changed: 3, failed: 0, gone: 0, manual: 0, backlog: 0 })
    })

    it('F1 總覽:本輪邊有異動 → 重建 <workDir>/knowledge/relations 之 index.md 與 graph.json;待投影帳清空(空帳刪檔)、總覽無待重建旗標', () => {
        assert.deepEqual(Object.keys(rep1.stages[0].result.detail), ['relate', 'project', 'relationIndex'])
        assert.deepEqual(fs.readdirSync(`${root}/knowledge/relations`).sort(), ['graph.json', 'index.md'])
        assert.equal(indexDirtyOf(`${root}/state`), false)
        assert.equal(fs.existsSync(`${root}/state/${LEDGER_FILES.dirty}`), false, '待投影帳空即刪檔')
    })

    it('F2 固定格式摘要(對外契約)逐字;第二輪附「重判」段(自組子階段而含關聯子階段者仍用固定格式)', () => {
        assert.equal(rep1.stages[0].result.summary, '處理 3、關聯 2 條、衝突 1 組（AI 1 次）')
        assert.equal(rep2.stages[0].result.summary, '處理 2、關聯 1 條、衝突 0 組（AI 1 次）｜重判 1 篇')
        assert.equal(subReport(rep2, '關聯', 'relate').summary, '', '子階段本身無摘要')
    })

    it('F2 開工標記先宣告本輪上限、執行摘要結構化落地(管線名、段、子階段、統計);兩輪各一份,時間戳與日誌檔同一個;段落完成行可由日誌契約之正則解析', () => {
        const starts = findFiles(`${root}/log`, '-run.start.json')
        const sums = findFiles(`${root}/log`, '-run.json')
        assert.deepEqual([starts.length, sums.length, findFiles(`${root}/log`, '-run.log').length], [2, 2, 2])
        const st = readJsonFile(starts[0])
        assert.deepEqual([st.limitMin, st.scheduleLimitMin, st.deadlineMs, st.lockStaleMs, st.pid], [55, 55, 49 * MIN, 60 * MIN, process.pid])
        assert.equal(path.basename(starts[0]).replace('-run.start.json', ''), path.basename(rep1.summaryFile).replace('-run.json', ''))
        const sum = readJsonFile(rep1.summaryFile)
        assert.deepEqual([sum.name, sum.ok, sum.lockSkipped, sum.stages.map((x) => x.name)], ['知識關聯', true, false, ['關聯']])
        assert.deepEqual(Object.keys(sum.stages[0].sub), ['relate', 'project', 'relationIndex'])
        assert.deepEqual([sum.stages[0].sub.relate.detail.edges, sum.stages[0].sub.relate.detail.conflicts], [2, 1])
        assert.equal(sum.stages[0].summary, rep1.stages[0].result.summary)
        const t1 = logText(rep1)
        const num = (re) => Number(t1.match(re)[1])
        assert.deepEqual([num(RELATE_LOG_PARSE.targets), num(RELATE_LOG_PARSE.edges), num(RELATE_LOG_PARSE.conflicts), num(RELATE_LOG_PARSE.aiCalls)], [3, 2, 1, 1])
        assert.match(t1, /INFO\s+關聯：恆星視差之量測-[0-9a-f]{8} → 1 條/)
        assert.deepEqual(Object.keys(readJsonFile(rep2.summaryFile).stages[0].sub), ['relate', 'project', 'relationIndex', 'probe'])
    })

    it('F3 第二輪之增量:只有新筆記(d)與內容變更之筆記(a)送 AI——已關聯而未變者(b、c)不再送;a 記 relatedChangeAt＝knowledgeChangedAt、計重判;既有邊只增不刪', async () => {
        assertSubStagesOk(rep2, assert)
        assert.deepEqual(titlesOfRound[2].sort(), ['恆星視差之量測', '視差量測之新方法'])
        assert.equal(ai.calls.filter((c) => c.role === 'relate').length, 2, '兩輪各一次批次呼叫')
        const d = subReport(rep2, '關聯', 'relate').detail
        assert.deepEqual([d.targets, d.reTargets, d.edges, d.conflicts, d.changedSeen, d.pending, d.changedPending], [2, 1, 1, 0, 1, 0, 0])
        await withStores(flow2, async (s) => {
            const a = await s.notes.get(N.a.id)
            assert.equal(a.relatedChangeAt, a.knowledgeChangedAt)
            const edges = await s.relations.select()
            assert.deepEqual(edges.map((e) => e.id).sort(), [edgeId(N.a.id, N.b.id), edgeId(N.c.id, N.a.id), edgeId(N.d.id, N.b.id)].sort(), '第一輪之邊皆保留,新增 d–b')
            const b = await s.notes.get(N.b.id)
            assert.ok(b.relatedAt < a.relatedAt, '未變者之 relatedAt 不刷新')
        })
    })

    it('F3 受影響者重投:新邊之兩端(d、b)與內容變更者(a)及其鄰居(b、c)之 md 依邊庫重算;總覽重建(邊 3、節點 4)', () => {
        const pj = subReport(rep2, '關聯', 'project').detail
        assert.deepEqual([pj.projected, pj.failed, pj.backlog], [4, 0, 0])
        const mdB = readMd(N.b.file)
        assert.deepEqual(mdB.front.related, [N.a.id, N.d.id].sort())
        assert.ok(mdB.body.includes(`- [${T1}] ← [[${N.d.id}]] 視差量測之新方法：${REASON_DB}`), mdB.body)
        assert.deepEqual(readMd(N.d.file).front.related, [N.b.id])
        const idx = readMd(`${root}/knowledge/relations/index.md`)
        assert.deepEqual([idx.front.type, idx.front.edges, idx.front.nodes], ['relation-index', 3, 4])
        const g = readJsonFile(`${root}/knowledge/relations/graph.json`)
        assert.deepEqual([g.nodes.length, g.edges.length], [4, 3])
        assert.deepEqual(Object.keys(g.nodes[0]).sort(), ['category', 'concepts', 'id', 'title'])
        assert.deepEqual(Object.keys(g.edges[0]).sort(), ['from', 'reason', 'to', 'type'])
    })

    it('F4 ctx 旗標限同一管線:同一輪之後段讀得到 relateEdges＝本輪邊之實際異動數(新增 1)、relateBlocked 未設;旗標名取 RELATE_CTX_FLAGS', () => {
        assert.deepEqual(probeSeen, [{ edges: 1, blocked: false }])
        assert.deepEqual(RELATE_CTX_FLAGS, { edgesChanged: 'relateEdges', blocked: 'relateBlocked' })
    })

    it('F4 兩輪之 AI 呼叫:皆為關聯提示詞(首句「…的關聯建立器」)、席位由子階段給(spec＝relate.ai)、逐次給 acceptTruncated', () => {
        assert.deepEqual(ai.calls.map((c) => c.role), ['relate', 'relate'])
        for (const c of ai.calls) {
            assert.equal(c.opt?.acceptTruncated, true)
            assert.equal(typeof c.spec?.use, 'string')
            assert.match(c.prompt, /^你是知識庫的關聯建立器/)
        }
        assert.deepEqual(ai.calls[0].spec, flow2.info().settings.relate.ai)
    })
})
