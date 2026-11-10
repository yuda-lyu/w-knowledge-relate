// unit-relate-chain.test.mjs — 扣保留之 AI 呼叫在真接縫上之行為(REL-20):真轉接層(createAiAdapter)＋真調度層(w-dispatch-ai 之遞補迴圈)＋本機假 OpenAI 相容伺服器
//   ＋本套件之真 reserveOf／relateAiCallOf／reservedCallOf／callTimeoutMsOf(不呼叫真 AI、不起 CLI)
// 規格:①進門扣保留後不足開工門檻 → 不送出(skipped,不打伺服器);②主席逾時後剩餘低於開工門檻而仍夠續派門檻 → 遞補照派、成交;
//   ③各家皆試過而真的失敗(剩餘仍夠續派門檻)→ 照計失敗(skipped:false);④被截止切斷(剩餘低於續派門檻)→ 中止(skipped:true)、不再派遞補;
//   ⑤同樣輸入若沿用修前選項(鏈內以開工門檻判)→ 遞補一律被中止——證明本案例分得出新舊(非空洞斷言)
// 執行:自套件根 node <mocha> test/unit-relate-chain.test.mjs(固定埠 8863;暫存 test/_tmp/relate-chain-<pid>,測完即刪;約 10 秒)

import assert from 'node:assert/strict'
import { startServer, createAiAdapter, genClockTZ, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { reserveOf } from '../src/core/capturePackage.mjs'
import { callTimeoutMsOf } from '../src/core/relateSettings.mjs'
import { relateAiCallOf, reservedCallOf } from '../src/stages/relateAiCall.mjs'

const PORT = 8863 // 本機假 REST(固定埠;本檔專屬)
const S = 1000
const KEEP = 900 * S // 保留給後段之時間
const HANG = 'rest:hang~3000' // 收件後 3 秒才回;單次逾時 1 秒 → 必逾時(模擬主席掛起)
const OK = 'rest:ok~100' // 0.1 秒回合格 JSON(健康之遞補)
const PLAIN = 'rest:plain~10' // 純文字(驗證不過 → 遞補「真的失敗」)
const SLOW = 'rest:slow~1' // 他席之首家(逾時 120 秒;不被呼叫,只把開工門檻拉到 120 秒——三席首家逾時取最大者)
const TIMEOUTS = { [HANG]: 1 * S, [OK]: 2 * S, [PLAIN]: 2 * S, [SLOW]: 120 * S }
const ENV = { FAKE_ONE: 'k1' }

// 判定小組之回覆驗證(同衝突核對段之 checkJson)
const checkJson = (d) => Array.isArray(d) && d.some((it) => Number.isInteger(it?.index))
const sceneOf = (scene) => (scene === 'ok' ? { fr: 'stop', content: '[{"index":1,"verdict":"keep","reason":"x"}]' } : undefined)
const entryOf = (base, model) => ({ id: `rest:${model}`, model, kind: 'api-openai-compat', baseURL: base, envVar: 'FAKE_ONE' })

describe('unit-relate-chain', function() {

    this.timeout(120_000)

    let TMP = ''
    let srv = null
    let seq = 0
    before(async () => {
        TMP = tmpRoot('relate-chain')
        srv = await startServer({ port: PORT, sceneOf })
    })
    after(async () => {
        await srv?.close()
        removeRoots([TMP])
    })

    /**
     * 一個情境:新 adapter(冷卻與健康各自歸零)、真時鐘之整輪截止;沿用修前選項(old)或經 reservedCallOf(new)呼叫第三席
     * @param {Object} o 輸入 { mode:'old'|'new', totalMs:整輪剩餘, firstMs:開工門檻, third:席位 }
     * @returns {Promise} 回傳 { r(呼叫結果), dispatched(伺服器收到之 model 依序), entryLeft(進門扣保留後之剩餘) }
     */
    async function scenario(o) {
        const entries = [HANG, OK, PLAIN, SLOW].map((id) => entryOf(srv.base, id.slice('rest:'.length)))
        const ai = createAiAdapter({ ai: { extraProviders: entries, providerTimeouts: TIMEOUTS, cooldownMs: 900_000, maxRetries: 0 }, env: ENV, workspace: `${TMP}/work-${++seq}`, clock: genClockTZ('Asia/Taipei') })
        const h0 = srv.hits.length
        const deadline = Date.now() + o.totalMs
        const ctx = { remainingMs: () => deadline - Date.now(), expired: () => Date.now() >= deadline }
        const sub = reserveOf(ctx, KEEP)
        const entryLeft = sub.remainingMs()
        const ask = relateAiCallOf({ ai })
        const c = { spec: o.third, seat: 'third', segment: 'conflictCheck' }
        const r = o.mode === 'old'
            ? await ask('判定小組之提示詞', checkJson, { ...c, shouldStop: () => sub.shouldStop(o.firstMs), budgetMs: sub.remainingMs() }) // 修前之選項(鏈內以開工門檻判)
            : await reservedCallOf(ask, sub, o.firstMs)('判定小組之提示詞', checkJson, c)
        return { r, dispatched: srv.hits.slice(h0).map((h) => h.model), entryLeft }
    }

    const seats3 = [{ use: OK }, { use: SLOW }, { use: HANG }]
    const firstMs = callTimeoutMsOf({ ai: { timeoutMs: 300 * S, providerTimeouts: TIMEOUTS } }, seats3)

    it('開工門檻＝三席首家逾時之最大值(120 秒);以下情境皆以它為進門門檻', () => {
        assert.equal(firstMs, 120 * S)
    })

    it('主席逾時後遞補是否派出:進門剩 121 秒(≥ 開工門檻)、主席逾時 1 秒後剩約 120 秒(< 開工門檻、≥ 續派門檻 60 秒)——修前選項被中止、只打主席一次;reservedCallOf 遞補成交', async () => {
        const third = { use: HANG, fallback: [OK] }
        const before1 = await scenario({ mode: 'old', totalMs: KEEP + 121 * S, firstMs, third })
        assert.deepEqual([before1.r.ok, before1.r.skipped, before1.r.error, before1.dispatched], [false, true, 'ABORTED', ['hang~3000']], JSON.stringify(before1.r))
        const after1 = await scenario({ mode: 'new', totalMs: KEEP + 121 * S, firstMs, third })
        assert.deepEqual([after1.r.ok, after1.r.skipped, after1.r.providerId, after1.r.attempts, after1.dispatched], [true, false, OK, 2, ['hang~3000', 'ok~100']], JSON.stringify(after1.r))
    })

    it('進門不足開工門檻(剩 119 秒 < 120 秒):不送出——伺服器 0 命中,回調度層進門即中止之完整形狀', async () => {
        const { r, dispatched } = await scenario({ mode: 'new', totalMs: KEEP + 119 * S, firstMs, third: { use: HANG, fallback: [OK] } })
        assert.deepEqual(r, { ok: false, data: null, error: 'ABORTED', providerId: '', attempts: 0, skipped: true, errors: [] })
        assert.deepEqual(dispatched, [])
    })

    it('各家皆試過而真的失敗(主席逾時、遞補回純文字;此刻剩約 120 秒 ≥ 續派門檻):照計失敗(skipped:false、attempts 2),不因剩餘不足開工門檻改標中止', async () => {
        const { r, dispatched } = await scenario({ mode: 'new', totalMs: KEEP + 121 * S, firstMs, third: { use: HANG, fallback: [PLAIN] } })
        assert.deepEqual([r.ok, r.skipped, r.attempts, dispatched], [false, false, 2, ['hang~3000', 'plain~10']], JSON.stringify(r))
    })

    it('被截止切斷:開工門檻 2 秒、進門剩 2.5 秒(進門與鏈內之裕度各 0.5 秒),主席逾時 1 秒後剩約 1.5 秒 < 續派門檻 2 秒 → 中止(skipped:true)、不再派遞補', async () => {
        const { r, dispatched } = await scenario({ mode: 'new', totalMs: KEEP + 2500, firstMs: 2 * S, third: { use: HANG, fallback: [OK] } })
        assert.deepEqual([r.ok, r.skipped, r.error, dispatched], [false, true, 'ABORTED', ['hang~3000']], JSON.stringify(r))
    })
})
