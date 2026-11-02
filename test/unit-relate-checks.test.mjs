// unit-relate-checks.test.mjs — 檢定標準之檢核紀錄(core/stores/checks):判定須否重檢(needsCheck)、落帳(recordCheck)、真 LMDB 之往返
// 規格:方案 v2 §1.4(AI 標準以檢核紀錄判定須否重檢:內容雜湊或標準版本變 → 重檢;雜湊變了舊結果全數作廢;狀態為四態＋豁免之一)
//   (檢核紀錄之擁有者為本套件;待判登錄之同類案在抓取套件之 test/)
// 執行:自套件根 node <mocha> test/unit-relate-checks.test.mjs(暫存 test/_tmp/relate-checks-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { checkKey, needsCheck, recordCheck, aiStandardRowOf, CHECK_STATES } from '../src/core/stores/checks.mjs'

let TMP = ''
const T1 = '2026-10-04T10:00:00+08:00'
const T2 = '2026-10-05T10:00:00+08:00'

describe('unit-relate-checks', function() {

    before(() => {
        TMP = tmpRoot('relate-checks')
    })
    after(() => removeRoots([TMP]))

    it('needsCheck:無紀錄、雜湊不同、無該標準、版本不同 → 須檢;同雜湊同版本 → 不須', () => {
        const rec = { id: checkKey('edges', 'e1'), hash: 'h1', results: { RS4: { v: 1, status: 'pass' } } }
        assert.equal(needsCheck(null, { hash: 'h1', std: 'RS4', v: 1 }), true)
        assert.equal(needsCheck(rec, { hash: 'h2', std: 'RS4', v: 1 }), true, '內容變了')
        assert.equal(needsCheck(rec, { hash: 'h1', std: 'RS6', v: 1 }), true, '未檢過此標準')
        assert.equal(needsCheck(rec, { hash: 'h1', std: 'RS4', v: 2 }), true, '標準改版')
        assert.equal(needsCheck(rec, { hash: 'h1', std: 'RS4', v: 1 }), false)
    })

    it('aiStandardRowOf(檔頭【AI 標準列】):檢核紀錄計已檢、四態、版本過時;待判計未結與已豁免;來源未給之欄為 null、皆未給列為 null;欄序固定;各工作之掃描同用', () => {
        // 規則:checks.aiStandardRowOf——紀錄之 results 之該標準有鍵即已檢;四態之外之狀態只計已檢;v ≠ 現版計 stale;holds 依 std 計 open／waived
        const s = { id: 'X1', title: '題', kind: 'ai', v: 2, object: 'edge' }
        const rows = [
            { results: { X1: { status: 'pass', v: 2 } } },
            { results: { X1: { status: 'violation', v: 1 } } },
            { results: { X1: { status: 'waived', v: 2 } } },
            { results: { X9: { status: 'pass', v: 2 } } },
            null,
        ]
        const holds = [{ std: 'X1', status: 'open' }, { std: 'X1', status: 'waived' }, { std: 'X1', status: 'resolved' }, { std: 'X9', status: 'open' }]
        const row = aiStandardRowOf(s, { module: 'm', checkRows: rows, holds })
        assert.deepEqual(Object.keys(row), ['id', 'title', 'kind', 'v', 'module', 'object', 'checked', 'pass', 'violation', 'undetermined', 'na', 'stale', 'holdsOpen', 'holdsWaived'])
        assert.deepEqual(row, { id: 'X1', title: '題', kind: 'ai', v: 2, module: 'm', object: 'edge', checked: 3, pass: 1, violation: 1, undetermined: 0, na: 0, stale: 1, holdsOpen: 1, holdsWaived: 1 })
        assert.deepEqual(CHECK_STATES, ['pass', 'violation', 'undetermined', 'na'])
        const onlyHolds = aiStandardRowOf(s, { module: 'm', checkRows: null, holds })
        assert.deepEqual([onlyHolds.checked, onlyHolds.pass, onlyHolds.stale, onlyHolds.holdsOpen, onlyHolds.holdsWaived], [null, null, null, 1, 1], '檢核紀錄未給 → 其欄 null')
        const onlyChecks = aiStandardRowOf(s, { module: 'm', checkRows: [], holds: null })
        assert.deepEqual([onlyChecks.checked, onlyChecks.holdsOpen, onlyChecks.holdsWaived], [0, null, null], '待判未給 → 其欄 null;紀錄為空陣列仍計 0')
        assert.equal(aiStandardRowOf(s, { module: 'm', checkRows: null, holds: null }), null, '皆未給 → 列 null')
        assert.equal(aiStandardRowOf(s, {}), null)
    })

    it('recordCheck:同雜湊累積各標準結果;雜湊變了 → 舊結果全數作廢;狀態須為四態＋豁免之一', async () => {
        const st = memStore()
        await recordCheck(st, { object: 'edges', oid: 'e1', hash: 'h1', std: 'RS4', v: 1, at: T1, status: 'pass', seats: 'a|b' })
        await recordCheck(st, { object: 'edges', oid: 'e1', hash: 'h1', std: 'RS6', v: 1, at: T1, status: 'undetermined', reason: '兩席不一致' })
        assert.deepEqual(Object.keys((await st.get('edges:e1')).results).sort(), ['RS4', 'RS6'])
        const r = await recordCheck(st, { object: 'edges', oid: 'e1', hash: 'h2', std: 'RS4', v: 1, at: T2, status: 'violation', reason: '非真衝突' })
        assert.deepEqual([r.hash, Object.keys(r.results)], ['h2', ['RS4']], '內容變了,舊結果作廢')
        await assert.rejects(() => recordCheck(st, { object: 'edges', oid: 'e1', hash: 'h2', std: 'RS4', v: 1, status: 'ok' }), /狀態「ok」不在/)
    })

    it('真 LMDB:檢核紀錄之 results(巢狀物件)經 replace 落庫逐欄相符;雜湊變更之重建無殘留舊標準', async () => {
        const checks = W.openCollection({ WOrm, path: `${TMP}/db`, db: 'knowledge', cl: 'checks' })
        try {
            const c1 = await recordCheck(checks, { object: 'edges', oid: 'e1', hash: 'h1', std: 'RS4', v: 1, at: T1, status: 'pass', seats: 'a|b' })
            assert.deepEqual(await checks.get(c1.id), c1)
            const c2 = await recordCheck(checks, { object: 'edges', oid: 'e1', hash: 'h2', std: 'RS6', v: 1, at: T2, status: 'violation' })
            assert.deepEqual(await checks.get(c2.id), c2, '雜湊變更之重建亦逐欄相符(無殘留舊標準)')
        }
        finally {
            await checks.close()
        }
    })
})
