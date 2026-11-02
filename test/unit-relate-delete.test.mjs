// unit-relate-delete.test.mjs — 關聯要點 3「知識刪除 → 刪除關聯」:明示刪除 op(預演、墓碑(記理由)、封存(含反向待處理對)、稽核、衝突事件帳、
//   鄰居重投、清帳、總覽待重建、核心出處計數)、中斷後續作(重跑 op——md 路徑與鄰居取自封存——或關聯段依墓碑清殘留邊)、撤銷刪除(undoDeleteNote:
//   原樣放回、不過閘、不登錄新待判、其後之改動不覆寫、可續作含半刪之逆)、使用者還原(restoreNote:過閘、預演、續作、鄰居、稽核、RS4 登錄守豁免)、
//   被拒之邊之補救(restoreEdge 接受 note-deleted)、懸空邊明示清理、半狀態、邊庫世代不符拒寫
// 規格出處:規則帳本 REL-09(及摘要套件之納入閘 STD-05)
//   (tmp/relate-pkg-audit/終審.md:回退＝撤銷該次處置之效果、撤銷與重新收件是兩種契約、先記後寫、可續作)
// 執行:自套件根 node <mocha> test/unit-relate-delete.test.mjs(暫存 test/_tmp/relate-delete-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { memStore, genClockTZ, recLog, silentLog, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { sha1, putHold, waiveHold, holdKey, readJsonlRows } from '../src/core/capturePackage.mjs'
import { readMd, writeMd } from '../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { makeEdge, edgeId, sameEdge } from '../src/stores/edgeStore.mjs'
import { openRelateLedgers, readAuditRows, appendAudit, LEDGER_FILES } from '../src/stores/relateLedgers.mjs'
import { retireEdge } from '../src/stores/edgeRetire.mjs'
import { retiredEdgesOf } from '../src/stores/edgeAudit.mjs'
import { archiveFilesOf, deletionHalfStatesOf } from '../src/stores/deletions.mjs'
import { RS4 } from '../src/stores/conflictCheckPolicy.mjs'
import { deleteNote, deletionStatusOf, undoDeleteNote, restoreNote, pruneDangling, projectAll, restoreEdge } from '../src/ops/noteOps.mjs'
// 摘要套件之件(還原閘、同步雜湊、詞彙解析)與子階段之 ctx(bagCtx)一律經單一匯入點取得(GEN-12)
import { createNoteRestoreGate, syncFieldsOf, syncHashOf, resolveSummarizeVocab, bagCtx } from './tools/summarizeForTest.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const C = DOMAIN.conflictType
const AT = '2026-01-05T00:00:00+08:00'
let seq = 0

/**
 * 環境:筆記 a、b、c(含 md);邊 a–b(衝突)、c→a(前置概念)、b–c;核心 k1 以 a 為出處
 * @param {Object} [o={}] 輸入 { holds:Boolean(另開 holds、checks 集合) }
 * @returns {Object} 回傳 { deps, notes, relations, cores, file, state, mk }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const mk = (id, body) => {
        const file = `${dir}/notes/${id}.md`
        writeMd(file, { title: `標題${id}`, slug: id }, body || `# 標題${id}\n\n## 一句話重點\n\n${id}\n\n## 核心知識\n\n- k`)
        return { id, title: `標題${id}`, concepts: ['p'], category: 'c', createdAt: '2026-01-01', relatedAt: '2026-01-02', file }
    }
    const notes = memStore(['a', 'b', 'c'].map((id) => mk(id)))
    const relations = memStore([
        makeEdge({ from: 'a', to: 'b', type: C, reason: '甲說動量有效、乙說扣成本後無效', nowIso: AT }),
        makeEdge({ from: 'c', to: 'a', type: '前置概念', reason: 'c 之定義是理解 a 之前置概念', nowIso: AT }),
        makeEdge({ from: 'b', to: 'c', type: '互補搭配', reason: 'b 與 c 共用同一組成交量指標', nowIso: AT }),
    ])
    const cores = memStore([{ id: 'k1', noteIds: ['a', 'x'] }, { id: 'k2', noteIds: ['b'] }])
    const log = recLog()
    const stores = { notes, relations, cores, ...(o.holds ? { holds: memStore([]), checks: memStore([]) } : {}) }
    const deps = { stores, dirs: { state: `${dir}/state` }, clock, log, domain: DOMAIN }
    const addNote = async (id, body) => {
        const n = mk(id, body)
        await notes.insertNew([n])
        return n
    }
    return { deps, notes, relations, cores, log: log.lines, file: (id) => `${dir}/notes/${id}.md`, state: () => openRelateLedgers(`${dir}/state`), dir, addNote }
}

/**
 * 某方法第 n 次呼叫拋錯(模擬中斷);回傳復原函數
 * @param {Object} obj 輸入物件
 * @param {String} name 輸入方法名
 * @param {Integer} n 輸入第幾次呼叫拋錯
 * @returns {Function} 回傳復原函數
 */
const failAt = (obj, name, n) => {
    const real = obj[name]
    let k = 0
    obj[name] = async (...a) => {
        if (++k === n) throw new Error('模擬中斷')
        return real(...a)
    }
    return () => {
        obj[name] = real
    }
}
const auditOf = (e) => readAuditRows(e.state().files.retired)
const restoredRows = (e, via) => auditOf(e).filter((x) => x.reason === 'restored' && (!via || x.via === via))
const holdsCount = async (e) => (e.deps.stores.holds ? (await e.deps.stores.holds.select()).length : 0)
const edgesById = async (e) => new Map((await e.relations.select()).map((x) => [x.id, x]))

describe('unit-relate-delete', function() {

    before(() => {
        TMP = tmpRoot('relate-delete')
    })
    after(() => removeRoots([TMP]))

    describe('deleteNote', function() {

        it('預演(dryRun):列出邊數、鄰居、以之為出處之核心;不寫任何東西', async () => {
            const e = env()
            const r = await deleteNote(e.deps, 'a', { dryRun: true })
            assert.deepEqual([r.dryRun, r.resumed, r.edges, r.neighbors, r.cores], [true, false, 2, ['b', 'c'], ['k1']])
            assert.deepEqual([(await e.relations.select()).length, !!(await e.notes.get('a')), fs.existsSync(e.file('a')), fs.existsSync(e.deps.dirs.state)], [3, true, true, false])
            await assert.rejects(() => deleteNote(e.deps, 'nope'), /筆記不存在：nope/)
            // 預演純讀(D15):不開帳——壞帳不被隔離、不建任何檔(開帳會把壞檔改名為 .corrupt-*);restoreEdge 之預演(非 apply)同
            const st = e.deps.dirs.state
            fs.mkdirSync(st, { recursive: true })
            fs.writeFileSync(`${st}/${LEDGER_FILES.dirty}`, '{壞', 'utf8')
            fs.writeFileSync(`${st}/${LEDGER_FILES.tombstones}`, JSON.stringify({ ids: { a: { at: AT, reason: '預演讀得到墓碑理由' } } }), 'utf8')
            const d2 = await deleteNote(e.deps, 'a', { dryRun: true })
            assert.deepEqual([d2.resumed, d2.reason], [true, '預演讀得到墓碑理由'], '墓碑以唯讀讀之(含理由)')
            const pv = await restoreEdge(e.deps, 'no-such-edge')
            assert.deepEqual([pv.found, pv.restorable], [false, false])
            assert.deepEqual(fs.readdirSync(st).sort(), [LEDGER_FILES.dirty, LEDGER_FILES.tombstones], '預演不隔離、不建檔')
            assert.equal(fs.readFileSync(`${st}/${LEDGER_FILES.dirty}`, 'utf8'), '{壞')
            assert.deepEqual(e.log, [], '預演不告警')
        })

        it('墓碑 → 封存(記錄＋邊＋涉及該篇之反向待處理對＋md)→ 刪邊(稽核先記)→ 刪記錄 → 刪 md → 清帳 → 總覽待重建;鄰居當場重投(不再列已刪者);刪除完整', async () => {
            const e = env()
            const L0 = e.state()
            L0.dirty.add(['a'])
            L0.reverse.add([{ o: 'a', n: 'b', score: 11, at: 't' }, { o: 'c', n: 'b', score: 11, at: 't' }])
            await assert.rejects(() => deleteNote(e.deps, 'a'), /deleteNote 需要刪除理由/, '墓碑記理由:未給理由不刪')
            assert.equal(e.state().tombstones.has('a'), false)
            const r = await deleteNote(e.deps, 'a', { reason: '內容與 b 重複' })
            assert.deepEqual([r.edges, r.neighbors, r.cores, r.projected.projected, r.reason, r.resumed, r.mdLeft], [2, ['b', 'c'], ['k1'], 2, '內容與 b 重複', false, false])
            assert.deepEqual((await e.relations.select()).map((x) => x.id), [edgeId('b', 'c')])
            assert.equal(await e.notes.get('a'), null)
            assert.equal(fs.existsSync(e.file('a')), false)
            const L = e.state()
            assert.deepEqual([L.tombstones.has('a'), L.tombstones.reasonOf('a'), L.dirty.has('a'), L.reverse.pairs().map((p) => p.o), L.state.get().indexDirty], [true, '內容與 b 重複', false, ['c'], true])
            const arc = JSON.parse(fs.readFileSync(`${L.files.archive}/a.json`, 'utf8'))
            assert.deepEqual([arc.record.id, arc.reason, arc.edges.length, fs.existsSync(`${L.files.archive}/a.md`)], ['a', '內容與 b 重複', 2, true])
            assert.deepEqual(arc.reverse.map((p) => `${p.o}|${p.n}`), ['a|b'], '封存記涉及該篇之反向待處理對(撤銷時放回)')
            const audit = auditOf(e)
            assert.deepEqual(audit.map((x) => [x.reason, x.note, x.detail]), [['note-deleted', 'a', '內容與 b 重複'], ['note-deleted', 'a', '內容與 b 重複']])
            // 衝突邊之撤出寫事件帳(此前只有重評寫;提煉據以排「衝突已不成立」之重審)
            const ev = readJsonlRows(`${e.deps.dirs.state}/${LEDGER_FILES.conflictEvents}`)
            assert.deepEqual(ev.map((x) => [x.edgeId, x.kind, x.oldType, x.note]), [[edgeId('a', 'b'), 'retire', C, 'a']])
            for (const id of ['b', 'c']) {
                const md = readMd(e.file(id))
                assert.ok(!(md.front.related || []).includes('a') && !md.body.includes('[[a]]'), `${id} 之投影不再列 a`)
            }
            assert.equal(readMd(e.file('b')).front.conflicts, undefined, 'b 唯一之衝突對象已刪 → 衝突章移除')
            assert.deepEqual(await deletionStatusOf(e.deps, 'a'), { record: false, tombstone: true, archive: true, edges: 0, md: false, complete: true })
        })

        it('中斷後續作:刪邊途中拋錯 → 墓碑與封存已在、記錄仍在(半刪);重跑 op 續完且封存之邊為聯集(撤銷得回全部);記錄已無而殘留邊者,關聯段依墓碑清除(稽核)', async () => {
            const e = env()
            const undo = failAt(e.relations, 'del', 2)
            await assert.rejects(() => deleteNote(e.deps, 'a', { reason: '測試刪除' }), /模擬中斷/)
            undo()
            assert.ok(e.state().tombstones.has('a') && fs.existsSync(`${e.state().files.archive}/a.json`))
            assert.deepEqual([(await e.relations.select()).length, !!(await e.notes.get('a'))], [2, true], '殘留一條 a 之邊、記錄仍在')
            assert.deepEqual(deletionHalfStatesOf(e.deps.dirs.state, (id) => ['a', 'b', 'c'].includes(id)), [{ id: 'a', state: 'tombstone-with-record' }])
            assert.equal((await deletionStatusOf(e.deps, 'a')).complete, false)
            const r2 = await deleteNote(e.deps, 'a')
            assert.deepEqual([r2.resumed, r2.edges, (await e.relations.select()).length, await e.notes.get('a'), r2.reason, r2.neighbors], [true, 1, 1, null, '測試刪除', ['b', 'c']], '續作不需再給理由(取墓碑);鄰居含前次已撤之邊之對方(取自封存)')
            assert.equal(JSON.parse(fs.readFileSync(`${e.state().files.archive}/a.json`, 'utf8')).edges.length, 2, '封存之邊為兩次之聯集')
            assert.equal((await deletionStatusOf(e.deps, 'a')).complete, true)
            assert.equal((await undoDeleteNote(e.deps, 'a')).edgesRestored, 2)
            // 記錄已無而邊殘留(管線外移除記錄):關聯段只依墓碑清除
            const f = env()
            f.state().tombstones.add('a', 'x', '測試刪除')
            await f.notes.del('a')
            const ctx = bagCtx({ stores: { notes: f.notes, relations: f.relations }, settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { rounds: 1, notesPerCall: 6, candidatesPerNote: 5 } }), ai: null, clock, dirs: { state: f.deps.dirs.state }, domains: { relate: DOMAIN } }, silentLog)
            const rr = await stageRelate({ callAI: withCheck(async () => ({ ok: true, data: [], error: '', skipped: false, attempts: 1, preview: '' })) }).run(ctx)
            assert.deepEqual([rr.detail.retired, rr.detail.dangling], [2, 0])
            assert.deepEqual((await f.relations.select()).map((x) => x.id), [edgeId('b', 'c')])
            const r3 = await deleteNote(f.deps, 'a')
            assert.deepEqual([r3.resumed, r3.edges], [true, 0], '記錄已無、有墓碑:續完不拋錯')
        })

        it('續作補齊(終審 D1):記錄已刪而 md 仍在(刪 md 前中斷)→ 重跑取封存之 md 路徑刪之、鄰居取自封存;md 與封存副本不同者不刪(mdLeft);前次還原或撤銷未歸檔封存者拒刪', async () => {
            const e = env()
            await deleteNote(e.deps, 'a', { reason: '測試刪除', project: false })
            const files = archiveFilesOf(e.deps.dirs.state, 'a')
            fs.copyFileSync(files.md, e.file('a')) // 模擬:刪 md 之前中斷
            assert.deepEqual(deletionHalfStatesOf(e.deps.dirs.state, (id) => ['b', 'c'].includes(id)), [{ id: 'a', state: 'md-left' }])
            const r = await deleteNote(e.deps, 'a', { project: false })
            assert.deepEqual([r.resumed, r.edges, r.neighbors, r.mdLeft, fs.existsSync(e.file('a'))], [true, 0, ['b', 'c'], false, false])
            assert.deepEqual(deletionHalfStatesOf(e.deps.dirs.state, (id) => ['b', 'c'].includes(id)), [])
            // md 與封存副本不同(非本次刪除之物)→ 不刪、回報
            fs.writeFileSync(e.file('a'), '他處寫入之不同內容', 'utf8')
            const r2 = await deleteNote(e.deps, 'a', { project: false })
            assert.deepEqual([r2.mdLeft, fs.readFileSync(e.file('a'), 'utf8')], [true, '他處寫入之不同內容'])
            // 前次還原或撤銷未歸檔封存(記錄在、無墓碑、封存在)→ 拒刪(否則新封存誤併舊封存之邊)
            const f = env()
            await deleteNote(f.deps, 'b', { reason: '測試刪除', project: false })
            const fb = archiveFilesOf(f.deps.dirs.state, 'b')
            const keep = fs.readFileSync(fb.json)
            await undoDeleteNote(f.deps, 'b', { project: false })
            fs.writeFileSync(fb.json, keep) // 模擬:歸檔之前中斷
            assert.deepEqual(deletionHalfStatesOf(f.deps.dirs.state, (id) => ['a', 'b', 'c'].includes(id)), [{ id: 'b', state: 'archive-without-tombstone' }])
            await assert.rejects(() => deleteNote(f.deps, 'b', { reason: '再刪' }), /筆記 b 之前次還原或撤銷未完成（封存未歸檔）——以 deleteNote（續刪）或 undoDeleteNote／restoreNote（續還原）續作完成/)
        })
    })

    describe('undoDeleteNote(撤銷:原樣、不過閘、不登錄新待判)', function() {

        it('原樣放回:記錄、md 逐位元組;邊逐欄 sameEdge(含簡體理由、數字不見於兩端之衝突邊〔未過 RS8〕);型別改名照改名表機械改寫;反向待處理對含 tries;待判與檢核不增;稽核 restored;本篇與鄰居先記待投影;封存歸檔 .undone-', async () => {
            const e = env({ holds: true })
            const RN = createRelateDomain({ vocab: { relationTypeRenames: { 舊互補搭配: '互補搭配' } } })
            for (const x of await e.relations.select()) await e.relations.del(x.id)
            await e.addNote('d')
            await e.addNote('f')
            const E = {
                ab: makeEdge({ from: 'a', to: 'b', type: C, reason: '甲说年化 12% 有效、乙说扣除成本后无效', nowIso: AT }),
                ca: makeEdge({ from: 'c', to: 'a', type: '前置概念', reason: 'c 之定義是理解 a 之前置概念', nowIso: AT }),
                ad: { ...makeEdge({ from: 'a', to: 'd', type: '舊互補搭配', reason: 'a 與 d 共用同一組成交量指標', nowIso: AT }), history: [{ from: 'd', to: 'a', type: '舊互補搭配', reason: 'd 先於 a', createdAt: '2026-01-01' }] },
                bc: makeEdge({ from: 'b', to: 'c', type: '互補搭配', reason: 'b 與 c 共用同一組成交量指標', nowIso: AT }),
            }
            await e.relations.insertNew(Object.values(E))
            e.state().reverse.add([{ o: 'f', n: 'a', score: 21, at: 't1' }])
            e.state().reverse.bump([{ o: 'f', n: 'a' }])
            e.state().reverse.bump([{ o: 'f', n: 'a' }])
            const rec0 = await e.notes.get('a')
            const md0 = fs.readFileSync(e.file('a'))
            await deleteNote(e.deps, 'a', { reason: '測試刪除', project: false })
            const h0 = await holdsCount(e)
            const r = await undoDeleteNote({ ...e.deps, domain: RN }, 'a', { project: false })
            assert.deepEqual([r.undone, r.resumed, r.edgesRestored, r.edgesKept, r.edgesSkipped, r.mdConflict, r.reversePairs, r.neighbors, r.projected], [true, false, 3, [], [], false, 1, ['b', 'c', 'd'], null])
            assert.deepEqual(await e.notes.get('a'), rec0, '記錄原樣')
            assert.ok(fs.readFileSync(e.file('a')).equals(md0), 'md 逐位元組放回')
            const now = await edgesById(e)
            assert.ok(sameEdge(now.get(E.ab.id), E.ab), '簡體理由、未過 RS8 之衝突邊原樣(撤銷不過新進之閘)')
            assert.ok(sameEdge(now.get(E.ca.id), E.ca))
            const ad = now.get(E.ad.id)
            assert.deepEqual([ad.type, ad.history.map((h) => h.type), ad.updatedAt, ad.reason], ['互補搭配', ['互補搭配'], E.ad.updatedAt, E.ad.reason], '型別改名照改名表機械改寫(id、updatedAt 不動)')
            assert.equal(await holdsCount(e), h0, '不登錄新待判(撤銷不產生該次處置以外之判定工作)')
            assert.deepEqual((await e.deps.stores.checks.select()).length, 0)
            assert.deepEqual(restoredRows(e, 'undoDeleteNote').map((x) => [x.edge.id, x.note, x.restoredFrom]).sort(), [E.ab.id, E.ad.id, E.ca.id].sort().map((id) => [id, 'a', 'note-deleted']))
            assert.deepEqual(e.state().reverse.pairs().find((p) => p.o === 'f'), { o: 'f', n: 'a', score: 21, at: 't1', tries: 2 }, '反向待處理對原樣放回(含 tries)')
            assert.equal(e.state().tombstones.has('a'), false)
            assert.ok(fs.readdirSync(e.state().files.archive).some((x) => /^a\.undone-\d+\.json$/.test(x)))
            assert.deepEqual([e.state().dirty.ids(), e.state().state.get().indexDirty], [['a', 'b', 'c', 'd'], true], '本篇與鄰居先記待投影、總覽待重建(呼叫端不當場投影時下輪補投)')
            await projectAll({ ...e.deps, domain: RN })
            assert.deepEqual(readMd(e.file('b')).front.conflicts, ['a'], '補投後鄰居之衝突章回來')
            assert.deepEqual(deletionHalfStatesOf(e.deps.dirs.state, () => true), [])
            // 冪等:已撤銷完 → 無可撤銷
            assert.deepEqual((await undoDeleteNote(e.deps, 'a')).undone, false)
            await assert.rejects(() => undoDeleteNote(e.deps, 'nope'), /找不到封存/)
        })

        it('續作(各步注入中斷):放回記錄時中斷 → md 已在(md-left)→ 重跑完成;放回第二條邊時中斷 → 半狀態(墓碑在而記錄在)→ 重跑只補未完成者(稽核不重複)', async () => {
            const e = env()
            await deleteNote(e.deps, 'a', { reason: '測試刪除', project: false })
            let undo = failAt(e.notes, 'insertNew', 1)
            await assert.rejects(() => undoDeleteNote(e.deps, 'a'), /模擬中斷/)
            undo()
            assert.deepEqual(deletionHalfStatesOf(e.deps.dirs.state, (id) => ['b', 'c'].includes(id)), [{ id: 'a', state: 'md-left' }])
            undo = failAt(e.relations, 'insertNew', 2)
            await assert.rejects(() => undoDeleteNote(e.deps, 'a'), /模擬中斷/)
            undo()
            assert.deepEqual(deletionHalfStatesOf(e.deps.dirs.state, (id) => ['a', 'b', 'c'].includes(id)), [{ id: 'a', state: 'tombstone-with-record' }])
            assert.equal(restoredRows(e).length, 1, '第一條已放回並記稽核')
            const r = await undoDeleteNote(e.deps, 'a')
            assert.deepEqual([r.undone, r.resumed, r.edgesRestored], [true, true, 1], '續作只補未完成者')
            assert.equal(restoredRows(e).length, 2, '稽核不重複')
            assert.equal((await e.relations.select()).length, 3)
            assert.deepEqual(deletionHalfStatesOf(e.deps.dirs.state, () => true), [])
        })

        it('半刪之逆:刪除停在撤邊途中(第二條邊已記撤出稽核而未刪成)→ 撤銷放回已撤之邊、稽核與現值不一致之邊補記 restored、移除墓碑、歸檔、預設當場投影鄰居;只記了墓碑(封存之前中斷)者撤銷＝移除墓碑;未被刪除者無可撤銷', async () => {
            const e = env()
            const undo = failAt(e.relations, 'del', 2)
            await assert.rejects(() => deleteNote(e.deps, 'a', { reason: '測試刪除' }), /模擬中斷/)
            undo()
            const r = await undoDeleteNote(e.deps, 'a')
            assert.deepEqual([r.undone, r.resumed, r.edgesRestored, r.neighbors, r.projected.projected], [true, true, 2, ['b', 'c'], 3])
            assert.equal((await e.relations.select()).length, 3)
            assert.deepEqual([...retiredEdgesOf(auditOf(e)).keys()], [], '稽核與現值一致(無在撤出中之邊)')
            assert.deepEqual(readMd(e.file('b')).front.conflicts, ['a'])
            assert.deepEqual([e.state().tombstones.has('a'), deletionHalfStatesOf(e.deps.dirs.state, () => true)], [false, []])
            // 只記了墓碑
            const f = env()
            f.state().tombstones.add('a', AT, '測試刪除')
            assert.deepEqual([(await undoDeleteNote(f.deps, 'a')).undone, f.state().tombstones.has('a')], [true, false])
            assert.deepEqual((await undoDeleteNote(f.deps, 'a')).undone, false, '未被刪除:無可撤銷')
        })

        it('其後之改動不覆寫:md 已在而不同 → mdConflict(不覆寫);刪除後另被撤出之邊不放回(edgesKept);對方已被刪 → edgesSkipped;被略過之邊於兩端皆在後以 restoreEdge 補救(note-deleted 可還原,過閘)', async () => {
            const e = env()
            await deleteNote(e.deps, 'a', { reason: '測試刪除', project: false })
            fs.writeFileSync(e.file('a'), '他處寫入之不同內容', 'utf8')
            appendAudit(e.state().files.retired, { at: '2026-01-06T00:00:00+08:00', reason: 'std-retire', edge: makeEdge({ from: 'c', to: 'a', type: '前置概念', reason: 'c 之定義是理解 a 之前置概念', nowIso: AT }) })
            await deleteNote(e.deps, 'b', { reason: '測試刪除', project: false })
            const r = await undoDeleteNote(e.deps, 'a', { project: false })
            assert.deepEqual([r.undone, r.edgesRestored, r.mdConflict, r.edgesKept, r.edgesSkipped, r.neighbors], [true, 0, true, [{ id: edgeId('c', 'a'), other: 'c', why: '刪除後另被撤出（std-retire）' }], [{ id: edgeId('a', 'b'), other: 'b' }], []])
            assert.equal(fs.readFileSync(e.file('a'), 'utf8'), '他處寫入之不同內容')
            // b 撤銷後兩端皆在:a–b 由 restoreEdge 補救(撤出理由 note-deleted;使用者之還原過閘)
            await undoDeleteNote(e.deps, 'b', { project: false })
            const p = await restoreEdge(e.deps, edgeId('a', 'b'))
            assert.deepEqual([p.restorable, p.retiredAs], [true, 'note-deleted'], p.reason)
            const ap = await restoreEdge(e.deps, edgeId('a', 'b'), { apply: true, project: false })
            assert.deepEqual([ap.applied, ap.ruling, !!(await e.relations.get(edgeId('a', 'b')))], [true, '', true])
            assert.equal((await restoreEdge(e.deps, edgeId('a', 'b'))).reason, '稽核最後一筆為已還原')
        })
    })

    describe('restoreNote(使用者之重新收件:過閘)', function() {

        it('由封存還原記錄、md 與兩端仍在之邊;反向待處理對放回(同撤銷);墓碑移除、鄰居當場重投並回傳、稽核 restored(via restoreNote)、封存歸檔;已還原者拒還原', async () => {
            const e = env()
            await e.addNote('f')
            e.state().reverse.add([{ o: 'f', n: 'a', score: 21, at: 't1' }])
            await deleteNote(e.deps, 'a', { reason: '測試刪除' })
            assert.equal((await restoreNote(e.deps, 'a', { dryRun: true })).reversePairs, 1, '預演列將放回之反向待處理對')
            const r = await restoreNote(e.deps, 'a')
            assert.deepEqual([r.edgesRestored, r.edgesSkipped, r.edgesRejected, r.edgesKept, r.neighbors, r.resumed, r.reversePairs], [2, [], [], [], ['b', 'c'], false, 1])
            assert.deepEqual(e.state().reverse.pairs().map((p) => `${p.o}|${p.n}`), ['f|a'])
            assert.ok(await e.notes.get('a'))
            assert.equal((await e.relations.select()).length, 3)
            assert.equal((await e.relations.get(edgeId('a', 'b'))).type, C)
            assert.deepEqual(readMd(e.file('b')).front.conflicts, ['a'], '鄰居重投回衝突章')
            assert.equal(restoredRows(e, 'restoreNote').length, 2)
            const L = e.state()
            assert.equal(L.tombstones.has('a'), false)
            assert.equal(fs.existsSync(`${L.files.archive}/a.json`), false)
            assert.ok(fs.readdirSync(L.files.archive).some((f) => /^a\.restored-\d+\.json$/.test(f)))
            await assert.rejects(() => restoreNote(e.deps, 'a'), /找不到封存/)
        })

        it('預演(dryRun;純讀):列出將還原、不還原之邊與鄰居,不寫任何東西(墓碑、記錄、封存、邊、稽核皆不動)', async () => {
            const e = env()
            await deleteNote(e.deps, 'a', { reason: '測試刪除', project: false })
            const before = [fs.readFileSync(e.state().files.retired, 'utf8'), (await e.relations.select()).length]
            const d = await restoreNote(e.deps, 'a', { dryRun: true })
            assert.deepEqual([d.dryRun, d.edgesRestored, d.edgesRejected, d.neighbors, d.projected], [true, 2, [], ['b', 'c'], null])
            assert.deepEqual([e.state().tombstones.has('a'), await e.notes.get('a'), fs.existsSync(`${e.state().files.archive}/a.json`), fs.readFileSync(e.state().files.retired, 'utf8'), (await e.relations.select()).length], [true, null, true, ...before])
        })

        it('續作:放回第二條邊時中斷 → 重跑只補未完成者(稽核不重複)、移除墓碑', async () => {
            const e = env()
            await deleteNote(e.deps, 'a', { reason: '測試刪除', project: false })
            const undo = failAt(e.relations, 'insertNew', 2)
            await assert.rejects(() => restoreNote(e.deps, 'a', { project: false }), /模擬中斷/)
            undo()
            const r = await restoreNote(e.deps, 'a', { project: false })
            assert.deepEqual([r.resumed, r.edgesRestored, r.neighbors, restoredRows(e).length, (await e.relations.select()).length, e.state().tombstones.has('a')], [true, 1, ['b', 'c'], 2, 3, false], '續作只補未完成者;稽核不重複')
        })

        it('過納入閘:封存之邊理由簡體 → 轉正體後還原;理由空泛、數字不見於兩端筆記、型別無對映 → 不還原並列出理由', async () => {
            const e = env()
            for (const x of await e.relations.select()) await e.relations.del(x.id)
            await e.relations.insertNew([
                makeEdge({ from: 'a', to: 'b', type: C, reason: '甲说动量有效、乙说扣除成本则无效', nowIso: AT }),
                makeEdge({ from: 'a', to: 'c', type: '前置概念', reason: '都與某主題有關', nowIso: AT }),
            ])
            await e.addNote('d', '# 標題d\n\n## 一句話重點\n\n年化 8.2%\n\n## 核心知識\n\n- k')
            await e.addNote('f')
            await e.relations.insertNew([
                makeEdge({ from: 'a', to: 'd', type: '延伸深化', reason: 'a 之訊號延伸 d 之夏普 1.9 結論', nowIso: AT }),
                makeEdge({ from: 'a', to: 'f', type: '舊型別', reason: 'a 之訊號與 f 共用同一組指標', nowIso: AT }),
            ])
            await deleteNote(e.deps, 'a', { reason: '測試刪除' })
            const r = await restoreNote(e.deps, 'a')
            assert.deepEqual([r.edgesRestored, r.neighbors], [1, ['b']], '鄰居只含放回後仍相連者')
            assert.equal((await e.relations.get(edgeId('a', 'b'))).reason, '甲說動量有效、乙說扣除成本則無效', '簡體修正後還原')
            const why = Object.fromEntries(r.edgesRejected.map((x) => [x.other, x.reasons.join('；')]))
            assert.match(why.c, /^RS2 去空泛片語與標點後只剩 0 字/)
            assert.match(why.d, /^RS8 兩端皆無之數字：1\.9/)
            assert.match(why.f, /型別「舊型別」不在清單、亦無改名或別名對映/)
            assert.equal((await e.relations.select()).length, 1, '未過閘者不入庫')
        })

        it('帶回之衝突邊之 RS4 登錄守豁免:使用者已豁免而邊未再變者不重開;無豁免者登錄(pipeline)', async () => {
            const e = env({ holds: true })
            const eab = edgeId('a', 'b')
            await putHold(e.deps.stores.holds, { object: RS4.objectEdge, oid: eab, std: RS4.std, reason: '前次登錄', next: 'x', owner: 'pipeline', deadline: '2026-12-31T00:00:00Z', ctx: { from: 'a', to: 'b' } }, '2026-01-06T00:00:00+08:00')
            await waiveHold(e.deps.stores.holds, holdKey(RS4.objectEdge, eab, RS4.std), { by: '使用者', ruling: '保留', at: '2026-01-07T00:00:00+08:00' })
            await deleteNote(e.deps, 'a', { reason: '測試刪除', project: false })
            const r = await restoreNote(e.deps, 'a', { project: false, conflictCheck: true })
            assert.deepEqual([r.rs4Queued, (await e.deps.stores.holds.get(holdKey(RS4.objectEdge, eab, RS4.std))).status], [0, 'waived'])
            const f = env({ holds: true })
            await deleteNote(f.deps, 'a', { reason: '測試刪除', project: false })
            const r2 = await restoreNote(f.deps, 'a', { project: false, conflictCheck: true })
            assert.deepEqual([r2.rs4Queued, (await f.deps.stores.holds.get(holdKey(RS4.objectEdge, eab, RS4.std))).status], [1, 'open'])
        })

        // 2026-10-07 摘要切換(盤查 C delete:172 之改寫):還原閘本身(判定、修法、SS9 對應、待判)由 摘要套件 w-knowledge-summarize unit-summarize-contract「還原閘之對外契約…」
        //   與 unit-summarize-ops「還原筆記之標準閘」各案驗;本案驗本套件之 restoreNote 與之整合(封存、墓碑、withHolds、預演之拒絕、未注入 WARN),
        //   以及撤銷(undoDeleteNote)不經筆記標準。還原閘之詞彙須經摘要套件解析(未解析者建立即拋);詞彙之類別含夾具之 'c'
        it('筆記過筆記標準(注入 deps.noteGate＝摘要套件之 createNoteRestoreGate):可修者修正後還原(md、記錄、syncHash;不寫 knowledgeChangedAt);仍不合格者不還原且不寫任何東西(預演列 refused);withHolds 照還原並登錄待判;撤銷不經標準;未注入 → WARN', async () => {
            const e = env({ holds: true })
            const holds = e.deps.stores.holds
            const VOC = resolveSummarizeVocab({ categories: ['c', '其他'], claimTypes: ['實證研究'], evidenceLevels: ['高', '中', '低'] })
            assert.throws(() => createNoteRestoreGate({ stores: e.deps.stores, vocab: { claimTypes: ['實證研究'], evidenceLevels: ['高', '中', '低'] }, clock }), /resolveSummarizeVocab/, '未經摘要套件解析之詞彙 → 建立即拋')
            const noteGate = createNoteRestoreGate({ stores: e.deps.stores, vocab: VOC, clock })
            const mkNote = async (id, title, kps) => {
                const body = `# ${title}\n\n## 一句話重點\n\n動量之重點\n\n## 品質與證據標注\n\n- 內容類型：實證研究\n- 證據等級：中\n\n## 核心知識\n\n${kps}\n`
                writeMd(e.file(id), { title, slug: id, concepts: ['動量', '風險'], claim_type: '實證研究', evidence_level: '中' }, body)
                const md = readMd(e.file(id))
                await e.notes.insertNew([{ id, title, concepts: ['動量', '風險'], summary: '動量之重點', category: 'c', createdAt: '2026-01-01', relatedAt: '2026-01-02', file: e.file(id), syncHash: syncHashOf(syncFieldsOf(md)) }])
                await deleteNote(e.deps, id, { reason: '測試刪除' })
            }
            // 可修:標題簡體
            await mkNote('g', '动量之风险', '- 要點')
            const r = await restoreNote({ ...e.deps, noteGate }, 'g', { project: false })
            assert.deepEqual([...new Set(r.std.fixed.map((c) => c.std))], ['SS3'], JSON.stringify(r.std.fixed))
            // 兩旗標分列(還原閘之 contentChanged／titleChanged,與存量處置之帳列同義;呼叫端據以請下游重設基準):標題與正文 H1 皆轉正體
            assert.deepEqual([r.std.titleChanged, r.std.contentChanged], [true, true])
            const g = await e.notes.get('g')
            const mdG = readMd(e.file('g'))
            assert.deepEqual([g.title, mdG.front.title, g.knowledgeChangedAt], ['動量之風險', '動量之風險', undefined])
            assert.equal(g.syncHash, syncHashOf(syncFieldsOf(mdG)), 'syncHash 依修正後之 md(下輪同步不報內容變更)')
            assert.ok(g.stdFixes.some((x) => /^還原 SS3/.test(x)))
            // 仍不合格(核心知識為空):不還原、不寫;預演列 refused 不拋
            await mkNote('h', '標題h', '')
            const dry = await restoreNote({ ...e.deps, noteGate }, 'h', { dryRun: true })
            assert.match(dry.refused, /確定性修正後仍未達筆記標準（SS2 核心知識為空）——不還原/)
            await assert.rejects(() => restoreNote({ ...e.deps, noteGate }, 'h', { project: false }), /確定性修正後仍未達筆記標準（SS2 核心知識為空）——不還原/)
            assert.deepEqual([await e.notes.get('h'), fs.existsSync(e.file('h')), e.state().tombstones.has('h')], [null, false, true])
            // withHolds:照還原並登錄待判(使用者)
            const r2 = await restoreNote({ ...e.deps, noteGate }, 'h', { project: false, withHolds: true })
            assert.deepEqual([r2.std.held, r2.std.titleChanged, r2.std.contentChanged], [['SS2'], false, false])
            assert.ok(await e.notes.get('h'))
            const hh = await holds.get('note:h:SS2')
            assert.deepEqual([hh.status, hh.owner], ['open', 'user'])
            // 撤銷(回退):原樣放回、不經筆記標準、不告警、不登錄待判
            await mkNote('k', '动量之风险二', '- 要點')
            const before = [e.log.length, (await holds.select()).length]
            const r3 = await undoDeleteNote({ ...e.deps, noteGate }, 'k', { project: false })
            assert.deepEqual([r3.undone, (await e.notes.get('k')).title, e.log.slice(before[0]).filter((l) => /未注入筆記標準閘/.test(l)), (await holds.select()).length], [true, '动量之风险二', [], before[1]])
            // 未注入:WARN 並原樣還原
            await mkNote('m', '标题m', '- 要點')
            await restoreNote(e.deps, 'm', { project: false })
            assert.ok(e.log.some((l) => /^WARN 還原筆記 m：未注入筆記標準閘/.test(l)))
            assert.equal((await e.notes.get('m')).title, '标题m')
        })
    })

    describe('restoreEdge(依稽核還原)', function() {

        it('note-deleted:一端不在 → 不可還原並指 restoreNote;裁示(AI 標準之撤出／隔離)須 checks 集合——缺即於寫前拋;續作:寫邊後中斷(裁示未記)→ 重跑補完裁示與稽核(不重複);預設當場投影兩端', async () => {
            const e = env()
            await deleteNote(e.deps, 'a', { reason: '測試刪除', project: false })
            const nd = await restoreEdge(e.deps, edgeId('a', 'b'))
            assert.deepEqual([nd.restorable, nd.reason], [false, '端點筆記不在（已刪除）——請以 restoreNote（重新收件：過標準）或 undoDeleteNote（撤銷刪除：原樣放回）還原該筆記（其邊一併還原）'])
            // 隔離之衝突邊(rs4-quarantine)
            const f = env({ holds: true })
            const ebc = makeEdge({ from: 'b', to: 'c', type: C, reason: '乙說訊號有效、丙說扣成本後無效', nowIso: AT })
            await f.relations.del(edgeId('b', 'c'))
            await f.relations.insertNew([ebc])
            await retireEdge({ relations: f.relations, ledgers: f.state(), stateDir: f.deps.dirs.state }, ebc, { reason: 'rs4-quarantine', at: AT, conflictTypes: DOMAIN.conflictTypeNames })
            const noChecks = { ...f.deps, stores: { ...f.deps.stores, checks: undefined } }
            const auditBefore = auditOf(f).length
            await assert.rejects(() => restoreEdge(noChecks, ebc.id, { apply: true }), /須 stores\.checks 記檢核紀錄/)
            assert.deepEqual([await f.relations.get(ebc.id), auditOf(f).length], [null, auditBefore], '寫前拋:未寫邊、未記稽核')
            const undo = failAt(f.deps.stores.checks, 'replace', 1)
            await assert.rejects(() => restoreEdge(f.deps, ebc.id, { apply: true }), /模擬中斷/)
            undo()
            assert.ok(await f.relations.get(ebc.id), '邊已寫入、稽核未記')
            const r = await restoreEdge(f.deps, ebc.id, { apply: true })
            assert.deepEqual([r.applied, r.resumed, r.ruling, restoredRows(f).length], [true, true, RS4.std, 1])
            assert.equal(r.projected.projected, 2, '預設當場投影兩端')
        })
    })

    describe('pruneDangling、projectAll、世代、domain', function() {

        it('pruneDangling:預設只列出;apply 才刪(稽核)並當場投影存活之端點;projectAll 全庫重投', async () => {
            const e = env()
            await e.relations.insertNew([makeEdge({ from: 'a', to: 'ghost', type: '前置概念', reason: 'r', nowIso: 'x' })])
            const dry = await pruneDangling(e.deps)
            assert.deepEqual([dry.dangling, dry.removed, (await e.relations.select()).length], [1, 0, 4])
            const ap = await pruneDangling(e.deps, { apply: true })
            assert.deepEqual([ap.removed, (await e.relations.select()).length, ap.projected.projected, e.state().dirty.ids(), e.state().state.get().indexDirty], [1, 3, 1, [], true])
            const pa = await projectAll(e.deps, { all: true })
            assert.deepEqual([pa.total, pa.projected, pa.backlog], [3, 3, 0])
            assert.ok(readMd(e.file('c')).front.related.includes('a'))
            // project:false 只記待投影(下輪補投)
            const f = env()
            await f.relations.insertNew([makeEdge({ from: 'b', to: 'ghost', type: '前置概念', reason: 'r', nowIso: 'x' })])
            const ap2 = await pruneDangling(f.deps, { apply: true, project: false })
            assert.deepEqual([ap2.projected, f.state().dirty.ids()], [undefined, ['b']])
        })

        it('預演純讀(STD-26):帳檔損壞時 pruneDangling 之預演不開帳——壞檔原樣、無隔離檔、無告警;apply 才開帳(隔離壞檔並告警)', async () => {
            const e = env()
            await e.relations.insertNew([makeEdge({ from: 'a', to: 'ghost', type: '前置概念', reason: 'r', nowIso: 'x' })])
            fs.mkdirSync(e.deps.dirs.state, { recursive: true })
            const bad = `${e.deps.dirs.state}/${LEDGER_FILES.dirty}`
            fs.writeFileSync(bad, '{not json')
            const corruptOf = () => e.deps.log.lines.filter((l) => /關聯帳檔損壞/.test(l)).length
            const dry = await pruneDangling(e.deps)
            assert.deepEqual([dry.dangling, dry.removed, fs.readdirSync(e.deps.dirs.state), fs.readFileSync(bad, 'utf8'), corruptOf()], [1, 0, [LEDGER_FILES.dirty], '{not json', 0], '預演:壞檔原樣、無隔離檔、無告警')
            const ap = await pruneDangling(e.deps, { apply: true })
            assert.equal(ap.removed, 1)
            assert.ok(fs.readdirSync(e.deps.dirs.state).some((f) => f.startsWith(`${LEDGER_FILES.dirty}.corrupt-`)), 'apply:開帳隔離壞檔')
            assert.equal(corruptOf(), 1, 'apply:告警一次')
        })

        it('邊庫世代不符(未遷移)→ 刪除／撤銷／還原／清理一律拒寫;訊息中立(舊世代資料須先遷移)', async () => {
            const e = env()
            await e.relations.insertNew([{ id: sha1('z|a'), from: 'z', to: 'a', type: '前置概念', reason: 'r', createdAt: 'x' }])
            await assert.rejects(() => deleteNote(e.deps, 'a', { reason: '測試刪除' }), { message: '關聯邊庫世代不符：1 條邊之 id 不是無序對雜湊——邊 id 非無序對身分之舊世代資料，須先遷移' })
            await assert.rejects(() => pruneDangling(e.deps, { apply: true }), /世代不符/)
            await assert.rejects(() => undoDeleteNote(e.deps, 'a'), /世代不符/)
            await assert.rejects(() => restoreNote(e.deps, 'a', { dryRun: true }), /世代不符/)
            assert.ok(await e.notes.get('a'))
            assert.equal(fs.existsSync(`${e.deps.dirs.state}/${LEDGER_FILES.tombstones}`), false)
        })

        it('domain 於任何寫入前驗(缺即拋,不以「衝突邊不寫事件」或「寫到一半才拋」降級):deleteNote(不論投影與否)、pruneDangling 之 apply、undoDeleteNote、restoreNote、restoreEdge、projectAll;預演(刪除、清理)不需 domain', async () => {
            const e = env()
            const noDomain = { ...e.deps, domain: undefined }
            const msg = (op) => `${op} 需要 deps.domain（關聯 domain，createRelateDomain 之產物——撤邊之衝突事件、投影與還原之納入閘皆讀之）`
            const untouched = async () => {
                assert.deepEqual([!!(await e.notes.get('a')), (await e.relations.select()).length, fs.existsSync(e.file('a')), fs.existsSync(e.deps.dirs.state)], [true, 3, true, false], '未寫任何東西')
            }
            for (const project of [true, false]) {
                await assert.rejects(() => deleteNote(noDomain, 'a', { reason: '測試刪除', project }), { message: msg('deleteNote') }, `project:${project}`)
                await untouched()
            }
            await assert.rejects(() => deleteNote({ ...e.deps, domain: { relationTypes: [] } }, 'a', { reason: '測試刪除' }), { message: msg('deleteNote') }, '殘缺之 domain 亦拋')
            assert.equal((await deleteNote(noDomain, 'a', { dryRun: true })).edges, 2, '預演不需 domain')
            await e.relations.insertNew([makeEdge({ from: 'a', to: 'ghost', type: C, reason: '甲說有效、鬼說無效之衝突', nowIso: 'x' })])
            await assert.rejects(() => pruneDangling(noDomain, { apply: true }), { message: msg('pruneDangling') })
            assert.deepEqual([(await pruneDangling(noDomain)).dangling, (await e.relations.select()).length], [1, 4], '預演不需 domain;未撤邊')
            await assert.rejects(() => projectAll(noDomain, { all: true }), { message: msg('projectAll') })
            // 撤銷與還原:先以完整 deps 刪除,再以缺 domain 之 deps 撤銷／還原 → 拋、記錄與墓碑皆不動
            await deleteNote(e.deps, 'b', { reason: '測試刪除', project: false })
            await assert.rejects(() => undoDeleteNote(noDomain, 'b', { project: false }), { message: msg('undoDeleteNote') })
            await assert.rejects(() => restoreNote(noDomain, 'b', { project: false }), { message: msg('restoreNote') })
            assert.deepEqual([await e.notes.get('b'), e.state().tombstones.has('b')], [null, true])
            const retired = auditOf(e)
            await assert.rejects(() => restoreEdge(noDomain, retired[0].edge.id), { message: msg('restoreEdge') })
            // 完整 deps 之衝突邊撤出照寫事件帳(對照)
            await pruneDangling(e.deps, { apply: true })
            const ev = readJsonlRows(`${e.deps.dirs.state}/${LEDGER_FILES.conflictEvents}`)
            assert.ok(ev.some((x) => x.edgeId === edgeId('a', 'ghost') && x.kind === 'retire'), '懸空之衝突邊撤出寫事件帳')
        })
    })

    describe('半狀態(關聯段每輪偵測;墓碑在而記錄在之篇不是本段之對象)', function() {

        it('關聯段:半狀態發必看字樣「關聯刪除或還原未完成」(墓碑在而記錄在、封存未歸檔);墓碑在而記錄在之篇不入正向池與候選', async () => {
            const e = env()
            // a:墓碑在而記錄在(刪除停在封存之前);c:封存未歸檔而無墓碑;b 為待關聯之新筆記
            e.state().tombstones.add('a', AT, '測試刪除')
            const fc = archiveFilesOf(e.deps.dirs.state, 'c')
            fs.mkdirSync(fc.dir, { recursive: true })
            fs.writeFileSync(fc.json, JSON.stringify({ deletedAt: AT, reason: 'x', record: await e.notes.get('c'), edges: [], reverse: [] }), 'utf8')
            await e.notes.patch('b', { relatedAt: '' })
            await e.notes.patch('a', { relatedAt: '' })
            const prompts = []
            const log = recLog()
            const ctx = bagCtx({ stores: { notes: e.notes, relations: e.relations }, settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { rounds: 1, notesPerCall: 6, candidatesPerNote: 5 } }), ai: null, clock, dirs: { state: e.deps.dirs.state }, domains: { relate: DOMAIN } }, log)
            await stageRelate({ callAI: withCheck(async (p) => {
                prompts.push(p)
                return { ok: true, data: [], error: '', skipped: false, attempts: 1, preview: '' }
            }) }).run(ctx)
            const lines = log.lines
            assert.ok(lines.includes('WARN 關聯刪除或還原未完成：a（墓碑在而記錄在）、c（封存未歸檔）——以 deleteNote（續刪）或 undoDeleteNote／restoreNote（續還原）續作完成'), lines.join('\n'))
            assert.ok(prompts.length >= 1, '正向段有開工(b)')
            const slugs = prompts.flatMap((p) => [...p.matchAll(/^ {2}- slug: (\S+)｜/gm)].map((m) => m[1]))
            assert.ok(slugs.includes('c') && !slugs.includes('a'), `候選不含 a:${slugs.join(',')}`)
            assert.deepEqual([(await e.notes.get('a')).relateTries, (await e.notes.get('b')).relateTries > 0], [undefined, true], 'a 不入正向池(未被處理、未記 tries);b 入池')
            assert.equal((await e.relations.select()).length, 3, '半刪之篇之邊照常保留(記錄在即不算懸空)')
        })
    })
})
