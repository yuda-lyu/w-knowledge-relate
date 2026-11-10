// unit-relate-chain.test.mjs — 扣保留之 AI 呼叫在真接縫上之行為(REL-20):真轉接層(createAiAdapter)＋真調度層(w-dispatch-ai 之遞補迴圈)＋本機假 OpenAI 相容伺服器
//   ＋抓取套件之真包裝 reservedAiCallOf／captureCallMsOf、真 reserveOf 與本套件之 relateAiCallOf(不呼叫真 AI、不起 CLI;不以替身取代轉接層與調度層)
// 同步:以事件推進可控時鐘,不以真逾時——ctx 之剩餘時間為變數(state.left);替身伺服器收到主席之請求時把它推進到情境之值、主席快速失敗(純文字,驗證不過),
//   調度層於嘗試之間呼叫之 shouldStop 即讀到推進後之時鐘。是否派出遞補以伺服器之收件(依序之 model)與結果之 attempts／errors(遞補歷程 tried 之摘要)判定,
//   不以調度層之 try 事件。
// 規格:①進門扣保留後不足段之開工門檻 → 不送出(skipped,不打伺服器);②主席失敗後剩餘低於開工門檻而仍夠續派門檻 → 遞補照派、成交;
//   ③各家皆試過而真的失敗(剩餘仍夠續派門檻)→ 照計失敗(skipped:false);④被截止切斷(剩餘低於續派門檻)→ 中止(skipped:true)、不再派遞補;
//   ⑤同樣輸入若沿用修前選項(鏈內以開工門檻判)→ 遞補一律被中止——證明本案例分得出新舊(非空洞斷言);
//   ⑥判定小組之第三席(Gitea #132):剩餘低於段之開工門檻而夠第三席首家之逾時者,給 startMs(＝captureCallMsOf(settings, 第三席))即送出;不給即不送出
// 執行:自套件根 node <mocha> test/unit-relate-chain.test.mjs(固定埠 8863;暫存 test/_tmp/relate-chain-<pid>,測完即刪;不依賴真逾時)

import assert from 'node:assert/strict'
import { startServer, createAiAdapter, genClockTZ, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { reserveOf, reservedAiCallOf, captureCallMsOf } from '../src/core/capturePackage.mjs'
import { relateAiCallOf } from '../src/stages/relateAiCall.mjs'

const PORT = 8863 // 本機假 REST(固定埠;本檔專屬)
const S = 1000
const KEEP = 900 * S // 保留給後段之時間
const CHAIR = 'rest:chair~0' // 主席:收件即推進時鐘、回純文字(驗證不過 → 失敗,調度層續派遞補前問 shouldStop)
const OK = 'rest:ok~0' // 回合格 JSON(健康之遞補)
const PLAIN = 'rest:plain~0' // 純文字(驗證不過 → 遞補「真的失敗」)
const SLOW = 'rest:slow~0' // 他席之首家(不被呼叫;逾時 120 秒,把段之開工門檻拉到 120 秒——三席首家逾時取最大者)
const TIMEOUTS = { [CHAIR]: 30 * S, [OK]: 20 * S, [PLAIN]: 20 * S, [SLOW]: 120 * S }
const ENV = { FAKE_ONE: 'k1' }
const SETTINGS = { ai: { timeoutMs: 300 * S, providerTimeouts: TIMEOUTS } }

// 判定小組之回覆驗證(同衝突核對段之 checkJson)
const checkJson = (d) => Array.isArray(d) && d.some((it) => Number.isInteger(it?.index))
const entryOf = (base, model) => ({ id: `rest:${model}`, model, kind: 'api-openai-compat', baseURL: base, envVar: 'FAKE_ONE' })

describe('unit-relate-chain', function() {

    let TMP = ''
    let srv = null
    let seq = 0
    // 可控時鐘:整輪剩餘(state.left);主席收件時推進到 state.leftAfterChair(未設即不動)
    const state = { left: 0, leftAfterChair: null }
    const sceneOf = (scene) => {
        if (scene === 'chair') {
            if (state.leftAfterChair !== null) state.left = state.leftAfterChair
            return { fr: 'stop', content: '好的,這是純文字回覆。' }
        }
        return scene === 'ok' ? { fr: 'stop', content: '[{"index":1,"verdict":"keep","reason":"x"}]' } : undefined
    }
    before(async () => {
        TMP = tmpRoot('relate-chain')
        srv = await startServer({ port: PORT, sceneOf })
    })
    after(async () => {
        await srv?.close()
        removeRoots([TMP])
    })

    /**
     * 一個情境:新 adapter(冷卻與健康各自歸零)、可控時鐘之整輪截止;沿用修前選項(old)或經抓取套件之包裝(new)呼叫第三席
     * @param {Object} o 輸入 { mode:'old'|'new', entryLeft:進門時扣保留後之剩餘, afterChair:主席收件後扣保留後之剩餘(未給不動), firstMs:段之開工門檻, third:席位, startMs?:逐次進門門檻 }
     * @returns {Promise} 回傳 { r(呼叫結果), dispatched(伺服器收到之 model 依序), budgetMs(交調度層之預算;new 才有) }
     */
    async function scenario(o) {
        const entries = [CHAIR, OK, PLAIN, SLOW].map((id) => entryOf(srv.base, id.slice('rest:'.length)))
        const ai = createAiAdapter({ ai: { extraProviders: entries, providerTimeouts: TIMEOUTS, cooldownMs: 900_000, maxRetries: 0 }, env: ENV, workspace: `${TMP}/work-${++seq}`, clock: genClockTZ('Asia/Taipei') })
        state.left = KEEP + o.entryLeft
        state.leftAfterChair = o.afterChair === undefined ? null : KEEP + o.afterChair
        const h0 = srv.hits.length
        const ctx = { remainingMs: () => state.left, expired: () => state.left <= 0 }
        const sub = reserveOf(ctx, KEEP)
        let budgetMs = null
        const ask = relateAiCallOf({ ai })
        const spy = (p, c, co) => {
            budgetMs = co.budgetMs
            return ask(p, c, co)
        }
        const c = { spec: o.third, seat: 'third', segment: 'conflictCheck', ...(o.startMs !== undefined ? { startMs: o.startMs } : {}) }
        const r = o.mode === 'old'
            ? await ask('判定小組之提示詞', checkJson, { ...c, shouldStop: () => sub.shouldStop(o.firstMs), budgetMs: sub.remainingMs() }) // 修前之選項(鏈內以開工門檻判)
            : await reservedAiCallOf(spy, sub, { firstMs: o.firstMs })('判定小組之提示詞', checkJson, c)
        state.leftAfterChair = null
        return { r, dispatched: srv.hits.slice(h0).map((h) => h.model), budgetMs }
    }

    const seats3 = [{ use: OK }, { use: SLOW }, { use: CHAIR }]
    const firstMs = captureCallMsOf(SETTINGS, seats3)
    const thirdMs = captureCallMsOf(SETTINGS, seats3[2])

    it('段之開工門檻＝三席首家逾時之最大值(120 秒)、第三席首家之逾時 30 秒;席位 timeoutMs 優先於逐家逾時(同一函數)', () => {
        assert.deepEqual([firstMs, thirdMs, captureCallMsOf(SETTINGS, [{ use: OK }, { use: SLOW, timeoutMs: 9 * S }, { use: CHAIR }])], [120 * S, 30 * S, 30 * S])
    })

    it('主席失敗後遞補是否派出:進門剩 121 秒(≥ 開工門檻 120)、主席失敗時剩 61 秒(< 開工門檻、≥ 續派門檻 60 秒)——修前選項被中止、只打主席一次;經包裝則遞補成交(預算＝進門時扣保留後之剩餘)', async () => {
        const third = { use: CHAIR, fallback: [OK] }
        const before1 = await scenario({ mode: 'old', entryLeft: 121 * S, afterChair: 61 * S, firstMs, third })
        assert.deepEqual([before1.r.ok, before1.r.skipped, before1.dispatched], [false, true, ['chair~0']], JSON.stringify(before1.r))
        const after1 = await scenario({ mode: 'new', entryLeft: 121 * S, afterChair: 61 * S, firstMs, third })
        assert.deepEqual([after1.r.ok, after1.r.skipped, after1.r.providerId, after1.r.attempts, after1.dispatched, after1.budgetMs], [true, false, OK, 2, ['chair~0', 'ok~0'], 121 * S], JSON.stringify(after1.r))
    })

    it('進門不足開工門檻(剩 119.999 秒 < 120 秒):不送出——伺服器 0 命中,回調度層進門即中止之完整形狀', async () => {
        const { r, dispatched } = await scenario({ mode: 'new', entryLeft: 120 * S - 1, firstMs, third: { use: CHAIR, fallback: [OK] } })
        assert.deepEqual(r, { ok: false, data: null, error: 'ABORTED', providerId: '', attempts: 0, skipped: true, errors: [] })
        assert.deepEqual(dispatched, [])
    })

    it('各家皆試過而真的失敗(主席與遞補皆回純文字;主席失敗時剩 61 秒 ≥ 續派門檻):照計失敗(skipped:false、attempts 2、errors 列兩家),不因剩餘不足開工門檻改標中止', async () => {
        const { r, dispatched } = await scenario({ mode: 'new', entryLeft: 121 * S, afterChair: 61 * S, firstMs, third: { use: CHAIR, fallback: [PLAIN] } })
        assert.deepEqual([r.ok, r.skipped, r.attempts, r.errors.length, dispatched], [false, false, 2, 2, ['chair~0', 'plain~0']], JSON.stringify(r))
        assert.ok(r.errors[0].startsWith(CHAIR) && r.errors[1].startsWith(PLAIN), JSON.stringify(r.errors))
    })

    it('被截止切斷:主席失敗時剩 59.999 秒 < 續派門檻 60 秒 → 中止(skipped:true)、不再派遞補(伺服器只收主席一件、attempts 1)', async () => {
        const { r, dispatched } = await scenario({ mode: 'new', entryLeft: 121 * S, afterChair: 60 * S - 1, firstMs, third: { use: CHAIR, fallback: [OK] } })
        assert.deepEqual([r.ok, r.skipped, r.attempts, dispatched], [false, true, 1, ['chair~0']], JSON.stringify(r))
    })

    it('判定小組之第三席(Gitea #132):進門剩 100 秒(< 段之開工門檻 120、≥ 第三席首家之逾時 30)——不給 startMs 不送出;給 startMs＝captureCallMsOf(settings, 第三席) 即送出,鏈內續派門檻以之為上限(主席失敗時剩 30 秒 → 續派、成交;剩 29.999 秒 → 中止)', async () => {
        const third = { use: CHAIR, fallback: [OK] }
        const none = await scenario({ mode: 'new', entryLeft: 100 * S, firstMs, third })
        assert.deepEqual([none.r.skipped, none.r.attempts, none.dispatched], [true, 0, []], JSON.stringify(none.r))
        const sent = await scenario({ mode: 'new', entryLeft: 100 * S, afterChair: 30 * S, firstMs, third, startMs: thirdMs })
        assert.deepEqual([sent.r.ok, sent.r.attempts, sent.dispatched, sent.budgetMs], [true, 2, ['chair~0', 'ok~0'], 100 * S], JSON.stringify(sent.r))
        const cut = await scenario({ mode: 'new', entryLeft: 100 * S, afterChair: 30 * S - 1, firstMs, third, startMs: thirdMs })
        assert.deepEqual([cut.r.skipped, cut.r.attempts, cut.dispatched], [true, 1, ['chair~0']], JSON.stringify(cut.r))
    })
})
