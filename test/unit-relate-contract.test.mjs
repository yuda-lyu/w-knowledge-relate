// unit-relate-contract.test.mjs — 關聯之對外契約與跨入口一致:下游可讀之產物格式、檢定標準 RS1／RS2／RS3／RS8 於各寫入入口同一判定、
//   上游(摘要套件)之內容變更與 ctx 旗標、兩份依賴(deps)契約
// 規則(出自 stores/noteProjection、stages/relateStage、standards/edgeGate 與 audit、ops/noteOps 檔頭與 README 之對外契約一章):
//   ①下游可讀之產物:筆記 md 之兩章(章名＝RELATE_SECTION_TITLES,且為摘要套件之非內容章——摘要之同步與數字紮根之材料皆不含之)、
//     行式(關聯章「- [型別] →／← [[slug]] 標題：理由」、⚠ 章「- 與 [[slug]] 標題：理由」)、frontmatter related／conflicts／related_at;
//     關聯總覽 index.md(frontmatter type relation-index、邊數、節點數)與 graph.json(全量節點與邊)
//   ②RS1／RS2／RS3／RS8 於各寫入入口同一判定:同一組六種提案在新進(正向之納入閘)、restoreEdge、restoreNote 三入口之去處一致——
//     合格與可確定性修正者(正體)納入、結構／理由形式／數字紮根不合格者不納入;符合度掃描(落庫之原值,不正規化)對同一組原值之判定與之對應
//   ③上游之變更通知:摘要套件之內容同步寫 knowledgeChangedAt → 關聯段重判該篇(記 relatedChangeAt);關聯之投影不觸發摘要之內容變更;
//     同一管線內摘要之重標旗標(SUMMARIZE_CTX_FLAGS.tagChanged)觸發總覽重建;關聯之 ctx 旗標(RELATE_CTX_FLAGS)交下游
//   ④兩份依賴契約:子階段之每輪依賴只讀 { stores:{ notes, relations, holds?, checks?, cores? }, clock, dirs:{ state, relations },
//     settings:{ ai, relate, relationIndexTitle? }, ai, domains:{ relate }, reserveMs? };維運 API 讀 { stores, dirs, clock, log?, domain(需 domain 之 op 缺即
//     於任何寫入前拋), noteGate?, settings? }
// 規則一律以中立題材驗(天文觀測);摘要套件之件經測試專用之橋接取得。
// 執行:自套件根 node <mocha> test/unit-relate-contract.test.mjs(暫存 test/_tmp/relate-contract-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { memStore, recLog, withCheck } from './tools/captureForTest.mjs'
import { tmpRoot, removeRoots, resetConceptFold, landNote, CLOCK, itemsOf, scriptedAi, relateAnswer, buildTestRelate, seedNotes, subReport, readJsonFile, STUB_REASON } from './tools/relateTestKit.mjs'
import { syncNotes, resolveSummarizeVocab, NON_CONTENT_SECTIONS, bagCtx } from './tools/summarizeForTest.mjs'
import { readMd, writeMd, noteMaterialText, SUMMARIZE_CTX_FLAGS } from '../src/core/summarizePackage.mjs'
import { stdReport } from '../src/core/capturePackage.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { createRelateObject } from '../src/relateObject.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { stageRelationIndex } from '../src/stages/relationIndexStage.mjs'
import { stageRelateProject } from '../src/stages/projectStage.mjs'
import { makeEdge, edgeId } from '../src/stores/edgeStore.mjs'
import { RELATE_SECTION_TITLES } from '../src/stores/noteProjection.mjs'
import { openRelateLedgers } from '../src/stores/relateLedgers.mjs'
import { retireEdge } from '../src/stores/edgeRetire.mjs'
import { deleteNote, restoreNote, restoreEdge, pruneDangling, projectAll } from '../src/ops/noteOps.mjs'
import { auditRelateStandards } from '../src/standards/audit.mjs'
import { RELATE_CTX_FLAGS } from '../src/logContract.mjs'

const DOMAIN = createRelateDomain({})
const [T0, T1] = DOMAIN.relationTypes.filter((t) => t !== DOMAIN.conflictType)
const C = DOMAIN.conflictType
const OLD = '2026-01-05T00:00:00+08:00'
const RELATED = '2026-01-02T00:00:00+08:00'

// ── 同一組六種提案(由 P_v 提向 Q_v):合格、含數字而紮根、型別不在清單、理由空泛、簡體(可確定性修正)、含原文沒有之數字 ──
const VARIANTS = Object.freeze({
    ok: { type: T0, reason: '兩篇皆以三角視差法量測並修正觀測誤差' },
    okNum: { type: T0, reason: '兩篇皆以 12 顆參考星校正視差之誤差' },
    rs1: { type: '不存在之型別', reason: '兩篇皆以三角視差法量測並修正觀測誤差' },
    rs2: { type: T0, reason: '都與某主題有關' },
    rs3: { type: T0, reason: '两篇都讨论视差之量测方法与误差' },
    rs8: { type: T0, reason: '兩篇皆以 37 顆參考星校正視差之誤差' },
})
const IDS = Object.keys(VARIANTS)
const ADMITTED = ['ok', 'okNum', 'rs3']
const REJECTED = { rs1: /型別「不存在之型別」不在清單、亦無改名或別名對映/, rs2: /^RS2 /, rs8: /^RS8 兩端皆無之數字：37/ }
const RS3_FIXED = '兩篇都討論視差之量測方法與誤差'
// 「12 顆」只在 Q_okNum 之一句話重點(數字紮根之材料:新進為候選列之重點、存量為 md 之內容章)
const Q_SUMMARY = { okNum: '以 12 顆參考星校正視差' }

describe('unit-relate-contract', function() {

    this.timeout(120_000)

    let root = ''
    let seq = 0
    const dirOf = (tag) => `${root}/${tag}-${++seq}`
    before(() => {
        root = tmpRoot('relate-contract')
    })
    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    /**
     * 被提方 Q_v(已關聯)
     *
     * @param {String} dir 輸入暫存目錄
     * @returns {Object} 回傳 { v:記錄 }
     */
    const landQ = (dir) => Object.fromEntries(IDS.map((v) => [v, landNote(`${dir}/notes`, { doc: `q-${v}`, title: `量測乙之${v}`, concepts: ['視差', '觀測誤差'], summary: Q_SUMMARY[v], record: { relatedAt: RELATED } })]))
    /**
     * 提出方 P_v
     *
     * @param {String} dir 輸入暫存目錄
     * @param {Boolean} fresh 輸入是否為新筆記(未關聯;新進入口)
     * @returns {Object} 回傳 { v:記錄 }
     */
    const landP = (dir, fresh) => Object.fromEntries(IDS.map((v) => [v, landNote(`${dir}/notes`, { doc: `p-${v}`, title: `量測甲之${v}`, concepts: ['視差', '觀測誤差'], record: fresh ? {} : { relatedAt: RELATED } })]))
    const rawEdge = (from, to, v) => makeEdge({ from, to, type: VARIANTS[v].type, reason: VARIANTS[v].reason, nowIso: OLD })
    const ctxOf = (deps, log = recLog()) => bagCtx(deps, log)
    const subDeps = (dir, stores, extra = {}) => ({
        stores, clock: CLOCK, dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { ai: { use: 'stub:a' } } }), ai: null, domains: { relate: DOMAIN }, ...extra,
    })
    /**
     * 注入之 AI 呼叫(取代調度層):依提示詞中本批之目標作答
     *
     * @param {Function} answer 輸入 (目標 { index, title, candidates }) => relations 陣列
     * @returns {Function} 回傳 callAI
     */
    const callAIOf = (answer) => withCheck(async (prompt) => ({ ok: true, data: itemsOf(prompt).map((t) => ({ index: t.index, relations: answer(t) })), error: '', skipped: false, attempts: 1, providerId: 'stub:a' }))
    const lineOf = (log, id) => log.lines.find((l) => l.includes(`[${id}]`) && l.includes('未達標準')) || ''

    // ══════════════════════════ ①下游可讀之產物 ══════════════════════════
    describe('① 下游可讀之產物格式', function() {

        it('兩章之章名＝RELATE_SECTION_TITLES(凍結),且皆為摘要套件之非內容章(摘要之同步與數字紮根之材料不含投影章)', () => {
            assert.deepEqual(RELATE_SECTION_TITLES, { relations: '關聯', conflicts: '⚠ 衝突與反例' })
            assert.ok(Object.isFrozen(RELATE_SECTION_TITLES))
            for (const t of Object.values(RELATE_SECTION_TITLES)) assert.ok(NON_CONTENT_SECTIONS.includes(t), t)
            const body = '# 標題\n\n## 一句話重點\n\n重點\n\n## 關聯\n\n- [x] → [[a]] 甲：含 99 之理由\n\n## ⚠ 衝突與反例\n\n- 與 [[a]] 甲：含 77 之理由'
            assert.ok(!/99|77|## 關聯|## ⚠/.test(noteMaterialText(body)), '投影章不進數字紮根之材料')
        })

        it('投影之行式與 frontmatter:關聯章(衝突在前、→＝本篇提出、←＝對方提出)、⚠ 章(只列衝突、不帶方向)、related／conflicts(排序之 slug)、related_at＝各邊之最新時刻;投影冪等(再投影內容不變即不寫)', async () => {
            const dir = dirOf('proj')
            const a = landNote(`${dir}/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差'] })
            const b = landNote(`${dir}/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差'] })
            const c = landNote(`${dir}/notes`, { doc: 'c', title: '星等之定義', concepts: ['星等'] })
            const edges = [makeEdge({ from: a.id, to: b.id, type: T0, reason: '甲以乙之誤差修正步驟量測視差', nowIso: '2026-01-05T00:00:00+08:00' }), makeEdge({ from: c.id, to: a.id, type: C, reason: '丙說星等與距離無關；甲說視差主導距離估計', nowIso: '2026-01-07T00:00:00+08:00' })]
            const stores = { notes: memStore([a, b, c]), relations: memStore(edges) }
            openRelateLedgers(`${dir}/state`).dirty.add([a.id, b.id, c.id])
            const ctx = ctxOf(subDeps(dir, stores))
            const r1 = await stageRelateProject().run(ctx)
            assert.deepEqual([r1.detail.projected, r1.detail.changed], [3, 3])
            const md = readMd(a.file)
            assert.deepEqual([md.front.related, md.front.conflicts, md.front.related_at], [[b.id, c.id].sort(), [c.id], '2026-01-07T00:00:00+08:00'])
            const rel = md.body.split('## 關聯\n\n')[1].split('\n\n')[0].split('\n')
            assert.deepEqual(rel, [`- [${C}] ← [[${c.id}]] 星等之定義：丙說星等與距離無關；甲說視差主導距離估計`, `- [${T0}] → [[${b.id}]] 視差誤差之修正：甲以乙之誤差修正步驟量測視差`])
            assert.equal(md.body.split('## ⚠ 衝突與反例\n\n')[1].trim(), `- 與 [[${c.id}]] 星等之定義：丙說星等與距離無關；甲說視差主導距離估計`)
            const mdB = readMd(b.file)
            assert.deepEqual([mdB.front.related, mdB.front.conflicts, mdB.front.related_at], [[a.id], undefined, '2026-01-05T00:00:00+08:00'], '無衝突者不寫 conflicts')
            assert.ok(!mdB.body.includes('## ⚠ 衝突與反例'), '無衝突者無 ⚠ 章')
            const before = fs.readFileSync(a.file, 'utf8')
            openRelateLedgers(`${dir}/state`).dirty.add([a.id])
            const r2 = await stageRelateProject().run(ctx)
            assert.deepEqual([r2.detail.projected, r2.detail.changed], [1, 0], '冪等')
            assert.equal(fs.readFileSync(a.file, 'utf8'), before)
        })

        it('關聯之投影不觸發摘要套件之內容變更:筆記首見回填同步雜湊 → 關聯寫入兩章 → 摘要之同步不報變更、不寫 knowledgeChangedAt', async () => {
            const dir = dirOf('sync')
            const a = landNote(`${dir}/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差'] })
            const b = landNote(`${dir}/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差'] })
            const notes = memStore([a, b])
            const sdeps = { stores: { notes }, dirs: { state: `${dir}/state` }, clock: CLOCK, log: recLog(), vocab: resolveSummarizeVocab({}) }
            const s1 = await syncNotes(sdeps, { all: true })
            assert.deepEqual([s1.backfilled, s1.changed], [2, 0])
            const stores = { notes, relations: memStore([makeEdge({ from: a.id, to: b.id, type: T0, reason: '甲以乙之誤差修正步驟量測視差', nowIso: OLD })]) }
            openRelateLedgers(`${dir}/state`).dirty.add([a.id, b.id])
            await stageRelateProject().run(ctxOf(subDeps(dir, stores)))
            assert.match(fs.readFileSync(a.file, 'utf8'), /## 關聯/)
            const s2 = await syncNotes(sdeps, { all: true })
            assert.equal(s2.changed, 0, '投影章為非內容章')
            assert.deepEqual((await notes.select()).map((n) => n.knowledgeChangedAt), [undefined, undefined])
        })

        it('關聯總覽:index.md(frontmatter:標題、type relation-index、更新時刻、邊數、節點數、顯示數;依連結數降冪之導覽)與 graph.json(全量節點 { id, title, category, concepts }、全量邊 { from, to, type, reason })', async () => {
            const wd = dirOf('index')
            const { flow } = buildTestRelate(wd, { relationIndexTitle: '星空關聯總覽', aiAdapter: scriptedAi((role, p, o, items) => (role === 'relate' ? relateAnswer(items, { 恆星視差之量測: [{ to: '視差誤差之修正', type: T0 }, { to: '星等之定義', type: T1 }] }) : undefined)) })
            const notes = [['a', '恆星視差之量測'], ['b', '視差誤差之修正'], ['c', '星等之定義']].map(([doc, title]) => landNote(`${wd}/knowledge/notes`, { doc, title, concepts: ['視差'] }))
            await seedNotes(flow, notes)
            await flow.run()
            const idx = readMd(`${wd}/knowledge/relations/index.md`)
            assert.deepEqual(Object.keys(idx.front), ['title', 'type', 'updated', 'edges', 'nodes', 'shown'])
            assert.deepEqual([idx.front.title, idx.front.type, idx.front.edges, idx.front.nodes, idx.front.shown], ['星空關聯總覽', 'relation-index', 2, 3, 3])
            assert.match(idx.body, /^\n?# 星空關聯總覽\n\n共 2 條關聯，涵蓋 3 篇筆記。/)
            const sections = idx.body.split(/^## /m).slice(1)
            assert.ok(sections[0].startsWith(`恆星視差之量測\n\n- 檔案：[[${notes[0].id}]]\n`), '連結數最多者在前')
            assert.ok(sections[0].includes(`- [${T0}] → [[${notes[1].id}]] 視差誤差之修正：${STUB_REASON}`), sections[0])
            assert.ok(sections[0].includes(`- [${T1}] → [[${notes[2].id}]] 星等之定義：${STUB_REASON}`), sections[0])
            const g = readJsonFile(`${wd}/knowledge/relations/graph.json`)
            assert.deepEqual(Object.keys(g), ['updatedAt', 'nodes', 'edges'])
            assert.deepEqual(g.nodes.map((n) => Object.keys(n)), notes.map(() => ['id', 'title', 'category', 'concepts']))
            assert.deepEqual(g.nodes.map((n) => n.id).sort(), notes.map((n) => n.id).sort())
            assert.deepEqual(g.edges.map((e) => Object.keys(e)), [['from', 'to', 'type', 'reason'], ['from', 'to', 'type', 'reason']])
            assert.equal(g.updatedAt, idx.front.updated)
        })
    })

    // ══════════════════════════ ②各寫入入口同一判定 ══════════════════════════
    describe('② RS1／RS2／RS3／RS8 於各寫入入口同一判定', function() {
        /** 各入口之結果:{ 入口: { admitted:Array(變體), rejected:{ 變體: 理由 }, stored:{ 變體: 落庫之理由 } } } */
        const out = {}

        before(async () => {
            // (1) 新進:正向之納入閘(P_v 為新筆記,AI 提向 Q_v)——每項另帶一條合格之錨定關聯(指向 H):整項無一條合格者為未涵蓋(下輪再判、
            //     不逐條記錄),帶錨定者該項恆合格,逐條之剔除理由與計數才可觀察
            {
                const dir = dirOf('new')
                const Q = landQ(dir)
                const P = landP(dir, true)
                const H = landNote(`${dir}/notes`, { doc: 'hub', title: '視差量測之共同基準', concepts: ['視差', '觀測誤差'], record: { relatedAt: RELATED } })
                const relations = memStore([])
                const log = recLog()
                const ctx = ctxOf(subDeps(dir, { notes: memStore([...Object.values(P), ...Object.values(Q), H]), relations }), log)
                const callAI = callAIOf((t) => {
                    const v = t.title.replace(/^量測甲之/, '')
                    return VARIANTS[v] ? [{ to: Q[v].id, ...VARIANTS[v] }, { to: H.id, type: T0, reason: STUB_REASON }] : []
                })
                const r = await createRelateObject({ callAI }).run(ctx)
                const byPair = new Map((await relations.select()).map((e) => [e.id, e]))
                const res = { admitted: [], rejected: {}, stored: {}, detail: r.detail.relate.detail, anchors: Object.values(P).filter((p) => byPair.has(edgeId(p.id, H.id))).length }
                for (const v of IDS) {
                    const e = byPair.get(edgeId(P[v].id, Q[v].id))
                    if (e) {
                        res.admitted.push(v)
                        res.stored[v] = e.reason
                    }
                    else res.rejected[v] = (/不納入、其餘照收（(.*)）$/.exec(lineOf(log, P[v].id)) || [])[1] || ''
                }
                out.new = res
            }
            // (2) restoreEdge:邊撤出(std-retire)後以 restoreEdge 還原
            {
                const dir = dirOf('restoreEdge')
                const Q = landQ(dir)
                const P = landP(dir, false)
                const edges = IDS.map((v) => rawEdge(P[v].id, Q[v].id, v))
                const stores = { notes: memStore([...Object.values(P), ...Object.values(Q)]), relations: memStore(edges), holds: memStore([]), checks: memStore([]) }
                const ledgers = openRelateLedgers(`${dir}/state`)
                for (const e of edges) await retireEdge({ relations: stores.relations, ledgers, stateDir: `${dir}/state` }, e, { reason: 'std-retire', at: OLD, conflictTypes: DOMAIN.conflictTypeNames, hasNote: () => true })
                assert.equal((await stores.relations.select()).length, 0, '前提:六條皆已撤出')
                const deps = { stores, dirs: { state: `${dir}/state` }, clock: CLOCK, log: recLog(), domain: DOMAIN }
                const res = { admitted: [], rejected: {}, stored: {} }
                for (const v of IDS) {
                    const r = await restoreEdge(deps, edgeId(P[v].id, Q[v].id), { apply: true })
                    if (r.applied) {
                        res.admitted.push(v)
                        res.stored[v] = (await stores.relations.get(edgeId(P[v].id, Q[v].id))).reason
                    }
                    else res.rejected[v] = r.reason.replace(/^未達檢定標準：/, '')
                }
                out.restoreEdge = res
            }
            // (3) restoreNote:一篇筆記 X 與各 Q_v 之邊(六種理由),明示刪除後還原(邊經同一閘重入)
            {
                const dir = dirOf('restoreNote')
                const Q = landQ(dir)
                const X = landNote(`${dir}/notes`, { doc: 'x', title: '量測甲', concepts: ['視差'], record: { relatedAt: RELATED } })
                const stores = { notes: memStore([X, ...Object.values(Q)]), relations: memStore(IDS.map((v) => rawEdge(X.id, Q[v].id, v))) }
                const deps = { stores, dirs: { state: `${dir}/state` }, clock: CLOCK, log: recLog(), domain: DOMAIN }
                await deleteNote(deps, X.id, { reason: '測試刪除後還原' })
                assert.equal((await stores.relations.select()).length, 0, '前提:刪除連帶撤邊')
                const r = await restoreNote(deps, X.id, { conflictCheck: false })
                const res = { admitted: [], rejected: {}, stored: {}, raw: r }
                for (const v of IDS) {
                    const e = await stores.relations.get(edgeId(X.id, Q[v].id))
                    if (e) {
                        res.admitted.push(v)
                        res.stored[v] = e.reason
                    }
                    else res.rejected[v] = (r.edgesRejected.find((x) => x.other === Q[v].id)?.reasons || []).join('；')
                }
                out.restoreNote = res
            }
            // (4) 符合度掃描:落庫之原值(不正規化)
            {
                const dir = dirOf('audit')
                const Q = landQ(dir)
                const P = landP(dir, false)
                const stores = { notes: memStore([...Object.values(P), ...Object.values(Q)]), relations: memStore(IDS.map((v) => rawEdge(P[v].id, Q[v].id, v))) }
                const rep = await auditRelateStandards({ stores, domain: DOMAIN })
                const idOf = Object.fromEntries(IDS.map((v) => [edgeId(P[v].id, Q[v].id), v]))
                out.audit = Object.fromEntries(['RS1', 'RS2', 'RS3', 'RS8'].map((s) => [s, rep.standards[s].violations.map((x) => idOf[x.id]).sort()]))
                out.auditUndetermined = ['RS1', 'RS2', 'RS3', 'RS8'].reduce((n, s) => n + rep.standards[s].undetermined, 0)
                out.auditPass = IDS.filter((v) => ['RS1', 'RS2', 'RS3', 'RS8'].every((s) => !out.audit[s].includes(v)))
            }
        })

        it('三個寫入入口之去處一致:合格者(ok、okNum)與可確定性修正者(簡體 → 正體)納入,型別不在清單(RS1)、理由空泛(RS2)、原文沒有之數字(RS8)不納入', () => {
            for (const k of ['new', 'restoreEdge', 'restoreNote']) {
                assert.deepEqual(out[k].admitted, ADMITTED, `${k} 之納入`)
                assert.deepEqual(Object.keys(out[k].rejected).sort(), Object.keys(REJECTED).sort(), `${k} 之不納入`)
                for (const [v, re] of Object.entries(REJECTED)) assert.match(out[k].rejected[v], re, `${k}:${v}`)
            }
        })

        it('可確定性修正者三入口落庫同一值(理由轉正體);合格者原樣落庫;新進之計數:未達標準 3、修正後納入 1(錨定之 6 條另計於新建)', () => {
            for (const k of ['new', 'restoreEdge', 'restoreNote']) {
                assert.equal(out[k].stored.rs3, RS3_FIXED, `${k}:rs3`)
                assert.equal(out[k].stored.ok, VARIANTS.ok.reason, `${k}:ok`)
                assert.equal(out[k].stored.okNum, VARIANTS.okNum.reason, `${k}:okNum`)
            }
            assert.equal(out.new.anchors, 6, '錨定關聯皆納入(前提)')
            assert.deepEqual([out.new.detail.edgeStdRejected, out.new.detail.edgeStdFixed, out.new.detail.edges], [3, 1, 9])
            assert.deepEqual([out.restoreNote.raw.edgesRestored, out.restoreNote.raw.edgesRejected.length], [3, 3])
        })

        it('符合度掃描對同一組原值之判定與之對應:各標準之違反恰為該類提案(RS3 判原值之簡體——寫入入口於落庫前已修正之);合格者皆過、無未能判定', () => {
            assert.deepEqual(out.audit, { RS1: ['rs1'], RS2: ['rs2'], RS3: ['rs3'], RS8: ['rs8'] })
            assert.deepEqual(out.auditPass, ['ok', 'okNum'])
            assert.equal(out.auditUndetermined, 0)
        })
    })

    // ══════════════════════════ ③上游之變更通知與 ctx 旗標 ══════════════════════════
    describe('③ 上游之變更通知與 ctx 旗標', function() {

        it('摘要套件之內容同步寫 knowledgeChangedAt(使用者改了一句話重點)→ 關聯段將該篇重入正向池重判(reTargets),記 relatedChangeAt＝knowledgeChangedAt;下一輪不再重判', async () => {
            const dir = dirOf('changed')
            const a = landNote(`${dir}/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差'] })
            const b = landNote(`${dir}/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差'] })
            const notes = memStore([a, b])
            const sdeps = { stores: { notes }, dirs: { state: `${dir}/state` }, clock: CLOCK, log: recLog(), vocab: resolveSummarizeVocab({}) }
            await syncNotes(sdeps, { all: true })
            const stores = { notes, relations: memStore([]) }
            const callAI = callAIOf(() => [])
            const r1 = await createRelateObject({ callAI }).run(ctxOf(subDeps(dir, stores)))
            assert.deepEqual([r1.detail.relate.detail.targets, r1.detail.relate.detail.reTargets], [2, 0])
            const md = readMd(a.file)
            assert.ok(md.body.includes('恆星視差之量測之重點'), '前提:一句話重點在 md')
            writeMd(a.file, md.front, md.body.replace('恆星視差之量測之重點', '修訂：以三角視差法量測恆星距離'))
            const s = await syncNotes(sdeps, { all: true })
            assert.equal(s.changed, 1)
            const kc = (await notes.get(a.id)).knowledgeChangedAt
            assert.match(kc, /^\d{4}-\d{2}-\d{2}T/)
            const r2 = await createRelateObject({ callAI }).run(ctxOf(subDeps(dir, stores)))
            assert.deepEqual([r2.detail.relate.detail.targets, r2.detail.relate.detail.reTargets], [1, 1])
            assert.equal((await notes.get(a.id)).relatedChangeAt, kc)
            const r3 = await createRelateObject({ callAI }).run(ctxOf(subDeps(dir, stores)))
            assert.equal(r3.detail.relate.detail.targets, 0, '同一版本不再重判')
        })

        it('同一管線內摘要之重標旗標(SUMMARIZE_CTX_FLAGS.tagChanged)→ 本輪無邊異動亦重建總覽(節點帶類別);無重標、無邊異動、未待重建 → 不重建', async () => {
            assert.equal(SUMMARIZE_CTX_FLAGS.tagChanged, 'notesTagChanged')
            const wd = dirOf('tag')
            const flagger = (n) => ({ name: 'retagProbe', run: async (ctx) => {
                if (n) ctx.set(SUMMARIZE_CTX_FLAGS.tagChanged, n)
                return stdReport()
            } })
            const stagesOf = (n) => [flagger(n), stageRelate(), stageRelateProject(), stageRelationIndex()]
            const notes = [['a', '恆星視差之量測'], ['b', '視差誤差之修正']].map(([doc, title]) => landNote(`${wd}/knowledge/notes`, { doc, title, concepts: ['視差'], record: { relatedAt: RELATED } }))
            const f0 = buildTestRelate(wd, { stages: stagesOf(0) }).flow
            await seedNotes(f0, notes, [makeEdge({ from: notes[0].id, to: notes[1].id, type: T0, reason: STUB_REASON, nowIso: OLD })])
            const r0 = await f0.run()
            assert.equal(subReport(r0, '關聯', 'relationIndex'), null, '無重標、無邊異動 → 不重建')
            assert.ok(!fs.existsSync(`${wd}/knowledge/relations/graph.json`))
            const r1 = await buildTestRelate(wd, { stages: stagesOf(2) }).flow.run()
            assert.equal(subReport(r1, '關聯', 'relationIndex').ok, true, '重標旗標 → 重建')
            const g = readJsonFile(`${wd}/knowledge/relations/graph.json`)
            assert.deepEqual(g.nodes.map((n) => n.category), ['方法與技術', '方法與技術'], '節點帶類別')
        })

        it('關聯之 ctx 旗標交下游(同一管線):邊庫世代不符 → relateBlocked 為 true、relateEdges 為 0、投影略過;正常輪之 relateEdges＝本輪邊之實際異動數', async () => {
            const seen = []
            const probe = { name: 'downstream', run: async (ctx) => {
                seen.push([ctx.get(RELATE_CTX_FLAGS.edgesChanged, null), ctx.get(RELATE_CTX_FLAGS.blocked, false)])
                return stdReport()
            } }
            const wd = dirOf('flags')
            const notes = [['a', '恆星視差之量測'], ['b', '視差誤差之修正']].map(([doc, title]) => landNote(`${wd}/knowledge/notes`, { doc, title, concepts: ['視差'] }))
            const bad = { ...makeEdge({ from: notes[0].id, to: notes[1].id, type: T0, reason: STUB_REASON, nowIso: OLD }), id: 'not-an-unordered-hash' }
            const f = buildTestRelate(wd, { stages: [stageRelate(), stageRelateProject(), probe] }).flow
            await seedNotes(f, notes, [bad])
            const rep = await f.run()
            assert.deepEqual(subReport(rep, '關聯', 'project').detail, { blocked: true })
            assert.deepEqual(seen, [[0, true]])
            const wd2 = dirOf('flags')
            const ai = scriptedAi((role, p, o, items) => (role === 'relate' ? relateAnswer(items, { 恆星視差之量測: [{ to: '視差誤差之修正', type: T0 }] }) : undefined))
            const f2 = buildTestRelate(wd2, { aiAdapter: ai, stages: [stageRelate(), stageRelateProject(), probe] }).flow
            await seedNotes(f2, [['a', '恆星視差之量測'], ['b', '視差誤差之修正']].map(([doc, title]) => landNote(`${wd2}/knowledge/notes`, { doc, title, concepts: ['視差'] })))
            await f2.run()
            assert.deepEqual(seen[1], [1, false])
        })
    })

    // ══════════════════════════ ④兩份依賴契約 ══════════════════════════
    describe('④ 依賴(deps)契約', function() {

        it('子階段之每輪依賴:只給 { stores:{ notes, relations }, clock, dirs:{ state, relations }, settings:{ ai, relate, relationIndexTitle }, ai, domains:{ relate } } 即可跑完三個子階段(不讀 data、vocab;holds／checks／cores 為選用);他總組裝之同形設定(另有他工作之段)亦可', async () => {
            const dir = dirOf('subdeps')
            const a = landNote(`${dir}/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差'] })
            const b = landNote(`${dir}/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差'] })
            const s = resolveRelateSettings({ ai: { parallel: 1 }, relate: { ai: { use: 'stub:a' } } })
            const settings = { ai: s.ai, relate: s.relate, relationIndexTitle: s.relationIndexTitle, summarize: { 他工作: true } }
            const deps = { stores: { notes: memStore([a, b]), relations: memStore([]) }, clock: CLOCK, dirs: { state: `${dir}/state`, relations: `${dir}/relations` }, settings, ai: null, domains: { relate: DOMAIN } }
            const callAI = callAIOf((t) => (t.title === '恆星視差之量測' ? [{ to: b.id, type: T0, reason: STUB_REASON }] : []))
            const rep = await createRelateObject({ callAI }).run(ctxOf(deps))
            assert.equal(rep.ok, true, JSON.stringify(rep.detail))
            assert.deepEqual(Object.keys(rep.detail), ['relate', 'project', 'relationIndex'])
            assert.equal(rep.detail.relate.detail.edges, 1)
            assert.equal(readMd(`${dir}/relations/index.md`).front.title, s.relationIndexTitle, '總覽之標題取 settings.relationIndexTitle')
            assert.match(fs.readFileSync(a.file, 'utf8'), /## 關聯/)
        })

        it('維運 API 之依賴:{ stores, dirs, clock, log?, domain } 即可執行明示刪除、還原、懸空清理、全庫投影;需 domain 之 op 缺 domain 即於任何寫入前拋(邊庫與記錄不變)', async () => {
            const dir = dirOf('opsdeps')
            const a = landNote(`${dir}/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差'], record: { relatedAt: RELATED } })
            const b = landNote(`${dir}/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差'], record: { relatedAt: RELATED } })
            const e = makeEdge({ from: a.id, to: b.id, type: T0, reason: STUB_REASON, nowIso: OLD })
            const stores = { notes: memStore([a, b]), relations: memStore([e]) }
            const deps = { stores, dirs: { state: `${dir}/state` }, clock: CLOCK, log: recLog(), domain: DOMAIN }
            const { domain: _d, ...noDomain } = deps
            for (const [op, fn] of [['deleteNote', () => deleteNote(noDomain, a.id, { reason: 'x' })], ['restoreNote', () => restoreNote(noDomain, a.id)], ['pruneDangling', () => pruneDangling(noDomain, { apply: true })], ['restoreEdge', () => restoreEdge(noDomain, e.id, { apply: true })], ['projectAll', () => projectAll(noDomain, { all: true })]]) {
                await assert.rejects(fn, { message: `${op} 需要 deps.domain（關聯 domain，createRelateDomain 之產物——撤邊之衝突事件、投影與還原之納入閘皆讀之）` }, op)
            }
            assert.deepEqual([(await stores.relations.select()).length, (await stores.notes.select()).length], [1, 2], '缺 domain 之 op 未寫任何東西')
            assert.ok(!fs.existsSync(`${dir}/state`), '缺 domain 之 op 未建任何帳')
            assert.deepEqual(await pruneDangling(noDomain), { dangling: 0, removed: 0, sample: [] }, '預演(只列出)不需 domain')
            const all = await projectAll(deps, { all: true })
            assert.equal(all.projected, 2)
            const del = await deleteNote(deps, a.id, { reason: '重複之筆記' })
            assert.deepEqual([del.edges, del.neighbors], [1, [b.id]])
            const back = await restoreNote(deps, a.id)
            assert.deepEqual([back.edgesRestored, back.edgesRejected], [1, []])
            assert.ok(deps.log.lines.some((l) => l.startsWith(`WARN 還原筆記 ${a.id}：未注入筆記標準閘`)), '未注入筆記標準閘 → WARN 原樣還原(呼叫端注入摘要套件之還原閘)')
        })
    })
})
