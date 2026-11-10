// unit-relate-forward-reserve.test.mjs — 正向段(新筆記關聯主迴圈)亦扣保留給後段之時間(opt.reserveMs／deps.reserveMs),與反向、輪巡、重評、
//   既有邊覆核、衝突核對同法:開工前與每輪開工前判「剩餘−保留 ≥ 席位首家逾時」,每次呼叫以「剩餘−保留」封頂;時間不足是少做幾輪、不是縮容量
// 規格出處:規則帳本 REL-18(承 REL-08 之時間守門);保留時間之來源與取值規則不變(opt.reserveMs 明給者優先 → ctx.deps.reserveMs → 0)
// 同步方式:以注入之虛擬時鐘(remainingMs 讀 state.left)驅動,AI 替身每次呼叫扣 cost;不用固定等待,不呼叫 AI,不發網路
// 執行:自套件根 npx mocha test/unit-relate-forward-reserve.test.mjs(暫存 test/_tmp/relate-fwd-reserve-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, memStore, genClockTZ, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { writeMd } from '../src/core/summarizePackage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { inRelatePool } from '../src/stores/relatedNotes.mjs'
import { RELATE_REPORT_KEYS } from '../src/logContract.mjs'

let TMP = ''
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
let seq = 0

const MIN = 60_000
// 席位 stub:a(正向)首家逾時 6 分、stub:b 1 分;ai.timeoutMs 5 分——三者互異,才分得出開工門檻取的是哪一個
const TIMEOUTS = { 'stub:a': 6 * MIN, 'stub:b': 1 * MIN }

/**
 * 環境:pool 篇新筆記(正向池)＋related 篇已關聯之舊筆記;AI 替身只回空關聯(零邊亦算評估完)並登記每次呼叫收到之 budgetMs／shouldStop;
 *   虛擬時鐘 state.left(毫秒;未給即無截止),每次呼叫扣 cost
 * @param {Object} o 輸入 { pool, related?, left?, cost?, reserve?(deps.reserveMs;未給即不注入), expired?, parallel?, notesPerCall?, rounds?, relate?, ai? }
 * @returns {Object} 回傳 { ctx, notes, log, calls, state, run }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const mk = (id, i, extra) => {
        const file = `${dir}/notes/${id}.md`
        writeMd(file, { title: `T${id}`, slug: id }, `# T${id}\n\n## 一句話重點\n\n${id} 之重點\n`)
        return { id, title: `T${id}`, category: 'c', summary: `${id} 之重點`, concepts: ['p'], createdAt: `2026-01-${String(i + 1).padStart(2, '0')}`, relatedAt: '', file, ...extra }
    }
    const recs = [
        ...Array.from({ length: o.related || 0 }, (_, i) => mk(`r${String(i + 1).padStart(2, '0')}`, i, { relatedAt: '2026-01-02T00:00:00+08:00' })),
        ...Array.from({ length: o.pool }, (_, i) => mk(`p${String(i + 1).padStart(2, '0')}`, i + 10)),
    ]
    const notes = memStore(recs)
    const relations = memStore([])
    const log = recLog()
    const calls = []
    const state = { left: o.left, expired: !!o.expired }
    const deps = {
        stores: { notes, relations },
        settings: resolveRelateSettings({
            ai: { parallel: o.parallel ?? 1, timeoutMs: 5 * MIN, providerTimeouts: TIMEOUTS, ...(o.ai || {}) },
            relate: { rounds: o.rounds ?? 3, notesPerCall: o.notesPerCall ?? 2, candidatesPerNote: 2, ai: { use: 'stub:a' }, reverse: { perRun: 0 }, rotation: { perRun: 0 }, reeval: { perRun: 0 }, ...(o.relate || {}) },
        }),
        ai: null,
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: DOMAIN },
    }
    if (o.reserve !== undefined) deps.reserveMs = o.reserve
    const ctx = bagCtx(deps, log, o.left === undefined && !o.expired ? {} : { remainingMs: () => (state.left === undefined ? Infinity : state.left), expired: () => state.expired })
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    const callAI = withCheck(async (prompt, check, co) => {
        const titles = [...prompt.matchAll(/^--- 第(\d+)篇（待建立關聯）---\n標題：(.+)$/gm)].map((m) => ({ index: Number(m[1]), title: m[2] }))
        const rec = { seg: co?.segment, budgetMs: co?.budgetMs, stopBefore: co?.shouldStop?.(), titles: titles.map((t) => t.title) }
        calls.push(rec)
        if (o.cost) {
            // 讓同輪並行之呼叫先全部登記(各自看到扣時間之前的預算),再扣虛擬時間:以事件迴圈之階段排序,不是等待一段時間
            await new Promise((r) => setImmediate(r))
            state.left -= o.cost
        }
        rec.stopAfter = co?.shouldStop?.()
        return { ok: true, data: titles.map((t) => ({ index: t.index, relations: [] })), error: '', skipped: false, attempts: 1, preview: '', providerId: 'stub:a' }
    })
    const run = (extra = {}) => stageRelate({ callAI, ...extra }).run(ctx)
    return { ctx, notes, log, calls, state, run, callAI }
}

/** 池中(未關聯)之筆記 id */
const poolIds = async (e) => (await e.notes.select()).filter((n) => inRelatePool(n)).map((n) => n.id)
const fwd = (e) => e.calls.filter((c) => c.seg === 'forward')

describe('unit-relate-forward-reserve', function() {

    before(() => {
        TMP = tmpRoot('relate-fwd-reserve')
    })
    after(() => removeRoots([TMP]))

    // ─── 開工前 ───

    it('R1 開工前(issue 情境一):剩餘 20 分、保留 15 分、首家逾時 6 分 → 正向段不開工:forwardDeferred、AI 0 次、新筆記全留池中、relateTries 不動;日誌寫明秒數與待處理篇數', async () => {
        const e = env({ pool: 4, left: 20 * MIN, reserve: 15 * MIN })
        const d = (await e.run()).detail
        // spec:時間不足 → 日誌「扣保留時間後剩餘不足一次呼叫(Ns),正向段本輪延後(待處理 M 篇)」、detail 記 deferred:true、新筆記留佇列
        assert.equal(d.forwardDeferred, true, JSON.stringify(d))
        assert.deepEqual([e.calls.length, d.targets, d.pending, d.aiAttempts], [0, 0, 4, 0], 'AI 0 次、未處理')
        assert.deepEqual(await poolIds(e), ['p01', 'p02', 'p03', 'p04'], '新筆記全留池中(下輪再做)')
        assert.deepEqual((await e.notes.select()).map((n) => n.relateTries || 0), [0, 0, 0, 0], '延後不記 relateTries')
        assert.ok(e.log.lines.includes('INFO 關聯正向段：扣保留時間後剩餘時間不足一次呼叫（360s），本輪延後（待處理 4 篇）'), e.log.lines.join('\n'))
        assert.equal(d.stopped, false, '延後不是守門停止')
    })

    it('R2 延後之文件下輪仍在池中:時間恢復後同一批照常處理(少做不丟)', async () => {
        const e = env({ pool: 2, left: 20 * MIN, reserve: 15 * MIN })
        assert.equal((await e.run()).detail.forwardDeferred, true)
        e.state.left = 40 * MIN
        const d = (await e.run()).detail
        assert.deepEqual([!!d.forwardDeferred, d.targets, d.pending, fwd(e).length], [false, 2, 0, 1])
        assert.deepEqual(await poolIds(e), [])
    })

    it('R3 開工前之邊界:剩餘恰等於保留加首家逾時 → 開工且呼叫預算＝首家逾時;少 1 毫秒 → 延後', async () => {
        const at = env({ pool: 4, left: 15 * MIN + 6 * MIN, reserve: 15 * MIN, notesPerCall: 4, rounds: 1 })
        const d = (await at.run()).detail
        assert.deepEqual([!!d.forwardDeferred, d.targets, fwd(at).map((c) => c.budgetMs)], [false, 4, [6 * MIN]], JSON.stringify(d))
        const under = env({ pool: 4, left: 15 * MIN + 6 * MIN - 1, reserve: 15 * MIN, notesPerCall: 4, rounds: 1 })
        const du = (await under.run()).detail
        assert.deepEqual([du.forwardDeferred, under.calls.length, du.targets], [true, 0, 0])
    })

    it('R4 shouldStop 於第一輪之前即成立:剩餘不及保留、或整輪已逾期(有保留時) → 延後而不是逾時停止;AI 0 次、池不動', async () => {
        const lowLeft = env({ pool: 2, left: 10 * MIN, reserve: 15 * MIN })
        const d1 = (await lowLeft.run()).detail
        assert.deepEqual([d1.forwardDeferred, lowLeft.calls.length, d1.pending], [true, 0, 2], '剩餘 10 分 < 保留 15 分')
        const expired = env({ pool: 2, left: 99 * MIN, expired: true, reserve: 15 * MIN })
        const d2 = (await expired.run()).detail
        assert.deepEqual([d2.forwardDeferred, expired.calls.length, d2.pending], [true, 0, 2], '整輪已逾期')
        assert.deepEqual(await poolIds(expired), ['p01', 'p02'])
    })

    it('R5 無事可延後:池空、或正向輪數為 0 → 不記 forwardDeferred、不寫延後日誌(即使時間不足)', async () => {
        const empty = env({ pool: 0, related: 2, left: 10 * MIN, reserve: 15 * MIN })
        const d1 = (await empty.run()).detail
        assert.deepEqual([d1.forwardDeferred, empty.log.lines.some((l) => /正向段/.test(l))], [false, false])
        // 池空 → 無事可做:有保留而剩餘低於門檻,也不報時間停止(stopped／「逾時間預算」WARN 會誤導)
        assert.deepEqual([d1.stopped, empty.log.lines.some((l) => /逾時間預算/.test(l)), empty.calls.length], [false, false, 0])
        const zero = env({ pool: 2, left: 10 * MIN, reserve: 15 * MIN, rounds: 0 })
        const d2 = (await zero.run()).detail
        assert.deepEqual([d2.forwardDeferred, zero.log.lines.some((l) => /正向段/.test(l)), d2.pending], [false, false, 2])
    })

    // ─── 每輪開工前、每次呼叫之封頂 ───

    it('R6 每輪(issue 情境二):剩餘 30 分、保留 15 分、首家 6 分 → 第 1 輪做完、第 2 輪開工前停;處理篇數＝parallel×notesPerCall,其餘留池;呼叫預算＝剩餘−保留;嘗試之間的 shouldStop 以續派門檻判且扣保留(REL-20)', async () => {
        // 每次呼叫耗 5 分;第 1 輪兩批並行 → 耗 10 分,剩 20 分,扣保留 5 分 < 6 分
        const e = env({ pool: 10, left: 30 * MIN, cost: 5 * MIN, reserve: 15 * MIN, parallel: 2, notesPerCall: 2, rounds: 3 })
        const d = (await e.run()).detail
        assert.equal(e.calls.length, 2, `只做第 1 輪的兩批:${JSON.stringify(e.calls)}`)
        assert.deepEqual(e.calls.map((c) => c.budgetMs), [15 * MIN, 15 * MIN], '呼叫預算＝剩餘 30 分 − 保留 15 分(不是整輪 30 分)')
        assert.deepEqual(e.calls.map((c) => c.stopBefore), [false, false])
        // 第二批扣完時間後(剩 20 分,扣保留 5 分:< 開工門檻 6 分、≥ 鏈內續派門檻 1 分)——同一呼叫之鏈內不停(REL-20:遞補仍可用扣保留後之 5 分,
        //   逾時由 budgetMs 封頂);下一輪由開工門檻擋下(下行之 stopped)。鏈內門檻仍扣保留,見 unit-relate-aicall 之接線案(抓取套件之 reservedAiCallOf)
        assert.deepEqual(e.calls.map((c) => c.stopAfter), [false, false], '鏈內以續派門檻(開工門檻與 60 秒之較小者)判')
        assert.deepEqual([d.targets, d.pending, d.stopped, !!d.forwardDeferred], [4, 6, true, false])
        assert.equal((await poolIds(e)).length, 6, '其餘 6 篇留池中')
        // 容量鍵語意不變:時間不足只是少做輪數;下一輪時間足夠即照常做滿 parallel×notesPerCall
        e.state.left = 30 * MIN
        const d2 = (await e.run()).detail
        assert.deepEqual([d2.targets, d2.pending], [4, 2])
    })

    it('R7 每輪之邊界:第 1 輪後「剩餘−保留」恰等於首家逾時 → 第 2 輪照做;其後不足 → 停', async () => {
        const e = env({ pool: 8, left: 26 * MIN, cost: 5 * MIN, reserve: 15 * MIN, parallel: 1, notesPerCall: 2, rounds: 4 })
        const d = (await e.run()).detail
        // 26−15=11 ≥ 6 → 第 1 輪;耗 5 → 21−15=6 ≥ 6(恰等)→ 第 2 輪;耗 5 → 16−15=1 < 6 → 停
        assert.deepEqual([e.calls.length, d.targets, d.pending, d.stopped], [2, 4, 4, true], JSON.stringify(e.calls))
        assert.deepEqual(e.calls.map((c) => c.budgetMs), [11 * MIN, 6 * MIN])
    })

    it('R6b 池在第 1 輪後已空:下一輪開工前即使「剩餘−保留」低於門檻,也不報時間停止(stopped=false、無「逾時間預算」WARN)——無事可做不是被時間截止', async () => {
        // 3 篇一批做完(池空);呼叫耗 10 分 → 剩 20 分,扣保留 5 分 < 6 分,但池已空
        const e = env({ pool: 3, left: 30 * MIN, cost: 10 * MIN, reserve: 15 * MIN, parallel: 1, notesPerCall: 6, rounds: 2 })
        const d = (await e.run()).detail
        assert.deepEqual([e.calls.length, d.targets, d.pending, d.stopped, !!d.forwardDeferred], [1, 3, 0, false, false], JSON.stringify(d))
        assert.equal(e.log.lines.some((l) => /逾時間預算/.test(l)), false, e.log.lines.join('\n'))
        // 對照:池未空時同樣的時間條件才算被時間截止(R6)
        const cut = env({ pool: 4, left: 30 * MIN, cost: 10 * MIN, reserve: 15 * MIN, parallel: 1, notesPerCall: 2, rounds: 2 })
        const dc = (await cut.run()).detail
        assert.deepEqual([cut.calls.length, dc.stopped, dc.pending], [1, true, 2])
    })

    it('R6c opt.rounds 打錯(非正整數)時不被「延後」吞掉:照舊交批次執行器檢核而拋錯(有保留且時間不足時亦然)', async () => {
        await assert.rejects(() => env({ pool: 2, left: 10 * MIN, reserve: 15 * MIN }).run({ rounds: 1.5 }), /rounds/)
        await assert.rejects(() => env({ pool: 2, left: 10 * MIN, reserve: 15 * MIN }).run({ rounds: '2.5' }), /rounds/)
        await assert.rejects(() => env({ pool: 2 }).run({ rounds: 1.5 }), /rounds/, '無保留亦拋(同加保留前)')
    })

    // ─── 開工門檻取正向席位首家逾時 ───

    it('R8 門檻取正向席位首家之單次逾時(ai.providerTimeouts → ai.timeoutMs),不取反向席位:可用 5.5 分 → 6 分席(正向)延後、無個別逾時時以 ai.timeoutMs 5 分開工', async () => {
        // 剩 20.5 分、保留 15 分 → 可用 5.5 分;反向席 stub:b 僅 1 分,但正向不讀它
        const slow = env({ pool: 2, left: 20.5 * MIN, reserve: 15 * MIN, relate: { reverse: { perRun: 0, ai: { use: 'stub:b' } } } })
        assert.equal((await slow.run()).detail.forwardDeferred, true, '正向席 stub:a 首家逾時 6 分 > 5.5 分')
        const plain = env({ pool: 2, left: 20.5 * MIN, reserve: 15 * MIN, ai: { providerTimeouts: {} } })
        const d = (await plain.run()).detail
        assert.deepEqual([!!d.forwardDeferred, d.targets], [false, 2], '無個別逾時 → ai.timeoutMs 5 分 ≤ 5.5 分')
        const other = env({ pool: 2, left: 20.5 * MIN, reserve: 15 * MIN, relate: { ai: { use: 'stub:b' } } })
        assert.deepEqual([!!(await other.run()).detail.forwardDeferred, fwd(other).length], [false, 1], '正向席換 stub:b(1 分)→ 開工')
    })

    // ─── 保留時間之來源與取值規則不變 ───

    it('R9 未注入保留(deps.reserveMs 未給、opt.reserveMs 未給)→ 行為同加保留前:剩餘不足首家逾時但未逾期仍開工,呼叫預算＝整輪剩餘;逾期則由批次守門停止(stopped、不記延後)', async () => {
        const low = env({ pool: 4, left: 100_000, parallel: 1, notesPerCall: 2, rounds: 2 })
        const d = (await low.run()).detail
        assert.deepEqual([!!d.forwardDeferred, low.calls.length, d.targets, d.stopped], [false, 2, 4, false], JSON.stringify(d))
        assert.deepEqual(low.calls.map((c) => [c.budgetMs, c.stopBefore]), [[100_000, false], [100_000, false]], '預算＝整輪剩餘')
        const none = env({ pool: 4, parallel: 1, notesPerCall: 2, rounds: 2 })
        assert.deepEqual([!!(await none.run()).detail.forwardDeferred, fwd(none).length, fwd(none)[0].budgetMs], [false, 2, Infinity], '無截止:預算 Infinity(同加保留前)')
        const gone = env({ pool: 2, left: 100_000, expired: true })
        const dg = (await gone.run()).detail
        assert.deepEqual([!!dg.forwardDeferred, gone.calls.length, dg.stopped, dg.pending], [false, 0, true, 2], '逾期:批次守門停止,與加保留前相同')
        assert.ok(gone.log.lines.some((l) => /^WARN 批次：逾時間預算，第 1\/3 輪起不再開工/.test(l)), gone.log.lines.join('\n'))
        // 逾期而池空:加保留前亦由批次守門報停止(守門先於取件);未注入保留者維持,不套「池空不報」之短路
        const goneIdle = env({ pool: 0, related: 2, left: 100_000, expired: true })
        const di = (await goneIdle.run()).detail
        assert.deepEqual([!!di.forwardDeferred, goneIdle.calls.length, di.stopped], [false, 0, true], '未注入保留:逾期即報停止,與池空與否無關(同加保留前)')
    })

    it('R10 opt.reserveMs 明給者優先於 deps.reserveMs(0 亦為明給);函數形式每輪求值並收 ctx;皆不給為 0', async () => {
        // 剩 10 分、deps.reserveMs 15 分 → 延後;opt.reserveMs 0 → 開工
        const a = env({ pool: 2, left: 10 * MIN, reserve: 15 * MIN })
        assert.equal((await a.run()).detail.forwardDeferred, true, 'deps.reserveMs 生效')
        const b = env({ pool: 2, left: 10 * MIN, reserve: 15 * MIN })
        const db = (await b.run({ reserveMs: 0 })).detail
        assert.deepEqual([!!db.forwardDeferred, db.targets], [false, 2], 'opt.reserveMs 優先(0 亦為明給)')
        const seen = []
        const c = env({ pool: 2, left: 20 * MIN })
        const dc = (await c.run({ reserveMs: (ctx) => { seen.push(typeof ctx.remainingMs); return 15 * MIN } })).detail
        assert.deepEqual([dc.forwardDeferred, seen.length >= 1, seen[0]], [true, true, 'function'], '函數形式:收 ctx、每輪求值')
        const d = env({ pool: 2, left: 10 * MIN, reserve: 15 * MIN })
        delete d.ctx.deps.reserveMs
        assert.equal(!!(await d.run()).detail.forwardDeferred, false, '皆不給 → 不保留')
    })

    it('R11 reserveMs 不合法時之處置與既有段一致:非負毫秒數或 (ctx) => 毫秒數,否則於該段開工時拋錯(正向段字樣)', async () => {
        await assert.rejects(() => env({ pool: 2 }).run({ reserveMs: 'abc' }), /關聯正向段之 reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數，收到 abc/)
        await assert.rejects(() => env({ pool: 2 }).run({ reserveMs: -1 }), /關聯正向段之 reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數，收到 -1/)
        await assert.rejects(() => env({ pool: 2 }).run({ reserveMs: () => -5 }), /關聯正向段之 reserveMs 函數須回傳非負毫秒數，收到 -5/)
        const e = env({ pool: 2 })
        await assert.rejects(() => e.run({ reserveMs: 'abc' }))
        assert.deepEqual([e.calls.length, (await poolIds(e)).length], [0, 2], '拋錯前未呼叫 AI、未動池')
    })

    // ─── 後段各自決定 ───

    it('R12 正向段延後時,其後之選配段照既有判斷各自決定:反向席較短(1 分)的輪巡段仍開工,正向段延後', async () => {
        const e = env({
            pool: 1,
            related: 5,
            left: 20.5 * MIN,
            reserve: 15 * MIN,
            relate: { rotation: { perRun: 1 }, reverse: { perRun: 0, ai: { use: 'stub:b' } } },
        })
        const d = (await e.run()).detail
        assert.deepEqual([d.forwardDeferred, d.rotationDeferred, d.rotationTargets], [true, false, 1], JSON.stringify(d))
        assert.deepEqual(e.calls.map((c) => c.seg), ['rotation'], '只有輪巡呼叫;正向 0 次')
        assert.equal(e.calls[0].budgetMs, 5.5 * MIN, '輪巡呼叫以「剩餘−保留」封頂(既有行為不變)')
    })

    // ─── 報告契約 ───

    it('R13 報告契約:forwardDeferred 恆有且為布林(延後與否皆有),並列入 RELATE_REPORT_KEYS.detail.relate', async () => {
        assert.ok(RELATE_REPORT_KEYS.detail.relate.includes('forwardDeferred'))
        for (const o of [{ pool: 2 }, { pool: 2, left: 10 * MIN, reserve: 15 * MIN }]) {
            const d = (await env(o).run()).detail
            assert.equal(typeof d.forwardDeferred, 'boolean', JSON.stringify(d))
        }
    })
})
