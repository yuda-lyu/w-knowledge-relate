// unit-relate-stockfix.test.mjs — 邊之檢定標準存量處置(standards/stockFix 之 RS3 修正 edgeFixOf、預演 → 套用 → 連鎖斷言 → 回退;排入 standards/edgeQueue)與
//   投影之共用 API(ops/projectOps 之 projectAffected、neighborsOf)
// 規則(出自 standards/stockFix、ops/projectOps 檔頭與 JSDoc):
//   ①RS3:理由與沿革(history)之理由轉正體、updatedAt 不動;[[連結]] 與網址不轉;已合格者回 null(無須修正、不入處置帳)
//   ②預演:目標取自符合度掃描(同一判定);RS3 → 修正項(changes、兩端)、RS2／RS8 → 交兩席改寫之項;只預演不寫任何東西
//   ③套用:RS3 逐條以現值重算再寫(updatedAt 不動、即記帳);RS4／RS6 檢核紀錄原與舊值同步者換為新值之雜湊(不同步者不動、無紀錄者不造);
//     onEdgeFixed 之回傳併入帳列(本模組之欄位不被覆寫;拋錯者照記帳、列 errors);RS2／RS8 依型別登錄待判(非衝突 → 既有邊覆核 RS6、
//     衝突型 → 衝突核對 RS4;期限與下一步取 relateHolds 之常數;已有未結者不重登;覆核待判已豁免而其來源即本標準者不重開,來源不同或無者照登錄);
//     修不了者(RS3)以現值重判分流(邊不在、已合格、現值已可確定性修正 → stale;現行理由仍不合正體 → 同上之兩席;只剩沿革 → 使用者待判
//     edge:<邊 id>:RS3;已有未結或已豁免者不重登);未開 holds 集合 → errors(不靜默);回傳受影響之兩端供呼叫端投影
//   ④處置帳:列形狀與原實作相容(邊列 { at, object:'edge', id, stds, changes, before:{ edge }, …, check? }、覆核列、待判列、回退列);
//     opt.ledgerFile 或 dirs.state 下之 stock-fix.jsonl;皆未給即拋;讀帳只取本模組之列、排除已回退者
//   ⑤連鎖斷言:邊仍在、updatedAt 未被改、理由已合正體、檢核雜湊已換;待判已登錄;他模組之列略過
//   ⑥回退(逐列):本模組之列依逆序寫回(邊全值、檢核雜湊換回、onEdgeRolledBack);待判只結未結(使用者之豁免不被改寫);附寫回退列;
//     他模組之列 restored 0、不報錯——呼叫端逐列交付時全域逆序不變
//   ⑦projectAffected:現存者記待投影、總覽待重建、當場投影(project:false 只記帳;缺 domain 而須投影者於寫入前拋);neighborsOf:一次讀邊庫之鄰居聯集;
//     維運 op(restoreEdge、restoreNote)改用之後之帳與原寫法相同
// 承接原實作 unit-standards-stock:131(edgeFixOf)與 :183、:206、:275、:305 之邊部分(預演不寫、RS3 套用與 RS2 → RS6 待判、帳列、回退逆序與
//   使用者裁示、RS3 修正後檢核雜湊同步與換回;讀關聯之下游之快照改以 onEdgeFixed／onEdgeRolledBack 模擬);其餘為新增。
// 執行:自套件根 node <mocha> test/unit-relate-stockfix.test.mjs(暫存 test/_tmp/relate-stockfix-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore, genClockTZ, STOCK_LEDGER_FILE, sourceFilesOf, removeRoots } from './tools/captureForTest.mjs'
import { PKG_ROOT, tmpRoot } from './tools/relateTestKit.mjs'
import { readMd, writeMd } from '../src/core/summarizePackage.mjs'
import { holdKey, readJsonlRows } from '../src/core/capturePackage.mjs'
import { checkKey, needsCheck, recordCheck } from '../src/core/stores/checks.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'
import { openRelateLedgers } from '../src/stores/relateLedgers.mjs'
import { retireEdge } from '../src/stores/edgeRetire.mjs'
import { relateHoldDeadlineOf, RELATE_HOLD_NEXT } from '../src/stores/relateHolds.mjs'
import { RS4 } from '../src/stores/conflictCheckPolicy.mjs'
import { relationTypesVersionOf } from '../src/stores/edgeCheckKit.mjs'
import { createCheckHasher } from '../src/stores/checkMaterial.mjs'
import { RS6 } from '../src/stores/edgeReviewPolicy.mjs'
import { checkEdge } from '../src/standards/edgeStandards.mjs'
import { stockWaiverKeyOf, queueEdgeReview, queueConflictCheck } from '../src/standards/edgeQueue.mjs'
import { deleteNote, restoreNote, restoreEdge } from '../src/ops/noteOps.mjs'
import { projectAffected, neighborsOf } from '../src/ops/projectOps.mjs'
import { auditRelateStandards } from '../src/standards/audit.mjs'
import {
    EDGE_FIX_STDS, edgeFixOf, planEdgeStockFix, applyEdgeStockFix, verifyEdgeStockChain, readEdgeStockLedger, rollbackEdgeStockFix,
} from '../src/standards/stockFix.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const C = DOMAIN.conflictType
const T = '互補搭配'
const T0 = '2026-10-01T00:00:00+08:00'
const AT = '2026-10-08T04:00:00+08:00'
const AT2 = '2026-10-08T05:00:00+08:00'
const TYPES_VER = relationTypesVersionOf(DOMAIN)
// 檢核雜湊與關聯段同一算法、同一素材讀法(stores/checkMaterial.createCheckHasher)
const hashOf = async (e, x) => createCheckHasher({ byId: new Map([[x.from, await e.notes.get(x.from)], [x.to, await e.notes.get(x.to)]]), domain: DOMAIN, typesVer: TYPES_VER }).hashOf(x)
let seq = 0

const BODY = (id) => [`# 標題${id}`, '', '## 一句話重點', '', `${id} 之重點`, '', '## 核心知識', '', '- 軌道之量測方法', '', '## 來源', '', '- 原文標題：原文', ''].join('\n')

/**
 * 存量環境:筆記 n1～n6(有 md);邊 eA(RS3:理由與 history 之簡體,含連結與網址)、eB(RS2:佔位;非衝突)、eC(RS8:兩端皆無之數字;衝突型)、
 *   eD(合格)、eE(RS2:佔位;衝突型)
 * @param {Object} [o={}] 輸入 { noHolds:Boolean, checks:Boolean(開檢核紀錄集合), stores:(rows)=>集合(自訂集合工廠,LMDB 用), relations:(store)=>store(包裝) }
 * @returns {Object} 回傳 { deps, dir, notes, relations, holds, checks, g:{ eA…eE }, ledger, state:()=>openRelateLedgers }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const mkNote = (id) => {
        const file = `${dir}/notes/${id}.md`
        writeMd(file, { title: `標題${id}`, slug: id }, BODY(id))
        return { id, title: `標題${id}`, concepts: ['軌道'], category: 'c', file, createdAt: T0, relatedAt: T0 }
    }
    const E = (from, to, type, reason, extra = {}) => ({ ...makeEdge({ from, to, type, reason, nowIso: T0 }), ...extra })
    const g = {
        eA: E('n1', 'n2', T, '两篇都讨论轨道之量测，见 [[旧-slug]] 与 https://x.test/数据', { history: [{ from: 'n2', to: 'n1', type: '前置概念', reason: '先理解轨道再看量测', createdAt: T0 }] }),
        eB: E('n2', 'n3', T, 'placeholder'),
        eC: E('n3', 'n4', C, '甲篇主張週期為 37 天；乙篇主張週期無規律'),
        eD: E('n4', 'n5', T, '兩篇皆以近日點距離之量測方法比較軌道'),
        eE: E('n5', 'n6', C, '同上'),
    }
    const factory = o.stores || ((name, rows) => memStore(rows))
    const notes = factory('notes', ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map(mkNote))
    const relations0 = factory('relations', Object.values(g))
    const relations = o.relations ? o.relations(relations0) : relations0
    const holds = o.noHolds ? null : factory('holds', [])
    const checks = o.checks ? factory('checks', []) : null
    const deps = { stores: { notes, relations, ...(holds ? { holds } : {}), ...(checks ? { checks } : {}) }, dirs: { state: `${dir}/state` }, clock, domain: DOMAIN }
    return { deps, dir, notes, relations, holds, checks, g, ledger: `${dir}/state/${STOCK_LEDGER_FILE}`, state: () => openRelateLedgers(`${dir}/state`) }
}

describe('unit-relate-stockfix', function() {

    before(() => {
        TMP = tmpRoot('relate-stockfix')
    })
    after(() => removeRoots([TMP]))

    it('edgeFixOf RS3:理由與沿革理由轉正體、updatedAt 不動;合格者回 null(CS10 之群合併與留存序屬抓取套件,測於抓取套件)', () => {
        const e = { ...makeEdge({ from: 'a', to: 'b', type: '互補搭配', reason: '两篇都讨论风险', nowIso: '2026-10-01T00:00:00+08:00' }), history: [{ reason: '先理解风险', type: '前置概念' }] }
        const f = edgeFixOf(e)
        assert.deepEqual([f.edge.reason, f.edge.history[0].reason, f.edge.updatedAt], ['兩篇都討論風險', '先理解風險', e.updatedAt])
        assert.equal(edgeFixOf(f.edge), null)
    })

    it('stockWaiverKeyOf:已豁免之覆核待判(RS6;衝突型 RS4)而來源為 RS1(維護段之清單外型別)／RS2／RS3／RS8 → edge:<邊 id>:<來源>;未結、已結案、無來源、他來源、提案之待判、他標準之待判、非物件 → null', () => {
        const h = (o) => ({ object: RS6.objectEdge, oid: 'e1', std: RS6.std, status: 'waived', ctx: { stockStd: 'RS2' }, ...o })
        for (const s of ['RS1', 'RS2', 'RS3', 'RS8']) {
            assert.equal(stockWaiverKeyOf(h({ ctx: { stockStd: s } })), holdKey(RS6.objectEdge, 'e1', s), `RS6 來源 ${s}`)
            assert.equal(stockWaiverKeyOf(h({ std: RS4.std, ctx: { stockStd: s } })), holdKey(RS6.objectEdge, 'e1', s), `RS4 來源 ${s}`)
        }
        for (const [why, x] of [
            ['未結', h({ status: 'open' })], ['已結案', h({ status: 'resolved' })], ['無來源', h({ ctx: {} })], ['無 ctx', h({ ctx: undefined })],
            ['他來源', h({ ctx: { stockStd: 'RS9' } })], ['提案之待判', h({ object: RS4.objectProposal, std: RS4.std })], ['他標準之待判', h({ std: 'RS5' })],
        ]) assert.equal(stockWaiverKeyOf(x), null, why)
        for (const x of [null, undefined, 'edge:e1:RS6', []]) assert.equal(stockWaiverKeyOf(x), null)
    })

    // ══════════════════════════ 預演 → 套用 → 回退(承接 :183、:206 之邊部分)══════════════════════════
    describe('預演 → 套用 → 回退', function() {

        it('planEdgeStockFix:RS3 修正項(changes、兩端)、RS2／RS8 交改寫之項(依掃描之序;衝突型亦列);計數;只預演不寫任何東西', async () => {
            const e = env()
            const edges0 = JSON.stringify(await e.relations.select())
            const plan = await planEdgeStockFix(e.deps, {})
            assert.deepEqual(plan.stds, [...EDGE_FIX_STDS])
            assert.deepEqual(plan.items.map((x) => [x.object, x.id, x.stds]), [
                ['edge', e.g.eA.id, ['RS3']],
                ['edge-review', e.g.eB.id, ['RS2']],
                ['edge-review', e.g.eE.id, ['RS2']],
                ['edge-review', e.g.eC.id, ['RS8']],
            ])
            const a = plan.items[0]
            assert.deepEqual([a.changes, a.ends], [[{ std: 'RS3', what: '理由轉正體' }, { std: 'RS3', what: '沿革理由轉正體 1 筆' }], ['n1', 'n2']])
            assert.deepEqual(plan.items.slice(1).map((x) => x.why), ['佔位理由「placeholder」', '佔位理由「同上」', '兩端皆無之數字：37 天'])
            assert.deepEqual([plan.unfixable, plan.resolvable, plan.counts], [[], [], { violations: { RS3: 1, RS2: 2, RS8: 1 }, items: 4, unfixable: 0, resolvable: 0, fixes: { RS3: 1, RS2: 2, RS8: 1 } }])
            assert.match(plan.at, /^\d{4}-\d{2}-\d{2}T/, '預演時刻取 clock')
            assert.equal((await planEdgeStockFix(e.deps, { at: AT, stds: ['RS3'] })).at, AT, 'opt.at 優先')
            // 預演不寫
            assert.equal(JSON.stringify(await e.relations.select()), edges0)
            assert.equal(fs.existsSync(e.deps.dirs.state), false, '不建處置帳')
            assert.deepEqual(await e.holds.select(), [], '不登錄待判')
        })

        it('預演之範圍與上限:stds 只處置所列(其他 id 略過、空陣列＝全部);ids 只處置所列之邊;limit 為每標準至多幾件;stds 皆不可處置 → 不掃', async () => {
            const e = env()
            const only = await planEdgeStockFix(e.deps, { stds: ['RS8', 'SS3', 'RS1'] })
            assert.deepEqual([only.stds, only.items.map((x) => x.id)], [['RS8'], [e.g.eC.id]])
            assert.deepEqual((await planEdgeStockFix(e.deps, { ids: [e.g.eE.id, e.g.eA.id] })).items.map((x) => x.id), [e.g.eA.id, e.g.eE.id])
            assert.deepEqual((await planEdgeStockFix(e.deps, { limit: 1 })).items.map((x) => [x.id, x.stds[0]]), [[e.g.eA.id, 'RS3'], [e.g.eB.id, 'RS2'], [e.g.eC.id, 'RS8']], '每標準至多 1 件')
            const none = await planEdgeStockFix(e.deps, { stds: ['RS1', 'XX'] })
            assert.deepEqual([none.stds, none.items, none.counts.violations], [[], [], {}])
        })

        it('applyEdgeStockFix:RS3 修正(updatedAt 不動、history 同步、連結與網址不轉);RS2／RS8 依型別登錄待判(非衝突 → RS6、衝突型 → RS4;期限與下一步取常數);帳列;回傳兩端;重跑預演 RS3 為 0;連鎖斷言無問題;回退全數還原', async () => {
            const e = env()
            const eA0 = await e.relations.get(e.g.eA.id)
            const plan = await planEdgeStockFix(e.deps, {})
            const r = await applyEdgeStockFix(e.deps, plan, { at: AT })
            assert.deepEqual([r.errors, r.stale, r.alreadyHeld, r.held], [[], [], [], []])
            assert.deepEqual(r.counts, { RS3: 1, RS2: 2, RS8: 1 })
            assert.deepEqual(r.affected, ['n1', 'n2'], '受影響之兩端(呼叫端投影)')
            // RS3:理由與 history 轉正體,連結與網址原樣;id、型別、updatedAt 不動
            const eA = await e.relations.get(e.g.eA.id)
            assert.deepEqual([eA.reason, eA.history[0].reason, eA.updatedAt, eA.type, eA.id], ['兩篇都討論軌道之量測，見 [[旧-slug]] 與 https://x.test/数据', '先理解軌道再看量測', eA0.updatedAt, T, eA0.id])
            // RS2(非衝突)→ RS6 待判;RS2／RS8(衝突型)→ RS4 待判
            const hB = await e.holds.get(holdKey(RS6.objectEdge, e.g.eB.id, RS6.std))
            assert.deepEqual([hB.status, hB.owner, hB.next, hB.deadline, hB.reason, hB.ctx], ['open', 'pipeline', RELATE_HOLD_NEXT.edgeReviewStock, relateHoldDeadlineOf(AT), '存量 RS2：佔位理由「placeholder」', { from: 'n2', to: 'n3', type: T, stockStd: 'RS2' }])
            const hE = await e.holds.get(holdKey(RS4.objectEdge, e.g.eE.id, RS4.std))
            assert.deepEqual([hE.status, hE.owner, hE.next, hE.deadline, hE.reason, hE.ctx], ['open', 'pipeline', RELATE_HOLD_NEXT.conflictCheckStock, relateHoldDeadlineOf(AT), '存量 RS2（衝突型）：佔位理由「同上」', { from: 'n5', to: 'n6', stockStd: 'RS2' }])
            const hC = await e.holds.get(holdKey(RS4.objectEdge, e.g.eC.id, RS4.std))
            assert.deepEqual([hC.status, hC.ctx.stockStd, hC.reason], ['open', 'RS8', '存量 RS8（衝突型）：兩端皆無之數字：37 天'])
            assert.equal(await e.holds.get(holdKey(RS6.objectEdge, e.g.eC.id, RS6.std)), null, '衝突型不交既有邊覆核')
            // 處置帳
            const rows = readEdgeStockLedger(e.ledger)
            assert.deepEqual(r.rows, rows, '回傳之帳列＝落檔之帳列')
            assert.deepEqual(rows.map((x) => [x.object, x.id, x.stds, x.hold]), [
                ['edge', e.g.eA.id, ['RS3'], undefined],
                ['edge-review', e.g.eB.id, ['RS2'], hB.id],
                ['edge-review', e.g.eE.id, ['RS2'], hE.id],
                ['edge-review', e.g.eC.id, ['RS8'], hC.id],
            ])
            assert.equal(path.resolve(r.ledgerFile), path.resolve(e.ledger), '預設為 dirs.state 下之 stock-fix.jsonl')
            // 重跑預演:RS3 已修;RS2／RS8 仍違反(待兩席改寫)——再套用不重登(已有未結者)
            const again = await planEdgeStockFix(e.deps, {})
            assert.deepEqual(again.items.filter((x) => x.object === 'edge'), [])
            const r2 = await applyEdgeStockFix(e.deps, again, { at: AT2 })
            assert.deepEqual([r2.rows, r2.alreadyHeld.sort(), r2.counts], [[], [hB.id, hE.id, hC.id].sort(), {}])
            assert.equal((await e.holds.get(hB.id)).tries, 0, '未結者不重登(不累加 tries)')
            assert.equal((await auditRelateStandards({ stores: e.deps.stores, domain: DOMAIN }, { only: ['RS3'] })).standards.RS3.violation, 0)
            // 連鎖斷言
            assert.deepEqual(await verifyEdgeStockChain(e.deps, rows), { checked: 4, problems: [] })
            // 回退:邊逐字還原、待判結案;已回退者不再列
            const rb = await rollbackEdgeStockFix(e.deps, rows, { at: AT2 })
            assert.deepEqual([rb.restored, rb.errors, rb.affected], [4, [], ['n1', 'n2']])
            assert.deepEqual(await e.relations.get(e.g.eA.id), eA0)
            for (const h of [hB, hE, hC]) assert.equal((await e.holds.get(h.id)).status, 'resolved', `${h.id} 結案`)
            assert.deepEqual(readEdgeStockLedger(e.ledger), [], '已回退者不再列')
        })
    })

    // ══════════════════════════ 處置帳、連鎖斷言、回退之順序與裁示(承接 :275)══════════════════════════
    describe('處置帳、連鎖斷言、回退之順序與裁示', function() {

        it('帳列形狀:邊列 { at, object, id, stds, changes, before:{ edge }, after:{ edge } }、覆核列 { at, object, id, stds, before:{ hold:登錄前之記錄｜null }, hold }、回退列 { at, rollbackOf, object, id }', async () => {
            const e = env()
            const r = await applyEdgeStockFix(e.deps, await planEdgeStockFix(e.deps, { stds: ['RS3', 'RS2'] }), { at: AT })
            const edge = r.rows.find((x) => x.object === 'edge')
            assert.deepEqual(Object.keys(edge), ['at', 'object', 'id', 'stds', 'changes', 'before', 'after'])
            assert.deepEqual([Object.keys(edge.before), Object.keys(edge.after)], [['edge'], ['edge']])
            assert.deepEqual(edge.before.edge, e.g.eA, '處置前之邊全值')
            assert.deepEqual(edge.after.edge, await e.relations.get(e.g.eA.id), '處置後之邊全值(回退防護之比對基準)')
            const review = r.rows.find((x) => x.object === 'edge-review')
            assert.deepEqual(Object.keys(review), ['at', 'object', 'id', 'stds', 'before', 'hold'])
            assert.deepEqual([review.before, review.hold], [{ hold: null }, holdKey(RS6.objectEdge, e.g.eB.id, RS6.std)])
            await rollbackEdgeStockFix(e.deps, r.rows, { at: AT2 })
            const back = readJsonlRows(e.ledger).filter((x) => x.rollbackOf)
            assert.deepEqual(back.map((x) => Object.keys(x)), back.map(() => ['at', 'rollbackOf', 'object', 'id']))
            assert.deepEqual(back.map((x) => [x.at, x.rollbackOf, x.object]), [...r.rows].reverse().map((x) => [AT2, AT, x.object]), '依逆序附寫回退列')
        })

        it('處置帳之位置:opt.ledgerFile 優先(預設位置不建);未給為 dirs.state 下之 stock-fix.jsonl;兩者皆無 → 套用與回退皆拋(預演不需帳);讀帳之檔不存在回空陣列', async () => {
            const e = env()
            const plan = await planEdgeStockFix(e.deps, { stds: ['RS3'] })
            const own = `${e.dir}/own/ledger.jsonl`
            const r = await applyEdgeStockFix(e.deps, plan, { at: AT, ledgerFile: own })
            assert.deepEqual([r.ledgerFile, readEdgeStockLedger(own).length, fs.existsSync(e.ledger)], [own, 1, false])
            const noDirs = { ...e.deps, dirs: {} }
            await assert.rejects(() => applyEdgeStockFix(noDirs, plan), /需要處置帳之路徑/)
            await assert.rejects(() => rollbackEdgeStockFix(noDirs, readEdgeStockLedger(own)), /需要處置帳之路徑/)
            assert.ok(Array.isArray((await planEdgeStockFix(noDirs, {})).items), '預演不需帳')
            assert.deepEqual([readEdgeStockLedger(`${e.dir}/none.jsonl`), readEdgeStockLedger(undefined)], [[], []])
        })

        it('讀帳:只取本模組之列(邊列、覆核列、邊之待判列;筆記、核心、文件等他模組之列與他物件之待判列略過)、壞行即拋(allowBad 才略過)、since／at 篩選、已回退者排除', () => {
            const dir = `${TMP}/ledger${++seq}`
            fs.mkdirSync(dir, { recursive: true })
            const f = `${dir}/stock-fix.jsonl`
            const L = [
                { at: 't1', object: 'edge', id: 'e1', stds: ['RS3'], changes: [], before: { edge: { id: 'e1' } } },
                { at: 't1', object: 'edge-review', id: 'e2', stds: ['RS2'], before: {}, hold: 'edge:e2:RS6' },
                { at: 't1', object: 'hold', id: 'edge:e3:RS3', stds: ['RS3'], before: {}, hold: 'edge:e3:RS3' },
                { at: 't1', object: 'note', id: 'n1', stds: ['SS3'], before: {} },
                { at: 't1', object: 'hold', id: 'note:n2:SS2', stds: ['SS2'], before: {}, hold: 'note:n2:SS2' },
                { at: 't1', object: 'core', id: 'k1', stds: ['ES3'], before: {} },
                { at: 't1', object: 'doc', id: 'd1', stds: ['CS10'], before: {} },
                { at: 't2', object: 'edge', id: 'e4', stds: ['RS3'], changes: [], before: { edge: { id: 'e4' } } },
                { at: 't3', object: 'edge', id: 'e5', stds: ['RS3'], changes: [], before: { edge: { id: 'e5' } } },
                { at: 't4', rollbackOf: 't3', object: 'edge', id: 'e5' },
                // 結案列:邊之待判者認、他物件之待判者略過
                { at: 't1', object: 'hold-resolved', id: 'edge:e6:RS3', stds: ['RS3'], before: { hold: {} }, hold: 'edge:e6:RS3' },
                { at: 't1', object: 'hold-resolved', id: 'label:x:CS12', stds: ['CS12'], before: { hold: {} }, hold: 'label:x:CS12' },
            ]
            fs.writeFileSync(f, `${L.slice(0, 3).map((x) => JSON.stringify(x)).join('\n')}\n{壞行\n${L.slice(3).map((x) => JSON.stringify(x)).join('\n')}\n`, 'utf8')
            assert.throws(() => readEdgeStockLedger(f), /有 1 行無法解析（第 4 行：/)
            assert.deepEqual(readEdgeStockLedger(f, { allowBad: true }).map((x) => `${x.object}:${x.id}`), ['edge:e1', 'edge-review:e2', 'hold:edge:e3:RS3', 'edge:e4', 'hold-resolved:edge:e6:RS3'])
            fs.writeFileSync(f, `${L.map((x) => JSON.stringify(x)).join('\n')}\n`, 'utf8')
            assert.deepEqual(readEdgeStockLedger(f).map((x) => `${x.object}:${x.id}`), ['edge:e1', 'edge-review:e2', 'hold:edge:e3:RS3', 'edge:e4', 'hold-resolved:edge:e6:RS3'])
            assert.deepEqual(readEdgeStockLedger(f, { since: 't2' }).map((x) => x.id), ['e4'])
            assert.deepEqual(readEdgeStockLedger(f, { at: 't1' }).map((x) => x.id), ['e1', 'e2', 'edge:e3:RS3', 'edge:e6:RS3'])
        })

        it('連鎖斷言:套用後無問題;邊不在、updatedAt 被改、理由仍未合正體、檢核雜湊未換、待判不在 → 逐一列出;他模組之列略過', async () => {
            const e = env({ checks: true })
            const eA0 = await e.relations.get(e.g.eA.id)
            await recordCheck(e.checks, { object: RS6.objectEdge, oid: eA0.id, hash: await hashOf(e, eA0), std: RS6.std, v: RS6.v, at: T0, status: 'pass', seats: 'p1|p2' })
            const r = await applyEdgeStockFix(e.deps, await planEdgeStockFix(e.deps, {}), { at: AT })
            const rows = [...r.rows, { at: AT, object: 'note', id: 'n1', stds: ['SS3'], before: {} }, { at: AT, object: 'core', id: 'k1', stds: ['ES3'], before: {} }]
            assert.deepEqual(await verifyEdgeStockChain(e.deps, rows), { checked: 4, problems: [] })
            // 逐一破壞
            const eA = await e.relations.get(e.g.eA.id)
            await e.checks.replace({ ...(await e.checks.get(checkKey(RS6.objectEdge, eA.id))), hash: 'x' })
            await e.holds.del(holdKey(RS6.objectEdge, e.g.eB.id, RS6.std))
            let v = await verifyEdgeStockChain(e.deps, rows)
            assert.deepEqual(v.problems, [`邊 ${eA.id}：RS4／RS6 檢核紀錄未隨字形修正換雜湊（下輪會重核）`, `待判 ${holdKey(RS6.objectEdge, e.g.eB.id, RS6.std)}：未登錄`])
            await e.relations.replace({ ...eA, reason: '两篇仍有简体之理由' }) // 理由退回簡體(updatedAt 不變)
            v = await verifyEdgeStockChain(e.deps, rows)
            assert.match(v.problems[0], new RegExp(`^邊 ${eA.id}：理由仍未合正體（理由 \\d+ 處）`))
            await e.relations.replace({ ...eA, updatedAt: AT2 })
            v = await verifyEdgeStockChain(e.deps, rows)
            assert.equal(v.problems[0], `邊 ${eA.id}：updatedAt 被改（${eA.updatedAt} → ${AT2}；重評會誤挑此邊）`)
            await e.relations.del(eA.id)
            assert.equal((await verifyEdgeStockChain(e.deps, rows)).problems[0], `邊 ${eA.id}：處置後不在`)
            // 未開 holds 集合:覆核列無從驗證(列出,不靜默)
            const noHolds = await verifyEdgeStockChain({ stores: { relations: e.relations } }, rows.filter((x) => x.object === 'edge-review'))
            assert.ok(noHolds.problems.length === 3 && noHolds.problems.every((p) => /未開 holds 集合，無從驗證/.test(p)))
        })

        it('回退之順序與使用者裁示:給多列 → 依逆序;同一邊兩次處置而其間有他處改寫 → 先撤第二次(回到他處改寫之值)、第一次之擁有單位其後被改動 → 衝突(不覆寫他處之改寫);套用後使用者豁免之待判回退不改寫、其餘未結者結案;邊已被刪(其後被撤出)→ 衝突、不復活(回退＝撤銷該次處置;2026-10-12 終審 D1 改寫原「回到最初」「寫回」之兩釘)', async () => {
            const e = env()
            const r1 = await applyEdgeStockFix(e.deps, await planEdgeStockFix(e.deps, {}), { at: AT })
            // 其間他處改寫理由(簡體)→ 同一邊之第二次處置再修
            const OTHER = '后来之理由改为简体并加上量测说明'
            await e.relations.replace({ ...(await e.relations.get(e.g.eA.id)), reason: OTHER })
            const r2 = await applyEdgeStockFix(e.deps, await planEdgeStockFix(e.deps, { stds: ['RS3'] }), { at: AT2 })
            assert.equal(r2.rows.length, 1)
            // 使用者於套用後豁免一筆(衝突核對之存量待判)
            const hC = holdKey(RS4.objectEdge, e.g.eC.id, RS4.std)
            await e.holds.patch(hC, { status: 'waived', waivedBy: '使用者', ruling: '確認維持' })
            const rows = readEdgeStockLedger(e.ledger)
            assert.equal(rows.length, 5)
            const rb = await rollbackEdgeStockFix(e.deps, rows, { at: '2026-10-08T06:00:00+08:00' })
            assert.deepEqual([rb.restored, rb.errors, rb.conflicts], [4, [], [{ id: e.g.eA.id, object: 'edge', units: ['reason'] }]])
            assert.equal((await e.relations.get(e.g.eA.id)).reason, OTHER, '撤第二次回到他處改寫之值;第一次不覆寫之')
            assert.equal((await e.holds.get(hC)).status, 'waived', '使用者之裁示不被回退改寫')
            for (const k of [holdKey(RS6.objectEdge, e.g.eB.id, RS6.std), holdKey(RS4.objectEdge, e.g.eE.id, RS4.std)]) assert.equal((await e.holds.get(k)).status, 'resolved', k)
            assert.deepEqual(readEdgeStockLedger(e.ledger).map((x) => [x.object, x.id, x.at]), [['edge', e.g.eA.id, r1.at]], '衝突之第一次處置仍列於帳')
            // 邊已被刪(其後之撤出)→ 衝突:不復活、不記回退列(讀帳仍列);acceptCurrent → 取代列
            const f = env()
            const ra = await applyEdgeStockFix(f.deps, await planEdgeStockFix(f.deps, { stds: ['RS3'] }), { at: AT })
            await f.relations.del(f.g.eA.id)
            const rbf = await rollbackEdgeStockFix(f.deps, ra.rows, { at: AT2 })
            assert.deepEqual([rbf.errors, rbf.restored, rbf.conflicts], [[], 0, [{ id: f.g.eA.id, object: 'edge', units: ['（記錄不在）'] }]])
            assert.equal(await f.relations.get(f.g.eA.id), null, '不復活其後被撤出之邊')
            assert.equal(readEdgeStockLedger(f.ledger).length, 1, '衝突之列仍列於帳')
            const acc = await rollbackEdgeStockFix(f.deps, ra.rows, { at: AT2, acceptCurrent: true })
            assert.deepEqual([acc.accepted, readEdgeStockLedger(f.ledger)], [1, []])
        })

        it('回退防護(擁有單位＝理由與被修之沿革理由):其後他處改動之非擁有欄位(型別、時刻、新增沿革)保留、擁有單位寫回處置前;擁有單位其後被改動 → 衝突(不覆寫)', async () => {
            const e = env()
            const ra = await applyEdgeStockFix(e.deps, await planEdgeStockFix(e.deps, { stds: ['RS3'] }), { at: AT })
            const fixed = await e.relations.get(e.g.eA.id)
            // 其後:合併加入一筆新沿革、updatedAt 推進(非擁有欄位)
            const later = { ...fixed, updatedAt: '2026-10-09T00:00:00+08:00', history: [...fixed.history, { from: 'n2', to: 'n1', type: T, reason: '其後新增之沿革', createdAt: '2026-10-09T00:00:00+08:00' }] }
            await e.relations.replace(later)
            const rb = await rollbackEdgeStockFix(e.deps, ra.rows, { at: AT2 })
            assert.deepEqual([rb.errors, rb.conflicts, rb.restored], [[], [], 1])
            const now = await e.relations.get(e.g.eA.id)
            assert.deepEqual([now.reason, now.history[0].reason, now.history.at(-1).reason, now.updatedAt], [e.g.eA.reason, e.g.eA.history[0].reason, '其後新增之沿革', '2026-10-09T00:00:00+08:00'], '擁有單位回到處置前、其後之改動保留')
            // 擁有單位(理由)其後被改動 → 衝突
            const g = env()
            const rg = await applyEdgeStockFix(g.deps, await planEdgeStockFix(g.deps, { stds: ['RS3'] }), { at: AT })
            await g.relations.patch(g.g.eA.id, { reason: '使用者其後改寫之理由，兩篇都談軌道量測之誤差修正' })
            const rbg = await rollbackEdgeStockFix(g.deps, rg.rows, { at: AT2 })
            assert.deepEqual([rbg.restored, rbg.conflicts], [0, [{ id: g.g.eA.id, object: 'edge', units: ['reason'] }]])
            assert.equal((await g.relations.get(g.g.eA.id)).reason, '使用者其後改寫之理由，兩篇都談軌道量測之誤差修正', '不覆寫')
            // 缺 after 之邊列即錯
            const bad = { ...rg.rows[0], after: undefined }
            assert.match((await rollbackEdgeStockFix(g.deps, [bad], { at: AT2 })).errors[0].error, /帳列缺 after（處置後之值），無從判定其後是否被改動/)
        })

        it('回退逐列:他模組之列(筆記、核心、他物件之待判)restored 0、不報錯;呼叫端依帳之全域逆序逐列交付時,邊列與他列交錯之先後不變,回退列依交付序附寫', async () => {
            const e = env()
            const r = await applyEdgeStockFix(e.deps, await planEdgeStockFix(e.deps, {}), { at: AT })
            const fake = (object, id, stds, extra = {}) => ({ at: AT, object, id, stds, before: {}, ...extra })
            const all = [fake('note', 'n9', ['SS3']), r.rows[0], fake('core', 'k1', ['ES3']), r.rows[1], fake('hold', 'note:n9:SS2', ['SS2'], { hold: 'note:n9:SS2' }), r.rows[2], fake('doc', 'd1', ['CS10']), r.rows[3]]
            const mine = new Set(r.rows)
            const order = []
            for (const row of [...all].reverse()) {
                const rb = await rollbackEdgeStockFix(e.deps, [row], { at: AT2, ledgerFile: e.ledger })
                assert.deepEqual(rb.errors, [], `${row.object}:${row.id}`)
                order.push(`${rb.restored ? 'relate' : 'other'}:${row.object}:${row.id}`)
            }
            assert.deepEqual(order, [...all].reverse().map((x) => `${mine.has(x) ? 'relate' : 'other'}:${x.object}:${x.id}`))
            const back = readJsonlRows(e.ledger).filter((x) => x.rollbackOf)
            assert.deepEqual(back.map((x) => x.id), [...r.rows].reverse().map((x) => x.id), '只附寫本模組之回退列,依交付序')
            assert.deepEqual(await e.relations.get(e.g.eA.id), e.g.eA)
            assert.deepEqual((await rollbackEdgeStockFix(e.deps, [fake('note', 'n9', ['SS3'])], { at: AT2 })), { at: AT2, restored: 0, accepted: 0, conflicts: [], errors: [], affected: [] })
        })
    })

    // ══════════════════════════ 連鎖:檢核雜湊與呼叫端之快照(承接 :305)══════════════════════════
    describe('連鎖:檢核雜湊與呼叫端之連鎖', function() {

        it('RS3 修正後,RS4／RS6 檢核紀錄原與舊值同步者換為新值之雜湊(結果保留、不須重核);原不同步者不動;無紀錄者不造;帳列記 check;回退換回(其後已被推進者不動)', async () => {
            const e = env({ checks: true })
            // 另一條須 RS3 修正之邊(其檢核紀錄本就不同步)
            const eF = makeEdge({ from: 'n4', to: 'n6', type: T, reason: '两篇之后续量测方法', nowIso: T0 })
            await e.relations.insertNew([eF])
            const h0 = await hashOf(e, e.g.eA)
            await recordCheck(e.checks, { object: RS6.objectEdge, oid: e.g.eA.id, hash: h0, std: RS6.std, v: RS6.v, at: T0, status: 'pass', seats: 'p1|p2' })
            await recordCheck(e.checks, { object: RS4.objectEdge, oid: eF.id, hash: 'stale-hash', std: RS4.std, v: RS4.v, at: T0, status: 'pass', seats: 'p1|p2' })
            const plan = await planEdgeStockFix(e.deps, { stds: ['RS3'] })
            assert.deepEqual(plan.items.map((x) => x.id).sort(), [e.g.eA.id, eF.id].sort())
            const r = await applyEdgeStockFix(e.deps, plan, { at: AT })
            assert.deepEqual([r.errors, r.counts], [[], { RS3: 2 }])
            const eA1 = await e.relations.get(e.g.eA.id)
            const h1 = await hashOf(e, eA1)
            const rec = await e.checks.get(checkKey(RS6.objectEdge, e.g.eA.id))
            assert.deepEqual([rec.hash, rec.results.RS6.status, needsCheck(rec, { hash: h1, std: RS6.std, v: RS6.v })], [h1, 'pass', false], '換值、結果保留、不須重核')
            assert.equal((await e.checks.get(checkKey(RS4.objectEdge, eF.id))).hash, 'stale-hash', '原不同步者不動')
            assert.equal(await e.checks.get(checkKey(RS6.objectEdge, e.g.eD.id)), null, '無紀錄者不造')
            const rowA = r.rows.find((x) => x.id === e.g.eA.id)
            assert.deepEqual(rowA.check, { from: h0, to: h1 })
            assert.equal('check' in r.rows.find((x) => x.id === eF.id), false)
            assert.deepEqual((await verifyEdgeStockChain(e.deps, r.rows)).problems, [])
            // 回退換回;其後已被推進者(雜湊已非處置所換之值)不動
            await e.checks.replace({ ...(await e.checks.get(checkKey(RS4.objectEdge, eF.id))), hash: 'later' })
            assert.deepEqual((await rollbackEdgeStockFix(e.deps, r.rows, { at: AT2 })).errors, [])
            assert.equal((await e.checks.get(checkKey(RS6.objectEdge, e.g.eA.id))).hash, h0)
            assert.equal((await e.checks.get(checkKey(RS4.objectEdge, eF.id))).hash, 'later')
            // 推進後之回退:雜湊已被他處改寫者不換回
            const f = env({ checks: true })
            const g0 = await hashOf(f, f.g.eA)
            await recordCheck(f.checks, { object: RS6.objectEdge, oid: f.g.eA.id, hash: g0, std: RS6.std, v: RS6.v, at: T0, status: 'pass', seats: 'p1|p2' })
            const rf = await applyEdgeStockFix(f.deps, await planEdgeStockFix(f.deps, { stds: ['RS3'] }), { at: AT })
            await f.checks.replace({ ...(await f.checks.get(checkKey(RS6.objectEdge, f.g.eA.id))), hash: 'rechecked' })
            await rollbackEdgeStockFix(f.deps, rf.rows, { at: AT2 })
            assert.equal((await f.checks.get(checkKey(RS6.objectEdge, f.g.eA.id))).hash, 'rechecked')
        })

        it('onEdgeFixed(before, after):每條 RS3 修正寫入後呼叫,回傳之物件併入帳列(本模組之欄位不被覆寫);onEdgeRolledBack(row) 於寫回後呼叫——呼叫端以之同步與換回其快照;拋錯者照記帳、列 errors', async () => {
            const e = env()
            const sig = (x) => `${x.type}|${x.reason}`
            const snap = { edges: { [e.g.eA.id]: sig(e.g.eA) } }
            const calls = []
            const r = await applyEdgeStockFix(e.deps, await planEdgeStockFix(e.deps, { stds: ['RS3'] }), {
                at: AT,
                onEdgeFixed: (before, after) => {
                    calls.push([before.reason, after.reason])
                    if (snap.edges[before.id] !== sig(before)) return undefined
                    snap.edges[before.id] = sig(after)
                    return { seen: { from: sig(before), to: sig(after) }, id: '改不了', before: '改不了', stds: ['XX'] }
                },
            })
            assert.deepEqual(calls, [[e.g.eA.reason, (await e.relations.get(e.g.eA.id)).reason]])
            const row = r.rows[0]
            assert.deepEqual([row.id, row.stds, Object.keys(row.before), row.seen], [e.g.eA.id, ['RS3'], ['edge'], { from: sig(e.g.eA), to: snap.edges[e.g.eA.id] }])
            assert.deepEqual(readEdgeStockLedger(e.ledger)[0].seen, row.seen, '併入之欄位落帳')
            const back = []
            await rollbackEdgeStockFix(e.deps, r.rows, {
                at: AT2,
                onEdgeRolledBack: (x) => {
                    back.push(x.id)
                    if (x.seen && snap.edges[x.id] === x.seen.to) snap.edges[x.id] = x.seen.from
                },
            })
            assert.deepEqual([back, snap.edges[e.g.eA.id]], [[e.g.eA.id], sig(e.g.eA)])
            // 拋錯:邊已改寫 → 照記帳(可回退)、列 errors
            const f = env()
            const rf = await applyEdgeStockFix(f.deps, await planEdgeStockFix(f.deps, { stds: ['RS3'] }), {
                at: AT, onEdgeFixed: () => {
                    throw new Error('快照寫不進去')
                },
            })
            assert.deepEqual([rf.counts, rf.rows.length, rf.errors], [{ RS3: 1 }, 1, [{ id: f.g.eA.id, object: 'edge', error: 'onEdgeFixed：快照寫不進去' }]])
        })
    })

    // ══════════════════════════ 修不了者與重算之邊界 ══════════════════════════
    describe('修不了者與重算之邊界', function() {

        // 只剩沿革之字形之修不了者:沿革之理由為非字串之殘形(符合度掃描以字串化判 RS3、確定性修正只處理字串而略過)——現行字表下唯一可得之
        //   「修不了」實例,走預演 → 套用之真實路徑;現行理由經正規化仍不合格者於現行字表下不可達(見 unit-relate-standards 之定義案)
        const historyOnly = () => ({ ...makeEdge({ from: 'n1', to: 'n6', type: T, reason: '兩篇皆以近日點距離之量測方法比較軌道', nowIso: T0 }), history: [{ from: 'n6', to: 'n1', type: '前置概念', reason: ['旧理由之后续'], createdAt: T0 }] })

        it('修不了者(RS3)以現值重判分流——只剩沿革之字形:預演列修不了 → 套用登錄使用者待判 edge:<邊 id>:RS3(下一步 stockHistoryScript、負責者 user、期限 relateHoldDeadlineOf、ctx 兩端與型別;帳列 hold);連鎖斷言照驗;已有未結或已豁免者不重登;豁免後掃描記已豁免、預演不再列;回退不改寫使用者之豁免', async () => {
            const e = env()
            const eH = historyOnly()
            await e.relations.insertNew([eH])
            const plan = await planEdgeStockFix(e.deps, { stds: ['RS3'] })
            const d3 = checkEdge(eH).find((x) => x.std === 'RS3').detail
            assert.match(d3, /^history\[0\] 理由 \d+ 處$/)
            assert.deepEqual([plan.items.map((x) => x.id), plan.unfixable], [[e.g.eA.id], [{ id: eH.id, std: 'RS3', detail: d3 }]], 'edgeFixOf 不處理非字串之沿革 → 修不了')
            const r = await applyEdgeStockFix(e.deps, plan, { at: AT })
            const key = holdKey(RS6.objectEdge, eH.id, 'RS3')
            assert.deepEqual([r.errors, r.counts, r.held, r.alreadyHeld, r.stale], [[], { RS3: 1, held: 1 }, [{ key, id: eH.id, std: 'RS3' }], [], []])
            const h = await e.holds.get(key)
            assert.deepEqual([h.object, h.std, h.owner, h.status, h.next, h.deadline, h.reason, h.ctx],
                ['edge', 'RS3', 'user', 'open', RELATE_HOLD_NEXT.stockHistoryScript, relateHoldDeadlineOf(AT), `存量 RS3：沿革理由之字形確定性修正做不到（${d3}）`, { from: 'n1', to: 'n6', type: T }])
            assert.equal(await e.holds.get(holdKey(RS6.objectEdge, eH.id, RS6.std)), null, '現行理由無須改寫 → 不交兩席')
            const row = r.rows.find((x) => x.object === 'hold')
            assert.deepEqual(row, { at: AT, object: 'hold', id: key, stds: ['RS3'], before: { hold: null }, hold: key })
            assert.deepEqual(await verifyEdgeStockChain(e.deps, r.rows), { checked: 2, problems: [] })
            assert.deepEqual(readEdgeStockLedger(e.ledger).map((x) => x.id), [e.g.eA.id, key], '讀帳認此待判列')
            // 已有未結者不重登
            const r2 = await applyEdgeStockFix(e.deps, plan, { at: AT2 })
            assert.deepEqual([r2.alreadyHeld, r2.rows, r2.stale], [[key], [], [e.g.eA.id]])
            // 使用者豁免 → 掃描記已豁免(鍵即該標準之登錄)、預演不再列;再套用舊計畫不重開
            await e.holds.patch(key, { status: 'waived', waivedBy: '使用者', ruling: '保留沿革原樣' })
            const S3 = (await auditRelateStandards({ stores: e.deps.stores, domain: DOMAIN }, { only: ['RS3'] })).standards.RS3
            assert.deepEqual([S3.violation, S3.waiveds.map((x) => x.id)], [0, [eH.id]])
            assert.deepEqual((await planEdgeStockFix(e.deps, { stds: ['RS3'] })).unfixable, [])
            assert.deepEqual((await applyEdgeStockFix(e.deps, plan, { at: AT2 })).alreadyHeld, [key])
            // 回退:邊還原;使用者之豁免不被改寫
            const rb = await rollbackEdgeStockFix(e.deps, r.rows, { at: AT2 })
            assert.deepEqual([rb.restored, rb.errors, (await e.holds.get(key)).status], [2, [], 'waived'])
        })

        it('修不了者(RS3)以現值重判分流——邊不在、RS3 已合格、現值已可確定性修正(交下次預演之修正項)→ stale 不登錄;他模組之標準略過;RS2／RS8(預演不產生,他處給者)照交兩席改寫;未結之使用者待判照常回退結案', async () => {
            const e = env()
            const plan = {
                items: [],
                unfixable: [
                    { id: 'gone', std: 'RS3', detail: '邊不在' },
                    { id: e.g.eD.id, std: 'RS3', detail: '理由 1 處' }, // RS3 已合格
                    { id: e.g.eA.id, std: 'RS3', detail: '理由 3 處' }, // 現值可確定性修正
                    { id: e.g.eB.id, std: 'RS2', detail: '佔位理由「placeholder」' },
                    { id: 'n1', std: 'SS3', detail: '他模組' },
                ],
            }
            const r = await applyEdgeStockFix(e.deps, plan, { at: AT })
            const kB = holdKey(RS6.objectEdge, e.g.eB.id, RS6.std)
            assert.deepEqual([r.stale, r.held, r.counts, r.errors], [['gone', e.g.eD.id, e.g.eA.id], [{ key: kB, id: e.g.eB.id, std: 'RS2' }], { held: 1 }, []])
            assert.deepEqual((await e.holds.select()).map((x) => x.id), [kB], '只登錄須改寫者')
            const hB = await e.holds.get(kB)
            assert.deepEqual([hB.owner, hB.next, hB.reason, hB.ctx.stockStd], ['pipeline', RELATE_HOLD_NEXT.edgeReviewStock, '存量 RS2：確定性修正做不到（佔位理由「placeholder」）', 'RS2'])
            assert.equal((await e.relations.get(e.g.eA.id)).reason, e.g.eA.reason, '修不了之分流不改寫邊(修正屬修正項)')
            // 使用者待判(未結)之回退:結案
            const f = env()
            const eH = historyOnly()
            await f.relations.insertNew([eH])
            const rf = await applyEdgeStockFix(f.deps, await planEdgeStockFix(f.deps, { stds: ['RS3'] }), { at: AT })
            await rollbackEdgeStockFix(f.deps, rf.rows, { at: AT2 })
            assert.equal((await f.holds.get(holdKey(RS6.objectEdge, eH.id, 'RS3'))).status, 'resolved')
        })

        it('已不再違反之結案(終審 D8;各工作之存量待判件同一機制):使用者待判 edge:<邊 id>:RS3 而沿革已被他途改正 → 預演列 resolvable(受 ids 限、不受 limit 限;仍違反、邊不在、已豁免、已結案、範圍不含 RS3 者不列)→ 套用結案(抓取套件之 closeStockHold:結案列 { object:hold-resolved, before.hold }、counts.resolved;再套用不重結)→ 連鎖斷言認結案列(登錄須在且已結案)→ 回退復原(仍為該次所結者 → 重開;其後豁免者不動);未開 holds → errors', async () => {
            const e = env()
            const eH = historyOnly()
            await e.relations.insertNew([eH])
            const key = holdKey(RS6.objectEdge, eH.id, 'RS3')
            const r0 = await applyEdgeStockFix(e.deps, await planEdgeStockFix(e.deps, { stds: ['RS3'] }), { at: AT })
            assert.deepEqual(r0.held.map((x) => x.key), [key], '前提:修不了者已登錄使用者待判')
            // 仍違反 → 不列
            assert.deepEqual((await planEdgeStockFix(e.deps, { stds: ['RS3'] })).resolvable, [])
            // 沿革被他途改正(字串化之正體)→ RS3 合格 → 列 resolvable;範圍不含 RS3、ids 不含該邊 → 不列;limit 不限
            const fixed = { ...(await e.relations.get(eH.id)), history: [{ ...eH.history[0], reason: '舊理由之後續' }] }
            await e.relations.replace(fixed)
            assert.equal(checkEdge(fixed).find((x) => x.std === 'RS3').status, 'pass', '前提:現值已合格')
            const plan = await planEdgeStockFix(e.deps, { stds: ['RS3'] })
            assert.deepEqual([plan.items, plan.unfixable, plan.resolvable, plan.counts.resolvable], [[], [], [{ key, id: eH.id, std: 'RS3' }], 1], 'eA 已於前次修正;只剩結案項')
            assert.deepEqual((await planEdgeStockFix(e.deps, { stds: ['RS2'] })).resolvable, [], '範圍不含 RS3')
            assert.deepEqual((await planEdgeStockFix(e.deps, { stds: ['RS3'], ids: [e.g.eA.id] })).resolvable, [], 'ids 外')
            assert.deepEqual((await planEdgeStockFix(e.deps, { stds: ['RS3'], ids: [eH.id], limit: 1 })).resolvable.map((x) => x.id), [eH.id], 'ids 內;limit 不限')
            const edges0 = JSON.stringify(await e.relations.select())
            assert.equal(JSON.stringify(await e.relations.select()), edges0, '預演不寫')
            // 套用:結案、結案列、計數;再套用同一計畫不重結、不記
            const r = await applyEdgeStockFix(e.deps, plan, { at: AT2 })
            assert.deepEqual([r.errors, r.counts, r.resolved, r.held, r.rows.map((x) => x.object)], [[], { resolved: 1 }, [key], [], ['hold-resolved']])
            const h = await e.holds.get(key)
            assert.deepEqual([h.status, h.resolvedAt, h.how], ['resolved', AT2, '存量處置重掃已無此違反'])
            const row = r.rows[0]
            assert.deepEqual([Object.keys(row), row.id, row.stds, row.hold, row.before.hold.status, row.before.hold.since], [['at', 'object', 'id', 'stds', 'before', 'hold'], key, ['RS3'], key, 'open', AT])
            assert.deepEqual(readEdgeStockLedger(e.ledger, { at: AT2 }).map((x) => `${x.object}:${x.id}`), [`hold-resolved:${key}`], '讀帳認結案列')
            const again = await applyEdgeStockFix(e.deps, plan, { at: '2026-10-08T06:00:00+08:00' })
            assert.deepEqual([again.resolved, again.rows, again.counts], [[], [], {}], '非未結者不動、不記')
            assert.deepEqual((await planEdgeStockFix(e.deps, { stds: ['RS3'] })).resolvable, [], '已結案者不再列')
            // 連鎖斷言:結案列之登錄須在且已結案
            assert.deepEqual(await verifyEdgeStockChain(e.deps, r.rows), { checked: 1, problems: [] })
            await e.holds.patch(key, { status: 'open' })
            assert.deepEqual((await verifyEdgeStockChain(e.deps, [row])).problems, [`待判 ${key}：未結案`])
            await e.holds.del(key)
            assert.deepEqual((await verifyEdgeStockChain(e.deps, [row])).problems, [`待判 ${key}：不在（結案列之登錄須在）`])
            // 邊不在 → 不列(未能判定不結案;撤出中之邊可還原,其問題仍在)
            const f = env()
            const fH = historyOnly()
            await f.relations.insertNew([fH])
            await applyEdgeStockFix(f.deps, await planEdgeStockFix(f.deps, { stds: ['RS3'] }), { at: AT })
            await f.relations.replace({ ...(await f.relations.get(fH.id)), history: [{ ...fH.history[0], reason: '舊理由之後續' }] })
            const planF = await planEdgeStockFix(f.deps, { stds: ['RS3'] })
            assert.deepEqual(planF.resolvable.map((x) => x.id), [fH.id])
            await f.relations.del(fH.id)
            assert.deepEqual((await planEdgeStockFix(f.deps, { stds: ['RS3'] })).resolvable, [], '邊不在 → 不列')
            // 已豁免者不列;回退:仍為該次所結者重開;其後豁免者不動
            await f.relations.insertNew([{ ...fH, history: [{ ...fH.history[0], reason: '舊理由之後續' }] }])
            const rf = await applyEdgeStockFix(f.deps, planF, { at: AT2 })
            assert.deepEqual([rf.resolved, (await f.holds.get(holdKey(RS6.objectEdge, fH.id, 'RS3'))).status], [[holdKey(RS6.objectEdge, fH.id, 'RS3')], 'resolved'])
            const rb = await rollbackEdgeStockFix(f.deps, rf.rows, { at: '2026-10-08T06:00:00+08:00' })
            const hf = await f.holds.get(holdKey(RS6.objectEdge, fH.id, 'RS3'))
            assert.deepEqual([rb.restored, rb.errors, hf.status, hf.since], [1, [], 'open', AT], '復原為結案前之登錄')
            assert.deepEqual(readEdgeStockLedger(f.ledger, { at: AT2 }), [], '回退列使讀帳不再列之')
            await f.holds.patch(hf.id, { status: 'waived', waivedBy: '使用者', ruling: '保留' })
            assert.deepEqual((await planEdgeStockFix(f.deps, { stds: ['RS3'] })).resolvable, [], '已豁免者不列')
            const rf2 = await applyEdgeStockFix(f.deps, planF, { at: '2026-10-08T07:00:00+08:00' })
            assert.deepEqual(rf2.resolved, [], '已豁免者不結')
            // 結案後使用者豁免 → 回退不改寫(其後之裁示)
            const g = env()
            const gH = historyOnly()
            await g.relations.insertNew([gH])
            await applyEdgeStockFix(g.deps, await planEdgeStockFix(g.deps, { stds: ['RS3'] }), { at: AT })
            await g.relations.replace({ ...(await g.relations.get(gH.id)), history: [{ ...gH.history[0], reason: '舊理由之後續' }] })
            const rg = await applyEdgeStockFix(g.deps, await planEdgeStockFix(g.deps, { stds: ['RS3'] }), { at: AT2 })
            const kg = holdKey(RS6.objectEdge, gH.id, 'RS3')
            await g.holds.patch(kg, { status: 'waived', waivedBy: '使用者', ruling: '保留' })
            await rollbackEdgeStockFix(g.deps, rg.rows, { at: '2026-10-08T06:00:00+08:00' })
            assert.equal((await g.holds.get(kg)).status, 'waived', '其後之豁免不被回退改寫')
            // 未開 holds 集合 → errors(不靜默)
            const n = env({ noHolds: true })
            const rn = await applyEdgeStockFix(n.deps, { resolvable: [{ key: 'edge:x:RS3', id: 'x', std: 'RS3' }, { key: 'core:c:ES3', id: 'c', std: 'ES3' }] }, { at: AT })
            assert.deepEqual(rn.errors.map((x) => [x.id, x.object]), [['edge:x:RS3', 'edge']])
            assert.match(rn.errors[0].error, /未開 holds 集合，已不再違反之待判未結案/)
        })

        it('豁免規則(同一問題之裁示不重提):覆核待判已豁免而其來源即本標準者不重開(RS6／RS2、衝突型 RS4／RS8;列 alreadyHeld);豁免之來源不同或無(型別判不了之豁免)→ 照登錄,前段之裁示留於待判之 history;掃描記同一問題之豁免為已豁免、預演不再列之', async () => {
            const e = env()
            const plan = await planEdgeStockFix(e.deps, {})
            const waived = (e0, std, stockStd) => ({ id: holdKey('edge', e0.id, std), object: 'edge', oid: e0.id, std, status: 'waived', owner: 'pipeline', reason: 'r', next: 'n', since: T0, at: T0, tries: 0, waivedBy: '使用者', ruling: '保留', waivedAt: T0, ctx: stockStd ? { stockStd } : {} })
            await e.holds.replace(waived(e.g.eB, RS6.std, 'RS2')) // 同一問題
            await e.holds.replace(waived(e.g.eC, RS4.std, 'RS8')) // 同一問題(衝突型)
            await e.holds.replace(waived(e.g.eE, RS4.std, 'RS8')) // 不同問題:eE 之項為 RS2
            const r = await applyEdgeStockFix(e.deps, plan, { at: AT })
            const k = (e0, std) => holdKey('edge', e0.id, std)
            assert.deepEqual([r.alreadyHeld, r.counts, r.rows.map((x) => [x.object, x.id])], [[k(e.g.eB, RS6.std), k(e.g.eC, RS4.std)], { RS3: 1, RS2: 1 }, [['edge', e.g.eA.id], ['edge-review', e.g.eE.id]]])
            for (const [e0, std] of [[e.g.eB, RS6.std], [e.g.eC, RS4.std]]) assert.equal((await e.holds.get(k(e0, std))).status, 'waived', `${std} 之同一問題不重開`)
            const hE = await e.holds.get(k(e.g.eE, RS4.std))
            assert.deepEqual([hE.status, hE.ctx.stockStd, hE.history.map((x) => [x.status, x.ruling])], ['open', 'RS2', [['waived', '保留']]], '不同問題照登錄,前段之豁免留存')
            // 掃描:同一問題之豁免記已豁免;重開者仍不合格;預演只剩重開者
            const S = (await auditRelateStandards({ stores: e.deps.stores, domain: DOMAIN }, { only: ['RS2', 'RS8'] })).standards
            assert.deepEqual([S.RS2.waiveds.map((x) => x.id), S.RS2.violations.map((x) => x.id), S.RS8.waiveds.map((x) => x.id), S.RS8.violation], [[e.g.eB.id], [e.g.eE.id], [e.g.eC.id], 0])
            assert.deepEqual((await planEdgeStockFix(e.deps, { stds: ['RS2', 'RS8'] })).items.map((x) => x.id), [e.g.eE.id])
            // 無來源之豁免(如型別判不了)→ 照登錄(新問題)
            const f = env()
            const planF = await planEdgeStockFix(f.deps, { stds: ['RS2'] })
            await f.holds.replace(waived(f.g.eB, RS6.std, null))
            const rf = await applyEdgeStockFix(f.deps, planF, { at: AT })
            const hB = await f.holds.get(k(f.g.eB, RS6.std))
            assert.deepEqual([rf.alreadyHeld, hB.status, hB.ctx.stockStd, hB.history.length], [[], 'open', 'RS2', 1])
        })

        it('登錄件以同一問題鍵守豁免(終審 D3 R65;原則:使用者之裁示不被自動流程推翻):queueEdgeReview／queueConflictCheck 遇已豁免而來源即本次問題 → waived 不重開;不同問題照登錄(前段裁示留於 history);「任何豁免皆不重開」之 respectWaived 已不存在(原始碼盤點)', async () => {
            assert.deepEqual(sourceFilesOf(`${PKG_ROOT}/src`).filter((f) => /respectWaived/.test(fs.readFileSync(`${PKG_ROOT}/src/${f}`, 'utf8'))), [])
            const waived = (e0, std, stockStd) => ({ id: holdKey('edge', e0.id, std), object: 'edge', oid: e0.id, std, status: 'waived', owner: 'pipeline', reason: 'r', next: 'n', since: T0, at: T0, tries: 0, waivedBy: '使用者', ruling: '保留', waivedAt: T0, ctx: stockStd ? { stockStd } : {} })
            const k = (e0, std) => holdKey('edge', e0.id, std)
            const e = env()
            const eB = e.g.eB
            // RS6 待判(來源 RS2)已豁免:RS2 之再登錄 → waived;RS1(維護之清單外型別)之登錄 → 不同問題,照登錄(重開、前段裁示入 history)
            await e.holds.replace(waived(eB, RS6.std, 'RS2'))
            assert.equal(await queueEdgeReview(e.holds, eB, { std: 'RS2', why: 'x', at: AT }), 'waived')
            assert.equal(await queueEdgeReview(e.holds, eB, { std: 'RS1', why: '型別不在清單', at: AT }), 'queued')
            const h = await e.holds.get(k(eB, RS6.std))
            assert.deepEqual([h.status, h.ctx.stockStd, h.history.length], ['open', 'RS1', 1])
            // RS4 待判(來源 RS8)已豁免:同一問題之轉交 → waived;無來源(他段交回)→ 照登錄
            const eA = e.g.eA
            await e.holds.replace({ ...waived(eA, RS4.std, 'RS8'), object: RS6.objectEdge })
            assert.equal(await queueConflictCheck(e.holds, { edgeId: eA.id, from: eA.from, to: eA.to, reason: 'r', at: AT, ctx: { stockStd: 'RS8' } }), 'waived')
            assert.equal(await queueConflictCheck(e.holds, { edgeId: eA.id, from: eA.from, to: eA.to, reason: '下游判非對立', at: AT }), 'queued')
        })

        it('預演之修不了:掃描後讀不到之邊列 unfixable(邊不在);RS3 之修不了於達上限前照列', async () => {
            const e = env({ relations: (s) => ({ ...s, get: async (id) => (id === makeEdge({ from: 'n1', to: 'n2' }).id ? null : s.get(id)) }) })
            const plan = await planEdgeStockFix(e.deps, { stds: ['RS3'] })
            assert.deepEqual([plan.items, plan.unfixable], [[], [{ id: e.g.eA.id, std: 'RS3', detail: '邊不在' }]])
            assert.deepEqual(plan.counts, { violations: { RS3: 1 }, items: 0, unfixable: 1, resolvable: 0, fixes: {} })
        })

        it('逐條以現值重算:同一計畫套用兩次 → 第二次 RS3 全列 stale、不寫帳;預演後邊已被改好或已刪者列 stale;未開 holds 集合 → RS2／RS8 與修不了者列 errors(不靜默),RS3 照修', async () => {
            const e = env()
            const plan = await planEdgeStockFix(e.deps, { stds: ['RS3'] })
            await applyEdgeStockFix(e.deps, plan, { at: AT })
            const second = await applyEdgeStockFix(e.deps, plan, { at: AT2 })
            assert.deepEqual([second.stale, second.rows, second.counts], [[e.g.eA.id], [], {}])
            const f = env()
            const plan2 = await planEdgeStockFix(f.deps, {})
            await f.relations.del(f.g.eB.id)
            const r = await applyEdgeStockFix(f.deps, plan2, { at: AT })
            assert.deepEqual(r.stale, [f.g.eB.id])
            const g = env({ noHolds: true })
            const eH = historyOnly()
            await g.relations.insertNew([eH])
            const r3 = await applyEdgeStockFix(g.deps, await planEdgeStockFix(g.deps, {}), { at: AT })
            assert.deepEqual(r3.errors.map((x) => [x.id, x.object]), [[g.g.eB.id, 'edge-review'], [g.g.eE.id, 'edge-review'], [g.g.eC.id, 'edge-review'], [eH.id, 'edge']])
            assert.ok(r3.errors.slice(0, 3).every((x) => /未開 holds 集合，須改寫理由之存量未登錄待判/.test(x.error)) && /未開 holds 集合，修不了之存量未登錄待判/.test(r3.errors[3].error))
            assert.deepEqual(r3.counts, { RS3: 1 }, 'RS3 照修')
        })

        it('設定之檢核:缺集合(或其方法)、缺 domain 即拋(套用於寫入前);opt 非物件 → 預設;計畫非物件 → 不處置;連鎖斷言與回退缺邊集合即拋', async () => {
            const e = env()
            await assert.rejects(() => planEdgeStockFix({ stores: { relations: e.relations }, domain: DOMAIN }), /需要 deps\.stores\.relations（具 select／get 方法）與 deps\.stores\.notes/)
            await assert.rejects(() => planEdgeStockFix({ stores: e.deps.stores }), /planEdgeStockFix 需要 deps\.domain/)
            await assert.rejects(() => applyEdgeStockFix({ ...e.deps, domain: { relationTypes: [] } }, {}), /applyEdgeStockFix 需要 deps\.domain/)
            assert.equal(fs.existsSync(e.deps.dirs.state), false, '缺 domain:未寫任何東西')
            await assert.rejects(() => applyEdgeStockFix({ stores: { relations: { get: async () => null } }, domain: DOMAIN }, {}), /需要 deps\.stores\.relations（具 get／patch／replace 方法）/)
            await assert.rejects(() => verifyEdgeStockChain(undefined, []), /需要 deps\.stores\.relations/)
            await assert.rejects(() => rollbackEdgeStockFix({}, []), /需要 deps\.stores\.relations/)
            assert.equal((await planEdgeStockFix(e.deps, 'x')).items.length, 4)
            const r = await applyEdgeStockFix(e.deps, null, { at: AT })
            assert.deepEqual([r.rows, r.held, r.errors, r.affected], [[], [], [], []])
        })
    })

    // ══════════════════════════ 真 LMDB ══════════════════════════
    describe('真 LMDB', function() {

        it('邊、筆記、待判、檢核紀錄在 LMDB 集合:RS3 修正之 history 真正寫回(集合 patch 為深合併)、待判登錄、雜湊同步;連鎖斷言無問題;回退後逐欄還原', async () => {
            const lm = {}
            const e = env({
                checks: true,
                stores: (name, rows) => {
                    lm[name] = W.openCollection({ WOrm, path: `${TMP}/lmdb${seq}/db`, db: 'knowledge', cl: name })
                    lm[`${name}Rows`] = rows
                    return lm[name]
                },
            })
            try {
                for (const k of ['notes', 'relations']) await lm[k].insertNew(lm[`${k}Rows`])
                const h0 = await hashOf(e, e.g.eA)
                await recordCheck(e.checks, { object: RS6.objectEdge, oid: e.g.eA.id, hash: h0, std: RS6.std, v: RS6.v, at: T0, status: 'pass', seats: 'p1|p2' })
                const r = await applyEdgeStockFix(e.deps, await planEdgeStockFix(e.deps, {}), { at: AT })
                assert.deepEqual([r.errors, r.counts], [[], { RS3: 1, RS2: 2, RS8: 1 }])
                const eA = await lm.relations.get(e.g.eA.id)
                assert.deepEqual([eA.reason, eA.history.map((x) => x.reason), eA.updatedAt], ['兩篇都討論軌道之量測，見 [[旧-slug]] 與 https://x.test/数据', ['先理解軌道再看量測'], e.g.eA.updatedAt])
                assert.equal((await lm.holds.get(holdKey(RS4.objectEdge, e.g.eC.id, RS4.std))).status, 'open')
                assert.notEqual((await lm.checks.get(checkKey(RS6.objectEdge, e.g.eA.id))).hash, h0)
                assert.deepEqual(await verifyEdgeStockChain(e.deps, r.rows), { checked: 4, problems: [] })
                const rb = await rollbackEdgeStockFix(e.deps, readEdgeStockLedger(e.ledger), { at: AT2 })
                assert.deepEqual(rb.errors, [])
                assert.deepEqual(await lm.relations.get(e.g.eA.id), e.g.eA)
                assert.deepEqual([(await lm.checks.get(checkKey(RS6.objectEdge, e.g.eA.id))).hash, (await lm.holds.get(holdKey(RS4.objectEdge, e.g.eC.id, RS4.std))).status], [h0, 'resolved'])
            }
            finally {
                for (const k of ['notes', 'relations', 'holds', 'checks']) await lm[k]?.close()
            }
        })
    })

    // ══════════════════════════ 投影之共用 API ══════════════════════════
    describe('投影之共用 API(projectAffected、neighborsOf)', function() {

        it('projectAffected:現存者(去重、依輸入序)記待投影、總覽待重建、當場投影(成功者出帳;md 之關聯章依邊庫);不存在者略過;皆不存在 → 不開帳、不寫', async () => {
            const e = env()
            const p = await projectAffected(e.deps, ['n1', 'n2', 'gone', 'n1'])
            assert.deepEqual([p.ids, p.projected.projected, p.projected.gone], [['n1', 'n2'], 2, 0])
            const L = e.state()
            assert.deepEqual([L.dirty.ids(), L.state.get().indexDirty], [[], true], '投影成功者出帳;總覽待重建')
            const md1 = readMd(`${e.dir}/notes/n1.md`)
            assert.ok(md1.body.includes('## 關聯') && md1.body.includes('[[n2]]') && (md1.front.related || []).includes('n2'), md1.body)
            assert.equal((await e.notes.get('n1')).relatedCount, 1)
            const f = env()
            assert.deepEqual(await projectAffected(f.deps, ['gone', '', null]), { ids: [], projected: null })
            assert.equal(fs.existsSync(f.deps.dirs.state), false, '不開帳、不寫')
        })

        it('projectAffected 之 project:false 只記帳(下輪投影子階段補投,md 不動);給 opt.ledgers 即用之;缺 domain 而須投影 → 寫入前拋;缺帳之位置 → 拋', async () => {
            const e = env()
            const md0 = fs.readFileSync(`${e.dir}/notes/n3.md`, 'utf8')
            const L = e.state()
            const p = await projectAffected({ stores: e.deps.stores }, ['n3', 'n4'], { ledgers: L, project: false })
            assert.deepEqual([p, L.dirty.ids(), e.state().state.get().indexDirty], [{ ids: ['n3', 'n4'], projected: null }, ['n3', 'n4'], true])
            assert.equal(fs.readFileSync(`${e.dir}/notes/n3.md`, 'utf8'), md0)
            const f = env()
            await assert.rejects(() => projectAffected({ ...f.deps, domain: null }, ['n1']), /projectAffected 需要 deps\.domain/)
            assert.equal(fs.existsSync(f.deps.dirs.state), false, '寫入前拋')
            await assert.rejects(() => projectAffected({ stores: f.deps.stores, domain: DOMAIN }, ['n1']), /需要 deps\.dirs\.state/)
            await assert.rejects(() => projectAffected({ stores: {} }, ['n1'], { project: false }), /需要 deps\.stores\.notes/)
        })

        it('neighborsOf:一次讀邊庫之鄰居聯集(互為鄰居者各列;依 ids 之序與鄰接序、去重);ids 為空不讀邊庫;缺邊集合即拋', async () => {
            const e = env()
            assert.deepEqual(await neighborsOf(e.deps.stores, ['n1']), ['n2'])
            assert.deepEqual(await neighborsOf(e.deps.stores, ['n2', 'n3', 'n2']), ['n1', 'n3', 'n2', 'n4'])
            assert.deepEqual(await neighborsOf(e.deps.stores, ['nX']), [])
            let reads = 0
            const spy = { relations: { select: async () => (++reads, []) } }
            assert.deepEqual([await neighborsOf(spy, []), await neighborsOf(spy, undefined), reads], [[], [], 0])
            await assert.rejects(() => neighborsOf({}, ['n1']), /neighborsOf 需要 stores\.relations/)
        })

        it('維運 op 之先記後寫:restoreEdge(apply)先記兩端待投影＋總覽待重建,預設當場投影(project:false 只記帳,下輪投影子階段補投——與刪除、撤銷、還原同一投影預設);restoreNote 記本篇與帶回之鄰居', async () => {
            const e = env()
            const L0 = e.state()
            await retireEdge({ relations: e.relations, ledgers: L0, stateDir: e.deps.dirs.state }, e.g.eD, { reason: 'std-retire', at: AT, conflictTypes: DOMAIN.conflictTypeNames })
            L0.dirty.remove(L0.dirty.ids())
            L0.state.set({ indexDirty: false })
            const md4 = fs.readFileSync(`${e.dir}/notes/n4.md`, 'utf8')
            const r = await restoreEdge(e.deps, e.g.eD.id, { apply: true, project: false })
            assert.equal(r.applied, true, r.reason)
            assert.deepEqual([e.state().dirty.ids(), e.state().state.get().indexDirty, r.projected], [['n4', 'n5'], true, null])
            assert.equal(fs.readFileSync(`${e.dir}/notes/n4.md`, 'utf8'), md4, 'project:false 不當場投影(下輪投影子階段)')
            const e2 = env()
            await retireEdge({ relations: e2.relations, ledgers: e2.state(), stateDir: e2.deps.dirs.state }, e2.g.eD, { reason: 'std-retire', at: AT, conflictTypes: DOMAIN.conflictTypeNames })
            const r2 = await restoreEdge(e2.deps, e2.g.eD.id, { apply: true })
            assert.deepEqual([r2.applied, r2.projected.projected, e2.state().dirty.ids()], [true, 2, []], '預設當場投影兩端(出帳)')
            const f = env()
            await deleteNote(f.deps, 'n4', { reason: '測試刪除' })
            const L1 = f.state()
            L1.dirty.remove(L1.dirty.ids())
            L1.state.set({ indexDirty: false })
            const rn = await restoreNote(f.deps, 'n4', { project: false, conflictCheck: false })
            assert.deepEqual([rn.edgesRestored, rn.edgesRejected.map((x) => x.id)], [1, [f.g.eC.id]], 'eC 之理由含兩端皆無之數字(RS8),還原過閘不合格')
            assert.deepEqual([f.state().dirty.ids(), f.state().state.get().indexDirty], [['n4', 'n5'], true])
        })
    })
})
