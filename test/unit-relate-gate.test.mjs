// unit-relate-gate.test.mjs — 關聯之納入閘與撤出單一實作(標準之定義見 standards/registry.mjs 之 RELATE_STANDARDS)
// 規格:檢定標準 RS1(結構)、RS1′(型別改名宣告:現值與 history 機械改寫、提煉認舊名)、RS2(理由形式;不靜默截斷——逾長於句界截並記錄)、
//   RS3(正體;只改違規處)、RS8(數字紮根;新進材料＝模型所見之區塊)、RS9(清單外型別:別名表對映或不納入,不落後備型別)、
//   RS7(撤出:事件帳、稽核理由、回驗、鄰接、反向帳、dirty;墓碑記理由)。
// 執行:自套件根 npx mocha test/unit-relate-gate.test.mjs(暫存 test/_tmp/relate-gate-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, memStore, genClockTZ, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { readConflictEvents } from '../src/stores/conflictEvents.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { admitRelation } from '../src/stages/relateChain.mjs'
import { makeEdge, edgeId, buildAdjacency, renameEdgeTypes, typeRankOf } from '../src/stores/edgeStore.mjs'
import { openRelateLedgers, readAuditRows, createTombstones } from '../src/stores/relateLedgers.mjs'
import { retireEdge, RETIRE_REASONS } from '../src/stores/edgeRetire.mjs'
import { rewriteEdge } from '../src/stores/edgeRewrite.mjs'
import { retiredEdgesOf } from '../src/stores/edgeAudit.mjs'
import { REASON_MAX_CHARS, cutReason, normalizeEdgeProposal, gateEdgeProposal } from '../src/standards/edgeGate.mjs'
import { checkEdge } from '../src/standards/edgeStandards.mjs'
import { createRelateObject } from '../src/relateObject.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const C = DOMAIN.conflictType
const [T0, T1] = DOMAIN.relationTypes.filter((t) => t !== C)
const AT = '2026-01-05T00:00:00+08:00'
const AT2 = '2026-01-06T00:00:00+08:00'
let seq = 0

/**
 * 關聯段環境(同 unit-relate-stage 之替身):筆記(含 md)、邊、依標題回腳本之 AI
 * @param {Object} o 輸入 { notes, edges, script:{標題:relations}, domain }
 * @returns {Object} 回傳 { ctx, notes, relations, log, run, state, dir }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const recs = (o.notes || []).map((n) => {
        const file = `${dir}/notes/${n.id}.md`
        const title = n.title || `標題${n.id}`
        writeMd(file, { title, slug: n.id }, `# ${title}\n\n## 一句話重點\n\n${n.summary || `${n.id} 之重點`}\n\n## 核心知識\n\n- 要點`)
        return { category: 'c', summary: `${n.id} 之重點`, relatedAt: '', concepts: ['p'], createdAt: '2026-01-01', ...n, title, file }
    })
    const notes = memStore(recs)
    const relations = memStore(o.edges || [])
    const log = recLog()
    const domain = o.domain || DOMAIN
    const deps = {
        stores: { notes, relations },
        settings: resolveRelateSettings({ ai: { parallel: 1, timeoutMs: 300_000, providerTimeouts: {} }, relate: { rounds: 1, notesPerCall: 6, candidatesPerNote: 15, ai: { use: 'stub:a' }, reverse: { perRun: 0 } } }),
        ai: null,
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: domain },
    }
    const ctx = bagCtx(deps, log)
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    const callAI = withCheck(async (prompt) => {
        const targets = [...prompt.matchAll(/^--- 第(\d+)篇（待建立關聯）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
        return { ok: true, data: targets.map((t) => ({ index: t.index, relations: (o.script || {})[t.title] || [] })), error: '', skipped: false, attempts: 1 }
    })
    return { ctx, notes, relations, log, run: () => stageRelate({ callAI }).run(ctx), state: () => openRelateLedgers(ctx.deps.dirs.state), dir }
}

describe('unit-relate-gate', function() {

    before(() => {
        TMP = tmpRoot('relate-gate')
    })
    after(() => removeRoots([TMP]))

    // 詞彙表之別名／改名表之規則(別名不在清單或改名表、值在清單;改名之舊名不在清單、終點在清單、可成鏈;預設皆空)由 unit-vocab 驗
    describe('詞彙表與 domain(RS9、RS1′)', function() {

        it('resolveType:清單內原樣(去頭尾空白)、改名循鏈、別名對映、其餘回 \'\'(不落後備型別);conflictTypeNames＝現名＋終點為衝突型之舊名', () => {
            const d = createRelateDomain({ vocab: { relationTypeRenames: { 舊衝突: C, 甲型: '乙型', 乙型: T0 }, relationTypeAliases: { 衝突: C } } })
            assert.deepEqual([d.resolveType(` ${T1} `), d.resolveType('甲型'), d.resolveType('衝突'), d.resolveType('互製搭配'), d.resolveType('')], [T1, T0, C, '', ''])
            assert.deepEqual(d.conflictTypeNames, [C, '舊衝突'])
            assert.deepEqual(DOMAIN.conflictTypeNames, [C])
            assert.deepEqual(DOMAIN.vagueReasons, ['都與某主題有關', '同屬某一大領域'])
        })

        it('seenTextOf 與 buildPrompt 同一組字(提示詞格式釘住:評比題目識別不變)', () => {
            const t = { id: 't-1', title: '甲', category: '方法', evidenceLevel: '中', caveats: ['單一市場'], concepts: ['動量', '回測'], summary: '年化 8.2%' }
            const c = { id: 'c-1', title: '乙', category: '資料', concepts: ['成交量'], summary: '乙'.repeat(100) }
            const p = DOMAIN.buildPrompt([t], new Map([['t-1', [c]]]))
            const block = [
                '--- 第1篇（待建立關聯）---',
                '標題：甲',
                '類別：方法｜證據:中｜⚠單一市場',
                '概念：動量、回測',
                '重點：年化 8.2%',
                '候選關聯對象：',
                `  - slug: c-1｜標題: 乙｜類別: 資料｜證據:未評估｜概念: 成交量｜重點: ${'乙'.repeat(80)}...`,
            ].join('\n')
            assert.ok(p.endsWith(block), p.slice(-400))
            assert.equal(DOMAIN.seenTextOf(t, 'target'), block.split('\n').slice(1, 5).join('\n'))
            assert.equal(`  - ${DOMAIN.seenTextOf(c, 'candidate')}`, block.split('\n')[6])
            const rp = DOMAIN.buildReevalPrompt([{ target: t, summary: '全文重點', neighbors: [{ note: c, edge: { type: T0, reason: '舊理由' } }] }])
            assert.ok(rp.includes(`${DOMAIN.seenTextOf(t, 'reevalTarget', { summary: '全文重點' })}\n既有關聯：\n  - ${DOMAIN.seenTextOf(c, 'reevalNeighbor', { edge: { type: T0, reason: '舊理由' } })}`))
            // 重評之不確定(判定小組之合法裁決;2026-10-05 審查 A-B1):有 unsure 選項與範例,不再「拿不準一律 keep」
            for (const s of ['1. keep：', '2. change：', '3. retire：', '5. unsure：', '拿不準就回 unsure，不要猜，也不要用 keep 代替不確定', '"verdict":"unsure"']) assert.ok(rp.includes(s), s)
            assert.doesNotMatch(rp, /拿不準一律 keep/)
        })

        it('衝突核對(RS4)提示詞:各方區塊＝seenTextOf(checkSide)(RS8 之核對席材料同一組字)、清單各至多 8／6 條、項編號由呼叫端給;判準與四種裁決(含 unsure)、「理由須寫出雙方之具體主張」明文', () => {
            const a = { id: 'a', title: '甲', category: '方法', evidenceLevel: '中', concepts: ['動量'], summary: '紀錄之摘要' }
            const b = { id: 'b', title: '乙', category: '資料', concepts: ['成交量'], summary: '乙之摘要' }
            const ea = { summary: '甲之一句話重點全文', keyPoints: Array.from({ length: 10 }, (_, i) => `要點${i + 1}`), conditions: ['條件一'] }
            const p = DOMAIN.buildConflictCheckPrompt([{ index: 7, a: { note: a, extra: ea }, b: { note: b, extra: {} }, edge: { type: C, reason: '甲說 X；乙說 Y' } }])
            const block = ['--- 第7項 ---', '【甲】', DOMAIN.seenTextOf(a, 'checkSide', ea), '【乙】', DOMAIN.seenTextOf(b, 'checkSide', {}), `現行型別：${C}`, '現行理由：甲說 X；乙說 Y'].join('\n')
            assert.ok(p.endsWith(block), p.slice(-500))
            assert.match(DOMAIN.seenTextOf(a, 'checkSide', ea), /^標題：甲\n類別：方法｜證據:中\n概念：動量\n一句話重點：甲之一句話重點全文\n核心知識：\n- 要點1\n[\s\S]*- 要點8\n適用條件與限制：\n- 條件一$/)
            assert.doesNotMatch(DOMAIN.seenTextOf(a, 'checkSide', ea), /要點9/, '核心知識至多 8 條')
            assert.equal(DOMAIN.seenTextOf(b, 'checkSide', {}), '標題：乙\n類別：資料｜證據:未評估\n概念：成交量\n一句話重點：乙之摘要', 'md 讀不到者用記錄之 summary、無清單')
            for (const s of ['真衝突＝甲乙對同一個問題給出相反的結論', '都不是衝突', '1. keep：', '2. change：', '3. retire：', '4. unsure：', '拿不準就回 unsure，不要猜', '沒有」寫出雙方各自的具體主張', '不要為了把理由寫得更完整而改用 change']) assert.ok(p.includes(s), s)
        })
    })

    describe('納入閘(edgeGate)', function() {

        const ctx = (material = {}) => ({ resolveType: DOMAIN.resolveType, relationTypes: DOMAIN.relationTypes, vague: DOMAIN.vagueReasons, hasNote: (id) => id !== 'gone', materialOf: (id) => (id in material ? material[id] : '') })
        const P = (o) => makeEdge({ from: 'a', to: 'b', type: T0, reason: 'a 之訊號以 b 之報酬拆解為前提', nowIso: AT, ...o })

        it('cutReason:≤上限不動;逾上限截至上限內最後一個句界;句界前不足 10 字或無句界 → 不截(不靜默截斷)', () => {
            assert.deepEqual(cutReason('甲說動量在台股長期有效。乙說扣除成本後無效。', 14), { reason: '甲說動量在台股長期有效。', cut: true, from: 22 })
            assert.deepEqual(cutReason('甲說動量有效。乙說無效。', 8).cut, false, '截後不足 10 字:不截')
            assert.deepEqual(cutReason(`${'甲'.repeat(150)}。${'乙'.repeat(100)}`).cut, true)
            assert.equal([...cutReason(`${'甲'.repeat(150)}。${'乙'.repeat(100)}`).reason].length, 151)
            assert.deepEqual(cutReason(`甲。${'乙'.repeat(300)}`).cut, false, '句界前不足 10 字:不截')
            assert.deepEqual(cutReason('乙'.repeat(300)).cut, false, '無句界:不截')
            assert.equal(cutReason('  甲   乙  ').reason, '甲 乙', '去多餘空白')
            assert.equal(REASON_MAX_CHARS, 200)
        })

        it('合格者原樣納入;可確定性修正者(別名、簡體、逾長)修正後納入並記錄;history 之型別與理由同步正規化', () => {
            const ok = gateEdgeProposal(P(), ctx())
            assert.deepEqual([ok.ok, ok.fixes, ok.reasons], [true, [], []])
            const d = createRelateDomain({ vocab: { relationTypeAliases: { 前置: T0 } } })
            const fx = gateEdgeProposal(P({ type: '前置', reason: `a 之讯号以 b 之报酬拆解为前提。${'乙'.repeat(200)}` }), { ...ctx(), resolveType: d.resolveType })
            assert.equal(fx.ok, true, fx.reasons.join('；'))
            assert.deepEqual([fx.edge.type, fx.edge.reason], [T0, 'a 之訊號以 b 之報酬拆解為前提。'])
            assert.deepEqual(fx.fixes, [`型別「前置」→「${T0}」`, '理由轉正體', '理由 218 字逾 200，於句界截為 18 字'])
            const n = normalizeEdgeProposal({ ...P(), history: [{ from: 'b', to: 'a', type: T1, reason: '旧理由', createdAt: AT }] }, { resolveType: DOMAIN.resolveType })
            assert.deepEqual([n.edge.history[0].reason, n.fixes.at(-1)], ['舊理由', 'history 1 筆之型別或理由已正規化'])
        })

        it('不納入:清單外型別(無對映)、端點不存在、自指、佔位或空泛理由、數字不見於材料、材料不可得而理由含數字(未能判定);與符合度掃描同一判定(checkEdge)', () => {
            const r = (p, m) => gateEdgeProposal(P(p), ctx(m)).reasons.join('；')
            assert.match(r({ type: '互製搭配' }), /^型別「互製搭配」不在清單、亦無改名或別名對映$/, '此前落後備型別(2026-10-04 正式日誌 16 次)')
            assert.match(r({ to: 'gone' }), /^RS1 端點不存在：gone/)
            assert.match(r({ to: 'a' }), /^RS1 自指/)
            assert.match(r({ reason: '同上' }), /^RS2 佔位理由「同上」/)
            assert.match(r({ reason: '都與某主題有關，同屬某一大領域' }), /^RS2 去空泛片語與標點後只剩 0 字/)
            assert.match(r({ reason: 'a 之動量訊號延伸 b 之夏普 1.9 結論' }, { a: '年化 8.2%', b: '夏普 1.2' }), /^RS8 兩端皆無之數字：1\.9/)
            assert.equal(r({ reason: 'a 之動量訊號延伸 b 之夏普 1.2 結論' }, { a: '年化 8.2%', b: '夏普 1.2' }), '', '數字見於任一端之材料')
            assert.match(r({ reason: 'a 之動量訊號延伸 b 之夏普 1.2 結論' }, { a: null, b: '夏普 1.2' }), /^RS8 未能判定（端點材料不可得）/, '未能判定不得算合格')
            // 判定與掃描同一函數:閘之結論等於 checkEdge 於正規化後之結果
            const p = P({ reason: '同上' })
            const viaScan = checkEdge(normalizeEdgeProposal(p, ctx()).edge, ctx()).filter((x) => x.status !== 'pass').map((x) => x.std)
            assert.deepEqual(viaScan, ['RS2'])
        })
    })

    describe('正向與反向之接線(relateStage)', function() {

        it('buildEdges:逐條過閘——別名對映、簡體修正後納入(計 edgeStdFixed);清單外型別、空泛理由、無據數字不納入(計 edgeStdRejected);RS8 材料＝模型所見(候選重點只見前 80 字)', async () => {
            const domain = createRelateDomain({ vocab: { relationTypeAliases: { 互補: '互補搭配' } } })
            const e = env({
                domain,
                notes: [
                    { id: 't', title: '目標', concepts: ['p'], summary: '動量年化 8.2%' },
                    { id: 'b1', concepts: ['p'], relatedAt: '2026-01-02', summary: '夏普 1.2 之動量策略' },
                    { id: 'b2', concepts: ['p'], relatedAt: '2026-01-02', summary: `${'甲'.repeat(85)}夏普 3.4` },
                    { id: 'b3', concepts: ['p'], relatedAt: '2026-01-02' },
                    { id: 'b4', concepts: ['p'], relatedAt: '2026-01-02' },
                    { id: 'b5', concepts: ['p'], relatedAt: '2026-01-02' },
                ],
                script: {
                    目標: [
                        { to: 'b1', type: '互補', reason: '目标之动量讯号与 b1 夏普 1.2 之策略互补' },
                        { to: 'b2', type: T0, reason: '目標之動量延伸 b2 之夏普 3.4 結論' },
                        { to: 'b3', type: '互製搭配', reason: '目標與 b3 共用同一組成交量指標' },
                        { to: 'b4', type: T0, reason: '都與某主題有關' },
                        { to: 'b5', type: T1, reason: '目標之 8.2% 年化報酬延伸 b5 之回測框架' },
                    ],
                },
            })
            const r = await e.run()
            assert.deepEqual([r.detail.edges, r.detail.edgeStdFixed, r.detail.edgeStdRejected], [2, 1, 3], JSON.stringify(r.detail))
            const b1 = await e.relations.get(edgeId('t', 'b1'))
            assert.deepEqual([b1.type, b1.reason], ['互補搭配', '目標之動量訊號與 b1 夏普 1.2 之策略互補'])
            assert.ok(await e.relations.get(edgeId('t', 'b5')), '數字見於目標區塊(模型所見)')
            assert.equal(await e.relations.get(edgeId('t', 'b2')), null, '3.4 在候選重點第 85 字後:模型沒看到 → 無據')
            assert.ok(e.log.lines.some((l) => /^INFO 關聯：\[t\] 3 條關聯項目未達標準，不納入、其餘照收（.*型別「互製搭配」不在清單/.test(l)))
            assert.ok(e.log.lines.some((l) => /修正後納入（型別「互補」→「互補搭配」；理由轉正體）/.test(l)))
        })

        it('過閘後之丟棄不靜默(審查 A-A11、B-M5;終審採 P3-2):單篇上限截去之合格關聯計 relateCapDropped、同一對象多條只取一條計 relateDupDropped,皆 INFO 列出被捨之對;截取規則不變(衝突優先保留)', async () => {
            const nb = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']
            const R = (id) => `目標與 ${id} 共用同一組成交量指標與回看期設定`
            const e = env({
                notes: [{ id: 't', title: '目標', concepts: ['p'] }, ...nb.map((id) => ({ id, concepts: ['p'], relatedAt: '2026-01-02' }))],
                script: {
                    目標: [
                        ...nb.slice(0, 5).map((id) => ({ to: id, type: T0, reason: R(id) })),
                        { to: 'b6', type: C, reason: '甲說動量於高波動期失效；乙說動量於高波動期反而更強' },
                        { to: 'b1', type: T1, reason: R('b1') }, // 同一對象之第二條(非衝突、後到)→ 捨去
                    ],
                },
            })
            const r = await e.run()
            assert.deepEqual([r.detail.edges, r.detail.relateCapDropped, r.detail.relateDupDropped, r.detail.conflicts], [4, 2, 1, 1], JSON.stringify(r.detail))
            assert.ok(await e.relations.get(edgeId('t', 'b6')), '衝突優先保留')
            assert.equal(await e.relations.get(edgeId('t', 'b5')), null)
            assert.ok(e.log.lines.some((l) => /^INFO 關聯：\[\[t\]\] 合格關聯 6 條逾單篇上限 4（衝突優先保留），截去 2 條（\[\[b4\]\]〔.+〕、\[\[b5\]\]〔.+〕）$/.test(l)), e.log.lines.join('\n'))
            assert.ok(e.log.lines.some((l) => new RegExp(`^INFO 關聯：\\[\\[t\\]\\] 同一對象有多條合格關聯（衝突優先、否則取先到者），捨去 1 條（\\[\\[b1\\]\\]〔${T1}〕）$`).test(l)), e.log.lines.join('\n'))
        })

        it('理由截短之明示(審查 A-B21):納入閘於句界截短者,提案記 reasonCut＝原字數並隨邊落庫;未截短者無此鍵', async () => {
            const long = `目標之動量訊號延伸 b1 之回看期設定。${'並且說明其參數選擇之細節與適用之市場環境，'.repeat(12)}`
            const gctx = { resolveType: DOMAIN.resolveType, relationTypes: DOMAIN.relationTypes, vague: DOMAIN.vagueReasons, hasNote: () => true, materialOf: () => '' }
            const prop = (reason) => makeEdge({ from: 'a', to: 'b', type: T0, reason, nowIso: AT })
            const g = gateEdgeProposal(prop(long), gctx)
            assert.deepEqual([g.ok, g.edge.reason, g.edge.reasonCut], [true, '目標之動量訊號延伸 b1 之回看期設定。', [...long].length])
            assert.equal('reasonCut' in gateEdgeProposal(prop('a 之訊號以 b 之報酬拆解為前提'), gctx).edge, false)
            const e = env({ notes: [{ id: 't', title: '目標', concepts: ['p'] }, { id: 'b1', concepts: ['p'], relatedAt: '2026-01-02' }], script: { 目標: [{ to: 'b1', type: T0, reason: long }] } })
            await e.run()
            const got = await e.relations.get(edgeId('t', 'b1'))
            assert.deepEqual([got.reason, got.reasonCut], ['目標之動量訊號延伸 b1 之回看期設定。', [...long].length])
        })

        it('關聯物件摘要:句尾附「｜標準修正 N、未達標準 N 條」(>0 才附;契約前段不變)', async () => {
            const e = env({
                notes: [{ id: 't', title: '目標', concepts: ['p'] }, { id: 'b1', concepts: ['p'], relatedAt: '2026-01-02' }, { id: 'b2', concepts: ['p'], relatedAt: '2026-01-02' }],
                script: { 目標: [{ to: 'b1', type: T0, reason: '目标之动量讯号以 b1 之报酬拆解为前提' }, { to: 'b2', type: '互製搭配', reason: '目標與 b2 共用同一組成交量指標' }] },
            })
            const callAI = withCheck(async (p) => {
                const targets = [...p.matchAll(/^--- 第(\d+)篇（待建立關聯）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
                return { ok: true, data: targets.map((t) => ({ index: t.index, relations: t.title === '目標' ? [{ to: 'b1', type: T0, reason: '目标之动量讯号以 b1 之报酬拆解为前提' }, { to: 'b2', type: '互製搭配', reason: '目標與 b2 共用同一組成交量指標' }] : [] })), error: '', skipped: false, attempts: 1 }
            })
            const rep = await createRelateObject({ relate: { callAI } }).run(e.ctx)
            assert.match(rep.summary, /^處理 1、關聯 1 條、衝突 0 組（AI 1 次）.*｜標準修正 1、未達標準 1 條$/, rep.summary)
        })

        it('整項之關聯皆未達標準 → 未涵蓋(relateTries＋1、relatedAt 不寫、下輪再判);relations 為空 → 合法(零條)', async () => {
            const e = env({
                notes: [{ id: 't', title: '目標', concepts: ['p'] }, { id: 'z', title: '零', concepts: ['p'] }, { id: 'b', concepts: ['p'], relatedAt: '2026-01-02' }],
                script: { 目標: [{ to: 'b', type: '互製搭配', reason: '目標與 b 共用同一組成交量指標' }], 零: [] },
            })
            const r = await e.run()
            assert.deepEqual([r.detail.targets, r.detail.missed, r.detail.edges], [1, 1, 0], JSON.stringify(r.detail))
            const t = await e.notes.get('t')
            assert.deepEqual([t.relateTries, t.relatedAt], [1, ''])
            assert.ok((await e.notes.get('z')).relatedAt, '空陣列＝評估完、零條')
        })

        it('admitRelation:slug 解析不到、指向自身不進閘;尾碼救回標記 rescued', () => {
            const o = { target: { id: 't-aaaaaaaa' }, resolve: (raw) => (String(raw).endsWith('bbbbbbbb') ? 'b-bbbbbbbb' : null), candidates: new Map([['b-bbbbbbbb', { id: 'b-bbbbbbbb' }]]), domain: DOMAIN, hasNote: () => true, nowIso: AT }
            assert.deepEqual(admitRelation({ to: 'x', type: T0, reason: '目標與 b 共用同一組成交量指標' }, o).reasons, ['slug 解析不到（x）'])
            assert.equal(admitRelation({ to: 'bb-bbbbbbbb', type: T0, reason: '目標與 b 共用同一組成交量指標' }, o).rescued, true)
            assert.deepEqual(admitRelation({ to: 't-aaaaaaaa', type: T0, reason: 'x' }, { ...o, resolve: () => 't-aaaaaaaa' }).reasons, ['指向自身'])
            assert.deepEqual(admitRelation(null, o).reasons, ['項目非物件'])
        })
    })

    describe('撤出單一實作(retireEdge)與墓碑', function() {

        it('順序與副作用:兩端(現存者)dirty、總覽待重建、衝突型(含舊名)寫事件帳、稽核含理由、刪、回驗、鄰接表、反向帳;理由不在清單即拋錯', async () => {
            const dir = `${TMP}/r${++seq}`
            const ledgers = openRelateLedgers(dir)
            const e1 = makeEdge({ from: 'a', to: 'b', type: C, reason: '甲說有效、乙說無效之衝突', nowIso: AT })
            const e2 = makeEdge({ from: 'a', to: 'c', type: '舊衝突', reason: '舊名之衝突邊理由', nowIso: AT })
            const e3 = makeEdge({ from: 'a', to: 'd', type: T0, reason: '一般邊之理由文字', nowIso: AT })
            const relations = memStore([e1, e2, e3])
            const adj = buildAdjacency([e1, e2, e3])
            ledgers.reverse.add([{ o: 'b', n: 'a', score: 1, at: 't' }, { o: 'c', n: 'x', score: 1, at: 't' }])
            const deps = { relations, ledgers, stateDir: dir }
            await assert.rejects(() => retireEdge(deps, e1, { reason: 'whatever', at: AT }), /retireEdge 之理由「whatever」不在清單/)
            const names = [C, '舊衝突']
            for (const e of [e1, e2, e3]) await retireEdge(deps, e, { reason: 'std-retire', at: AT, detail: 'RS2 理由空泛', conflictTypes: names, hasNote: (id) => id !== 'd', adj })
            assert.deepEqual((await relations.select()).length, 0)
            assert.deepEqual(readConflictEvents(dir).map((x) => [x.edgeId, x.kind, x.oldType, x.reason]), [[e1.id, 'retire', C, 'RS2 理由空泛'], [e2.id, 'retire', '舊衝突', 'RS2 理由空泛']], '一般邊不寫事件')
            assert.deepEqual(readAuditRows(ledgers.files.retired).map((x) => [x.reason, x.detail, x.edge.id]), [e1, e2, e3].map((e) => ['std-retire', 'RS2 理由空泛', e.id]))
            assert.deepEqual([ledgers.dirty.ids(), ledgers.state.get().indexDirty, adj.get('a').size, ledgers.reverse.pairs().map((p) => p.o)], [['a', 'b', 'c'], true, 0, ['c']])
            // 封閉清單(rs4-retire／rs4-quarantine:衝突核對 RS4 之撤銷與隔離,2026-10-04 D 段;rs6-retire／rs6-quarantine:既有邊覆核 RS6,2026-10-05)
            //   reprocess:使用端依產出鏈選件(ops/provenanceOps)後撤出重處理之理由(只登記常數,撤出流程不變;邊之產出鏈見 unit-relate-provenance)
            assert.deepEqual(RETIRE_REASONS, ['note-deleted', 'prune-dangling', 'reeval-retire', 'std-retire', 'rs4-retire', 'rs4-quarantine', 'rs6-retire', 'rs6-quarantine', 'reprocess'])
            // 回驗:刪不掉即拋錯
            const stuck = { get: async () => e1, del: async () => {} }
            await assert.rejects(() => retireEdge({ ...deps, relations: stuck }, e1, { reason: 'std-retire', at: AT }), /撤出後回驗仍在/)
        })

        // 2026-10-12 關聯套件審計終審 D4(P2):改寫與記帳之單一實作——重評、既有邊覆核、衝突核對同一件;降級事件之判準一份(含衝突型舊名)
        it('改寫單一實作(rewriteEdge)與帳之 touch:兩端(has 篩出現存者)dirty＋總覽待重建 → 衝突型(含舊名)改為非衝突型寫降級事件 → 改寫(舊值入 history)→ 鄰接表;衝突型之間、一般邊不寫事件', async () => {
            const dir = `${TMP}/r${++seq}`
            const ledgers = openRelateLedgers(dir)
            ledgers.touch(['x', 'y'], { has: (id) => id !== 'y' })
            assert.deepEqual([ledgers.dirty.ids(), ledgers.state.get().indexDirty], [['x'], true], 'touch:篩後記待投影、總覽待重建成對')
            const e1 = makeEdge({ from: 'a', to: 'b', type: '舊衝突', reason: '舊名之衝突邊理由', nowIso: AT })
            const e2 = makeEdge({ from: 'a', to: 'c', type: C, reason: '甲說有效、乙說無效之衝突', nowIso: AT })
            const relations = memStore([e1, e2])
            const adj = buildAdjacency([e1, e2])
            const deps = { relations, ledgers, stateDir: dir }
            const o = { rank: () => 0, at: AT2, conflictTypes: [C, '舊衝突'], hasNote: (id) => id !== 'c', adj, note: 'n9' }
            const p1 = makeEdge({ from: 'a', to: 'b', type: T0, reason: '改判為一般關係之理由', nowIso: AT2 })
            const w1 = await rewriteEdge(deps, e1, p1, o)
            const p2 = makeEdge({ from: 'a', to: 'c', type: C, reason: '衝突之理由改寫為更精確之敘述', nowIso: AT2 })
            const w2 = await rewriteEdge(deps, e2, p2, o)
            assert.deepEqual([w1.conflictEvent, w2.conflictEvent], [true, false])
            assert.deepEqual(readConflictEvents(dir).map((x) => [x.edgeId, x.kind, x.oldType, x.newType, x.note]), [[e1.id, 'downgrade', '舊衝突', T0, 'n9']])
            const s1 = await relations.get(e1.id)
            assert.deepEqual([s1.type, s1.reason, (s1.history || []).some((h) => h.reason === e1.reason), (await relations.get(e2.id)).reason], [T0, p1.reason, true, p2.reason])
            assert.deepEqual([ledgers.dirty.ids(), adj.get('a').get('b')?.type], [['a', 'b', 'x'], T0], 'c 不在 → 不記;鄰接表同步')
        })

        it('retiredEdgesOf(撤出稽核之判定,單一來源):依寫入序,每條邊之最後一筆為撤出(任何理由)者在撤出中、取該筆;最後一筆為還原(restored)者不在其列;無邊 id 之列略過', () => {
            const rows = [
                { at: 't1', reason: 'std-retire', edge: { id: 'e1' } },
                { at: 't2', reason: 'reeval-retire', edge: { id: 'e2' } },
                { at: 't3', reason: 'restored', restoredFrom: 'reeval-retire', edge: { id: 'e2' } },
                { at: 't4', reason: 'rs4-retire', edge: { id: 'e1' } },
                { at: 't5', reason: 'restored', edge: { id: 'e3' } },
                { at: 't6', reason: 'prune-dangling', edge: {} },
                null,
                { at: 't7', reason: 'rs6-quarantine', edge: { id: 'e2' } },
            ]
            const m = retiredEdgesOf(rows)
            assert.deepEqual([...m.keys()].sort(), ['e1', 'e2'])
            assert.deepEqual([m.get('e1').at, m.get('e1').reason, m.get('e2').at, m.get('e2').reason], ['t4', 'rs4-retire', 't7', 'rs6-quarantine'], '取最後一筆;還原後又撤出者在撤出中')
            assert.deepEqual([retiredEdgesOf(null).size, retiredEdgesOf('x').size], [0, 0])
        })

        it('墓碑記時刻與理由:{ ids:{ id:{ at, reason } } };缺檔＝空帳', () => {
            const f = `${TMP}/tomb-${++seq}.json`
            const t = createTombstones(f)
            t.add('n1', AT, '內容與 n2 重複')
            assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { ids: { n1: { at: AT, reason: '內容與 n2 重複' } } })
            const t2 = createTombstones(f)
            assert.deepEqual([t2.has('n1'), t2.at('n1'), t2.reasonOf('n1'), t2.has('n9'), t2.reasonOf('n9')], [true, AT, '內容與 n2 重複', false, ''])
        })
    })

    describe('型別改名(RS1′)', function() {

        it('renameEdgeTypes:現值與 history 之舊型別改名、id 與 updatedAt 不動;改名後與現值同身分之 history 移出;無舊名回 null', () => {
            const rank = typeRankOf({ relationTypes: DOMAIN.relationTypes, conflictType: C, fallbackType: DOMAIN.fallbackType })
            const renamed = (t) => ({ 舊型: T0, 舊二: T1 }[t] || '')
            const e = { ...makeEdge({ from: 'a', to: 'b', type: '舊型', reason: '現值理由', nowIso: AT }), updatedAt: '2026-01-06T00:00:00+08:00', history: [{ from: 'a', to: 'b', type: T0, reason: '同身分舊提案', createdAt: '2026-01-01' }, { from: 'b', to: 'a', type: '舊二', reason: '敗方', createdAt: '2026-01-02' }] }
            const r = renameEdgeTypes(e, renamed, { rank })
            assert.deepEqual([r.id, r.type, r.reason, r.updatedAt], [e.id, T0, '現值理由', '2026-01-06T00:00:00+08:00'])
            assert.deepEqual(r.history.map((h) => [h.from, h.type]), [['b', T1]], '改名後與現值同身分者移出')
            assert.equal(renameEdgeTypes(makeEdge({ from: 'a', to: 'b', type: T0, reason: 'x', nowIso: AT }), renamed, { rank }), null)
        })

        it('關聯段維護:改名表宣告之舊型別 → 既有邊改寫(兩端 dirty、計 typeRenamed、updatedAt 不動);未宣告之清單外型別只告警(提煉認舊名見 unit-extract-lineage)', async () => {
            const domain = createRelateDomain({ vocab: { relationTypeRenames: { 舊衝突: C, 舊前置: T0 } } })
            const old1 = { ...makeEdge({ from: 'a', to: 'b', type: '舊衝突', reason: '甲說有效、乙說無效之衝突', nowIso: AT }) }
            const old2 = makeEdge({ from: 'a', to: 'c', type: '舊前置', reason: 'a 之定義是理解 c 之前置', nowIso: AT })
            const off = makeEdge({ from: 'b', to: 'c', type: '未宣告型', reason: 'b 與 c 共用同一組指標', nowIso: AT })
            const e = env({ domain, notes: ['a', 'b', 'c'].map((id) => ({ id, relatedAt: '2026-01-02' })), edges: [old1, old2, off] })
            const r = await e.run()
            assert.equal(r.detail.typeRenamed, 2, JSON.stringify(r.detail))
            const a = await e.relations.get(old1.id)
            assert.deepEqual([a.type, a.updatedAt], [C, AT])
            assert.equal((await e.relations.get(old2.id)).type, T0)
            assert.equal((await e.relations.get(off.id)).type, '未宣告型', '未宣告者不改寫')
            assert.ok(e.log.lines.some((l) => /^WARN 關聯型別不在現行清單：「未宣告型」1 條/.test(l)))
            assert.deepEqual(e.state().dirty.ids(), ['a', 'b', 'c'])
            assert.ok(e.log.lines.some((l) => /依型別改名表改寫既有邊 2 條/.test(l)))
            const r2 = await e.run()
            assert.equal(r2.detail.typeRenamed, 0, '已改寫者不再改寫')
        })
    })
})
