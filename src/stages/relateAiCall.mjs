// relateAiCall.mjs — 關聯之 AI 呼叫(六類呼叫同一形狀:正向、反向、輪巡、重評之兩席與第三席、衝突核對三席、既有邊覆核三席)
//
// 【同一形狀】注入之 opt.callAI 一律收 { spec(席位), seat(席別), segment(段名), shouldStop, budgetMs, acceptTruncated };AI 調度層
//   ai.callJson 收其中之 spec、shouldStop、budgetMs、acceptTruncated——各段不各自組參數(注入之替身與正式呼叫看到同一組選項)。
//   席別:正向／反向／輪巡為 'proposer'(提案席;衝突核對之提案票即此席所出)、判定小組為 'first'／'second'／'third'。
// 【截斷放行逐次給】關聯之回覆皆為陣列(一項一篇或一項一條邊),逐項驗證、部分接受——回覆被截斷時救回前段完整之項仍有用(未涵蓋者
//   下輪再判),故每次呼叫明給 acceptTruncated:true。逐次給而不在調度層建構期開:同一調度層亦服務他工作,截斷放行是本套件之選擇。
// 【扣保留之段進門與鏈內分開判】扣保留之各段(reservedCallOf 包在 relateAiCallOf 之外)以開工門檻(callTimeoutMsOf)判「要不要送出一次新的
//   呼叫」,交調度層之 shouldStop(遞補鏈內、嘗試之間)則以續派門檻(chainStepMsOf)判——兩個決定不共用同一門檻,否則主席等滿逾時後遞補一律被中止。

import { chainStepMsOf } from '../core/relateSettings.mjs'

/**
 * 建立關聯之 AI 呼叫函數
 *
 * @param {Object} o 輸入 { ai:AI 調度層(具 callJson), callAI?:注入之呼叫函數 (prompt, check, callOpt) => Promise(給了即取代 ai.callJson) }
 * @returns {Function} 回傳 (prompt, check, { spec, seat, segment, shouldStop, budgetMs }) => Promise(調度層之回傳形狀)
 * @example
 * let seen = []
 * let callA = relateAiCallOf({ callAI: async (prompt, check, c) => { seen.push(c); return { ok: true, data: [] } } })
 * let ra = await callA('提示詞', () => true, { spec: { use: 'x' }, seat: 'proposer', segment: 'forward' })
 * console.log(ra.ok, seen[0].seat, seen[0].segment, seen[0].acceptTruncated)
 * let callB = relateAiCallOf({ ai: { callJson: async (prompt, check, opt) => ({ ok: true, opt }) } })
 * let rb = await callB('提示詞', () => true, { spec: { use: 'x' }, seat: 'first', segment: 'reeval' })
 * console.log(rb.opt.spec, rb.opt.acceptTruncated, 'seat' in rb.opt)
 * // => true proposer forward true
 * // => { use: 'x' } true false
 */
export function relateAiCallOf(o = {}) {
    const { ai, callAI } = o
    return (prompt, check, c = {}) => {
        const base = { spec: c.spec, shouldStop: c.shouldStop, budgetMs: c.budgetMs, acceptTruncated: true }
        return typeof callAI === 'function'
            ? callAI(prompt, check, { ...base, seat: c.seat, segment: c.segment })
            : ai.callJson(prompt, check, base)
    }
}

/**
 * 扣保留之段之呼叫(正向、反向、輪巡、重評、既有邊覆核、衝突核對同一份;包在 relateAiCallOf 之外):
 *   ①進門:扣保留後不足開工門檻(firstMs)→ 不送出,回 skipped(與調度層進門即回 ABORTED 同義;不計此次之失敗);
 *   ②鏈內:交調度層之 shouldStop 以鏈內續派門檻(chainStepMsOf)判——主席失敗(含等滿逾時)後仍續派遞補,
 *     各次嘗試之逾時由 budgetMs(＝進門當下之剩餘−保留;相對預算,於調度層起算時才開始計)封頂,使遞補不致侵入保留;
 *   ③失敗之歸類不另判:中止、預算用盡與「被截止切斷之末家」由調度層之結果(errorType、嘗試之間之 shouldStop)歸為 skipped;
 *     各家皆試過而真的失敗者照計失敗(不因此刻剩餘不足開工門檻而改標 skipped);惟轉接層於失敗後仍以鏈內 shouldStop 判斷是否被截止切斷,
 *     故此刻剩餘已低於續派門檻者同樣視為中止
 *
 * @param {Function} ask 輸入 relateAiCallOf 之產物
 * @param {Object} sub 輸入扣保留之預算(抓取套件之 reserveOf 之產物;取 shouldStop、remainingMs)
 * @param {Number} firstMs 輸入開工門檻毫秒數(callTimeoutMsOf;0＝未保留)
 * @returns {Function} 回傳 (prompt, check, { spec, seat, segment }) => Promise(調度層之回傳形狀)
 * @example
 * let left = 420000
 * let sub = { shouldStop: (ms) => left < ms, remainingMs: () => left }
 * let ask = async (p, c, o) => { left -= 300000; return o.shouldStop() ? { ok: false, skipped: true } : { ok: true } }
 * console.log((await reservedCallOf(ask, sub, 360000)('p', () => true, {})).ok)
 * // => true
 */
export function reservedCallOf(ask, sub, firstMs) {
    return async (prompt, check, c = {}) => {
        if (sub.shouldStop(firstMs)) return { ok: false, data: null, error: 'ABORTED', providerId: '', attempts: 0, skipped: true, errors: [] }
        const stepMs = chainStepMsOf(firstMs, c.spec)
        return ask(prompt, check, { ...c, shouldStop: () => sub.shouldStop(stepMs), budgetMs: sub.remainingMs() })
    }
}

export default { relateAiCallOf, reservedCallOf }
