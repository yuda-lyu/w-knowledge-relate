// unit-relate-provenance.test.mjs — 邊之產出鏈之積木與選件:createEdgeProvenance、stampEdge、voteOfVerdict、relateSeatPathOf、persistEdge／rewriteEdge 之 produced 選項、
//   edgesByProvenance(依產出鏈選件之維運件;純讀)、graph.json 之開關、撤出理由 reprocess;整輪之選件 → 撤出走既有稽核撤出路徑
// 規格:跨套件規格〈知識套件之產出鏈〉§2、§2.3、§6(選件:條件皆為且;since／until 比對 produced.at;history:true 比對 producedHistory 任一筆)、§7 驗收③;
//   輸入檢測依〈輸入參數之檢測機制〉(必須參數無效即拒收、訊息 invalid <名稱>: must be <種類描述> 且不回顯輸入值)
// 各段寫邊點之行為(stage、seat、provider、歷史)見 unit-flow-provenance
// 執行:自套件根 node <mocha> test/unit-relate-provenance.test.mjs(暫存 test/_tmp/relate-prov2-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { memStore, removeRoots, sleep } from './tools/captureForTest.mjs'
import { tmpRoot, resetConceptFold, landNote, scriptedAi, relateAnswer, buildTestRelate, withStores, seedNotes, readJsonFile, PKG_ROOT } from './tools/relateTestKit.mjs'
import * as entry from '../src/WKnowledgeRelate.mjs'
import {
    createEdgeProvenance, stampEdge, voteOfVerdict, EDGE_PRODUCED_STAGES, PROPOSER_ROLE_OF_SEGMENT,
    producedFieldsOf, withProducedRestored, producedUndoPlanOf, PRODUCED_FIELD_KEYS, PRODUCED_UNDO_WHY,
} from '../src/stores/edgeProvenance.mjs'
import { persistEdge, makeEdge, edgeId, typeRankOf } from '../src/stores/edgeStore.mjs'
import { rewriteEdge } from '../src/stores/edgeRewrite.mjs'
import { openRelateLedgers, readAuditRows, LEDGER_FILES } from '../src/stores/relateLedgers.mjs'
import { retireEdge, RETIRE_REASONS, RESTORABLE_REASONS } from '../src/stores/edgeRetire.mjs'
import { relateSeatPathOf, RELATE_SEGMENTS, resolveRelateSettings, RELATE_DEFAULT } from '../src/core/relateSettings.mjs'
import { edgesByProvenance, PROVENANCE_QUERY_KEYS } from '../src/ops/provenanceOps.mjs'
import { rebuildRelationIndex } from '../src/stages/relationIndexStage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'

let TMP = ''
const DOMAIN = createRelateDomain({})
const C = DOMAIN.conflictType
const [T0, T1] = DOMAIN.relationTypes.filter((t) => t !== C)
const rank = typeRankOf(DOMAIN)
const PKG = JSON.parse(fs.readFileSync(`${PKG_ROOT}/package.json`, 'utf8'))
const AT = '2026-11-08T20:12:31+08:00'
const FP = '5118f8f40bf0dc40'
const REASON = '兩篇皆以波動度調整部位，屬同一機制之延伸'
let seq = 0

const P = (o = {}) => ({ v: 1, stamp: '20261108100000', stage: 'relate', seat: 'relate.ai', provider: 'p1', pkg: 'w-demo@1.0.0', at: '2026-11-08T10:00:00+08:00', ...o })
const prov = (o = {}) => createEdgeProvenance({ stamp: '20261108200009', nowIso: () => AT, ...o })
/** 記憶體邊集合(get／insertNew／patch／replace;patch 為淺合併,同現行集合之合併語意之子集) */
const store = (rows = []) => memStore(rows)
const deepFreeze = (x) => {
    if (x && typeof x === 'object' && !Object.isFrozen(x)) {
        Object.freeze(x)
        Object.values(x).forEach(deepFreeze)
    }
    return x
}

describe('unit-relate-provenance', function() {

    this.timeout(120_000)

    before(() => {
        TMP = tmpRoot('relate-prov2')
    })
    after(() => removeRoots([TMP]))

    // ══════════════════ createEdgeProvenance ══════════════════
    describe('createEdgeProvenance', () => {

        it('單一產出者:鍵序 v、stamp、stage、seat、provider、promptFp、pkg、at;pkg＝本套件之 name@version;promptFp 依角色取、16 碼小寫十六進位才收', () => {
            const calls = []
            const p = prov({ promptFpOf: (role) => (calls.push(role), FP) }).make({ stage: 'relate', seat: 'relate.ai', provider: 'codex:gpt-6.1-terra', role: 'relate' })
            assert.deepEqual(Object.keys(p), ['v', 'stamp', 'stage', 'seat', 'provider', 'promptFp', 'pkg', 'at'])
            assert.deepEqual([p.v, p.stamp, p.stage, p.seat, p.provider, p.promptFp, p.pkg, p.at], [1, '20261108200009', 'relate', 'relate.ai', 'codex:gpt-6.1-terra', FP, `${PKG.name}@${PKG.version}`, AT])
            assert.deepEqual(calls, ['relate'])
            for (const bad of [null, undefined, '', 'XYZ', '5118F8F40BF0DC40', '5118f8f40bf0dc4', '5118f8f40bf0dc400', 5118, {}]) {
                const q = prov({ promptFpOf: () => bad }).make({ stage: 'relate', seat: 'relate.ai', provider: 'p', role: 'relate' })
                assert.equal(Object.hasOwn(q, 'promptFp'), false, `無效指紋省略該欄:${typeof bad}`)
            }
            assert.equal(Object.hasOwn(prov().make({ stage: 'relate', seat: 'relate.ai', provider: 'p', role: 'relate' }), 'promptFp'), false, '未注入 promptFpOf:無指紋')
            assert.equal(Object.hasOwn(prov({ promptFpOf: () => FP }).make({ stage: 'relate', seat: 'relate.ai', provider: 'p' }), 'promptFp'), false, '未給角色:不取指紋')
        })

        it('不呼叫 AI 之寫入:seat 與 provider 同時 null、不取指紋;只其一為 null 即拋(訊息不回顯輸入值);stage 須為小寫連字號名', () => {
            const calls = []
            const pv = prov({ promptFpOf: (r) => (calls.push(r), FP) })
            const n = pv.make({ stage: 'standards-fix', seat: null, provider: null, role: 'relate' })
            assert.deepEqual([n.seat, n.provider, Object.hasOwn(n, 'promptFp'), calls.length], [null, null, false, 0])
            assert.throws(() => pv.make({ stage: 'standards-fix', seat: 'a', provider: null }), { message: 'invalid o.seat and o.provider: must be both non-empty strings or both null' })
            assert.throws(() => pv.make({ stage: 'standards-fix', seat: null, provider: 'SECRET-PROVIDER' }), (e) => /both non-empty strings or both null/.test(e.message) && !/SECRET/.test(e.message))
            assert.throws(() => pv.make({ stage: 'Standards_Fix', seat: null, provider: null }), { message: 'invalid o.stage: must be a lowercase kebab-case name' })
            assert.throws(() => pv.make({ seat: null, provider: null }), { message: 'invalid o.stage: must be a lowercase kebab-case name' })
        })

        it('成交者空字串(調度層未回成交者)→ make 回 null(不寫產出鏈,不以占位字樣代之);seat 空字串同', () => {
            const pv = prov()
            assert.equal(pv.make({ stage: 'relate', seat: 'relate.ai', provider: '' }), null)
            assert.equal(pv.make({ stage: 'relate', seat: '', provider: 'p' }), null)
            assert.equal(pv.make({ stage: 'relate', seat: 'relate.ai', provider: undefined }), null)
        })

        it('stamp:未給＝null(輪次外);14 碼字串;格式不符於 make 時依 makeProduced 拋;opt 非物件視為未給;寫入時刻格式不符(非 YYYY-MM-DDTHH:mm:ss±hh:mm)取現在', () => {
            const mk = (o) => createEdgeProvenance(o).make({ stage: 'relate', seat: 's', provider: 'p' })
            assert.equal(mk({}).stamp, null)
            assert.equal(mk().stamp, null)
            assert.equal(mk('x').stamp, null, 'opt 非物件視為未給')
            assert.equal(mk({ stamp: '20261108200009' }).stamp, '20261108200009')
            assert.throws(() => mk({ stamp: '2026' }), { message: 'invalid o.stamp: must be a 14-digit stamp string or null' })
            assert.equal(mk({ nowIso: () => AT }).at, AT)
            for (const bad of ['T1', '2026-11-08T20:12:31Z', '2026-11-08T20:12:31.123+08:00', '', null, 5]) {
                assert.match(mk({ nowIso: () => bad }).at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, `at 取現在:${String(bad)}`)
            }
        })

        it('階段常數與提案席之角色對應(規格 §4 relate 列;提案來源段 → 評比角色)', () => {
            assert.deepEqual(Object.values(EDGE_PRODUCED_STAGES), ['relate', 'reverse', 'reeval', 'conflict-check', 'edge-review', 'standards-fix'])
            assert.deepEqual(PROPOSER_ROLE_OF_SEGMENT, { forward: 'relate', reverse: 'relate', rotation: 'relate', reeval: 'reeval', edgeReview: 'edge-review' })
            assert.ok(Object.isFrozen(EDGE_PRODUCED_STAGES) && Object.isFrozen(PROPOSER_ROLE_OF_SEGMENT))
        })
    })

    // ══════════════════ stampEdge ══════════════════
    describe('stampEdge', () => {

        it('新建(stored null):三欄齊備、歷史 1 筆且最末筆同 produced;不改輸入;produced 為 null → 原樣回傳同一物件', () => {
            const edge = deepFreeze({ id: 'e', type: '甲' })
            const p = prov().make({ stage: 'relate', seat: 'relate.ai', provider: 'p' })
            const e1 = stampEdge(edge, null, p)
            assert.deepEqual([e1.produced, e1.producedHistory, e1.producedHistoryDropped, e1.type], [p, [p], 0, '甲'])
            assert.notEqual(e1.produced, e1.producedHistory[0], '歷史各筆為新物件(改一不牽動另一)')
            assert.equal(Object.hasOwn(edge, 'produced'), false, '輸入未被改')
            assert.equal(stampEdge(edge, null, null), edge)
            assert.equal(stampEdge(edge, null, undefined), edge)
        })

        it('追加:歷史 +1(舊→新);以 stored 為基底(edge 上之舊三欄不影響);歷史上限 50:滿額再追加捨最舊並累計 producedHistoryDropped', () => {
            let cur = stampEdge({ id: 'e' }, null, prov({}).make({ stage: 'relate', seat: 's', provider: 'p0' }))
            for (let i = 1; i <= 51; i++) cur = stampEdge({ ...cur }, cur, createEdgeProvenance({ stamp: null, nowIso: () => AT }).make({ stage: 'reeval', seat: 'first', provider: `p${i}` }))
            assert.equal(cur.producedHistory.length, 50)
            assert.equal(cur.producedHistoryDropped, 2, '共 52 次寫入,留 50、捨 2')
            assert.deepEqual([cur.producedHistory[0].provider, cur.producedHistory[49].provider, cur.produced.provider], ['p2', 'p51', 'p51'], '捨最舊;produced＝最末筆')
            // edge 上帶別的舊三欄:仍以 stored 為準
            const s = stampEdge({ id: 'e' }, null, prov().make({ stage: 'relate', seat: 's', provider: 'p1' }))
            const next = stampEdge({ id: 'e', produced: { v: 1 }, producedHistory: [], producedHistoryDropped: 99 }, s, prov().make({ stage: 'relate', seat: 's', provider: 'p2' }))
            assert.deepEqual([next.producedHistory.map((x) => x.provider), next.producedHistoryDropped], [['p1', 'p2'], 0])
        })

        it('stored 之歷史形狀不合(非陣列、含非物件、捨去數非非負整數)即拋;produced 不合結構即拋', () => {
            const p = prov().make({ stage: 'relate', seat: 's', provider: 'p' })
            assert.throws(() => stampEdge({ id: 'e' }, { producedHistory: 'x' }, p), { message: 'invalid rec.producedHistory: must be an array' })
            assert.throws(() => stampEdge({ id: 'e' }, { producedHistory: [1] }, p), /rec\.producedHistory\[0\]/)
            assert.throws(() => stampEdge({ id: 'e' }, { producedHistoryDropped: -1 }, p), /rec\.producedHistoryDropped/)
            assert.throws(() => stampEdge({ id: 'e' }, null, { stage: 'relate' }), /invalid produced\./)
        })
    })

    // ══════════════════ voteOfVerdict ══════════════════
    describe('voteOfVerdict', () => {

        it('以參照回找該票;參照不在時以型別、理由、裁決比對;找不到、裁決值非物件、票非陣列 → null;不認缺票與非物件之票', () => {
            const a = { verdict: 'change', type: T0, reason: '理由一一一一一一一' }
            const b = { verdict: 'change', type: T0, reason: '理由二二二二二二二' }
            const votes = [{ seat: 'first', provider: 'p1', verdict: a }, { seat: 'second', provider: 'p2', verdict: b }, { seat: 'third', provider: 'p3', verdict: null }, null]
            assert.equal(voteOfVerdict(votes, b).seat, 'second')
            assert.equal(voteOfVerdict(votes, a).provider, 'p1')
            assert.equal(voteOfVerdict(votes, { ...b }).seat, 'second', '參照不在:以內容比對')
            assert.equal(voteOfVerdict(votes, { verdict: 'change', type: T1, reason: b.reason }), null, '型別不同不算同一票')
            for (const x of [null, undefined, 'unsure', 5]) assert.equal(voteOfVerdict(votes, x), null)
            for (const v of [null, undefined, 'x', {}]) assert.equal(voteOfVerdict(v, a), null)
        })
    })

    // ══════════════════ 撤銷產出鏈(回退、撤回之共用件) ══════════════════
    describe('producedFieldsOf／withProducedRestored／producedUndoPlanOf(撤銷而非追加)', () => {

        const pe = (n, o = {}) => P({ stage: 'edge-review', seat: 'first', provider: `p${n}`, at: '2026-11-08T10:00:00+08:00', ...o })
        const chain = (...ps) => ({ produced: ps[ps.length - 1], producedHistory: ps, producedHistoryDropped: 0 })
        const row = (edge = {}, at = '2026-11-08T10:00:01+08:00') => ({ at, edge })

        it('producedFieldsOf:只取邊上有之三欄、為新物件(改之不牽動輸入);非物件、無欄回 {}', () => {
            const e = { id: 'e', type: T0, ...chain(pe(1)) }
            const f = producedFieldsOf(e)
            assert.deepEqual(Object.keys(f), ['produced', 'producedHistory', 'producedHistoryDropped'])
            f.produced.provider = 'CHANGED'
            f.producedHistory.push(1)
            assert.deepEqual([e.produced.provider, e.producedHistory.length], ['p1', 1])
            assert.deepEqual(producedFieldsOf({ id: 'e', produced: pe(1) }), { produced: pe(1) }, '只帶有之欄')
            for (const x of [{ id: 'e' }, null, undefined, 'x', []]) assert.deepEqual(producedFieldsOf(x), {})
            assert.deepEqual(PRODUCED_FIELD_KEYS, ['produced', 'producedHistory', 'producedHistoryDropped'])
        })

        it('withProducedRestored:三欄換成給定之值(邊上之舊三欄先移除、其餘欄位不動、不改輸入);{}＝移除三欄;只給部分欄則只放該些', () => {
            const e = deepFreeze({ id: 'e', type: T0, reason: 'r', ...chain(pe(1), pe(2)) })
            const a = withProducedRestored(e, chain(pe(1)))
            assert.deepEqual([a.id, a.type, a.reason, a.produced.provider, a.producedHistory.length], ['e', T0, 'r', 'p1', 1])
            assert.deepEqual(withProducedRestored(e, {}), { id: 'e', type: T0, reason: 'r' })
            assert.deepEqual(Object.keys(withProducedRestored(e, { produced: pe(9) })).sort(), ['id', 'produced', 'reason', 'type'])
            assert.equal(e.producedHistory.length, 2, '輸入未被改')
        })

        it('producedUndoPlanOf:列之 edge 帶改寫前三欄 → 原樣換回(how row;不看現行邊,含改寫未留產出鏈者)', () => {
            const pre = chain(pe(1))
            const cur = chain(pe(1), pe(2))
            assert.deepEqual(producedUndoPlanOf(cur, row(pre), 'edge-review'), { done: true, how: 'row', restore: pre })
            assert.deepEqual(producedUndoPlanOf({}, row(pre), 'reeval').how, 'row', '不看階段、時刻與現行邊')
        })

        it('producedUndoPlanOf:列無三欄 → 現行 produced 為歷史末筆、階段＝該段、時刻不晚於列 → 退一筆(歷史 ≥ 2:produced＝次末筆、歷史少一筆、捨去數照舊);歷史只有一筆且無捨去者 → 移除三欄', () => {
            const cur = { ...chain(pe(1), pe(2), pe(3)), producedHistoryDropped: 4 }
            const p = producedUndoPlanOf(cur, row(), 'edge-review')
            assert.deepEqual([p.done, p.how], [true, 'history'])
            assert.deepEqual([p.restore.produced.provider, p.restore.producedHistory.map((x) => x.provider), p.restore.producedHistoryDropped], ['p2', ['p1', 'p2'], 4])
            assert.deepEqual(producedUndoPlanOf(chain(pe(1)), row(), 'edge-review'), { done: true, how: 'history', restore: {} })
            assert.equal(producedUndoPlanOf(chain(pe(1), pe(2)), row(undefined, '2026-11-08T10:00:00+08:00'), 'edge-review').how, 'history', '時刻相等(同一秒)亦算該次改寫所留')
            assert.equal(producedUndoPlanOf(chain(pe(1), pe(2)), row(undefined, '2026-11-08T02:00:01Z'), 'edge-review').how, 'history', '依時刻先後,不依字串(Z 與 +08:00)')
        })

        it('producedUndoPlanOf:判不了 → 不動(restore null)並帶原因字樣;現行邊與列皆無產出鏈 → 無須動(how none、done true)', () => {
            const ok = chain(pe(1), pe(2))
            const why = (cur, r = row(), stage = 'edge-review') => producedUndoPlanOf(cur, r, stage)
            const no = (w) => ({ done: false, how: 'none', why: w, restore: null })
            assert.deepEqual(why({ produced: pe(2) }), no('history-mismatch'), '無歷史')
            assert.deepEqual(why({ ...ok, producedHistory: [pe(1), pe(3)] }), no('history-mismatch'), 'produced 非歷史末筆')
            assert.deepEqual(why({ ...ok, producedHistory: [] }), no('history-mismatch'), '歷史空')
            assert.deepEqual(why(ok, row(), 'reeval'), no('stage-mismatch'))
            assert.deepEqual(why(ok, row(undefined, '2026-11-08T09:59:59+08:00')), no('newer-than-row'))
            assert.deepEqual(why(ok, row(undefined, 'T1')), no('at-unverifiable'), '列之時刻不可解析')
            assert.deepEqual(why(chain(pe(1, { at: 'T1' }), pe(2, { at: 'T1' }))), no('at-unverifiable'), 'produced.at 不可解析')
            assert.deepEqual(why({ ...chain(pe(1)), producedHistoryDropped: 2 }), no('history-dropped'), '歷史只有一筆而已捨去過更舊者')
            assert.deepEqual(why({ id: 'e' }), { done: true, how: 'none', restore: null })
            assert.deepEqual(why(null, null), { done: true, how: 'none', restore: null })
            assert.deepEqual(PRODUCED_UNDO_WHY, { historyMismatch: 'history-mismatch', stageMismatch: 'stage-mismatch', atUnverifiable: 'at-unverifiable', newerThanRow: 'newer-than-row', historyDropped: 'history-dropped' })
        })

        it('rewriteEdge 之 o.restoreProduced:三欄換成給定之值(不追加);{} 移除;優先於 o.produced;未給時行為同前', async () => {
            const dir = `${TMP}/rr${++seq}`
            fs.mkdirSync(dir, { recursive: true })
            const ledgers = openRelateLedgers(dir)
            const mkP = (n) => createEdgeProvenance({ stamp: null, nowIso: () => AT }).make({ stage: 'reeval', seat: 'first', provider: `p${n}` })
            const b1 = stampEdge(makeEdge({ from: 'a', to: 'b', type: T0, reason: REASON, nowIso: '2026-01-01T00:00:00+08:00' }), null, mkP(1))
            const base = stampEdge(b1, b1, mkP(1))
            const proposal = (reason) => makeEdge({ from: 'a', to: 'b', type: T0, reason, nowIso: '2026-02-01T00:00:00+08:00' })
            const run = async (o) => {
                const rel = store([base])
                const w = await rewriteEdge({ relations: rel, ledgers, stateDir: dir }, base, proposal(`${REASON}，補充說明`), { rank, at: AT, ...o })
                return { w, stored: await rel.get(base.id) }
            }
            const a = await run({ restoreProduced: { produced: mkP(0), producedHistory: [mkP(0)], producedHistoryDropped: 0 } })
            assert.deepEqual([a.w.edge.producedHistory.map((x) => x.provider), a.stored.produced.provider], [['p0'], 'p0'])
            const b = await run({ restoreProduced: {} })
            assert.deepEqual(['produced', 'producedHistory', 'producedHistoryDropped'].map((k) => Object.hasOwn(b.stored, k)), [false, false, false], '落庫後三欄皆無(patch 不刪鍵時走 replace)')
            const c = await run({ restoreProduced: {}, produced: mkP(7) })
            assert.equal(Object.hasOwn(c.stored, 'produced'), false, 'restoreProduced 優先於 produced')
            const d = await run({})
            assert.deepEqual(d.stored.producedHistory.length, 2, '未給 restoreProduced／produced:承襲現行三欄(同前)')
            const e = await run({ produced: mkP(8) })
            assert.deepEqual(e.stored.producedHistory.map((x) => x.provider), ['p1', 'p1', 'p8'])
        })
    })

    // ══════════════════ relateSeatPathOf ══════════════════
    describe('relateSeatPathOf', () => {

        it('forward＝relate.ai;reverse、rotation＝relate.reverse.ai 已設者為之、未設即沿用 relate.ai;settings 缺亦可;段名不合即拋(訊息不回顯輸入值)', () => {
            const set = resolveRelateSettings({ relate: { reverse: { ai: { use: 'x:a' } } } })
            const plain = resolveRelateSettings({})
            assert.deepEqual(RELATE_SEGMENTS, ['forward', 'reverse', 'rotation'])
            assert.deepEqual(RELATE_SEGMENTS.map((s) => relateSeatPathOf(set, s)), ['relate.ai', 'relate.reverse.ai', 'relate.reverse.ai'])
            assert.deepEqual(RELATE_SEGMENTS.map((s) => relateSeatPathOf(plain, s)), ['relate.ai', 'relate.ai', 'relate.ai'])
            assert.deepEqual(RELATE_SEGMENTS.map((s) => relateSeatPathOf(undefined, s)), ['relate.ai', 'relate.ai', 'relate.ai'])
            assert.throws(() => relateSeatPathOf(plain, 'SECRET-SEG'), (e) => e.message === "invalid segment: must be one of 'forward', 'reverse', 'rotation'")
            assert.throws(() => relateSeatPathOf(plain), /invalid segment/)
        })
    })

    // ══════════════════ persistEdge／rewriteEdge 之 produced 選項 ══════════════════
    describe('寫邊件之 produced 選項(只在新建與可見欄位改變時追加)', () => {

        const mk = (stamp, provider) => createEdgeProvenance({ stamp, nowIso: () => AT }).make({ stage: 'relate', seat: 'relate.ai', provider })
        const edge = (type = T0, reason = REASON, at = '2026-01-01T00:00:00+08:00') => makeEdge({ from: 'a', to: 'b', type, reason, nowIso: at })
        const opt = (produced, extra = {}) => ({ rank, conflictType: C, allowTypeChange: false, ...(produced ? { produced } : {}), ...extra })

        it('新建:追加一筆;未給 produced 之寫入不帶三欄(行為不變)', async () => {
            const rel = store()
            const r = await persistEdge(rel, edge(), opt(mk('20261108200009', 'p1')))
            assert.deepEqual([r.created, r.edge.producedHistory.length, (await rel.get(r.edge.id)).produced.provider], [true, 1, 'p1'])
            const rel2 = store()
            const r2 = await persistEdge(rel2, edge(), opt())
            assert.deepEqual([r2.created, ['produced', 'producedHistory', 'producedHistoryDropped'].some((k) => Object.hasOwn(r2.edge, k))], [true, false])
        })

        it('合併旗標不受 produced 影響:有無 produced,created／changed／visibleChanged／upgradedToConflict 逐案相同;同一提案重複再現(無異動)不追加', async () => {
            const cases = [
                ['重複再現', edge(), edge()],
                ['落敗之提案(跨輪只升不改)', edge(T0), edge(T1, '另一個關聯之說法：同樣具體')],
                ['升為衝突', edge(T0), edge(C, '甲說有效；乙說無效，結論相反')],
            ]
            for (const [name, first, second] of cases) {
                const withP = store()
                const without = store()
                await persistEdge(withP, first, opt(mk('20261108100000', 'p1')))
                await persistEdge(without, first, opt())
                const a = await persistEdge(withP, second, opt(mk('20261108200009', 'p2')))
                const b = await persistEdge(without, second, opt())
                const flags = (r) => [r.created, r.changed, r.visibleChanged, r.upgradedToConflict]
                assert.deepEqual(flags(a), flags(b), name)
            }
            const rel = store()
            await persistEdge(rel, edge(), opt(mk('20261108100000', 'p1')))
            const again = await persistEdge(rel, edge(), opt(mk('20261108200009', 'p2')))
            assert.deepEqual([again.changed, (await rel.get(edge().id)).producedHistory.length], [false, 1], '無異動:不追加(不因產出時刻不同而每輪重寫)')
        })

        it('落敗之提案只入 history(可見欄位不變)→ 產出鏈不動;升為衝突(可見欄位改變)→ 追加、produced 換為本次', async () => {
            const rel = store()
            await persistEdge(rel, edge(T0), opt(mk('20261108100000', 'p1')))
            const lose = await persistEdge(rel, edge(T1, '另一個關聯之說法：同樣具體'), opt(mk('20261108200009', 'p2')))
            assert.deepEqual([lose.changed, lose.visibleChanged], [true, false], '前提:只入 history')
            const cur = await rel.get(edge().id)
            assert.deepEqual([cur.history.length, cur.producedHistory.length, cur.produced.provider], [1, 1, 'p1'])
            const up = await persistEdge(rel, edge(C, '甲說有效；乙說無效，結論相反'), opt(mk('20261108300000', 'p3')))
            assert.equal(up.upgradedToConflict, true)
            const cur2 = await rel.get(edge().id)
            assert.deepEqual([cur2.producedHistory.map((x) => x.provider), cur2.produced.provider, cur2.type], [['p1', 'p3'], 'p3', C])
        })

        it('rewriteEdge:每次改寫追加一筆(produced 給了才寫);未給者不寫三欄;降級事件等原行為不變', async () => {
            const dir = `${TMP}/rw${++seq}`
            fs.mkdirSync(dir, { recursive: true })
            const ledgers = openRelateLedgers(dir)
            const cur = stampEdge(edge(C, '甲說有效；乙說無效，結論相反'), null, mk('20261108100000', 'p1'))
            const rel = store([cur])
            const proposal = makeEdge({ from: 'a', to: 'b', type: T0, reason: REASON, nowIso: '2026-02-01T00:00:00+08:00' })
            const w = await rewriteEdge({ relations: rel, ledgers, stateDir: dir }, cur, proposal, { rank, at: AT, conflictTypes: [C], produced: mk('20261108200009', 'p2') })
            assert.deepEqual([w.conflictEvent, w.edge.type, w.edge.producedHistory.map((x) => x.provider), (await rel.get(cur.id)).produced.provider], [true, T0, ['p1', 'p2'], 'p2'])
            const w2 = await rewriteEdge({ relations: rel, ledgers, stateDir: dir }, w.edge, makeEdge({ from: 'a', to: 'b', type: T0, reason: REASON + '，補充說明', nowIso: '2026-03-01T00:00:00+08:00' }), { rank, at: AT, conflictTypes: [C] })
            assert.deepEqual(w2.edge.producedHistory.map((x) => x.provider), ['p1', 'p2'], '未給 produced:產出鏈原樣(承襲 cur 之三欄)')
        })
    })

    // ══════════════════ edgesByProvenance ══════════════════
    describe('edgesByProvenance(純讀)', () => {

        const edges = () => {
            const e = (id, from, to, type, produced, extra = {}) => ({ id, from, to, type, reason: REASON, ...(produced ? { produced, producedHistory: [produced] } : {}), ...extra })
            const p1 = P({ stamp: '20261108100000', stage: 'relate', seat: 'relate.ai', provider: 'p1', at: '2026-11-08T10:00:00+08:00' })
            const p2 = P({ stamp: '20261108110000', stage: 'reverse', seat: 'relate.reverse.ai', provider: 'p2', at: '2026-11-08T11:00:00+08:00' })
            const p3 = P({ stamp: '20261108110000', stage: 'conflict-check', seat: 'first', provider: 'p3', at: '2026-11-08T11:30:00+08:00' })
            const p4 = P({ stamp: null, stage: 'standards-fix', seat: null, provider: null, at: '2026-11-08T12:00:00+08:00' })
            const old = P({ stamp: '20261107100000', stage: 'relate', provider: 'p1', at: '2026-11-07T10:00:00+08:00' })
            return [
                e('e1', 'a', 'b', T0, p1),
                e('e2', 'a', 'c', T0, p2),
                // e3:現為 p3 改寫,歷史上曾為 p1 於 20261108100000 所建
                { ...e('e3', 'a', 'd', T0, p3), producedHistory: [{ ...p1, at: '2026-11-08T09:00:00+08:00' }, p3] },
                e('e4', 'b', 'c', T1, p4),
                e('e5', 'b', 'd', T0, null), // 舊邊:無產出鏈
                { ...e('e6', 'c', 'd', T0, old), produced: old, producedHistory: [old] },
            ]
        }
        const deps = (rows = edges()) => ({ stores: { relations: { select: async () => rows } } })
        const ids = (r) => r.map((x) => x.edgeId)

        it('取回 [{ edgeId, from, to, type, produced }];條件皆為且;舊邊(無 produced)不出現;未給條件＝全部有產出鏈者', async () => {
            const all = await edgesByProvenance(deps())
            assert.deepEqual(all.map((x) => Object.keys(x)), all.map(() => ['edgeId', 'from', 'to', 'type', 'produced']))
            assert.deepEqual(ids(all), ['e6', 'e1', 'e2', 'e3', 'e4'], '依 produced.at 先後;舊邊 e5 不出現')
            assert.deepEqual(ids(await edgesByProvenance(deps(), {})), ids(all))
            assert.deepEqual(ids(await edgesByProvenance(deps(), null)), ids(all), 'query null 視為未給')
            assert.deepEqual(all.find((x) => x.edgeId === 'e1'), { edgeId: 'e1', from: 'a', to: 'b', type: T0, produced: P({ stamp: '20261108100000', stage: 'relate', seat: 'relate.ai', provider: 'p1', at: '2026-11-08T10:00:00+08:00' }) })
        })

        it('stamp、stage、provider、seat 各自之選取;且之組合;stamp／provider／seat 可給 null(輪次外、無 AI 呼叫之寫入)', async () => {
            const q = async (o) => ids(await edgesByProvenance(deps(), o))
            assert.deepEqual(await q({ stamp: '20261108110000' }), ['e2', 'e3'])
            assert.deepEqual(await q({ stamp: '20261108110000', stage: 'reverse' }), ['e2'])
            assert.deepEqual(await q({ stage: 'relate' }), ['e6', 'e1'])
            assert.deepEqual(await q({ provider: 'p3' }), ['e3'])
            assert.deepEqual(await q({ seat: 'relate.reverse.ai' }), ['e2'])
            assert.deepEqual(await q({ provider: 'p1', stamp: '20261108100000' }), ['e1'])
            assert.deepEqual(await q({ provider: 'p1', stamp: '20261108110000' }), [], '條件為且:無一筆同時符合')
            assert.deepEqual(await q({ stamp: null }), ['e4'], 'stamp null＝輪次外之寫入')
            assert.deepEqual(await q({ provider: null }), ['e4'], 'provider null＝無 AI 呼叫之寫入')
            assert.deepEqual(await q({ seat: null, provider: null, stage: 'standards-fix' }), ['e4'])
            assert.deepEqual(await q({ stamp: '20200101000000' }), [])
        })

        it('since／until 比對 produced.at(含端點;依時刻先後而不依字串:不同偏移之同一時刻相等);只給一端亦可', async () => {
            const q = async (o) => ids(await edgesByProvenance(deps(), o))
            assert.deepEqual(await q({ since: '2026-11-08T11:00:00+08:00' }), ['e2', 'e3', 'e4'], '含端點')
            assert.deepEqual(await q({ until: '2026-11-08T11:00:00+08:00' }), ['e6', 'e1', 'e2'])
            assert.deepEqual(await q({ since: '2026-11-08T11:00:00+08:00', until: '2026-11-08T11:30:00+08:00' }), ['e2', 'e3'])
            assert.deepEqual(await q({ since: '2026-11-08T03:00:00Z', until: '2026-11-08T03:00:00.000Z' }), ['e2'], 'Z 與 +08:00 同一時刻(11:00+08:00＝03:00Z)')
            assert.deepEqual(await q({ since: '2026-11-08T03:00:00+00:00', until: '2026-11-08T03:00:00Z' }), ['e2'])
            assert.deepEqual(await q({ since: '2026-11-08T12:00:00+08:00', until: '2026-11-08T12:00:00+08:00' }), ['e4'])
            assert.deepEqual(await q({ since: '2026-11-09T00:00:00+08:00' }), [])
        })

        it('history:true 改比對 producedHistory 之任一筆(同一筆須同時滿足全部條件);回傳之 produced 為符合條件之最近一筆;預設(false)只比 produced', async () => {
            const q = async (o) => edgesByProvenance(deps(), o)
            assert.deepEqual(ids(await q({ provider: 'p1' })), ['e6', 'e1'], '只比 produced:e3 現為 p3,不在')
            const h = await q({ provider: 'p1', history: true })
            assert.deepEqual(ids(h), ['e6', 'e3', 'e1'], 'e3 曾為 p1(依符合之那一筆之 at 排序)')
            const e3 = h.find((x) => x.edgeId === 'e3')
            assert.deepEqual([e3.produced.provider, e3.produced.at], ['p1', '2026-11-08T09:00:00+08:00'], '回傳符合條件之那一筆(不是 e3 目前之 produced)')
            assert.deepEqual(ids(await q({ provider: 'p1', stage: 'conflict-check', history: true })), [], '同一筆須同時滿足:p1 之那筆非 conflict-check')
            assert.deepEqual(ids(await q({ provider: 'p3', stage: 'conflict-check', history: true })), ['e3'])
            assert.deepEqual(ids(await q({ history: false, provider: 'p3' })), ['e3'])
            // 無 producedHistory 而有 produced(不應發生):以 produced 當一筆歷史
            const odd = [{ id: 'x', from: 'a', to: 'b', type: T0, produced: P({ provider: 'pz' }) }]
            assert.deepEqual(ids(await edgesByProvenance(deps(odd), { provider: 'pz', history: true })), ['x'])
        })

        it('純讀:只呼叫 relations.select(集合只給 select 即可運作;任何寫入方法之呼叫皆會拋);回傳之 produced 為新物件(改之不牽動集合)', async () => {
            const rows = edges()
            const trap = new Proxy({ select: async () => rows }, { get: (t, k) => (k in t ? t[k] : () => { throw new Error(`不得呼叫 relations.${String(k)}`) }) })
            const r = await edgesByProvenance({ stores: { relations: trap } }, { stage: 'relate' })
            r[0].produced.provider = 'CHANGED'
            assert.equal(rows.find((x) => x.id === r[0].edgeId).produced.provider, 'p1')
            assert.deepEqual(PROVENANCE_QUERY_KEYS, ['stamp', 'stage', 'provider', 'seat', 'since', 'until', 'history'])
        })

        it('輸入檢測:deps 無效、query 非一般物件、未知之鍵、任一條件無效皆拒收(reject;不改用預設——條件被當成未給會放寬成全部);訊息 invalid <名稱>: must be <種類描述>、不回顯輸入值', async () => {
            const bad = async (d, q) => edgesByProvenance(d, q).then(() => 'resolved', (e) => e.message)
            for (const d of [undefined, null, {}, { stores: {} }, { stores: { relations: {} } }, { stores: { relations: { select: 'x' } } }, 'x']) {
                assert.equal(await bad(d, {}), 'invalid deps: must be an object with stores.relations (select)')
            }
            for (const q of ['x', 5, true, [], () => {}]) assert.equal(await bad(deps(), q), 'invalid query: must be a plain object')
            assert.equal(await bad(deps(), { provder: 'p1' }), 'invalid query.provder: unknown key')
            const m = {
                stamp: [['2026', 123, '', '2026110820000x', {}], 'invalid query.stamp: must be a 14-digit stamp string or null'],
                stage: [['Relate', 'a_b', '', 5, null], 'invalid query.stage: must be a lowercase kebab-case name'],
                provider: [['', 5, {}], 'invalid query.provider: must be a non-empty string or null'],
                seat: [['', 5, []], 'invalid query.seat: must be a non-empty string or null'],
                since: [['2026-11-08', '2026-11-08T10:00:00', '2026-11-08 10:00:00+08:00', 1762560000000, null, '2026-13-40T10:00:00+08:00'], 'invalid query.since: must be a time string YYYY-MM-DDTHH:mm:ss with Z or ±hh:mm'],
                until: [['2026-11-08', null, 5], 'invalid query.until: must be a time string YYYY-MM-DDTHH:mm:ss with Z or ±hh:mm'],
                history: [['true', 1, 0, null, 'yes'], 'invalid query.history: must be a boolean'],
            }
            for (const [k, [vals, msg]] of Object.entries(m)) for (const v of vals) assert.equal(await bad(deps(), { [k]: v }), msg, `${k}=${String(v)}`)
            assert.equal(await bad(deps(), { since: '2026-11-09T00:00:00+08:00', until: '2026-11-08T00:00:00+08:00' }), 'invalid query.since: must not be later than query.until')
            assert.equal(await bad(deps(), { provider: 'SECRET-VALUE-XYZ', stage: 'Bad' }).then((s) => /SECRET/.test(s)), false, '不回顯輸入值')
        })
    })

    // ══════════════════ 整輪:選件 → 撤出(既有稽核撤出路徑)══════════════════
    describe('整輪(總組裝、真 LMDB):依產出鏈選件、舊邊不出現、選件之後走既有撤出路徑(reason reprocess)', () => {

        let root = ''
        let flow = null
        const run = {}
        const REASON_AB = '兩篇皆以三角視差法量測恆星距離並討論其誤差來源'
        const REASON_CB = '星等之定義提供視差量測所需之亮度換算基礎'
        const REASON_DB = '新方法沿用同一組視差誤差之修正步驟'

        before(async () => {
            root = tmpRoot('flow-prov2')
            const notesDir = `${root}/knowledge/notes`
            const N = {
                a: landNote(notesDir, { doc: 'a', title: '恆星視差之量測', concepts: ['視差', '觀測誤差'] }),
                b: landNote(notesDir, { doc: 'b', title: '視差誤差之修正', concepts: ['視差', '觀測誤差'] }),
                c: landNote(notesDir, { doc: 'c', title: '星等之定義', concepts: ['星等', '觀測誤差'] }),
            }
            let round = 1
            const base = scriptedAi((role, prompt, o, items) => {
                if (role !== 'relate') return undefined
                return round === 1
                    ? relateAnswer(items, { 恆星視差之量測: [{ to: '視差誤差之修正', type: T0, reason: REASON_AB }], 星等之定義: [{ to: '視差誤差之修正', type: T0, reason: REASON_CB }] })
                    : relateAnswer(items, { 視差量測之新方法: [{ to: '視差誤差之修正', type: T1, reason: REASON_DB }] })
            })
            // 兩輪由不同之成交者(遞補)承接
            const ai = { ...base, callJson: async (...args) => {
                const r = await base.callJson(...args)
                return r?.ok ? { ...r, providerId: round === 1 ? 'oc:model-one' : 'oc:model-two' } : r
            } }
            ;({ flow } = buildTestRelate(root, { aiAdapter: ai, scheduleLimitMin: 55 }))
            // 舊邊:本版本之前寫入,無產出鏈(不回填)
            const oldEdge = makeEdge({ from: N.a.id, to: N.c.id, type: T0, reason: '舊邊之理由：兩篇共用觀測誤差之概念', nowIso: '2026-01-01T00:00:00+08:00' })
            await seedNotes(flow, [N.a, N.b, N.c], [oldEdge])
            run.old = oldEdge.id
            const r1 = await flow.run()
            run.stamp1 = readJsonFile(r1.summaryFile).stamp
            N.d = landNote(notesDir, { doc: 'd', title: '視差量測之新方法', concepts: ['視差'] })
            await withStores(flow, (s) => s.notes.insertNew([N.d]))
            await sleep(1100) // 輪次 stamp 為秒級
            round = 2
            const r2 = await flow.run()
            run.stamp2 = readJsonFile(r2.summaryFile).stamp
            run.N = N
        })
        after(() => {
            resetConceptFold()
            removeRoots([root])
        })

        it('依 stamp 取回該輪新建之邊(舊邊不出現);兩輪各一個 stamp、provider 各為該輪之成交者', async () => {
            assert.notEqual(run.stamp1, run.stamp2)
            const r1 = await withStores(flow, (s) => edgesByProvenance({ stores: s }, { stamp: run.stamp1 }))
            const r2 = await withStores(flow, (s) => edgesByProvenance({ stores: s }, { stamp: run.stamp2 }))
            assert.deepEqual(r1.map((x) => x.produced.provider), ['oc:model-one', 'oc:model-one'])
            assert.equal(r1.length, 2)
            assert.deepEqual(r2.map((x) => [x.edgeId, x.produced.provider, x.produced.stage]), [[edgeId(run.N.d.id, run.N.b.id), 'oc:model-two', 'relate']])
            const all = await withStores(flow, (s) => edgesByProvenance({ stores: s }))
            assert.equal(all.length, 3)
            assert.equal(all.some((x) => x.edgeId === run.old), false, '舊邊(無產出鏈)不出現')
            assert.deepEqual((await withStores(flow, (s) => edgesByProvenance({ stores: s }, { provider: 'oc:model-two' }))).length, 1)
            assert.deepEqual((await withStores(flow, (s) => edgesByProvenance({ stores: s }, { stamp: run.stamp1, provider: 'oc:model-two' }))).length, 0)
            assert.equal((await withStores(flow, (s) => edgesByProvenance({ stores: s }, { since: new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z') }))).length, 0, '之後無新邊')
        })

        it('選件之後撤出走既有稽核撤出路徑(retireEdge;理由 reprocess 已登錄):稽核列含理由與撤出前之邊(帶產出鏈);該輪之邊離庫、他輪與舊邊不動;撤出後再選為空', async () => {
            const picked = await withStores(flow, (s) => edgesByProvenance({ stores: s }, { stamp: run.stamp1 }))
            const dirs = flow.info().dirs
            const ledgers = openRelateLedgers(dirs.state)
            await withStores(flow, async (s) => {
                for (const x of picked) await retireEdge({ relations: s.relations, ledgers, stateDir: dirs.state }, await s.relations.get(x.edgeId), { reason: 'reprocess', at: '2026-11-08T23:30:00+08:00', detail: `依產出鏈重處理（輪次 ${run.stamp1}）` })
            })
            const rows = readAuditRows(`${dirs.state}/${LEDGER_FILES.retired}`)
            assert.deepEqual(rows.map((r) => r.reason), ['reprocess', 'reprocess'])
            assert.ok(rows.every((r) => r.edge.produced.stamp === run.stamp1), '稽核之邊值帶產出鏈(還原時同)')
            const left = await withStores(flow, (s) => s.relations.select())
            assert.deepEqual(left.map((e) => e.id).sort(), [run.old, edgeId(run.N.d.id, run.N.b.id)].sort())
            assert.equal((await withStores(flow, (s) => edgesByProvenance({ stores: s }, { stamp: run.stamp1 }))).length, 0)
            assert.ok(RETIRE_REASONS.includes('reprocess') && RESTORABLE_REASONS.includes('reprocess'), 'reprocess 於撤出與可還原之清單皆已登錄')
        })
    })

    // ══════════════════ graph.json 之開關與設定 ══════════════════
    describe('graph.json 與設定', () => {

        const withP = [
            { id: 'e1', from: 'a', to: 'b', type: T0, reason: '理由一', produced: P({ stamp: '20261108100000', stage: 'relate', provider: 'p1', seat: 'relate.ai' }), producedHistory: [P()], producedHistoryDropped: 0 },
            { id: 'e2', from: 'a', to: 'c', type: T0, reason: '理由二', produced: P({ stamp: null, stage: 'standards-fix', provider: null, seat: null }), producedHistory: [], producedHistoryDropped: 0 },
            { id: 'e3', from: 'b', to: 'c', type: T0, reason: '舊邊無產出鏈' },
        ]
        const notes = [{ id: 'a', title: '甲', category: 'c', concepts: [] }, { id: 'b', title: '乙', category: 'c', concepts: [] }, { id: 'c', title: '丙', category: 'c', concepts: [] }]
        const build = async (rows, cfg) => {
            const dir = `${TMP}/g${++seq}`
            await rebuildRelationIndex({ relations: { select: async () => rows }, notes: { select: async () => notes } }, { dir, nowIso: AT, ...cfg })
            return fs.readFileSync(`${dir}/graph.json`)
        }

        it('預設與非 true 之值:graph.json 逐位元組同「邊無產出鏈」;只收 true(其餘視為關閉)', async () => {
            const stripped = withP.map(({ produced, producedHistory, producedHistoryDropped, ...rest }) => rest)
            const want = await build(stripped, {})
            for (const cfg of [{}, { graphProduced: false }, { graphProduced: 'true' }, { graphProduced: 1 }, { graphProduced: null }, { graphProduced: undefined }]) {
                assert.ok((await build(withP, cfg)).equals(want), `關閉:${JSON.stringify(cfg)}`)
            }
        })

        it('graphProduced:true → 邊帶 { stamp, stage, provider } 純量摘要(鍵序固定;輪次外之 stamp、無 AI 之 provider 為 null);無產出鏈之舊邊不帶;其餘欄位不變', async () => {
            const g = JSON.parse((await build(withP, { graphProduced: true })).toString('utf8'))
            assert.deepEqual(g.edges.map((e) => Object.keys(e)), [['from', 'to', 'type', 'reason', 'produced'], ['from', 'to', 'type', 'reason', 'produced'], ['from', 'to', 'type', 'reason']])
            assert.deepEqual(g.edges[0].produced, { stamp: '20261108100000', stage: 'relate', provider: 'p1' })
            assert.deepEqual(g.edges[1].produced, { stamp: null, stage: 'standards-fix', provider: null })
            assert.deepEqual(Object.keys(g.edges[0].produced), ['stamp', 'stage', 'provider'])
            const off = JSON.parse((await build(withP, {})).toString('utf8'))
            assert.deepEqual(g.edges.map(({ produced, ...r }) => r), off.edges, '開啟只多 produced 一鍵')
            assert.deepEqual([g.nodes, g.updatedAt], [off.nodes, off.updatedAt])
        })

        it('設定 relate.graphProduced:預設 false、型別為布林(非布林於啟動期拋);入口匯出與預設匯出皆含新件', () => {
            assert.equal(RELATE_DEFAULT.graphProduced, false)
            assert.equal(resolveRelateSettings({}).relate.graphProduced, false)
            assert.equal(resolveRelateSettings({ relate: { graphProduced: true } }).relate.graphProduced, true)
            assert.throws(() => resolveRelateSettings({ relate: { graphProduced: 'y' } }), /graphProduced/)
            for (const n of ['edgesByProvenance', 'createEdgeProvenance', 'stampEdge', 'voteOfVerdict', 'relateSeatPathOf', 'EDGE_PRODUCED_STAGES', 'producedFieldsOf', 'withProducedRestored', 'producedUndoPlanOf', 'PRODUCED_UNDO_WHY']) {
                assert.equal(typeof entry[n] !== 'undefined', true, `具名匯出 ${n}`)
                assert.equal(entry.default[n], entry[n], `預設匯出同一實體 ${n}`)
            }
        })
    })
})
