// relateAiCall.mjs — 關聯之 AI 呼叫(六類呼叫同一形狀:正向、反向、輪巡、重評之兩席與第三席、衝突核對三席、既有邊覆核三席)
//
// 【同一形狀】注入之 opt.callAI 一律收 { spec(席位), seat(席別), segment(段名), shouldStop, budgetMs, acceptTruncated };AI 調度層
//   ai.callJson 收其中之 spec、shouldStop、budgetMs、acceptTruncated——各段不各自組參數(注入之替身與正式呼叫看到同一組選項)。
//   席別:正向／反向／輪巡為 'proposer'(提案席;衝突核對之提案票即此席所出)、判定小組為 'first'／'second'／'third'。
// 【截斷放行逐次給】關聯之回覆皆為陣列(一項一篇或一項一條邊),逐項驗證、部分接受——回覆被截斷時救回前段完整之項仍有用(未涵蓋者
//   下輪再判),故每次呼叫明給 acceptTruncated:true。逐次給而不在調度層建構期開:同一調度層亦服務他工作,截斷放行是本套件之選擇。
// 【扣保留之段:進門與鏈內分開判,經抓取套件之唯一包裝】扣保留之各段把本檔之呼叫函數交抓取套件之 reservedAiCallOf(call, sub, { firstMs })
//   (core/capturePackage;本套件不另寫一份):進門以本次之進門門檻判「要不要送出一次新的呼叫」(不足即不送出,回進門即中止之形狀),交調度層之
//   shouldStop(遞補鏈內、嘗試之間)以續派門檻判、budgetMs 與扣保留之剩餘取小。段之開工門檻 firstMs 取抓取套件之 captureCallMsOf(settings,
//   席位或席位陣列;席位 timeoutMs → ai.providerTimeouts → ai.extraProviders 之條目逾時 → ai.timeoutMs,多席取最大)。
// 【逐次進門門檻(判定小組之第三席;使用端 Gitea #132)】判定小組三段(衝突核對、既有邊覆核、關聯重評)之段開工門檻為三席首家逾時之最大值
//   (每頁開工前之守門、整段延後之判定:前兩席並行,須夠最慢之一席)。第三席於前兩票之後才叫,若仍以該最大值判進門,頁開工時剩餘 <
//   「開工門檻＋前兩席耗時」者,前兩票已得而第三席不送出——送第三席之項整批留待下輪、前兩票作廢。故三段之第三席每次呼叫給
//   startMs ＝ captureCallMsOf(settings, 第三席)(該席首家之逾時;包裝內與 firstMs 取小、不轉交);第一、二席不給(取 firstMs)。

/**
 * 建立關聯之 AI 呼叫函數(扣保留之段再以抓取套件之 reservedAiCallOf 包一層;見檔頭)
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

export default { relateAiCallOf }
