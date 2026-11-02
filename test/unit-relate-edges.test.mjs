// unit-relate-edges.test.mjs — 關聯要點 2、3 之邊模型:無序對身分、型別序、提案全序合併(可交換／可結合／冪等、提案原子、
//   history、跨輪只升不改)、單交易寫入＋回讀(patch 之不變式、退回 replace)、行程內互斥、鄰接表、世代檢核
// 規格出處:規則帳本 REL-02、REL-03
// 執行:自套件根 node <mocha> test/unit-relate-edges.test.mjs(真 LMDB 暫存 test/_tmp/relate-edges-<pid>,測完即刪)

import assert from 'node:assert/strict'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { sha1 } from '../src/core/capturePackage.mjs'
import { edgeId, makeEdge, typeRankOf, compareProposals, sameEdge, mergeEdge, reviseEdge, renameEdgeTypes, createMutex, writeEdge, persistEdge, buildAdjacency, addToAdjacency, removeFromAdjacency, conflictNeighborsOf, generationMismatchOf } from '../src/stores/edgeStore.mjs'

const VOCAB = { relationTypes: ['前置概念', '延伸深化', '互補搭配', '衝突或反例', '實作範例'], conflictType: '衝突或反例', fallbackType: '互補搭配' }
const rank = typeRankOf(VOCAB)
const C = '衝突或反例'
const P = (from, to, type, createdAt, reason = `${from}${to}${type}`) => makeEdge({ from, to, type, reason, nowIso: createdAt })
const opt = { rank, conflictType: C }
const merge = (a, b) => (a ? mergeEdge(a, b, opt).edge : mergeEdge(null, b, opt).edge)
const fold = (props) => props.reduce((stored, p) => merge(stored, p), null)
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])))
let TMP = ''

describe('unit-relate-edges', function() {

    before(() => {
        TMP = tmpRoot('relate-edges')
    })
    after(() => removeRoots([TMP]))

    it('edgeId:無序對(兩向同 id)、字碼序(非語系序)、＝sha1(min|max);世代檢核計 id 非無序對雜湊者', () => {
        assert.equal(edgeId('b-1', 'a-2'), edgeId('a-2', 'b-1'))
        assert.equal(edgeId('a', 'b'), sha1('a|b'))
        assert.equal(edgeId('Z', 'a'), sha1('Z|a'), '字碼序:大寫 Z(0x5A) 小於 a(0x61)')
        assert.equal(edgeId('乙-1', '甲-1'), edgeId('甲-1', '乙-1'))
        const old = { id: sha1('b|a'), from: 'b', to: 'a' } // 舊世代:有序對 sha1(from|to)
        assert.equal(generationMismatchOf([P('a', 'b', C, 'x'), P('b', 'a', C, 'x'), old]), 1)
    })

    it('typeRankOf:衝突第一、fallbackType 殿後、其餘依 relationTypes 列序;不在清單者最後(同序)', () => {
        assert.deepEqual(['衝突或反例', '前置概念', '延伸深化', '實作範例', '互補搭配', '不存在', '也不存在'].map(rank), [0, 1, 2, 3, 4, 5, 5])
    })

    it('mergeEdge 窮舉(型別 × 方向 × 時刻 × 理由):三提案之任意排列與兩種括號位置結果逐欄相同(可交換、可結合);重複合併不變(冪等)', () => {
        const pool = []
        for (const t of VOCAB.relationTypes) for (const [f, to] of [['n1', 'n9'], ['n9', 'n1']]) for (const at of ['2026-10-01T00:00:00+08:00', '2026-10-02T00:00:00+08:00']) for (const why of ['甲', '乙']) pool.push(P(f, to, t, at, why))
        let n = 0
        for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) for (let k = j + 1; k < pool.length; k++) {
            const trio = [pool[i], pool[j], pool[k]]
            const want = JSON.stringify(fold(trio))
            for (const p of perms(trio)) {
                assert.equal(JSON.stringify(fold(p)), want, `左折疊之排列不影響結果:${trio.map((x) => `${x.from}→${x.to}:${x.type}@${x.createdAt.slice(8, 10)}${x.reason}`).join(' ')}`)
                // 右括號:a ⊕ (b ⊕ c)——incoming 帶 history,須一併併入(此前遺失 incoming.history)
                const right = mergeEdge(p[0], merge(merge(null, p[1]), p[2]), opt).edge
                assert.ok(sameEdge(right, JSON.parse(want)), `括號位置不影響結果:${p.map((x) => `${x.from}→${x.to}:${x.type}${x.reason}`).join(' ')}`)
            }
            const once = fold(trio)
            for (const p of trio) assert.equal(mergeEdge(once, p, opt).changed, false, '已併入之提案再來不變')
            n++
        }
        assert.equal(n, 9880)
    })

    it('全序以理由為最終決勝:同方向同型同時刻、理由不同之兩提案,兩種先後之合併結果相同', () => {
        const a = P('n1', 'n2', '前置概念', '2026-10-01', '甲') // U+7532
        const b = P('n1', 'n2', '前置概念', '2026-10-01', '乙') // U+4E59:字碼序較小者勝
        assert.ok(compareProposals(b, a, rank) < 0)
        assert.ok(sameEdge(merge(merge(null, a), b), merge(merge(null, b), a)))
        assert.equal(merge(merge(null, a), b).reason, '乙')
    })

    it('mergeEdge:衝突恆勝且提案原子(採用衝突提案之方向與理由)、敗方入 history;不標 typeDisputed;非衝突依型別序', () => {
        const a = P('n1', 'n2', '互補搭配', '2026-10-01T00:00:00+08:00', '甲說互補')
        const b = P('n2', 'n1', C, '2026-10-02T00:00:00+08:00', 'n2 說 X、n1 說 Y')
        const r = mergeEdge(a, b, opt)
        assert.deepEqual([r.changed, r.visibleChanged, r.upgradedToConflict, r.edge.from, r.edge.to, r.edge.type, r.edge.reason], [true, true, true, 'n2', 'n1', C, 'n2 說 X、n1 說 Y'])
        assert.deepEqual(r.edge.history.map((h) => [h.from, h.type]), [['n1', '互補搭配']])
        assert.equal(r.edge.updatedAt, b.updatedAt, '勝者換人 → updatedAt 取來者')
        const d = mergeEdge(P('n1', 'n2', '互補搭配', '2026-10-01'), P('n2', 'n1', '前置概念', '2026-10-01'), opt)
        assert.deepEqual([d.edge.type, d.edge.from, 'typeDisputed' in d.edge], ['前置概念', 'n2', false], '型別序:前置概念勝互補搭配(後備型別殿後);方向互逆之一致對不標爭議')
    })

    it('mergeEdge allowTypeChange:false(跨輪再現):非衝突不改型(以庫內為準、來者入 history、可見欄位不變);衝突仍升級;同一提案不覆寫理由', () => {
        const stored = P('n1', 'n2', '互補搭配', '2026-09-01')
        const keep = mergeEdge(stored, P('n2', 'n1', '前置概念', '2026-10-04'), { ...opt, allowTypeChange: false })
        assert.deepEqual([keep.edge.type, keep.edge.from, keep.edge.history.length, keep.changed, keep.visibleChanged, keep.upgradedToConflict, keep.edge.updatedAt], ['互補搭配', 'n1', 1, true, false, false, stored.updatedAt])
        const up = mergeEdge(stored, P('n2', 'n1', C, '2026-10-04'), { ...opt, allowTypeChange: false })
        assert.deepEqual([up.edge.type, up.edge.from, up.upgradedToConflict, up.visibleChanged], [C, 'n2', true, true])
        const same = mergeEdge(stored, P('n1', 'n2', '互補搭配', '2026-10-04', '新理由'), { ...opt, allowTypeChange: false })
        assert.deepEqual([same.changed, same.edge.reason], [false, stored.reason], '同一提案:新理由不覆寫')
        // 混合:跨輪保留後,同輪(完整全序)再來同一來者 → 依全序改判(前置概念勝互補搭配)
        const mixed = mergeEdge(keep.edge, P('n2', 'n1', '前置概念', '2026-10-04'), opt)
        assert.deepEqual([mixed.edge.type, mixed.edge.from, mixed.edge.history.map((h) => h.type)], ['前置概念', 'n2', ['互補搭配']])
        // 已是衝突:跨輪之另一方向衝突不改寫(只升不改)
        const cc = mergeEdge(up.edge, P('n1', 'n2', C, '2026-10-05', '反方向之衝突'), { ...opt, allowTypeChange: false })
        assert.deepEqual([cc.edge.from, cc.visibleChanged, cc.edge.history.length], ['n2', false, 2])
    })

    it('patch 不變式:任意合併序列之 history 長度只增不減、每筆鍵集固定且值皆字串(單交易 merge 依索引合併之前提)', () => {
        const pool = []
        for (const t of VOCAB.relationTypes) for (const [f, to] of [['n1', 'n9'], ['n9', 'n1']]) for (const at of ['2026-10-01', '2026-10-02']) pool.push(P(f, to, t, at))
        for (const allow of [true, false]) {
            for (let i = 0; i < pool.length; i++) {
                let e = merge(null, pool[i])
                for (let j = 0; j < pool.length; j++) {
                    const r = mergeEdge(e, pool[(i + j * 7) % pool.length], { ...opt, allowTypeChange: allow })
                    assert.ok((r.edge.history || []).length >= (e.history || []).length, 'history 不縮短')
                    for (const h of r.edge.history || []) {
                        assert.deepEqual(Object.keys(h).sort(), ['createdAt', 'from', 'reason', 'to', 'type'])
                        assert.ok(Object.values(h).every((v) => typeof v === 'string'))
                    }
                    e = r.edge
                }
            }
        }
    })

    it('history 浮上再驗(審查 A-B12、B-M16):完整全序模式下勝出身分之最優代表為 history 條目時,admit 不過 → 以勝方提案本身為現值、未過者移出(surfaceRejected);過者照舊升任;未給 admit ＝舊行為;只升不改模式與 reviseEdge／renameEdgeTypes 不會讓 history 升任', () => {
        // 庫內現值 n1→n2 互補(新)、history 有 n2→n1 前置概念之舊提案(較早、理由空泛);來者同身分(n2→n1 前置概念)較晚
        const old = P('n2', 'n1', '前置概念', '2026-10-01', '同上')
        const stored = mergeEdge(P('n1', 'n2', '互補搭配', '2026-10-02', '甲'), old, { ...opt, allowTypeChange: false }).edge
        assert.deepEqual([stored.type, stored.history.map((h) => h.reason)], ['互補搭配', ['同上']], '前提:舊提案在 history')
        const inc = P('n2', 'n1', '前置概念', '2026-10-03', '乙之定義是理解甲之前提')
        const plain = mergeEdge(stored, inc, opt)
        assert.deepEqual([plain.edge.reason, plain.surfaceRejected], ['同上', false], '未給 admit:全序取同身分較早者(舊行為)')
        const admit = (p) => p.reason !== '同上'
        const gated = mergeEdge(stored, inc, { ...opt, admit })
        assert.deepEqual([gated.edge.type, gated.edge.from, gated.edge.reason, gated.edge.createdAt, gated.surfaceRejected], ['前置概念', 'n2', '乙之定義是理解甲之前提', '2026-10-03', true], '浮上未過 → 以來者為現值')
        assert.ok(!gated.edge.history.some((h) => h.reason === '同上'), '未過者不留於 history(同一身分只留一筆)')
        assert.ok(gated.edge.history.some((h) => h.reason === '甲'), '舊現值入 history')
        const okAll = mergeEdge(stored, inc, { ...opt, admit: () => true })
        assert.deepEqual([okAll.edge.reason, okAll.surfaceRejected], ['同上', false], '過者照舊升任')
        // 只升不改:現值＝庫內或來者,admit 不參與
        assert.equal(mergeEdge(stored, inc, { ...opt, allowTypeChange: false, admit }).surfaceRejected, false)
        // reviseEdge:現值＝提案;renameEdgeTypes:現值留任(改名後同身分之 history 移出、不升任)
        assert.equal(reviseEdge(stored, inc, { rank }).reason, '乙之定義是理解甲之前提')
        const renamed = renameEdgeTypes({ ...stored, type: '舊互補', history: [{ from: 'n1', to: 'n2', type: '互補搭配', reason: '舊而空泛', createdAt: '2026-09-01' }] }, (t) => (t === '舊互補' ? '互補搭配' : ''), { rank })
        assert.deepEqual([renamed.type, renamed.reason, 'history' in renamed], ['互補搭配', '甲', false], '同身分之舊理由移出而非升任')
    })

    it('理由截短之明示 reasonCut(審查 A-B21):隨現值走——新建帶入;庫內現值勝出沿用;來者勝出取來者(無則 0,鍵一旦存在即保留);reviseEdge 依提案;renameEdgeTypes 不動;不入 history', () => {
        const cut = { ...P('n1', 'n2', '互補搭配', '2026-10-01', '甲。'), reasonCut: 230 }
        const c0 = mergeEdge(null, cut, opt).edge
        assert.equal(c0.reasonCut, 230)
        const keep = mergeEdge(c0, P('n2', 'n1', '互補搭配', '2026-10-05', '乙'), { ...opt, allowTypeChange: false }).edge
        assert.deepEqual([keep.reason, keep.reasonCut], ['甲。', 230], '庫內現值留任 → 沿用')
        assert.ok(keep.history.every((h) => !('reasonCut' in h)), 'history 鍵集固定')
        const up = mergeEdge(c0, P('n2', 'n1', C, '2026-10-06', '甲說 X、乙說 Y'), { ...opt, allowTypeChange: false }).edge
        assert.deepEqual([up.type, up.reasonCut], [C, 0], '來者(未截短)勝出 → 0(鍵保留,守頂層不刪鍵)')
        const plain = mergeEdge(null, P('n3', 'n4', '互補搭配', '2026-10-01'), opt).edge
        assert.equal('reasonCut' in mergeEdge(plain, P('n4', 'n3', C, '2026-10-02'), opt).edge, false, '從未截短者不加鍵')
        assert.equal(mergeEdge(plain, { ...P('n4', 'n3', C, '2026-10-02', '甲說 X、乙說 Y。'), reasonCut: 260 }, opt).edge.reasonCut, 260, '截短之來者勝出 → 取來者')
        assert.equal(reviseEdge(c0, P('n1', 'n2', '前置概念', '2026-10-07', '新理由'), { rank }).reasonCut, 0)
        assert.equal(reviseEdge(plain, { ...P('n3', 'n4', '前置概念', '2026-10-07', '新理由。'), reasonCut: 300 }, { rank }).reasonCut, 300)
        assert.equal(renameEdgeTypes({ ...c0, type: '舊互補' }, (t) => (t === '舊互補' ? '互補搭配' : ''), { rank }).reasonCut, 230)
    })

    it('createMutex:並行呼叫序列化(不交錯),例外不卡死後續', async () => {
        const lock = createMutex()
        const trace = []
        const job = (k, ms) => lock(async () => {
            trace.push(`${k}+`)
            await new Promise((r) => setTimeout(r, ms))
            trace.push(`${k}-`)
            if (k === 'b') throw new Error('boom')
            return k
        })
        const rs = await Promise.allSettled([job('a', 20), job('b', 1), job('c', 5)])
        assert.deepEqual(trace, ['a+', 'a-', 'b+', 'b-', 'c+', 'c-'])
        assert.deepEqual(rs.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled'])
    })

    it('persistEdge(記憶體):新對 insertNew、合併改型走 patch 且回讀相符、無變化不寫;鄰接表兩端同步、衝突鄰居', async () => {
        const rel = memStore()
        const r1 = await persistEdge(rel, P('n2', 'n1', '互補搭配', '2026-10-01'), opt)
        assert.deepEqual([r1.created, (await rel.select()).length], [true, 1])
        const r2 = await persistEdge(rel, P('n1', 'n2', C, '2026-10-02'), opt)
        const got = await rel.get(edgeId('n1', 'n2'))
        assert.deepEqual([r2.upgradedToConflict, got.type, got.from, got.history.length], [true, C, 'n1', 1])
        assert.ok(sameEdge(got, r2.edge))
        const r3 = await persistEdge(rel, P('n1', 'n2', C, '2026-10-02'), opt)
        assert.equal(r3.changed, false)
        const adj = buildAdjacency(await rel.select())
        assert.deepEqual([[...adj.get('n1').keys()], [...adj.get('n2').keys()]], [['n2'], ['n1']])
        assert.deepEqual([...conflictNeighborsOf(adj, 'n1', C)], ['n2'])
        addToAdjacency(adj, P('n3', 'n1', '前置概念', '2026-10-03'))
        assert.deepEqual([...adj.get('n1').keys()].sort(), ['n2', 'n3'])
        assert.deepEqual([...conflictNeighborsOf(adj, 'n1', C)], ['n2'], '非衝突鄰居不在排除集合')
        removeFromAdjacency(adj, got)
        assert.deepEqual([[...adj.get('n1').keys()], adj.get('n2').size], [['n3'], 0])
        assert.ok(compareProposals(P('a', 'b', C, '2026-10-09'), P('a', 'b', '前置概念', '2026-01-01'), rank) < 0, '衝突勝任何非衝突')
    })

    it('writeEdge:patch 後回讀不符(合併殘留)即退回 replace 並再驗;replace 後仍不符即拋錯(不回報成功)', async () => {
        const base = memStore()
        const e0 = merge(merge(null, P('n1', 'n2', '前置概念', '2026-10-01')), P('n2', 'n1', '延伸深化', '2026-10-02'))
        await base.insertNew([e0])
        // 合併殘留:patch 只淺合併頂層而保留舊陣列(模擬 merge 語意不合前提)
        const stale = { ...base, patch: async (id, f) => { const cur = await base.get(id); const { history: _h, ...rest } = f; await base.replace({ ...cur, ...rest }) } }
        const target = mergeEdge(e0, P('n1', 'n2', C, '2026-10-03'), opt).edge
        let replaced = 0
        stale.replace = async (rec) => { replaced++; return base.replace(rec) }
        await writeEdge(stale, target)
        assert.equal(replaced, 1, 'patch 回讀不符 → 退回 replace 一次')
        assert.ok(sameEdge(await base.get(target.id), target))
        const broken = { ...base, patch: async () => {}, replace: async () => {} }
        await assert.rejects(() => writeEdge(broken, mergeEdge(target, P('n9', 'n1', '前置概念', '2026-10-04'), opt).edge), /回驗不符/)
    })

    it('persistEdge(真 LMDB):新增 → 改型(history 增長)經 patch 單交易落庫逐欄相符;兩個並行寫入同一對(互斥)兩種完成順序結果相同', async () => {
        const open = (cl) => W.openCollection({ WOrm, path: `${TMP}/db`, db: 'knowledge', cl })
        const rel = open('relA')
        try {
            const props = [P('n1', 'n2', '互補搭配', '2026-10-01'), P('n2', 'n1', '前置概念', '2026-10-02'), P('n1', 'n2', C, '2026-10-03', '甲說 X、乙說 Y'), P('n2', 'n1', '實作範例', '2026-10-04')]
            for (const p of props) {
                const r = await persistEdge(rel, p, opt)
                assert.ok(sameEdge(await rel.get(p.id), r.edge), `落庫值與合併結果逐欄相符:${p.type}`)
            }
            const got = await rel.get(props[0].id)
            assert.deepEqual([got.type, got.from, got.history.map((h) => h.type)], [C, 'n1', ['前置概念', '實作範例', '互補搭配']])
            assert.ok(sameEdge(got, fold(props)), '與記憶體折疊同結果')
        }
        finally {
            await rel.close()
        }
        const results = []
        for (const order of [[0, 1], [1, 0]]) {
            const r2 = open(`relB${order.join('')}`)
            try {
                const lock = createMutex()
                const ps = [P('n5', 'n6', '延伸深化', '2026-10-01'), P('n6', 'n5', '前置概念', '2026-10-01')]
                const delays = order.map((k) => k * 15)
                await Promise.all(ps.map((p, i) => new Promise((res) => setTimeout(res, delays[i])).then(() => lock(() => persistEdge(r2, p, { ...opt, allowTypeChange: true })))))
                results.push(await r2.get(ps[0].id))
            }
            finally {
                await r2.close()
            }
        }
        assert.ok(sameEdge(results[0], results[1]), '並行之完成順序不影響結果(同輪完整全序)')
    })
})
