// unit-relate-audit.test.mjs — 關聯檢定標準之符合度掃描(standards/audit):四態計數與完整 id、與新進閘同一判定(以 domain 判)、資訊項、豁免、
//   RS8 之材料、AI 標準之列、範圍與上限、唯讀、真 LMDB
// 規則(出自 standards/audit 檔頭與 JSDoc):
//   ①逐標準:總量、四態、版本、完整 id;md 讀不到 → 理由含數字之邊之 RS8 未能判定(不報為零)
//   ②判定之型別清單與空泛片語一律取關聯 domain(與納入閘同一份;注入之 domain 亦然)——不另由詞彙表組一份;缺 domain 即拋
//   ③RS1／RS2／RS8 之資訊項:history 條目之違反與理由之句界截短計 info／infos,不算違反;種類之顯示名唯一在 EDGE_INFO_LABELS
//   ④不合格／未能判定而有使用者豁免(holds waived;鍵 edge:<邊 id>:<標準>,或覆核待判 RS6／RS4 之豁免而其來源 ctx.stockStd 為 RS1／RS2／RS3／RS8——
//     standards/edgeQueue 之 stockWaiverKeyOf)→ 已豁免(逐一列出,不算合格);未結之登錄不是豁免;合格者不因豁免改記
//   ⑤RS8 之材料＝兩端筆記之內容章＋原文標題(關聯兩章與來源章之他行不計);opt.materialOf 給了即以之為準(不讀 md);opt.onNote 給了即全量走訪
//     (每篇讀得到 md 者回呼一次);material:false 不讀材料——理由含數字者未能判定並註明;範圍不含 RS8 者不取材料
//   ⑥AI 標準:RS4／RS6 取檢核紀錄之已檢、四態、版本過時與待判之未結／已豁免;RS5 只取待判(檢核之欄 null);來源集合未給 → 欄 null、皆未給 → 列 null
//   ⑦唯讀:不寫任何檔案與集合
// 承接原實作 unit-standards-modules:246(四態與完整 id 之 RS2 部分)、:271(邊之資訊項)、:329(豁免映射與 AI 標準之 RS 部分)之斷言;其餘為新增。
// 執行:自套件根 node <mocha> test/unit-relate-audit.test.mjs(暫存 test/_tmp/relate-audit-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { readMd, writeMd, noteMaterialText } from '../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'
import { checkEdge, EDGE_INFO_LABELS } from '../src/standards/edgeStandards.mjs'
import { gateEdgeProposal } from '../src/standards/edgeGate.mjs'
import { RS4 } from '../src/stores/conflictCheckPolicy.mjs'
import { RS6 } from '../src/stores/edgeReviewPolicy.mjs'
import { RS5 } from '../src/stores/relateHolds.mjs'
import { RELATE_STANDARDS } from '../src/standards/registry.mjs'
import { auditRelateStandards, createMaterialReader, RELATE_AUDITED_STANDARD_IDS, RELATE_AI_STANDARD_IDS } from '../src/standards/audit.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let TMP = ''
const AT = '2026-10-08T10:00:00+08:00'
const DOMAIN = createRelateDomain({})
const T = '互補搭配'
const C = DOMAIN.conflictType
let seq = 0

const BODY = (o = {}) => [
    `# ${o.title || '標題'}`, '',
    '## 一句話重點', '', o.summary ?? '重點一句', '',
    '## 核心知識', '', ...(o.points || ['- 要點']), '',
    '## 來源', '', `- 原文標題：${o.origTitle || '原文'}`, '- 網址：https://x.test/a', '',
    ...(o.rel ? ['## 關聯', '', o.rel, ''] : []),
].join('\n')

/**
 * 暫存目錄(每案一個)
 * @returns {String} 回傳目錄路徑
 */
const dirOf = () => {
    const d = `${TMP}/e${++seq}`
    fs.mkdirSync(d, { recursive: true })
    return d
}

/**
 * 寫一篇筆記之 md 並回傳其記錄(o.missing 為真者不寫 md:md 讀不到)
 * @param {String} dir 輸入目錄
 * @param {String} id 輸入筆記 id
 * @param {Object} [o={}] 輸入 BODY 之覆寫＋{ missing }
 * @returns {Object} 回傳筆記記錄
 */
const mkNote = (dir, id, o = {}) => {
    const file = `${dir}/notes/${o.missing ? `missing-${id}` : id}.md`
    if (!o.missing) writeMd(file, { title: o.title || `標題${id}`, slug: id }, BODY({ title: `標題${id}`, ...o }))
    return { id, title: o.title || `標題${id}`, file, createdAt: AT }
}
const E = (from, to, reason, extra = {}) => ({ ...makeEdge({ from, to, type: extra.type || T, reason, nowIso: AT }), ...extra })
const ids = (list) => list.map((x) => x.id)

/**
 * 每筆判定恰歸一態、列表與計數一致(未給 maxIds 時)
 * @param {Object} b 輸入一條標準之掃描結果
 */
const wellFormed = (b) => {
    assert.equal(b.total, b.pass + b.violation + b.undetermined + b.na + b.waived, `${b.id}:total＝四態＋豁免`)
    assert.deepEqual([b.violations.length, b.undetermineds.length, b.waiveds.length], [b.violation, b.undetermined, b.waived], `${b.id}:列表與計數`)
}

/**
 * 掃描之夾具:n1～n6 有 md、n7 之 md 讀不到;邊 g1～g11(各標準之合格／不合格／未能判定、資訊項)
 * @param {String} dir 輸入目錄
 * @returns {Object} 回傳 { notes:Array, edges:Array, g:{ 名: 邊 } }
 */
function fixture(dir) {
    const notes = [
        mkNote(dir, 'n1', { points: ['- 觀測週期為 12 個月'], origTitle: '彗星軌道研究' }),
        mkNote(dir, 'n2', { points: ['- 樣本含 340 顆彗星'], origTitle: '近日點 2019 年之統計' }),
        mkNote(dir, 'n3', { rel: '- → [[n1]] 標題n1（互補搭配）提到 77 次' }), // 77 只在關聯章(不是材料)
        mkNote(dir, 'n4'),
        mkNote(dir, 'n5', { points: ['- 量測誤差約 3 公里'] }),
        mkNote(dir, 'n6'),
        mkNote(dir, 'n7', { missing: true }),
    ]
    const g = {
        g1: E('n1', 'n2', '兩篇皆以近日點距離之量測方法比較軌道'), // 全合格
        g2: E('n1', 'n3', 'placeholder'), // RS2 不合格
        g3: E('n2', 'n3', '两篇都讨论轨道之量测方法与误差'), // RS3 不合格
        g4: E('n1', 'n5', '兩篇皆以 12 個月週期與 340 顆樣本比較軌道'), // RS8:340 只在 n2(非兩端)→ 不合格
        g5: E('n2', 'n6', '近日點 2019 年之統計與另一篇之 340 顆樣本比較'), // RS8:2019 在 n2 之原文標題 → 合格
        g6: E('n3', 'n6', '兩篇皆提到 77 次觀測之紀錄與方法'), // RS8:77 只在 n3 之關聯章 → 不合格
        g7: E('n6', 'n7', '兩篇皆以 12 個月週期觀測軌道變化'), // RS8:n7 之 md 讀不到 → 未能判定
        g8: E('n1', 'nX', '兩篇皆以近日點距離之量測方法比較軌道'), // RS1:端點不存在
        g9: E('n5', 'n5', '同一篇之量測方法與誤差之自我比較'), // RS1:自指
        g10: E('n5', 'n6', '兩篇皆以近日點距離之量測方法比較軌道', { type: '不在清單之型' }), // RS1:型別不在清單
        g11: E('n2', 'n5', '甲篇主張誤差約 3 公里；乙篇主張樣本含 340 顆而無誤差', { // 合格;history 之 RS1／RS2／RS8 與截短 → 資訊項
            type: C, reasonCut: 240,
            history: [{ from: 'n5', to: 'n2', type: '舊型別', reason: '同上', createdAt: 'x' }, { from: 'n2', to: 'n5', type: T, reason: '兩篇皆以 999 個月週期比較軌道', createdAt: 'y' }],
        }),
    }
    return { notes, edges: Object.values(g), g }
}

/**
 * 兩端筆記之材料(內容章＋原文標題;md 讀不到 → null)——與還原路徑同一定義
 * @param {Array} notes 輸入筆記記錄
 * @returns {Function} 回傳 (id) => 材料|null
 */
const materialMapOf = (notes) => {
    const m = new Map(notes.map((n) => {
        const md = readMd(n.file)
        return [n.id, md ? noteMaterialText(md.body) : null]
    }))
    return (id) => (m.has(id) ? m.get(id) : null)
}

describe('unit-relate-audit', function() {

    before(() => {
        TMP = tmpRoot('relate-audit')
    })
    after(() => removeRoots([TMP]))

    describe('四態計數與完整 id(承接 :246 之邊部分)', function() {

        it('四態計數與完整 id:RS1 端點不存在／自指／清單外型別、RS2 佔位、RS3 簡體、RS8 兩端皆無之數字與材料不可得;依全集之序;counts.edges', async () => {
            const f = fixture(dirOf())
            const rep = await auditRelateStandards({ stores: { notes: memStore(f.notes), relations: memStore(f.edges) }, domain: DOMAIN })
            const S = rep.standards
            assert.deepEqual(Object.keys(S), [...RELATE_AUDITED_STANDARD_IDS], '依全集之序')
            assert.deepEqual(rep.counts, { edges: 11 })
            assert.deepEqual([S.RS1.violation, ids(S.RS1.violations)], [3, [f.g.g8.id, f.g.g9.id, f.g.g10.id]])
            assert.match(S.RS1.violations[0].detail, /端點不存在：nX/)
            assert.match(S.RS1.violations[1].detail, /自指/)
            assert.match(S.RS1.violations[2].detail, /型別「不在清單之型」不在清單/)
            assert.deepEqual([S.RS2.violation, ids(S.RS2.violations)], [1, [f.g.g2.id]], '佔位理由之邊(原實作 :246 之 RS2.violation 1)')
            assert.match(S.RS2.violations[0].detail, /佔位理由「placeholder」/)
            assert.deepEqual([S.RS3.violation, ids(S.RS3.violations)], [1, [f.g.g3.id]])
            assert.deepEqual([S.RS8.violation, ids(S.RS8.violations), S.RS8.undetermined, ids(S.RS8.undetermineds)], [2, [f.g.g4.id, f.g.g6.id], 1, [f.g.g7.id]])
            assert.deepEqual(S.RS8.violations.map((x) => x.detail), ['兩端皆無之數字：340', '兩端皆無之數字：77'], '原文標題算材料(g5 合格);關聯章不算(g6 不合格)')
            assert.equal(S.RS8.undetermineds[0].detail, '端點材料不可得', 'md 讀不到 → 未能判定,不報為零')
            for (const b of Object.values(S)) {
                assert.equal(b.total, 11, `${b.id} 逐邊皆判`)
                wellFormed(b)
            }
            assert.equal('ai' in rep, true, '未給 only:AI 標準之列一併列出')
        })

        it('與新進閘同一判定:逐邊逐標準之結果＝checkEdge(落地之邊;型別清單與空泛片語取 domain、材料＝兩端內容章＋原文標題);已正規化之邊過納入閘之理由與掃描之不合格同一字樣', async () => {
            const f = fixture(dirOf())
            const S = (await auditRelateStandards({ stores: { notes: memStore(f.notes), relations: memStore(f.edges) }, domain: DOMAIN })).standards
            const has = new Set(f.notes.map((n) => n.id))
            const ctx = { relationTypes: DOMAIN.relationTypes, vague: DOMAIN.vagueReasons, hasNote: (id) => has.has(id), materialOf: materialMapOf(f.notes) }
            let n = 0
            for (const e of f.edges) {
                for (const r of checkEdge(e, ctx)) {
                    n++
                    const b = S[r.std]
                    const where = { violation: b.violations, undetermined: b.undetermineds }[r.status]
                    if (where) assert.deepEqual(where.find((x) => x.id === e.id), { id: e.id, detail: r.detail }, `${e.id} ${r.std}`)
                    else assert.ok(!b.violations.some((x) => x.id === e.id) && !b.undetermineds.some((x) => x.id === e.id), `${e.id} ${r.std} ${r.status} 不在不合格／未能判定之列`)
                }
            }
            assert.equal(n, 11 * 4, '每邊四條標準')
            // 納入閘(同一判定;g2 已是落地形態,正規化不改其理由)
            const g = gateEdgeProposal(f.g.g2, { resolveType: DOMAIN.resolveType, relationTypes: DOMAIN.relationTypes, vague: DOMAIN.vagueReasons, hasNote: ctx.hasNote, materialOf: ctx.materialOf })
            assert.deepEqual(g.reasons, [`RS2 ${S.RS2.violations[0].detail}`])
        })

        it('注入之 domain 即判定之來源(型別清單、空泛片語):同一批邊,換 domain 即依其判;整組置換之 domain 物件亦然;缺 domain(或其型別清單、空泛片語)即拋', async () => {
            const dir = dirOf()
            const notes = [mkNote(dir, 'a'), mkNote(dir, 'b')]
            const h1 = E('a', 'b', '皆屬天文觀測，同屬自然科學', { type: '補充' })
            const stores = () => ({ notes: memStore(notes), relations: memStore([h1]) })
            const custom = createRelateDomain({ vocab: { relationTypes: ['前提', '補充', '衝突'], conflictType: '衝突', fallbackType: '補充', guide: { relate: { vagueReason: '皆屬天文觀測', broadRelation: '同屬自然科學' } } } })
            const pick = (S) => ['RS1', 'RS2'].map((id) => S[id].violation)
            assert.deepEqual(pick((await auditRelateStandards({ stores: stores(), domain: custom })).standards), [0, 1], '自訂 domain:型別在其清單、理由只有其空泛片語')
            assert.deepEqual(pick((await auditRelateStandards({ stores: stores(), domain: DOMAIN })).standards), [1, 0], '內建 domain:型別不在清單、空泛片語不同')
            const replaced = { relationTypes: ['補充'], vagueReasons: ['同屬自然科學'] } // 整組置換(只具掃描所讀之成員)
            const R = (await auditRelateStandards({ stores: stores(), domain: replaced })).standards
            assert.deepEqual([R.RS1.violation, R.RS2.violation], [0, 1])
            assert.match(R.RS2.violations[0].detail, /只剩 6 字/)
            for (const bad of [undefined, null, {}, { relationTypes: ['補充'] }, { vagueReasons: [] }]) {
                await assert.rejects(() => auditRelateStandards({ stores: stores(), domain: bad }), /需要 deps\.domain/)
            }
        })
    })

    describe('資訊項(承接 :271)', function() {

        it('history 條目之 RS1 型別／RS2 形式／RS8 數字與理由之句界截短計 info 與 infos,不算邊本身之違反;只在 RS1／RS2／RS8 之條目', async () => {
            const f = fixture(dirOf())
            const S = (await auditRelateStandards({ stores: { notes: memStore(f.notes), relations: memStore([f.g.g11, f.g.g1]) }, domain: DOMAIN })).standards
            assert.deepEqual([S.RS1.violation, S.RS2.violation, S.RS8.violation], [0, 0, 0], '資訊項不計違反')
            assert.deepEqual([S.RS1.info, S.RS2.info, S.RS8.info], [{ history: 1 }, { history: 1, cut: 1 }, { history: 1 }])
            assert.deepEqual(S.RS2.infos.map((x) => [x.id, x.kind]), [[f.g.g11.id, 'history'], [f.g.g11.id, 'cut']])
            assert.match(S.RS8.infos[0].detail, /^history\[1\] 兩端皆無之數字：999/)
            assert.equal('info' in S.RS3, false, 'RS3 無資訊項(history 之正體計入邊本身)')
        })

        it('資訊項之種類之顯示名(EDGE_INFO_LABELS)之鍵＝edgeInfoOf 所產之全部種類(實際產出＋原始碼之字面);字樣與巡檢之顯示同', async () => {
            assert.deepEqual(EDGE_INFO_LABELS, { history: 'history 條目不合', cut: '理由截短' })
            assert.ok(Object.isFrozen(EDGE_INFO_LABELS))
            const f = fixture(dirOf())
            const S = (await auditRelateStandards({ stores: { notes: memStore(f.notes), relations: memStore([f.g.g11]) }, domain: DOMAIN })).standards
            const seen = new Set(Object.values(S).flatMap((b) => (b.infos || []).map((x) => x.kind)))
            assert.deepEqual([...seen].sort(), Object.keys(EDGE_INFO_LABELS).sort(), '夾具產出全部種類')
            const src = fs.readFileSync(path.join(HERE, '..', 'src', 'standards', 'edgeStandards.mjs'), 'utf8')
            const body = src.slice(src.indexOf('export function edgeInfoOf'))
            const literal = new Set([...body.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]))
            assert.deepEqual([...literal].sort(), Object.keys(EDGE_INFO_LABELS).sort(), 'edgeInfoOf 之種類字面皆有顯示名')
        })
    })

    describe('使用者豁免(承接 :329 之豁免映射)', function() {

        it('不合格／未能判定而有豁免者記 waived(逐一列出,不算合格);鍵 edge:<邊 id>:<標準>;未結之登錄不是豁免;合格者不因有豁免而改記;他標準之豁免不跨用', async () => {
            const f = fixture(dirOf())
            const W_ = (e, std, status = 'waived') => ({ id: `edge:${e.id}:${std}`, object: 'edge', oid: e.id, std, status, waivedBy: '使用者', ruling: '保留' })
            const holds = memStore([
                W_(f.g.g2, 'RS2'), // 不合格 → 已豁免
                W_(f.g.g3, 'RS3', 'open'), // 未結 → 仍不合格
                W_(f.g.g1, 'RS1'), // 合格 → 仍合格
                W_(f.g.g7, 'RS8'), // 未能判定 → 已豁免
                W_(f.g.g4, 'RS2'), // 他標準之豁免:g4 之 RS8 違反不受影響
            ])
            const S = (await auditRelateStandards({ stores: { notes: memStore(f.notes), relations: memStore(f.edges), holds }, domain: DOMAIN })).standards
            assert.deepEqual([S.RS2.violation, S.RS2.waived, ids(S.RS2.waiveds)], [0, 1, [f.g.g2.id]], '豁免是裁示,另計(不算合格)')
            assert.match(S.RS2.waiveds[0].detail, /佔位理由/)
            assert.deepEqual([S.RS3.violation, S.RS3.waived], [1, 0], '未結之登錄不是豁免')
            assert.deepEqual([S.RS1.pass, S.RS1.waived], [8, 0], '合格者不因有豁免而改記')
            assert.deepEqual([S.RS8.undetermined, S.RS8.waived, ids(S.RS8.waiveds), ids(S.RS8.violations)], [0, 1, [f.g.g7.id], [f.g.g4.id, f.g.g6.id]])
            for (const b of Object.values(S)) wellFormed(b)
        })

        it('存量之豁免:覆核待判(RS6;衝突型 RS4)已豁免而來源(ctx.stockStd)為 RS1／RS2／RS3／RS8 → 該邊該標準記已豁免(同一問題之裁示;RS1 為維護段登錄之清單外型別);未結、無來源、提案之待判 → 不映射;他標準不跨用', async () => {
            const dir = dirOf()
            const notes = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((id) => mkNote(dir, id, id === 'n3' ? { rel: '- → [[n1]] 標題n1（互補搭配）提到 77 次' } : {}))
            const g = {
                a: E('n1', 'n3', 'placeholder'), // RS2;RS6 豁免、來源 RS2 → 已豁免
                b: E('n2', 'n3', 'placeholder', { type: C }), // RS2(衝突型);RS4 豁免、來源 RS2 → 已豁免
                c: E('n3', 'n6', '77 次', { type: C }), // RS2＋RS8(衝突型);RS4 豁免、來源 RS8 → 只 RS8 已豁免
                d: E('n1', 'n2', '两篇都讨论轨道之量测方法与误差'), // RS3;RS6 豁免、來源 RS3 → 已豁免
                e: E('n1', 'n4', 'placeholder'), // RS2;RS6 豁免、無來源(如型別判不了)→ 仍不合格
                f: E('n1', 'n5', 'placeholder'), // RS2;RS6 未結、來源 RS2 → 仍不合格
                h: E('n2', 'n4', 'placeholder'), // RS2;提案之待判(edge-proposal)豁免、來源 RS2 → 仍不合格
                k: E('n2', 'n6', 'placeholder', { type: '不在清單之型' }), // RS1＋RS2;RS6 豁免、來源 RS1(維護段登錄之清單外型別)→ RS1 已豁免、RS2 仍不合格
            }
            const H = (e, object, std, status, stockStd) => ({ id: `${object}:${e.id}:${std}`, object, oid: e.id, std, status, waivedBy: '使用者', ruling: '保留', ctx: stockStd ? { stockStd } : {} })
            const holds = memStore([
                H(g.a, RS6.objectEdge, RS6.std, 'waived', 'RS2'),
                H(g.b, RS4.objectEdge, RS4.std, 'waived', 'RS2'),
                H(g.c, RS4.objectEdge, RS4.std, 'waived', 'RS8'),
                H(g.d, RS6.objectEdge, RS6.std, 'waived', 'RS3'),
                H(g.e, RS6.objectEdge, RS6.std, 'waived', null),
                H(g.f, RS6.objectEdge, RS6.std, 'open', 'RS2'),
                H(g.h, RS4.objectProposal, RS4.std, 'waived', 'RS2'),
                H(g.k, RS6.objectEdge, RS6.std, 'waived', 'RS1'),
            ])
            const S = (await auditRelateStandards({ stores: { notes: memStore(notes), relations: memStore(Object.values(g)), holds }, domain: DOMAIN })).standards
            assert.deepEqual([ids(S.RS2.waiveds), ids(S.RS2.violations)], [[g.a.id, g.b.id], [g.c.id, g.e.id, g.f.id, g.h.id, g.k.id]])
            assert.deepEqual([ids(S.RS3.waiveds), S.RS3.violation], [[g.d.id], 0])
            assert.deepEqual([ids(S.RS8.waiveds), S.RS8.violation], [[g.c.id], 0], 'RS4 之豁免(來源 RS8)只及 RS8;同邊之 RS2 不跨用')
            assert.deepEqual([ids(S.RS1.waiveds), S.RS1.violation], [[g.k.id], 0], '來源 RS1(維護段登錄之清單外型別)之豁免即對 RS1 之裁示;同邊之 RS2 不跨用(上之 RS2 不合格含 k)')
            assert.match(S.RS2.waiveds[0].detail, /佔位理由/, '已豁免者帶原判定之說明')
            for (const b of Object.values(S)) wellFormed(b)
        })
    })

    describe('RS8 之材料', function() {

        it('materialOf(呼叫端之材料)給了即以之為準:不讀 md(筆記之 md 皆不存在照判)、不回呼 onNote、每篇至多問一次', async () => {
            const notes = ['p1', 'p2', 'p3'].map((id) => ({ id, file: `${TMP}/none/${id}.md` }))
            const edges = [E('p1', 'p2', '兩篇皆以 12 個月週期比較軌道'), E('p1', 'p3', '兩篇皆以 50 個月週期比較軌道'), E('p2', 'p3', '兩篇皆以 12 個月週期比較軌道')]
            const asked = []
            const mat = { p1: '週期 12 個月', p2: '週期約 12 個月之量測', p3: null }
            const onNote = []
            const S8 = (await auditRelateStandards({ stores: { notes: memStore(notes), relations: memStore(edges) }, domain: DOMAIN }, {
                only: ['RS8'], materialOf: (n) => {
                    asked.push(n.id)
                    return mat[n.id]
                }, onNote: (n) => onNote.push(n.id),
            })).standards.RS8
            assert.deepEqual([S8.pass, S8.undetermined, ids(S8.undetermineds)], [1, 2, [edges[1].id, edges[2].id]], 'p3 之材料不可得 → 含數字者未能判定')
            assert.deepEqual([asked.sort(), onNote], [['p1', 'p2', 'p3'], []], '每篇至多一次;給了 materialOf 不走訪')
        })

        it('onNote 給了即全量走訪:每篇讀得到 md 之筆記回呼一次(含不在任何邊上者;md 讀不到者不呼叫);範圍不含 RS8、或 material:false 者不走訪', async () => {
            const f = fixture(dirOf())
            const stores = () => ({ notes: memStore(f.notes), relations: memStore(f.edges) })
            const seen = []
            await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { onNote: (n, md) => seen.push([n.id, typeof md.body === 'string' && typeof md.front === 'object']) })
            assert.deepEqual(seen, f.notes.filter((n) => fs.existsSync(n.file)).map((n) => [n.id, true]), 'n4 不在任何邊上亦回呼;n7 之 md 讀不到不呼叫')
            const none = []
            await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { only: ['RS1', 'RS2', 'RS3'], onNote: (n) => none.push(n.id) })
            await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { material: false, onNote: (n) => none.push(n.id) })
            assert.deepEqual(none, [])
        })

        it('createMaterialReader(檔頭【材料讀取器一份】):materialOf 優先(不讀 md、非字串為不可得);useMaterial:false 一律 null;否則讀 md 以 textOf 算材料並快取(同篇只讀一次);onNote 全量走訪只在讀 md 時;缺 noteById／textOf 即拋', () => {
            // 規則:standards/audit.createMaterialReader——三來源之規則只此一份;下游經埠取用,材料之文字由 textOf 注入
            const d = dirOf()
            const notes = [{ id: 'a', file: `${d}/a.md` }, { id: 'b', file: `${d}/b.md` }, { id: 'c', file: `${d}/none.md` }]
            writeMd(notes[0].file, { title: 'A', slug: 'a' }, BODY({ origTitle: '原 A' }))
            writeMd(notes[1].file, { title: 'B', slug: 'b' }, BODY({ origTitle: '原 B' }))
            const noteById = new Map(notes.map((n) => [n.id, n]))
            // ① materialOf 優先
            const asked = []
            const walked = []
            const r1 = createMaterialReader({ notes, noteById, useMaterial: true, materialOf: (n) => (asked.push(n.id), n.id === 'b' ? 5 : `材料:${n.id}`), onNote: (n) => walked.push(n.id), textOf: () => '不該被呼叫' })
            assert.deepEqual([r1('a'), r1('a'), r1('b'), r1('zz')], ['材料:a', '材料:a', null, null], 'b 回非字串 → 不可得;不在之筆記 → null')
            assert.deepEqual([asked, walked], [['a', 'b'], []], '同篇只問一次;給了 materialOf 不走訪')
            // ② useMaterial:false
            const r2 = createMaterialReader({ notes, noteById, useMaterial: false, materialOf: null, onNote: (n) => walked.push(n.id), textOf: () => 'x' })
            assert.deepEqual([r2('a'), walked], [null, []])
            // ③ 讀 md:textOf 算材料、快取、md 讀不到 → null
            let reads = 0
            const r3 = createMaterialReader({ notes, noteById, useMaterial: true, materialOf: null, onNote: null, textOf: (n, md) => (reads++, `${n.id}|${noteMaterialText(md.body).split('\n')[0]}`) })
            assert.deepEqual([r3('a'), r3('a'), r3('c'), reads], ['a|原 A', 'a|原 A', null, 1])
            // ④ onNote 全量走訪(每篇讀得到 md 者一次;讀不到者不呼叫),之後取用不再讀
            const seen = []
            let reads4 = 0
            const r4 = createMaterialReader({ notes, noteById, useMaterial: true, materialOf: null, onNote: (n, md) => seen.push([n.id, typeof md.body]), textOf: () => (reads4++, 'm') })
            assert.deepEqual([seen, reads4, r4('a'), r4('b'), r4('c'), reads4], [[['a', 'string'], ['b', 'string']], 2, 'm', 'm', null, 2])
            // ⑤ 缺件即拋
            assert.throws(() => createMaterialReader({ notes, noteById: {}, useMaterial: true }), /需要 noteById/)
            assert.throws(() => createMaterialReader({ notes, noteById, useMaterial: true, materialOf: null }), /需要 textOf/)
        })

        it('material:false:不讀材料——理由含數字者 RS8 未能判定並註明(不報為零);理由無數字者照判合格;history 之 RS8 資訊不判;其餘標準不變', async () => {
            const f = fixture(dirOf())
            const stores = () => ({ notes: memStore(f.notes), relations: memStore(f.edges) })
            const on = (await auditRelateStandards({ stores: stores(), domain: DOMAIN })).standards
            const off = (await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { material: false })).standards
            const digits = [f.g.g4, f.g.g5, f.g.g6, f.g.g7, f.g.g11].map((e) => e.id)
            assert.deepEqual([off.RS8.violation, ids(off.RS8.undetermineds).sort(), off.RS8.pass], [0, [...digits].sort(), 6])
            assert.ok(off.RS8.undetermineds.every((x) => x.detail === '未讀筆記材料（material:false），數字紮根無從判定'), JSON.stringify(off.RS8.undetermineds))
            assert.deepEqual([off.RS8.info, on.RS8.info], [{}, { history: 1 }])
            for (const id of ['RS1', 'RS2', 'RS3']) assert.deepEqual(off[id], on[id], `${id} 不受 material 影響`)
            // 給了 materialOf 者以之為準(material 不影響)
            const mo = (await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { material: false, materialOf: (n) => materialMapOf(f.notes)(n.id) })).standards
            assert.deepEqual(mo.RS8, on.RS8)
        })
    })

    describe('AI 標準之列(承接 :329 之 AI 部分)', function() {

        const CHECKS = [
            { id: 'edge:e1', object: 'edge', oid: 'e1', hash: 'h1', results: { RS4: { status: 'pass', v: RS4.v }, RS6: { status: 'violation', v: RS6.v } } },
            { id: 'edge:e2', object: 'edge', oid: 'e2', hash: 'h2', results: { RS4: { status: 'undetermined', v: 0 } } },
            { id: 'edge:e3', object: 'edge', oid: 'e3', hash: 'h3', results: { RS6: { status: 'pass', v: 0 }, ES9: { status: 'pass', v: 1 } } },
            { id: 'claim:k1', object: 'claim', oid: 'k1', hash: 'h4', results: { ES9: { status: 'violation', v: 1 } } },
        ]
        const HOLDS = [
            { id: 'edge:e9:RS4', object: 'edge', oid: 'e9', std: 'RS4', status: 'open' },
            { id: 'edge-proposal:p1:RS4', object: 'edge-proposal', oid: 'p1', std: 'RS4', status: 'waived' },
            { id: 'edge:e8:RS4', object: 'edge', oid: 'e8', std: 'RS4', status: 'resolved' },
            { id: 'edge:e7:RS5', object: 'edge', oid: 'e7', std: RS5.std, status: 'waived' },
            { id: 'note:n1:RS5', object: 'note', oid: 'n1', std: RS5.std, status: 'open' },
            { id: 'edge:e6:RS6', object: 'edge', oid: 'e6', std: 'RS6', status: 'open' },
            { id: 'edge:e5:RS2', object: 'edge', oid: 'e5', std: 'RS2', status: 'open' },
        ]
        const base = (o = {}) => ({ notes: memStore([]), relations: memStore([]), ...o })
        const pick = (a) => (a ? [a.checked, a.pass, a.violation, a.undetermined, a.na, a.stale, a.holdsOpen, a.holdsWaived] : a)

        it('RS4／RS6:檢核紀錄之已檢、四態、版本過時(紀錄之 v ≠ 現版)與待判之未結／已豁免(任一物件);RS5 只計待判(檢核之欄 null、版本 null);欄位與欄序固定;標題等取自全集', async () => {
            const rep = await auditRelateStandards({ stores: base({ checks: memStore(CHECKS), holds: memStore(HOLDS) }), domain: DOMAIN }, { only: [...RELATE_AI_STANDARD_IDS] })
            assert.deepEqual(Object.keys(rep.standards), [], '只給 AI 標準 → 無逐件判定之條目')
            assert.deepEqual(Object.keys(rep.ai), ['RS4', 'RS5', 'RS6'])
            assert.deepEqual(pick(rep.ai.RS4), [2, 1, 0, 1, 0, 1, 1, 1], 'v0 之紀錄＝版本過時須重檢;已結案之登錄不計')
            assert.deepEqual(pick(rep.ai.RS6), [2, 1, 1, 0, 0, 1, 1, 0])
            assert.deepEqual(pick(rep.ai.RS5), [null, null, null, null, null, null, 1, 1])
            assert.equal(rep.ai.RS5.v, null)
            for (const a of Object.values(rep.ai)) {
                assert.deepEqual(Object.keys(a), ['id', 'title', 'kind', 'v', 'module', 'object', 'checked', 'pass', 'violation', 'undetermined', 'na', 'stale', 'holdsOpen', 'holdsWaived'])
                const s = RELATE_STANDARDS.find((x) => x.id === a.id)
                assert.deepEqual([a.title, a.kind, a.v, a.object, a.module], [s.title, s.kind, s.v, s.object, 'relate'])
            }
        })

        it('來源集合未給 → 欄 null(無從計,不報為零)、皆未給 → 列 null;範圍:只給逐件判定之標準者不出 ai、混給者各取所列', async () => {
            const none = await auditRelateStandards({ stores: base(), domain: DOMAIN })
            assert.deepEqual(none.ai, { RS4: null, RS5: null, RS6: null })
            const onlyHolds = await auditRelateStandards({ stores: base({ holds: memStore(HOLDS) }), domain: DOMAIN }, { only: ['RS4', 'RS5'] })
            assert.deepEqual([pick(onlyHolds.ai.RS4), pick(onlyHolds.ai.RS5)], [[null, null, null, null, null, null, 1, 1], [null, null, null, null, null, null, 1, 1]])
            const onlyChecks = await auditRelateStandards({ stores: base({ checks: memStore(CHECKS) }), domain: DOMAIN }, { only: ['RS4', 'RS5', 'RS6'] })
            assert.deepEqual([pick(onlyChecks.ai.RS4), onlyChecks.ai.RS5, pick(onlyChecks.ai.RS6)], [[2, 1, 0, 1, 0, 1, null, null], null, [2, 1, 1, 0, 0, 1, null, null]])
            const stores = base({ checks: memStore(CHECKS), holds: memStore(HOLDS) })
            assert.equal('ai' in await auditRelateStandards({ stores, domain: DOMAIN }, { only: [...RELATE_AUDITED_STANDARD_IDS] }), false)
            const mixed = await auditRelateStandards({ stores, domain: DOMAIN }, { only: ['RS2', RS5.std] })
            assert.deepEqual([Object.keys(mixed.standards), Object.keys(mixed.ai)], [['RS2'], [RS5.std]])
        })
    })

    describe('範圍、上限、設定之容錯', function() {

        it('only:只掃所列(不認得之 id、不掃之標準略過;空陣列＝全部);maxIds:列表與資訊截至上限而計數照實;opt 非物件 → 預設;缺集合(或其 select)即拋', async () => {
            const f = fixture(dirOf())
            const stores = () => ({ notes: memStore(f.notes), relations: memStore(f.edges) })
            assert.deepEqual(Object.keys((await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { only: ['RS3', 'RS9', 'RS10', 'XX'] })).standards), ['RS3'])
            assert.deepEqual(Object.keys((await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { only: [] })).standards), [...RELATE_AUDITED_STANDARD_IDS])
            for (const bad of [null, 'x', 5, []]) assert.deepEqual(Object.keys((await auditRelateStandards({ stores: stores(), domain: DOMAIN }, bad)).standards), [...RELATE_AUDITED_STANDARD_IDS])
            const one = (await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { maxIds: 1 })).standards
            assert.deepEqual([one.RS1.violation, one.RS1.violations.length, one.RS2.info.history, one.RS2.infos.length], [3, 1, 1, 1])
            const zero = (await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { maxIds: 0 })).standards.RS8
            assert.deepEqual([zero.violation + zero.undetermined, zero.violations.length + zero.undetermineds.length], [3, 0])
            await assert.rejects(() => auditRelateStandards({ stores: { notes: memStore([]) }, domain: DOMAIN }), /需要 deps\.stores\.relations 與 deps\.stores\.notes/)
            await assert.rejects(() => auditRelateStandards({ stores: { relations: memStore([]), notes: { get: async () => null } }, domain: DOMAIN }), /需要 deps\.stores\.relations 與 deps\.stores\.notes/)
            await assert.rejects(() => auditRelateStandards(undefined), /需要 deps\.stores/)
        })
    })

    describe('唯讀與計數之形狀', function() {

        it('唯讀:md 檔(內容與修改時刻)、各集合、目錄皆不變', async () => {
            const dir = dirOf()
            const f = fixture(dir)
            const stores = { notes: memStore(f.notes), relations: memStore(f.edges), holds: memStore([{ id: `edge:${f.g.g2.id}:RS2`, object: 'edge', oid: f.g.g2.id, std: 'RS2', status: 'waived' }]), checks: memStore([{ id: 'edge:x', object: 'edge', oid: 'x', hash: 'h', results: { RS4: { status: 'pass', v: 1 } } }]) }
            const snap = () => ({
                files: fs.readdirSync(`${dir}/notes`).sort(),
                md: f.notes.filter((n) => fs.existsSync(n.file)).map((n) => [fs.readFileSync(n.file, 'utf8'), fs.statSync(n.file).mtimeMs]),
                stores: Object.fromEntries(Object.entries(stores).map(([k, s]) => [k, JSON.stringify(s._dump())])),
            })
            const before = snap()
            await auditRelateStandards({ stores, domain: DOMAIN })
            await auditRelateStandards({ stores, domain: DOMAIN }, { material: false, onNote: () => {} })
            assert.deepEqual(snap(), before)
            assert.deepEqual(fs.readdirSync(dir), ['notes'], '不建任何檔案或目錄')
        })

        it('逐標準之條目帶計數摘要所讀之欄(id、v、total、violation、undetermined、waived 皆為數字;外部之執行摘要據以彙整)', async () => {
            const f = fixture(dirOf())
            const rep = await auditRelateStandards({ stores: { notes: memStore(f.notes), relations: memStore(f.edges) }, domain: DOMAIN })
            for (const [id, b] of Object.entries(rep.standards)) {
                assert.equal(b.id, id)
                for (const k of ['v', 'total', 'violation', 'undetermined', 'waived']) assert.equal(typeof b[k], 'number', `${id}.${k}`)
            }
        })
    })

    describe('真 LMDB', function() {

        it('筆記、邊、待判、檢核紀錄皆在 LMDB 集合:掃描結果與記憶體集合逐欄相同(含豁免、資訊項與 AI 標準之列)', async () => {
            const dir = dirOf()
            const f = fixture(dir)
            const holdRows = [
                { id: `edge:${f.g.g2.id}:RS2`, object: 'edge', oid: f.g.g2.id, std: 'RS2', status: 'waived', waivedBy: '使用者', ruling: '保留' },
                { id: 'edge:e9:RS4', object: 'edge', oid: 'e9', std: 'RS4', status: 'open' },
                { id: 'note:n1:RS5', object: 'note', oid: 'n1', std: RS5.std, status: 'waived' },
            ]
            const checkRows = [{ id: 'edge:e1', object: 'edge', oid: 'e1', hash: 'h', results: { RS4: { status: 'pass', v: 1 }, RS6: { status: 'na', v: 0 } } }]
            const byIdSort = (rows) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) // LMDB 依鍵序讀出,記憶體集合比照
            const mem = { notes: memStore(byIdSort(f.notes)), relations: memStore(byIdSort(f.edges)), holds: memStore(byIdSort(holdRows)), checks: memStore(byIdSort(checkRows)) }
            const open = (cl) => W.openCollection({ WOrm, path: `${dir}/db`, db: 'knowledge', cl })
            const lm = { notes: open('notes'), relations: open('relations'), holds: open('holds'), checks: open('checks') }
            try {
                await lm.notes.insertNew(f.notes)
                await lm.relations.insertNew(f.edges)
                await lm.holds.insertNew(holdRows)
                await lm.checks.insertNew(checkRows)
                const a = await auditRelateStandards({ stores: lm, domain: DOMAIN })
                const b = await auditRelateStandards({ stores: mem, domain: DOMAIN })
                assert.deepEqual(a, b)
                assert.deepEqual([a.standards.RS2.waived, a.standards.RS3.violation, a.standards.RS8.violation, a.standards.RS2.info.cut, a.ai.RS4.holdsOpen, a.ai.RS6.na, a.ai.RS5.holdsWaived], [1, 1, 2, 1, 1, 1, 1])
            }
            finally {
                for (const c of Object.values(lm)) await c.close()
            }
        })
    })
})
