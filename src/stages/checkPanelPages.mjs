// checkPanelPages.mjs — 核對類判定小組之分頁迴圈(衝突核對 RS4、既有邊覆核 RS6 共用;兩層判定之純函數在 stores/conflictCheckPolicy、
//   stores/edgeReviewPolicy):逐頁開工前之時間守門 → 每頁交摘要套件之判定小組單頁執行器 runPanelPage(core/standards/panelRun;第一、二席並行、
//   第二席項序打亂而編號不變、未成立而可成立者只送第三席)→ 把裁定寫回各項 → 中止之收尾
//
// 【為何獨立成檔】兩段之分頁、時間守門、呼叫結果之正規化、中止之語意同一份(同一規則手寫兩份必然漂移),兩段只給差異。
// 【單頁骨架取摘要套件】判定小組之單頁執行(兩席並行、第二席打亂、第三席只送需要之項)一律 runPanelPage;本檔以其 opt-in 參數給核對類之差異:
//   secondOf(頁)＝第二席所見之項(衝突核對只送既有邊與兩席類提案——單席提案之另一票是提案席;既有邊覆核為整頁)、ballotOf(項, 第一席票, 第二席票)＝
//   該項之前兩票、decideOf(項, 票)＝兩層判定(既有邊覆核之型別層須見該項之現行型別,故以項為參數)、needThirdOf＝兩層判定之 needThird、
//   thirdStop:'items'(第三席中止只使送第三席之項不判)。第二席之項序依 runPanelPage 之打亂(sha1(`<前綴>|<邊 id>`) 逐項)。
// 【失敗語意(與重評同一規則:中止不計、失敗計)】中止＝結果 skipped(額度用盡、整輪截止、斷網)——不是該項之失敗,不記 tries:前兩席中止 →
//   本頁與其後之頁不判;第三席中止 → 送第三席之項本輪不判(decision 為 null,呼叫端照「未判」處置:待判原樣、新提案入待判、存量下輪再排)、
//   本頁其餘項照判、**其後之頁仍以前兩席判、只不再叫第三席**(需第三席之項同不判;與重評同一規則)。失敗＝第三席呼叫失敗、未涵蓋或該項之票
//   不合格 → 該項 retry(呼叫端記待判之 tries,逾次轉使用者):第三席本可改變結果,不以前兩票之未決結果處置。前兩席之失敗(缺票)由兩層判定判 retry。
// 【呼叫與計數在呼叫端】call 由各段給(段名、席別、時間預算與 AI 呼叫數之計數皆在段內);本函數只把調度層之結果正規化為執行器之形狀
//   ({ ok, data, providerId, skipped, error } → { ok, data, providerId, stop }),回傳是否中止與送第三席之項數,由段記入其報告。

import isobj from 'wsemi/src/isobj.mjs'
import { oneline } from '../core/capturePackage.mjs'
import { PANEL_WHY, PANEL_THIRD_STOP, runPanelPage } from '../core/summarizePackage.mjs'

/**
 * 核對類判定小組之分頁迴圈(見檔頭):逐頁裁定 list 之各項(各項寫入 votes 與 decision;未判之項——時間守門或前兩席中止而未到之頁、
 *   第三席中止而送第三席之項、第三席已中止後需第三席之項——decision 不設或為 null)
 *
 * @param {Object} o 輸入 {
 *   list:Array(受檢項 [{ index:頁內外皆唯一之項編號, key:邊 id(打亂與裁定之鍵), edge:{ id, … }, … }];依序每 pageSize 項一頁),
 *   pageSize:Integer(正整數),
 *   seats:{ first, second?, third? }(第一席恆叫;第二席於 secondOf 非空時叫;third 為物件才叫),
 *   call:(spec, prompt, seat)=>Promise(調度層之結果 { ok, data, providerId, skipped, error };seat 為 'first'|'second'|'third'),
 *   buildPrompt:(items)=>String(組字拋錯即原樣拋出,本頁不呼叫),
 *   votesOf:(data, items)=>Map(項編號 → 票|PANEL_UNSURE|null;items 為該席所見之項),
 *   secondOf:(page)=>Array(第二席所見之項;依 sha1(`<shufflePrefix>|<各項邊 id>`) 打亂、編號不變),
 *   ballotOf:(x, a, b)=>Array(該項之前兩票;a、b 為第一、二席之票 { seat, provider, verdict }),
 *   decide:(x)=>Object(依 x.votes 之兩層判定 { action, why, needThird, … }),
 *   shufflePrefix:String, shouldStop:()=>Boolean(每頁開工前詢問;真即停), log:{ info }, label:String(日誌之段名) }
 * @returns {Promise<Object>} 回傳 { stopped:Boolean(時間守門或前兩席中止而未判完), aborted:Boolean(有席中止), third:Integer(送第三席之項數) };
 *   call 或 buildPrompt 拋錯則原樣拒絕
 * @example
 * let list = [{ index: 1, key: 'e1', edge: { id: 'e1' } }, { index: 2, key: 'e2', edge: { id: 'e2' } }]
 * let r = await runCheckPanelPages({
 *     list,
 *     pageSize: 10,
 *     seats: { first: { use: 'p1' }, second: { use: 'p2' } },
 *     call: async (spec, prompt, seat) => ({ ok: true, providerId: spec.use, data: [{ index: 1, verdict: 'keep' }, { index: 2, verdict: 'retire' }] }),
 *     buildPrompt: (items) => items.map((x) => x.index).join(','),
 *     votesOf: (data, items) => new Map(data.map((d) => [d.index, d.verdict])),
 *     secondOf: (page) => page,
 *     ballotOf: (x, a, b) => [a, b],
 *     decide: (x) => ({ action: x.votes[0].verdict === x.votes[1].verdict ? x.votes[0].verdict : 'retry', needThird: false }),
 *     shufflePrefix: 'demo',
 *     shouldStop: () => false,
 *     log: { info: () => {} },
 *     label: '示範',
 * })
 * console.log(r)
 * console.log(list.map((x) => `${x.key}:${x.decision.action}:${x.votes.map((v) => v.provider).join('+')}`))
 * // => { stopped: false, aborted: false, third: 0 }
 * // => [ 'e1:keep:p1+p2', 'e2:retire:p1+p2' ]
 */
export async function runCheckPanelPages(o) {
    const { list, pageSize, seats, call, buildPrompt, votesOf, secondOf, ballotOf, decide, shufflePrefix, shouldStop, log, label } = o
    let stopped = false
    let aborted = false
    let third = 0
    let thirdOn = isobj(seats.third)
    let thirdExhausted = false
    for (let i = 0; i < list.length && !stopped; i += pageSize) {
        const page = list.slice(i, i + pageSize)
        if (shouldStop()) {
            stopped = true
            break
        }
        const byIndex = new Map(page.map((x) => [x.index, x]))
        let stopErr = ''
        const r = await runPanelPage({
            local: page,
            buildPrompt,
            shufflePrefix,
            seats: thirdOn ? seats : { first: seats.first, second: seats.second },
            // 調度層之結果 → 執行器之形狀(skipped＝中止,其錯誤字樣留給日誌);不包成 async:同步拋出者原樣拋出,第二席不被呼叫
            call: (stage, seat, prompt) => Promise.resolve(call(seat, prompt, stage)).then((x) => {
                if (x?.skipped) stopErr = stopErr || oneline(x?.error, 80)
                return { ok: x?.ok, data: x?.data, providerId: x?.providerId, stop: x?.skipped }
            }),
            votesOf: (data, idx) => votesOf(data, [...idx].map((k) => byIndex.get(k))),
            secondOf,
            ballotOf,
            // 兩層判定以項為參數(依 x.votes);第三席失敗、未涵蓋或該項之票不合格 → 重試(記 tries;第三席本可改變結果,不以前兩票之未決結果處置)
            decideOf: (x, vs) => {
                x.votes = vs
                if (vs.length === 3 && vs[2].verdict === null) {
                    x.votes = vs.slice(0, 2)
                    const d = { ...decide(x), action: 'retry', why: PANEL_WHY.MISSING, needThird: false }
                    x.votes = vs
                    return d
                }
                return decide(x)
            },
            needThirdOf: (x, vs) => {
                x.votes = vs
                return decide(x).needThird
            },
            thirdStop: PANEL_THIRD_STOP.ITEMS,
        })
        // 前兩席中止(未取票、整頁未判):本頁與其後之頁不判
        if (r.stopped && page.every((x) => !x.votes)) {
            stopped = true
            aborted = true
            log.info(`${label}：額度或截止中止（${stopErr}），未核之項留待下輪`)
            break
        }
        // 送第三席之項:已有第三票者、第三席中止而未判者、第三席本輪已中止後需第三席者(同不判)
        for (const x of page) {
            const d = r.byIndex.has(x.index) ? r.byIndex.get(x.index) : null
            const needs = x.votes?.length === 3 || r.undecided.includes(x.index) || (thirdExhausted && d?.needThird === true)
            if (needs) third++
            x.decision = thirdExhausted && d?.needThird === true ? null : d
        }
        if (r.stopped) {
            // 第三席中止:送第三席之項本輪不判(不記 tries);其後之頁仍以前兩席判、只不再叫第三席(需第三席之項同不判)
            aborted = true
            thirdOn = false
            thirdExhausted = true
            log.info(`${label}：第三席額度或截止中止（${stopErr}），該些項留待下輪；本輪其後不再叫第三席`)
        }
    }
    return { stopped, aborted, third }
}

export default { runCheckPanelPages }
