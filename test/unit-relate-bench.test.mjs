// unit-relate-bench.test.mjs — 關聯之 AI 能力評分(bench/relateBench.mjs、bench/cli.mjs)之單元測試:以替身調度層(不連網、不呼叫真 AI)驗四角色
//   ①題組:四份通用題組全數通過驗證、類別涵蓋、材料之可見與現行理由之合格;RS4／RS5／RS6 檢定標準題組之形狀相容與拒收;各角色之逐案檢核
//   ②分頁與提示詞:正向 6、重評 10、衝突核對與既有邊覆核 10(項編號跨頁連續,同正式);各頁之提示詞與直接呼叫正式 domain 之結果逐字同;
//     題組與詞彙不合 → 任何呼叫之前拋錯
//   ③逐案類別:示範回覆逐案通過(應然可達);錯誤回覆與邊界(缺票、同 index 重複、slug 幻想與尾碼救回、型別在清單外、理由空泛、數字未紮根、
//     合併與單篇上限——與正式逐項鏈之 buildEdges 逐項同);批合格判準與逐次呼叫選項同正式
//   ④詞彙注入(opt.vocab／--vocab／--vocab-pick)、domain 注入、--role 解析、--role all 之準備期與停測帶過、多角色評比表並存、受測名單、
//     命令列薄殼、套件根之評比表表頭
//   ⑤領域中立:四份題組與評分原始碼不含量化／金融詞與網址
// 執行:自套件根 node <mocha> test/unit-relate-bench.test.mjs(暫存 test/_tmp/relate-bench-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
    RELATE_BENCH_ROLES, RELATE_BENCH_CASES_FILES, RELATE_BENCH_MODELS, RELATE_BENCH_USAGE, RELATE_BENCH_CHANGE,
    relateBenchRole, reevalBenchRole, conflictCheckBenchRole, edgeReviewBenchRole,
    relateBenchRoleOf, runRelateBench, planRelateBench, runRelateBenchCli, parseRelateBenchArgs, benchRelateEdgesOf,
} from '../src/bench/relateBench.mjs'
import * as cli from '../src/bench/cli.mjs'
import { BENCH_BOARD_HEADER, validateBenchCases, loadBenchCases, domainTermsIn, msgOf, plainLog, parseCsv, silentLog, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { makeMsg, DEFAULT_FREE_MODELS } from '../src/core/capturePackage.mjs'
import { RELATE_DEFAULT } from '../src/core/relateSettings.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { mwBuildEdges } from '../src/stages/relateChain.mjs'
import { makeSlugResolver } from '../src/stores/candidates.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'
import { checkEdge } from '../src/standards/edgeStandards.mjs'
import { normalizeEdgeProposal, pairCheckItemOf } from '../src/standards/edgeGate.mjs'
import { reviewVerdictOf, rs6DecisionOf, rs6VoteActionOf } from '../src/stores/edgeReviewPolicy.mjs'

// 套件根(以本檔位置定,不依 cwd)與測試暫存(tmpRoot;測完即刪)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let TMP = ''

/** 固定時鐘(報表時間戳可斷言) */
const FIXED = { timeZone: 'Fixed/Test', iso8: () => '2031-03-04T05:06:07+08:00', stamp8: () => '20310304050607', date8: () => '2031-03-04', day8: () => '20310304' }

/** 預設詞彙之 domain 與衝突型 */
const D = createRelateDomain()
const C = D.conflictType

/** 各角色之內建題組(已驗) */
const SET = Object.fromEntries(RELATE_BENCH_ROLES.map((r) => [r.id, loadBenchCases(r)]))
const caseOf = (roleId, id) => SET[roleId].cases.find((c) => c.id === id)
const ROLE_IDS = ['relate', 'reeval', 'conflict-check', 'edge-review']

// ════════════════ 示範回覆(各案之應然答案;驗應然可達) ════════════════

/** 正向之示範理由(過納入閘:具體、正體、數字見於模型所見之區塊) */
const RELATE_REASONS = {
    r01: { '克卜勒第三定律-8e04d7f3': '甲以乙之週期平方與半長軸立方成正比之關係換算行星之公轉週期' },
    r02: { '理想拋體運動之軌跡-0f6b3d82': '甲在乙之理想拋體模型上加入與速度平方成正比之空氣阻力' },
    r03: { 'dijkstra最短路徑演算法-c5a19f62': '甲以優先佇列實作乙之最短路徑演算法並用於公車路網' },
    r04: { '以自動錄音辨識夜行性鳥類-6f0b2d94': '乙之夜間自動錄音可補足甲之日間樣線調查所漏記之夜行性鳥種' },
    r05: { '快速排序法-b81d3e47': '兩者皆以分治法遞迴排序，甲為穩定排序而需額外空間，乙可就地排序但不穩定' },
    r06: { '以溫度露點差判斷起霧-5e9d03b2': '兩篇皆以露點溫度為依據，甲估計夜間最低氣溫，乙判斷是否起霧' },
    r07: { '放養濾食性魚類反使藍綠藻增加-d2b85f19': '甲說在湖泊放養濾食性魚類後藍綠藻減少；乙說同一湖泊放養後藍綠藻反而增加' },
    r08: {
        '同型鋁合金之最佳時效溫度-7c1e4a93': '甲說此型鋁合金於攝氏 175 度之硬度最高；乙說同型合金以攝氏 120 度之硬度最高',
        '時效硬化之析出機制-e4d02b78': '乙所述之析出強化機制是甲尋找最佳時效溫度所依據之原理',
    },
    r09: { '同品種萵苣種子在黑暗中發芽最佳-f0c7b294': '甲說此品種萵苣種子須照紅光才發芽；乙說同品種在全黑環境下發芽率最高' },
    h1: {
        'p波與s波之傳播特性-a7c30e5b': '甲以乙所述 P 波快於 S 波之速度差換算震央距離',
        '以三個測站交會定位震央-3d9f6a20': '乙以甲所得之各測站震央距離為半徑畫圓交會定出震央位置',
    },
    h2: { '波以耳定律-0c5e8b3a': '甲之理想氣體方程式在溫度與氣體量固定時即化為乙之壓力與體積成反比' },
    h3: { '睡前攝取咖啡因會延遲入睡-b9e04d27': '兩篇談同一機制：咖啡因阻斷腺苷受體，甲為日間警覺提升，乙為睡前入睡延遲' },
    h4: { '中間插入時動態陣列反而比鏈結串列快-2f7d0c64': '甲說中間插入時鏈結串列較快；乙說相同硬體與筆數下動態陣列較快' },
}

/** 正向之示範項:須選者取第一個可接受型別、須判衝突者取衝突型;允許空清單者回空陣列 */
const relateOracleItem = (c, index) => ({
    index,
    relations: [
        ...c.expect.must.map((m) => ({ to: m.to, type: m.types[0], reason: RELATE_REASONS[c.id][m.to] })),
        ...c.expect.conflict.map((to) => ({ to, type: C, reason: RELATE_REASONS[c.id][to] })),
    ],
})

/** 重評之示範項(頁內編號) */
function reevalOracleItem(c, index) {
    const e = c.expect
    const to = c.input.neighbor.id
    if (e.verdict === 'keep') return { index, verdicts: [{ to, verdict: 'keep', reason: '新內容仍以同一機制與對象相連' }] }
    if (e.verdict === 'retire') return { index, verdicts: [{ to, verdict: 'retire', reason: '新內容已換成無關之主題，與對象不再有共同之機制' }] }
    if (e.verdict === 'unsure') return { index, verdicts: [{ to, verdict: 'unsure', reason: '新內容未載關鍵細節' }] }
    const type = e.typeConflict ? C : D.relationTypes.find((t) => t !== C && t !== c.input.edge.type)
    return { index, verdicts: [{ to, verdict: 'change', type, reason: '新內容之結論已改變兩篇之關係，須改寫型別與理由' }] }
}

/** 衝突核對之示範票(全域編號) */
function checkOracleVote(c, index) {
    const e = c.expect
    if (e.verdict === 'keep') return { index, verdict: 'keep', reason: '理由已陳述雙方之主張' }
    if (e.verdict === 'retire') return { index, verdict: 'retire', reason: '兩篇只有名稱相同而無共同之機制' }
    if (e.verdict === 'unsure') return { index, verdict: 'unsure', reason: '甲之材料未載具體主張' }
    return { index, verdict: 'change', type: e.typeConflict ? C : '互補搭配', reason: e.typeConflict ? '甲說此條件下成立；乙說同一條件下結論相反' : '兩篇可同時成立，屬同一主題之不同面向' }
}

/** 既有邊覆核之示範票(全域編號) */
function reviewOracleVote(c, index) {
    const e = c.expect
    const cur = c.input.edge.type
    const reason = '點出甲乙各自之具體內容之改寫理由'
    if (e.kind === 'keep') return { index, verdict: 'keep', reason: '' }
    if (e.kind === 'reason') return { index, verdict: 'change', type: cur, reason }
    if (e.kind === 'retype') return { index, verdict: 'change', type: e.type, reason }
    if (e.kind === 'upgrade') return { index, verdict: 'change', type: C, reason: '甲說此條件下成立；乙說同一條件下結論相反' }
    if (e.kind === 'retire') return { index, verdict: 'retire', reason: '兩篇只有字面相同而無共同之機制' }
    return { index, verdict: 'unsure', reason: '甲之材料未載具體內容' }
}

/** 各角色之示範回覆:(該頁之案, 該頁首案之全域編號-1) => 回覆 */
const ORACLE = {
    relate: (cases) => cases.map((c, i) => relateOracleItem(c, i + 1)),
    reeval: (cases) => cases.map((c, i) => reevalOracleItem(c, i + 1)),
    'conflict-check': (cases, base) => cases.map((c, i) => checkOracleVote(c, base + i + 1)),
    'edge-review': (cases, base) => cases.map((c, i) => reviewOracleVote(c, base + i + 1)),
}

/**
 * 替身調度層:以各角色之規劃(planRelateBench)認出提示詞屬哪一頁(並記該頁首案之全域編號),依 reply[角色](同頁之案, 全域編號基數, 模型)
 *   或示範回覆作答;認不出之提示詞依 unknown(提示詞) 作答(未給回空陣列);fail[模型] 給了即該模型每次呼叫皆以該錯誤訊息失敗。
 *   回覆經 check 驗證(同正式調度層);記錄每次呼叫(含逐次呼叫選項)
 *
 * @param {Object} [o={}] 輸入 { reply:{ 角色 id: 函數 }, unknown:函數, plan:{ 角色 id: planRelateBench 之設定 }, fail:{ 模型: 錯誤訊息 } }
 * @returns {Object} 回傳 { calls, callJson }
 */
function benchStub(o = {}) {
    const byPrompt = new Map()
    for (const role of RELATE_BENCH_ROLES) {
        const plan = planRelateBench(role.id, o.plan?.[role.id] || {})
        const byId = new Map(plan.set.cases.map((c) => [c.id, c]))
        let base = 0
        for (const p of plan.pages) {
            byPrompt.set(p.prompt, { role: role.id, cases: p.ids.map((id) => byId.get(id)), base })
            base += p.ids.length
        }
    }
    const calls = []
    return {
        calls,
        callJson: async (prompt, check, callOpt) => {
            const model = callOpt?.spec?.use
            const hit = byPrompt.get(String(prompt))
            calls.push({ model, role: hit?.role || '', ids: hit ? hit.cases.map((c) => c.id) : [], prompt: String(prompt), callOpt })
            if (o.fail?.[model]) return { ok: false, data: null, error: o.fail[model], providerId: '', attempts: 1, skipped: false, errors: [] }
            const data = hit ? (o.reply?.[hit.role] || ORACLE[hit.role])(hit.cases, hit.base, model) : (o.unknown ? o.unknown(String(prompt)) : [])
            let ok
            try {
                ok = check(data)
            }
            catch (e) {
                ok = `check 拋錯：${e.message}`
            }
            if (ok !== true) return { ok: false, data: null, error: 'OUTPUT_VALIDATION_FAILED', providerId: '', attempts: 1, skipped: false, errors: [`${model}:validation(0.0s)：${ok}`] }
            return { ok: true, data, error: '', providerId: `${model}#p`, attempts: 1, skipped: false, errors: [] }
        },
    }
}

/**
 * 單案之判定:以該案單獨成頁規劃(項編號 1、頁之 domain 已記)後直接呼叫角色之 verdictOf(domain 以預設詞彙建)
 *
 * @param {String} roleId 輸入角色 id
 * @param {Object} c 輸入案
 * @param {*} data 輸入回覆
 * @returns {Object} 回傳 verdictOf 之結果
 */
function judgeOne(roleId, c, data) {
    const pc = planRelateBench(roleId, { cases: [c] }).set.cases[0]
    return relateBenchRoleOf(roleId).verdictOf(data, pc, { index: 1, seq: 1, domain: D, cases: [pc], roleOpt: {} })
}

/**
 * 內建題組之某一頁(規劃後之案;base 取核心所給之該頁項編號基數)
 *
 * @param {String} roleId 輸入角色 id
 * @param {Integer} k 輸入頁序(0 起)
 * @returns {Object} 回傳 { cases, base(該頁首案之全域編號-1), prompt }
 */
function pageOf(roleId, k) {
    const plan = planRelateBench(roleId)
    const byId = new Map(plan.set.cases.map((c) => [c.id, c]))
    return { cases: plan.pages[k].ids.map((id) => byId.get(id)), base: plan.pages[k].base, prompt: plan.pages[k].prompt }
}

/**
 * 經正式逐項鏈之 buildEdges(錨點之 handle)取提出之邊與計數
 *
 * @param {Object} item 輸入回覆之單項
 * @param {Object} target 輸入目標
 * @param {Array} cands 輸入候選清單
 * @returns {Promise} 回傳 Promise，resolve 回傳 { edges, stats }
 */
async function viaChain(item, target, cands) {
    const msg = makeMsg('note', { note: target, _aiItem: item, _resolver: makeSlugResolver(cands), _candidates: cands, _domain: D, _rt: { byId: new Map([target, ...cands].map((n) => [n.id, n])) } })
    await mwBuildEdges().handle(msg, { deps: { clock: { iso8: () => '2000-01-01T00:00:00+00:00' } }, log: silentLog }, (m) => m)
    return { edges: msg.data._edges, stats: msg.stats }
}

// ════════════════ 合成之材料(中立之示意;只用於驗檢核與判定之機制) ════════════════

/** 合成之筆記 */
const note = (id, title, extra = {}) => ({ id, title, category: '原理與概念', evidenceLevel: '中', concepts: ['某概念'], summary: `${title}之一句話重點`, ...extra })

/** 合成之正向案:候選甲(須選前置概念)、乙(須判衝突)、丙(不得選) */
function relateCase(over = {}) {
    return {
        id: 'z',
        input: { target: note('目標筆記-1111aaaa', '目標筆記'), candidates: [note('候選甲-2222bbbb', '候選甲'), note('候選乙-3333cccc', '候選乙'), note('候選丙-4444dddd', '候選丙')] },
        expect: { must: [{ to: '候選甲-2222bbbb', types: ['前置概念'] }], conflict: ['候選乙-3333cccc'], mustNot: ['候選丙-4444dddd'], allowEmpty: false },
        why: 'w',
        ...over,
    }
}

/** 合成之一對筆記(衝突核對、既有邊覆核) */
const side = (title) => ({ title, category: '原理與概念', evidenceLevel: '中', concepts: ['某概念'], summary: `${title}之一句話重點`, keyPoints: ['要點'], conditions: [] })

describe('unit-relate-bench', function() {

    before(() => {
        TMP = tmpRoot('relate-bench')
    })

    after(() => removeRoots([TMP]))

    // ══════════════════════════ ①題組 ══════════════════════════
    describe('① 題組', function() {

        it('四份通用題組全數通過驗證:各 12～16 案、保留題 3～5 案;std／v 與角色相符;題組檔在 bench/cases/<角色 id>-generic.json;每案有題型與依據', () => {
            assert.deepEqual(RELATE_BENCH_ROLES.map((r) => r.id), ROLE_IDS)
            assert.deepEqual(RELATE_BENCH_ROLES.map((r) => [r.name, [...r.std], r.v]), [
                ['正向關聯(relate)', [], 1], ['重評(reeval)', ['RS5'], 2], ['衝突核對(conflict-check)', ['RS4'], 1], ['既有邊覆核(edge-review)', ['RS6'], 1],
            ])
            for (const role of RELATE_BENCH_ROLES) {
                const set = SET[role.id]
                const n = set.cases.length
                const h = set.cases.filter((c) => c.holdout).length
                assert.ok(n >= 12 && n <= 16, `${role.id} 案數 ${n}`)
                assert.ok(h >= 3 && h <= 5, `${role.id} 保留題 ${h}`)
                if (role.std.length) assert.ok(role.std.includes(set.std), `${role.id} 之 std ${set.std}`)
                assert.equal(set.v, role.v, `${role.id} 之 v`)
                assert.equal(role.casesFile, RELATE_BENCH_CASES_FILES[role.id])
                assert.equal(path.relative(PKG, role.casesFile).replace(/\\/g, '/'), `src/bench/cases/${role.id}-generic.json`)
                assert.ok(set.cases.every((c) => typeof c.type === 'string' && c.type && typeof c.why === 'string' && c.why), `${role.id} 每案有題型與依據`)
                assert.ok(set.note.length > 100, `${role.id} 之 note 寫明應然之推得與類別`)
            }
        })

        it('類別涵蓋:正向含各非衝突型別之須選、須判衝突、允許空清單與多對象之案;重評與衝突核對含五類;既有邊覆核含六種處置(改型含實作與延伸);保留題各涵蓋 3 類以上', () => {
            const kinds = (id) => [...new Set(SET[id].cases.map((c) => relateBenchRoleOf(id).expectOf(c)))].sort()
            const rel = SET.relate.cases
            const mustTypes = new Set(rel.flatMap((c) => c.expect.must.flatMap((m) => m.types)))
            assert.deepEqual(D.relationTypes.filter((t) => t !== C && !mustTypes.has(t)), [], '各非衝突型別皆有須選之案')
            assert.ok(rel.filter((c) => c.expect.conflict.length).length >= 4, '須判衝突之案')
            assert.ok(rel.filter((c) => c.expect.allowEmpty).length >= 2, '允許空清單(全部候選不得選)之案')
            assert.ok(rel.some((c) => c.expect.must.length + c.expect.conflict.length >= 2), '多對象之案')
            assert.ok(rel.every((c) => c.expect.mustNot.length >= 1), '每案皆有不得選之陷阱(題材撞名或泛泛關係)')
            assert.deepEqual(kinds('relate'), ['match'], '正向之應然一律 match')
            const five = ['change(衝突型)', 'change(非衝突型)', 'keep', 'retire', 'unsure']
            assert.deepEqual(kinds('reeval'), five)
            assert.deepEqual(kinds('conflict-check'), five)
            assert.deepEqual(kinds('edge-review'), ['keep', 'reason', 'retire', 'retype:實作範例', 'retype:延伸深化', 'unsure', 'upgrade'])
            for (const id of ROLE_IDS.slice(1)) {
                const hk = new Set(SET[id].cases.filter((c) => c.holdout).map((c) => relateBenchRoleOf(id).expectOf(c)))
                assert.ok(hk.size >= 3, `${id} 之保留題涵蓋 ${hk.size} 類`)
            }
            assert.deepEqual([...new Set(rel.filter((c) => c.holdout).map((c) => c.type))].length, 5, '正向之保留題五種題型')
            assert.deepEqual(Object.values(RELATE_BENCH_CHANGE), ['change(衝突型)', 'change(非衝突型)'])
        })

        it('正向之材料:候選之一句話重點皆在提示詞所見之 80 字內、目標之 200 字內(應然所據之內容模型看得到);目標 id 不重複;slug 皆帶 8 碼尾碼', () => {
            const ids = SET.relate.cases.map((c) => c.input.target.id)
            assert.equal(new Set(ids).size, ids.length)
            for (const c of SET.relate.cases) {
                assert.ok([...c.input.target.summary].length <= 200, `${c.id} 之目標重點逾 200 字`)
                for (const x of c.input.candidates) {
                    assert.ok([...x.summary].length <= 80, `${c.id}／${x.id} 之候選重點逾 80 字`)
                    assert.match(x.id, /-[0-9a-f]{8}$/, `${x.id} 帶 8 碼尾碼`)
                }
            }
            for (const c of SET.reeval.cases) assert.ok([...c.input.neighbor.summary].length <= 120, `${c.id} 之鄰居重點逾 120 字(重評之鄰居列只見前 120 字)`)
        })

        it('衝突核對與既有邊覆核之現行理由無確定性之違反(RS2 空泛片語、RS8 數字紮根;否則正式送審時該項附改寫指示,提示詞與題組所送不同)', () => {
            for (const id of ['conflict-check', 'edge-review']) {
                for (const c of SET[id].cases) {
                    const e = normalizeEdgeProposal({ from: 'a', to: 'b', type: c.input.edge.type || C, reason: c.input.edge.reason }, { resolveType: D.resolveType }).edge
                    const mat = { a: D.seenTextOf(c.input.a, 'checkSide', c.input.a), b: D.seenTextOf(c.input.b, 'checkSide', c.input.b) }
                    const bad = checkEdge(e, { relationTypes: D.relationTypes, vague: D.vagueReasons, hasNote: () => true, materialOf: (x) => mat[x] }).filter((r) => (r.std === 'RS2' || r.std === 'RS8') && r.status !== 'pass')
                    assert.deepEqual(bad.map((r) => `${r.std} ${r.detail}`), [], `${id}／${c.id}`)
                }
            }
        })

        it('檢定標準題組之形狀相容:RS4(v1)、RS5(v2;案頂層之 category)、RS6(v1;excluded)之同形案可直接驗過;標準或版本不符拒收', () => {
            const a = side('甲篇')
            const b = side('乙篇')
            const rs4 = { std: 'RS4', v: 1, note: '', cases: [{ id: 'c1', holdout: false, input: { a, b, edge: { type: C, reason: '甲說某量上升；乙說同條件下下降' } }, expect: { verdict: 'change', typeConflict: true }, why: 'w' }] }
            assert.equal(validateBenchCases(conflictCheckBenchRole, rs4).cases.length, 1)
            const rs5 = { std: 'RS5', v: 2, note: '', cases: [{ id: 'k1', holdout: false, category: 'K', input: { target: { title: '甲', category: '原理與概念', concepts: ['某概念'], summary: '甲之新內容' }, neighbor: { id: 'nb-1111', title: '乙', category: '原理與概念', concepts: ['某概念'], summary: '乙之重點' }, edge: { type: '前置概念', reason: '甲以乙之定義推導' } }, expect: { verdict: 'keep' }, why: 'w' }] }
            assert.equal(validateBenchCases(reevalBenchRole, rs5).cases[0].category, 'K', '案頂層之 category 原樣保留')
            const rs6 = { std: 'RS6', v: 1, excluded: [{ id: 'x', why: '兩可' }], cases: [{ id: 't1', holdout: true, input: { a, b, edge: { type: '同類方法', reason: '兩篇皆以同一作法求解' } }, expect: { kind: 'retype', type: '實作範例' }, why: 'w' }] }
            assert.equal(validateBenchCases(edgeReviewBenchRole, rs6).cases[0].holdout, true)
            assert.match(msgOf(() => validateBenchCases(reevalBenchRole, { ...rs5, v: 1 })), /題組之 v「1」非本角色所讀之題組版本（2）/)
            assert.match(msgOf(() => validateBenchCases(edgeReviewBenchRole, { ...rs4, std: 'RS4' })), /題組之 std「RS4」非本角色之標準（RS6）/)
            assert.match(msgOf(() => validateBenchCases(conflictCheckBenchRole, { ...rs5, std: 'RS5', v: 1 })), /題組之 std「RS5」非本角色之標準（RS4）/)
        })

        it('正向之逐案檢核:應然四欄缺欄或形狀錯、對象不在候選、重複列、候選未列、allowEmpty 與須選不一致、須選逾上限、候選含目標自身、id 或尾碼重複、目標 id 重複、自帶詞彙不合 → 任何呼叫之前拋錯並列出全部問題', () => {
            const bad = (cases) => msgOf(() => validateBenchCases(relateBenchRole, cases)) || ''
            assert.equal(validateBenchCases(relateBenchRole, [relateCase()]).cases.length, 1, '合成之案合格')
            assert.match(bad([relateCase({ expect: undefined })]), /缺 expect:\{ must, conflict, mustNot, allowEmpty \}/)
            const shape = bad([relateCase({ expect: { must: 'x', conflict: [], mustNot: [], allowEmpty: 'no', extra: 1 } })])
            for (const p of [/expect 含不認得之鍵：extra/, /expect\.must 須為陣列/, /expect\.allowEmpty 須為布林/]) assert.match(shape, p)
            const list = bad([relateCase({ expect: { must: [{ to: '不在-9999eeee', types: ['前置概念'] }], conflict: ['候選乙-3333cccc'], mustNot: ['候選乙-3333cccc'], allowEmpty: true } })])
            for (const p of [/應然之對象不在候選清單：不在-9999eeee/, /對象重複列於應然：候選乙-3333cccc/, /候選未列於應然：候選甲-2222bbbb、候選丙-4444dddd/, /expect\.allowEmpty 須為 false/]) assert.match(list, p)
            assert.match(bad([relateCase({ expect: { must: [], conflict: [], mustNot: ['候選甲-2222bbbb', '候選乙-3333cccc', '候選丙-4444dddd'], allowEmpty: false } })]), /expect\.allowEmpty 須為 true/)
            const item = bad([relateCase({ expect: { must: [{ to: '候選甲-2222bbbb', types: [], x: 1 }], conflict: ['候選乙-3333cccc'], mustNot: ['候選丙-4444dddd'], allowEmpty: false } })])
            for (const p of [/expect\.must\[0\] 含不認得之鍵：x/, /expect\.must\[0\]\.types 須為非空字串陣列/]) assert.match(item, p)
            const five = ['一', '二', '三', '四', '五'].map((x, i) => note(`候選${x}-${'abcde'[i].repeat(8)}`, `候選${x}`))
            const over = bad([relateCase({ input: { target: note('目標筆記-1111aaaa', '目標筆記'), candidates: five }, expect: { must: five.map((x) => ({ to: x.id, types: ['前置概念'] })), conflict: [], mustNot: [], allowEmpty: false } })])
            assert.match(over, /須選與須判衝突之對象共 5 個，逾單篇上限 4/)
            const t = note('目標筆記-1111aaaa', '目標筆記')
            const cands = bad([relateCase({ input: { target: t, candidates: [t, note('候選甲-2222bbbb', '候選甲'), note('候選甲-2222bbbb', '候選甲'), note('另一-2222bbbb', '另一')] } })])
            for (const p of [/候選 id 重複：候選甲-2222bbbb/, /候選不得含目標自身/, /候選 id 之 8 碼尾碼重複：1111aaaa、2222bbbb|候選 id 之 8 碼尾碼重複：2222bbbb/]) assert.match(cands, p)
            assert.match(bad([relateCase(), relateCase({ id: 'z2' })]), /目標 id 重複：目標筆記-1111aaaa/)
            const shapeIn = bad([relateCase({ input: { target: { title: '' }, candidates: [] } })])
            for (const p of [/input\.target\.id 須為非空字串/, /input\.target\.title 須為非空字串/, /input\.candidates 須為非空陣列/]) assert.match(shapeIn, p)
            assert.match(bad([relateCase({ input: { ...relateCase().input, vocab: { bogus: 1 } } })]), /input\.vocab 不合：vocab 含不認得之鍵：bogus/)
        })

        it('重評、衝突核對、既有邊覆核之逐案檢核:缺欄、應然非法(verdict／typeConflict／kind／type)、自指、不收之欄位 → 任何呼叫之前拋錯並列出全部問題', () => {
            const bad = (role, cases) => msgOf(() => validateBenchCases(role, cases)) || ''
            const r = bad(reevalBenchRole, [
                { id: 'a', input: { target: { title: '' }, neighbor: { title: '乙' }, edge: { type: '', reason: '' } }, expect: { verdict: 'maybe' }, why: 'w' },
                { id: 'b', input: { target: note('同一-5555eeee', '甲'), neighbor: note('同一-5555eeee', '乙'), edge: { type: '前置概念', reason: '甲以乙之定義推導', reasonProblem: 'x' } }, expect: { verdict: 'change' }, why: 'w' },
                { id: 'c', input: { target: note(undefined, '甲'), neighbor: note('乙-6666ffff', '乙'), edge: { type: '前置概念', reason: '甲以乙之定義推導' } }, expect: { verdict: 'keep', typeConflict: false }, why: 'w' },
            ])
            for (const p of [/cases\[0\]\(a\) input\.target\.title 須為非空字串/, /input\.neighbor\.id 須為非空字串/, /input\.edge\.type 須為非空字串/, /input\.edge\.reason 須為非空字串/, /expect\.verdict 須為 keep／change／retire／unsure/,
                /cases\[1\]\(b\) .*目標與鄰居之 id 相同\(自指\)/, /input\.edge 不收 reasonProblem/, /expect\.typeConflict 須為布林/, /cases\[2\]\(c\) expect\.typeConflict 只用於 change/]) assert.match(r, p)
            // 「現行理由須改寫」之附註由評分依正式規則計算——三角色之題組皆不得自給(自給即與正式之提示詞形式分歧)
            const k = bad(conflictCheckBenchRole, [
                { id: 'a', input: { a: side('甲'), edge: { reason: '甲說某事；乙說另一事', reasonProblem: 'x' } }, expect: { verdict: 'keep', typeConflict: true }, why: 'w' },
            ])
            for (const p of [/缺 input\.b/, /input\.edge 不收 reasonProblem\(由評分依正式規則計算/, /expect\.typeConflict 只用於 change/]) assert.match(k, p)
            assert.match(bad(edgeReviewBenchRole, [{ id: 'a', input: { a: side('甲'), b: side('乙'), edge: { type: '前置概念', reason: '某理由說明', reasonProblem: 'x' } }, expect: { kind: 'keep' }, why: 'w' }]), /input\.edge 不收 reasonProblem/)
            assert.equal(validateBenchCases(conflictCheckBenchRole, [{ id: 'a', input: { a: side('甲'), b: side('乙'), edge: { reason: '甲說某事；乙說另一事' } }, expect: { verdict: 'unsure' }, why: 'w' }]).cases.length, 1, '衝突核對之現行型別可不給')
            const e = bad(edgeReviewBenchRole, [
                { id: 'a', input: { a: side('甲'), b: side('乙'), edge: { reason: '某理由說明' } }, expect: { kind: 'move' }, why: 'w' },
                { id: 'b', input: { a: side('甲'), b: side('乙'), edge: { type: '前置概念', reason: '某理由說明' } }, expect: { kind: 'retype' }, why: 'w' },
                { id: 'c', input: { a: side('甲'), b: side('乙'), edge: { type: '前置概念', reason: '某理由說明' } }, expect: { kind: 'keep', type: '實作範例' }, why: 'w' },
            ])
            for (const p of [/cases\[0\]\(a\) input\.edge\.type 須為非空字串/, /expect\.kind 須為 keep／reason／retype／upgrade／retire／unsure/, /cases\[1\]\(b\) expect\.type 須為非空字串/, /cases\[2\]\(c\) expect\.type 只用於 retype/]) assert.match(e, p)
        })
    })

    // ══════════════════════════ ②分頁與提示詞 ══════════════════════════
    describe('② 分頁與提示詞(與正式 domain 逐字同)', function() {

        it('正向:15 案 6／6／3(每頁 relate.notesPerCall＝6);roleOpt.batch 4 → 4／4／4／3;提示詞＝正式 buildPrompt(各案之目標, 目標 id → 候選清單)', () => {
            assert.equal(RELATE_DEFAULT.notesPerCall, 6)
            const plan = planRelateBench('relate')
            assert.deepEqual(plan.pages.map((p) => p.ids.length), [6, 6, 3])
            for (const p of plan.pages) {
                const cs = p.ids.map((id) => caseOf('relate', id))
                assert.equal(p.prompt, D.buildPrompt(cs.map((c) => c.input.target), new Map(cs.map((c) => [c.input.target.id, c.input.candidates]))))
            }
            assert.match(plan.pages[0].prompt, /^你是知識庫的關聯建立器/)
            assert.match(plan.pages[0].prompt, /--- 第6篇（待建立關聯）---/)
            const p4 = planRelateBench('relate', { roleOpt: { batch: 4 } })
            assert.deepEqual(p4.pages.map((p) => p.ids.length), [4, 4, 4, 3])
            assert.notEqual(p4.promptFp, plan.promptFp, '分頁一改指紋即不同')
            assert.match(msgOf(() => planRelateBench('relate', { roleOpt: { batch: 0 } })), /roleOpt\.batch 須為正整數/)
        })

        it('重評:15 案 10／5;提示詞＝正式 buildReevalPrompt(目標 id 未給為 t-<案 id>、一句話重點＝目標之 summary、鄰居一位與 makeEdge 之現行邊);項為頁內編號', () => {
            const plan = planRelateBench('reeval')
            assert.deepEqual(plan.pages.map((p) => p.ids.length), [10, 5])
            for (const p of plan.pages) {
                const items = p.ids.map((id) => {
                    const c = caseOf('reeval', id)
                    const target = { id: `t-${c.id}`, ...c.input.target }
                    const edge = makeEdge({ from: target.id, to: c.input.neighbor.id, type: c.input.edge.type, reason: c.input.edge.reason, nowIso: '' })
                    return { target, summary: target.summary, neighbors: [{ note: c.input.neighbor, edge }] }
                })
                assert.equal(p.prompt, D.buildReevalPrompt(items))
            }
            assert.match(plan.pages[1].prompt, /--- 第5項（內容已更新之筆記）---/)
            assert.doesNotMatch(plan.pages[1].prompt, /第6項/, '重評之項為頁內編號(同檢定標準題組之執行器)')
            assert.deepEqual(planRelateBench('reeval', { roleOpt: { batch: 4 } }).pages.map((p) => p.ids.length), [4, 4, 4, 3])
        })

        it('衝突核對:15 案 10／5,項編號跨頁連續(第 2 頁為第 11～15 項;同正式);提示詞＝正式 buildConflictCheckPrompt(兩方之筆記與材料同一物件、現行邊原樣);--batch 4 之編號亦連續', () => {
            const plan = planRelateBench('conflict-check')
            assert.deepEqual(plan.pages.map((p) => p.ids.length), [10, 5])
            let k = 0
            for (const p of plan.pages) {
                const items = p.ids.map((id) => {
                    const c = caseOf('conflict-check', id)
                    return { index: ++k, a: { note: c.input.a, extra: c.input.a }, b: { note: c.input.b, extra: c.input.b }, edge: c.input.edge }
                })
                assert.equal(p.prompt, D.buildConflictCheckPrompt(items))
            }
            assert.match(plan.pages[1].prompt, /--- 第11項 ---/)
            assert.doesNotMatch(plan.pages[1].prompt, /--- 第1項 ---/)
            assert.match(plan.pages[0].prompt, /^你是知識庫的衝突核對器/)
            const p4 = planRelateBench('conflict-check', { roleOpt: { batch: 4 } })
            assert.deepEqual(p4.pages.map((p) => p.ids.length), [4, 4, 4, 3])
            assert.match(p4.pages[3].prompt, /--- 第13項 ---[\s\S]*--- 第15項 ---/)
        })

        it('既有邊覆核:16 案 10／6,項編號跨頁連續;提示詞＝正式 buildEdgeReviewPrompt', () => {
            const plan = planRelateBench('edge-review')
            assert.deepEqual(plan.pages.map((p) => p.ids.length), [10, 6])
            let k = 0
            for (const p of plan.pages) {
                const items = p.ids.map((id) => {
                    const c = caseOf('edge-review', id)
                    return { index: ++k, a: { note: c.input.a, extra: c.input.a }, b: { note: c.input.b, extra: c.input.b }, edge: c.input.edge }
                })
                assert.equal(p.prompt, D.buildEdgeReviewPrompt(items))
            }
            assert.match(plan.pages[1].prompt, /--- 第16項 ---/)
            assert.match(plan.pages[0].prompt, /^你是知識庫的既有關聯覆核器/)
        })

        it('核對兩角色之項同正式兩段之形式(standards/edgeGate 之 pairCheckItemOf → checkPromptItemOf):現行理由須改寫才能合格者依正式規則附 reasonProblem(RS2 過短;RS8 數字不見於兩方區塊),合格者不附', () => {
            const k01 = caseOf('edge-review', 'k01')
            const c01 = caseOf('conflict-check', 'c01')
            const shortR = { ...k01, id: 'zs', input: { ...k01.input, edge: { ...k01.input.edge, reason: '兩者有關' } } }
            const er = planRelateBench('edge-review', { cases: [shortR, k01] }).pages[0].prompt
            assert.equal((er.match(/（現行理由未達標準：RS2 /g) || []).length, 1, '只有過短之案附註')
            assert.match(pairCheckItemOf(shortR.input, 1, D).edge.reasonProblem, /^RS2 /)
            assert.equal(pairCheckItemOf(k01.input, 2, D).edge.reasonProblem, undefined, '合格者不附')
            // RS8:理由之數字不見於兩方於提示詞中之區塊(題組之材料)
            const numR = { ...c01, id: 'zn', input: { ...c01.input, edge: { ...c01.input.edge, reason: '甲說觀測 37 次支持其結論；乙說同條件下結論相反' } } }
            assert.match(pairCheckItemOf(numR.input, 1, D).edge.reasonProblem, /^RS8 兩端皆無之數字：37/)
            assert.match(planRelateBench('conflict-check', { cases: [numR] }).pages[0].prompt, /（現行理由未達標準：RS8 兩端皆無之數字：37——是真衝突者須以 change/)
        })

        it('題組與詞彙不合 → 任何呼叫之前拋錯:正向之可接受型別不在清單或含衝突型;重評之現行型別不在清單;衝突核對之現行型別非衝突型;既有邊覆核之現行型別不在清單或為衝突型、應然改型為衝突型／同現行／不在封閉清單', () => {
            assert.match(msgOf(() => planRelateBench('relate', { cases: [relateCase({ expect: { must: [{ to: '候選甲-2222bbbb', types: ['不存在'] }], conflict: ['候選乙-3333cccc'], mustNot: ['候選丙-4444dddd'], allowEmpty: false } })] })),
                /正向關聯之題組與詞彙不合（1 項）：案 z 之可接受型別「不存在」不在型別清單/)
            assert.match(msgOf(() => planRelateBench('relate', { cases: [relateCase({ expect: { must: [{ to: '候選甲-2222bbbb', types: [C] }], conflict: ['候選乙-3333cccc'], mustNot: ['候選丙-4444dddd'], allowEmpty: false } })] })),
                /案 z 之 must 含衝突型「衝突或反例」/)
            const k1 = caseOf('reeval', 'k1')
            assert.match(msgOf(() => planRelateBench('reeval', { cases: [{ ...k1, input: { ...k1.input, edge: { type: '不存在', reason: '某理由' } } }] })), /重評之題組與詞彙不合（1 項）：案 k1 之現行型別「不存在」不在型別清單/)
            const c01 = caseOf('conflict-check', 'c01')
            assert.match(msgOf(() => planRelateBench('conflict-check', { cases: [{ ...c01, input: { ...c01.input, edge: { type: '互補搭配', reason: '某理由' } } }] })), /案 c01 之現行型別「互補搭配」非衝突型「衝突或反例」/)
            const k01 = caseOf('edge-review', 'k01')
            const er = (edge, expect) => msgOf(() => planRelateBench('edge-review', { cases: [{ ...k01, input: { ...k01.input, edge }, expect }] }))
            assert.match(er({ type: '不存在', reason: '某理由' }, { kind: 'keep' }), /案 k01 之現行型別「不存在」不在型別清單/)
            assert.match(er({ type: C, reason: '某理由' }, { kind: 'keep' }), /案 k01 之現行型別為衝突型/)
            assert.match(er({ type: '前置概念', reason: '某理由' }, { kind: 'retype', type: C }), /應然改為衝突型（應寫 upgrade）/)
            assert.match(er({ type: '前置概念', reason: '某理由' }, { kind: 'retype', type: '前置概念' }), /應然型別與現行相同（應寫 reason 或 keep）/)
            assert.match(er({ type: '前置概念', reason: '某理由' }, { kind: 'retype', type: '實作範例' }), /應然改型「前置概念」→「實作範例」不在型別改正之封閉清單/)
            assert.match(er({ type: '前置概念', reason: '某理由' }, { kind: 'retype', type: '不存在' }), /應然型別「不存在」不在型別清單/)
        })
    })

    // ══════════════════════════ ③逐案類別 ══════════════════════════
    describe('③ 逐案類別', function() {

        it('示範回覆 → 四角色逐案每回皆通過、合契約率 100%:應然可達;呼叫數＝頁數×回數;逐次呼叫選項同正式(acceptTruncated:true;席位只放受測模型、不遞補)', async () => {
            const stub = benchStub()
            const want = { relate: 6, reeval: 4, 'conflict-check': 4, 'edge-review': 4 }
            for (const role of RELATE_BENCH_ROLES) {
                const before = stub.calls.length
                const r = await runRelateBench(role.id, { models: ['good'], aiAdapter: stub, clock: FIXED })
                const m = r.models[0]
                assert.deepEqual(m.cases.filter((c) => !c.pass).map((c) => `${c.id}：${c.note}`), [], `${role.id} 未通過之案`)
                assert.equal(m.score.pass, SET[role.id].cases.length)
                assert.equal(m.contract.rate, 1, `${role.id} 合契約率`)
                assert.equal(stub.calls.length - before, want[role.id], `${role.id} 之呼叫數`)
                assert.equal(r.meta.promptFp, planRelateBench(role.id).promptFp, '指紋＝實際送出之提示詞')
            }
            assert.ok(stub.calls.every((c) => c.role && c.model === 'good' && c.callOpt.acceptTruncated === true && c.callOpt.spec.fallback.length === 0), '每次呼叫之提示詞皆為規劃之頁;逐次截斷放行;席位只放受測模型')
            // 正向之示範關聯確實逐條過閘(無剔除、無修正)
            const rr = await runRelateBench('relate', { models: ['good'], aiAdapter: benchStub(), clock: FIXED, runs: 1 })
            assert.ok(rr.models[0].cases.every((c) => c.runs[0].rejected === 0 && c.runs[0].fixed === 0 && c.runs[0].problems === ''), JSON.stringify(rr.models[0].cases.map((c) => [c.id, c.runs[0].rejectedWhy])))
        })

        it('逐次呼叫選項與正式呼叫一致:四角色皆為陣列輸出,逐次截斷放行(acceptTruncated:true)', () => {
            assert.deepEqual(RELATE_BENCH_ROLES.map((r) => r.callOpt), [{ acceptTruncated: true }, { acceptTruncated: true }, { acceptTruncated: true }, { acceptTruncated: true }])
        })

        it('正向:納入閘逐條過濾——slug 幻想剔除、尾碼救回納入、清單外型別剔除(不落後備型別)、理由空泛剔除、數字未紮根剔除、簡體修正後納入;有剔除即不合契約;全部剔除 → 無裁決(同正式之未涵蓋)', () => {
            const r08 = caseOf('relate', 'r08')
            const ok = relateOracleItem(r08, 1)
            const B = '時效硬化之析出機制-e4d02b78'
            const A = '同型鋁合金之最佳時效溫度-7c1e4a93'
            const v0 = judgeOne('relate', r08, [ok])
            assert.deepEqual([v0.cls, v0.valid, v0.fields.rejected, v0.fields.fixed], ['match', true, 0, 0])
            const fake = judgeOne('relate', r08, [{ index: 1, relations: [...ok.relations, { to: '不存在之筆記-abcdef01', type: '前置概念', reason: '甲以此筆記之定義推導出最佳溫度' }] }])
            assert.deepEqual([fake.cls, fake.valid, fake.fields.rejected], ['match', false, 1], 'slug 幻想剔除、其餘照收')
            assert.match(fake.fields.rejectedWhy, /slug 解析不到/)
            assert.equal(relateBenchRole.detailOf({ cls: fake.cls, ...fake.fields }), '（剔除 1 條）')
            const rescue = judgeOne('relate', r08, [{ index: 1, relations: [ok.relations[0], { ...ok.relations[1], to: '抄錯之前綴-7c1e4a93' }] }])
            assert.deepEqual([rescue.cls, rescue.valid], ['match', true], 'slug 尾碼救回')
            const offList = judgeOne('relate', r08, [{ index: 1, relations: [{ ...ok.relations[0], type: '相關' }, ok.relations[1]] }])
            assert.deepEqual([offList.cls, offList.fields.rejected], ['mismatch', 1])
            assert.match(offList.fields.rejectedWhy, /型別「相關」不在清單、亦無改名或別名對映/)
            assert.match(offList.fields.problems, /漏建「時效硬化之析出機制」/)
            const vague = judgeOne('relate', r08, [{ index: 1, relations: [{ to: B, type: '前置概念', reason: '都與某主題有關' }, ok.relations[1]] }])
            assert.match(vague.fields.rejectedWhy, /RS2 去空泛片語與標點後只剩 0 字/)
            const num = judgeOne('relate', r08, [{ index: 1, relations: [ok.relations[0], { to: A, type: C, reason: '甲說最佳為攝氏 999 度；乙說同型合金以 120 度最佳' }] }])
            assert.deepEqual([num.cls, num.fields.problems], ['mismatch', '漏判衝突「同型鋁合金之最佳時效溫度為攝氏 120 度」'])
            assert.match(num.fields.rejectedWhy, /RS8 兩端皆無之數字：999/)
            const simp = judgeOne('relate', r08, [{ index: 1, relations: [{ to: B, type: '前置概念', reason: '乙所述之析出强化机制是甲寻找最佳时效温度所依据之原理' }, ok.relations[1]] }])
            assert.deepEqual([simp.cls, simp.valid, simp.fields.fixed], ['match', true, 1], '簡體修正後納入(確定性修正不算剔除)')
            const none = judgeOne('relate', r08, [{ index: 1, relations: [{ to: '幻想之筆記-abcdef02', type: '前置概念', reason: '甲以此筆記之定義推導出最佳溫度' }] }])
            assert.deepEqual([none.cls, none.valid], [null, false])
            assert.match(none.problem, /^index 1 之項之 1 條關聯皆未過納入閘（slug 解析不到/)
        })

        it('正向:與應然比對——回空清單、漏建、型別不在可接受之列、應判衝突而未判、誤建不得選之對象 → mismatch;允許空清單之案回空陣列 → match', () => {
            const r08 = caseOf('relate', 'r08')
            const ok = relateOracleItem(r08, 1)
            const empty = judgeOne('relate', r08, [{ index: 1, relations: [] }])
            assert.deepEqual([empty.cls, empty.valid], ['mismatch', true])
            assert.equal(empty.fields.problems, '回空清單（本案不允許）；漏建「時效硬化之析出機制」；漏判衝突「同型鋁合金之最佳時效溫度為攝氏 120 度」')
            const wrongType = judgeOne('relate', r08, [{ index: 1, relations: [{ ...ok.relations[0], type: '同類方法' }, ok.relations[1]] }])
            assert.equal(wrongType.fields.problems, '「時效硬化之析出機制」之型別「同類方法」不在可接受之列（前置概念／實作範例）')
            const notConflict = judgeOne('relate', r08, [{ index: 1, relations: [ok.relations[0], { ...ok.relations[1], type: '互補搭配' }] }])
            assert.equal(notConflict.fields.problems, '「同型鋁合金之最佳時效溫度為攝氏 120 度」應判「衝突或反例」，判「互補搭配」')
            const extra = judgeOne('relate', r08, [{ index: 1, relations: [...ok.relations, { to: '鋁罐之回收流程-0a6f8c35', type: '互補搭配', reason: '兩篇皆談鋁材之加熱處理與熔融之溫度控制' }] }])
            assert.deepEqual([extra.cls, extra.fields.problems], ['mismatch', '誤建「鋁罐之回收流程」（互補搭配）'])
            assert.equal(relateBenchRole.detailOf({ cls: extra.cls, ...extra.fields }), '（誤建「鋁罐之回收流程」（互補搭配））')
            assert.match(extra.fields.edges, /鋁罐之回收流程:互補搭配/)
            const r10 = caseOf('relate', 'r10')
            assert.equal(judgeOne('relate', r10, [{ index: 1, relations: [] }]).cls, 'match', '允許空清單之案回空陣列')
            const homonym = judgeOne('relate', r10, [{ index: 1, relations: [{ to: '電腦病毒之傳播途徑-9e3b1f84', type: '同類方法', reason: '兩篇皆說明病毒之複製與傳播之途徑' }] }])
            assert.deepEqual([homonym.cls, homonym.fields.problems], ['mismatch', '誤建「電腦病毒之傳播途徑」（同類方法）'])
        })

        it('正向:同一 index 重複取第一個合格者(先全剔除者換下一項;先合格者即定,含空陣列);非陣列、缺項、index 非整數、relations 非陣列 → 無裁決;批合格判準同正式(無一項合格 → 不合)', () => {
            const r08 = caseOf('relate', 'r08')
            const ok = relateOracleItem(r08, 1)
            const junk = { index: 1, relations: [{ to: '幻想之筆記-abcdef03', type: '前置概念', reason: '甲以此筆記之定義推導出最佳溫度' }] }
            assert.equal(judgeOne('relate', r08, [junk, ok]).cls, 'match', '先全剔除者換下一項')
            assert.equal(judgeOne('relate', r08, [{ index: 1, relations: [] }, ok]).cls, 'mismatch', '先合格者(空陣列)即定')
            assert.equal(judgeOne('relate', r08, { index: 1 }).problem, '回覆非 JSON 陣列（object）')
            assert.equal(judgeOne('relate', r08, [{ index: 2, relations: [] }]).problem, '回覆無 index 1 之項')
            assert.equal(judgeOne('relate', r08, [{ index: '1', relations: [] }]).problem, '回覆無 index 1 之項', 'index 須為整數(同正式)')
            assert.equal(judgeOne('relate', r08, []).problem, '回覆為空陣列')
            assert.equal(judgeOne('relate', r08, [{ index: 1, relations: 'x' }]).problem, 'index 1 之項之 relations 非陣列')
            // 批合格判準(交調度層之 check):以第 1 頁(6 案)驗
            const pg = pageOf('relate', 0)
            const items = ORACLE.relate(pg.cases)
            const ctx = { roleOpt: {}, domain: D, base: 0 }
            assert.equal(relateBenchRole.check(items, pg.cases, ctx), true)
            assert.equal(relateBenchRole.check([junk, { index: 7, relations: [] }, { index: 2, relations: 'x' }], pg.cases, ctx), '回覆無一項合格（index 須對應頁內之案、relations 為陣列，且為空或至少一條過納入閘；同正式之批合格判準）')
            assert.equal(relateBenchRole.check([junk, { index: 3, relations: [] }], pg.cases, ctx), true, '一項合格即可(部分接受)')
            assert.match(relateBenchRole.check({ index: 1 }, pg.cases, ctx), /回覆非 JSON 陣列/)
            assert.match(relateBenchRole.check([], pg.cases, { roleOpt: {} }), /未備妥 domain/, '核心交 check 之 ctx 未帶 domain')
        })

        it('正向:合併與上限同正式逐項鏈——同一對象只取一條(衝突優先)、逾 4 條截去(衝突優先保留);benchRelateEdgesOf 之邊與計數與 buildEdges 逐項同', async () => {
            const t = note('目標筆記-1111aaaa', '目標筆記')
            const cs = ['甲', '乙', '丙', '丁', '戊', '己'].map((x, i) => note(`候選${x}-${'abcdef'[i].repeat(8)}`, `候選${x}`))
            const rel = (k, type, reason = '甲之推導以此候選所定義之量為前提而展開') => ({ to: cs[k].id, type, reason })
            const conflictReason = '甲說此量隨溫度上升；乙說同條件下此量下降'
            const variants = [
                [rel(0, '前置概念'), rel(1, '延伸深化'), rel(2, '互補搭配'), rel(3, '同類方法'), rel(4, C, conflictReason), rel(0, C, conflictReason), rel(5, '實作範例')],
                [rel(0, '前置概念'), { to: '幻想-0123abcd', type: '前置概念', reason: '甲之推導以此候選所定義之量為前提' }, rel(1, '相關'), rel(2, '互補搭配', '都與某主題有關'), rel(3, C, conflictReason)],
                [rel(0, '前置概念', '甲之推导以此候选所定义之量为前提而展开'), { ...rel(1, '延伸深化'), to: '抄錯-bbbbbbbb' }, rel(1, '互補搭配'), 'x'],
                [],
            ]
            for (const [k, relations] of variants.entries()) {
                const item = { index: 1, relations }
                const b = benchRelateEdgesOf(item, { target: t, candidates: cs, domain: D })
                const w = await viaChain(item, t, cs)
                const show = (es) => es.map((e) => `${e.to}|${e.type}|${e.reason}`)
                assert.deepEqual(show(b.edges), show(w.edges), `第 ${k + 1} 組之邊`)
                assert.deepEqual([b.rejected.length, b.fixed, b.dup.length, b.cut.length], [w.stats.edgeStdRejected || 0, w.stats.edgeStdFixed || 0, w.stats.relateDupDropped || 0, w.stats.relateCapDropped || 0], `第 ${k + 1} 組之計數`)
            }
            const v1 = benchRelateEdgesOf({ index: 1, relations: variants[0] }, { target: t, candidates: cs, domain: D })
            assert.deepEqual(v1.edges.map((e) => `${e.to.slice(0, 3)}:${e.type}`), ['候選甲:衝突或反例', '候選戊:衝突或反例', '候選乙:延伸深化', '候選丙:互補搭配'], '衝突優先保留、同一對象衝突勝出')
            assert.deepEqual([v1.dup.length, v1.cut.length], [1, 2])
            assert.equal(benchRelateEdgesOf({ index: 1, relations: [] }, { target: t, candidates: cs, domain: D }).covered, true, '空陣列＝已涵蓋')
        })

        it('重評:verdictsOf 之單評驗證——缺項、verdicts 非陣列或為空、slug 不符(尾碼救回可)、裁決值非法、change 型別不在清單或型別與理由皆同現行、理由過短、同一對象矛盾 → 無裁決;unsure 合法;同一編號取第一個結構完整之項(同正式 verdictsByIndexOf);他條之不合格裁決使不合契約', () => {
            const k1 = caseOf('reeval', 'k1')
            const nb = k1.input.neighbor.id
            const v = (verdicts, more = []) => judgeOne('reeval', k1, [{ index: 1, verdicts }, ...more])
            const keep = v([{ to: nb, verdict: 'keep', reason: '' }])
            assert.deepEqual([keep.cls, keep.valid, keep.fields.replied], ['keep', true, 'keep'])
            assert.equal(judgeOne('reeval', k1, [{ index: 2, verdicts: [] }]).problem, '回覆無 index 1 之項')
            assert.equal(judgeOne('reeval', k1, { index: 1 }).problem, '回覆非 JSON 陣列（object）')
            assert.equal(v('x').problem, 'index 1 之項之 verdicts 非陣列')
            assert.equal(v([]).problem, 'index 1 之項之 verdicts 為空')
            assert.equal(v([{ to: '幻想-abcdef04', verdict: 'keep', reason: '' }]).problem, `無指向對象 ${nb} 之裁決（slug 不符）`)
            assert.equal(v([{ to: '抄錯之前綴-8e04d7f3', verdict: 'keep', reason: '' }]).cls, 'keep', 'slug 尾碼救回')
            assert.match(v([{ to: nb, verdict: 'maybe', reason: '某說明' }]).problem, /^裁決不合格（同正式之單評驗證）：/)
            assert.equal(v([{ to: nb, verdict: 'change', type: '不存在', reason: '新內容已改變兩篇之關係之說明' }]).cls, null)
            assert.equal(v([{ to: nb, verdict: 'change', type: '前置概念', reason: k1.input.edge.reason }]).cls, 'keep', '型別與理由皆同現行＝沒有改,視同 keep(三標準同一規則;終審 D3 R63)')
            assert.equal(v([{ to: nb, verdict: 'retire', reason: '太短' }]).cls, null)
            assert.equal(v([{ to: nb, verdict: 'keep', reason: '' }, { to: nb, verdict: 'retire', reason: '新內容已換成無關之主題之說明' }]).problem, '同一對象之裁決互相矛盾（同正式規則作廢）')
            const u = v([{ to: nb, verdict: 'unsure', reason: '細節未載' }])
            assert.deepEqual([u.cls, u.valid, u.fields.reason], ['unsure', true, '細節未載'])
            assert.equal(v([{ to: nb, verdict: 'change', type: C, reason: '新內容之結論與對象相反之說明' }]).cls, 'change(衝突型)')
            const other = v([{ to: nb, verdict: 'change', type: '延伸深化', reason: '新內容改以延伸之方式使用對象之定律' }])
            assert.deepEqual([other.cls, other.fields.replied], ['change(非衝突型)', 'change→延伸深化'])
            assert.equal(judgeOne('reeval', k1, [{ index: 1, verdicts: 'x' }, { index: 1, verdicts: [{ to: nb, verdict: 'keep', reason: '' }] }]).cls, 'keep', '首項結構不完整 → 取下一個結構完整之項(同正式重評之 verdictsByIndexOf)')
            assert.equal(judgeOne('reeval', k1, [{ index: 1, verdicts: [{ to: nb, verdict: 'retire', reason: '新內容已換成無關之主題之說明' }] }, { index: 1, verdicts: [{ to: nb, verdict: 'keep', reason: '' }] }]).cls, 'retire', '兩項皆完整 → 取第一個')
            const mixed = v([{ to: nb, verdict: 'keep', reason: '' }, { to: '幻想-abcdef05', verdict: 'retire', reason: '新內容已換成無關之主題之說明' }])
            assert.deepEqual([mixed.cls, mixed.valid], ['keep', false], '他條之不合格裁決不影響該條,但不合契約')
            const own = { ...k1, input: { ...k1.input, target: { ...k1.input.target, id: '自訂目標-12345abc' } } }
            assert.equal(judgeOne('reeval', own, [{ index: 1, verdicts: [{ to: nb, verdict: 'keep', reason: '' }] }]).cls, 'keep', '目標自帶 id 者用之')
            assert.equal(judgeOne('reeval', k1, []).problem, '回覆為空陣列')
            assert.equal(judgeOne('reeval', k1, [{ index: '1', verdicts: [{ to: nb, verdict: 'keep', reason: '' }] }]).problem, '回覆無 index 1 之項', 'index 須為整數(同檢定標準題組之執行器與正式重評)')
        })

        it('衝突核對:票之驗證同正式——unsure 合法;理由過短、型別不在清單、同編號矛盾 → 缺票;同編號重複而相同 → 照收;衝突型而理由同現行 → keep;編號須為整數;編號限本頁、跨頁連續', () => {
            const c01 = caseOf('conflict-check', 'c01')
            const v = (data) => judgeOne('conflict-check', c01, data)
            assert.deepEqual([v([{ index: 1, verdict: 'keep', reason: '' }]).cls, v([{ index: 1, verdict: 'keep', reason: '' }]).valid], ['keep', true])
            const u = v([{ index: 1, verdict: 'unsure', reason: '材料不足' }])
            assert.deepEqual([u.cls, u.valid, u.fields.reason], ['unsure', true, '材料不足'])
            assert.match(v([{ index: 1, verdict: 'retire', reason: '太短' }]).problem, /^index 1 之裁決不合格（同正式之單票驗證，缺票）/)
            assert.equal(v([{ index: 1, verdict: 'change', type: '不存在', reason: '兩篇可同時成立之說明文字' }]).cls, null)
            assert.equal(v([{ index: 1, verdict: 'keep', reason: '' }, { index: 1, verdict: 'retire', reason: '兩篇只有名稱相同之說明' }]).problem, '同編號 1 之裁決互相矛盾（同正式規則作廢為缺票）')
            assert.equal(v([{ index: 1, verdict: 'keep', reason: '' }, { index: 1, verdict: 'keep', reason: '另一說法' }]).cls, 'keep')
            const same = v([{ index: 1, verdict: 'change', type: C, reason: c01.input.edge.reason }])
            assert.deepEqual([same.cls, same.fields.replied], ['keep', 'change→衝突或反例'], '衝突型而理由同現行視同 keep(回覆欄記原樣)')
            assert.equal(v([{ index: 1, verdict: 'KEEP', reason: '' }]).cls, 'keep', '裁決值之寬鬆寫法同正式單票驗證')
            assert.equal(v([{ index: '1', verdict: 'KEEP', reason: '' }]).problem, '回覆無 index 1 之裁決', '編號須為整數(同正式;字串編號不認)')
            assert.equal(v([{ index: 2, verdict: 'keep', reason: '' }]).problem, '回覆無 index 1 之裁決')
            assert.equal(v({ index: 1 }).problem, '回覆非 JSON 陣列（object）')
            assert.equal(v([{ index: 1, verdict: 'change', type: '互補搭配', reason: '兩篇可同時成立之說明文字' }]).cls, 'change(非衝突型)')
            // 第 2 頁(第 11～15 項):以全域編號作答(核心之 at.seq)
            const pg = pageOf('conflict-check', 1)
            const at = { index: 1, seq: pg.base + 1, domain: D, cases: pg.cases, roleOpt: {} }
            assert.equal(pg.base, 10)
            assert.throws(() => conflictCheckBenchRole.verdictOf([{ index: 11, verdict: 'keep', reason: '' }], pg.cases[0], { index: 1, domain: D, cases: pg.cases, roleOpt: {} }), /未帶項編號 seq/)
            assert.equal(conflictCheckBenchRole.verdictOf([{ index: 11, verdict: 'keep', reason: '' }], pg.cases[0], at).cls, 'keep')
            assert.equal(conflictCheckBenchRole.verdictOf([{ index: 1, verdict: 'keep', reason: '' }], pg.cases[0], at).problem, '回覆無 index 11 之裁決')
            // 交調度層之 check:至少一項帶整數 index(同正式)
            assert.equal(conflictCheckBenchRole.check([{ index: 3 }]), true)
            assert.match(conflictCheckBenchRole.check([{ index: '3' }]), /回覆無帶整數 index 之項/)
            assert.equal(reevalBenchRole.check([{ index: 1, verdicts: [] }]), true)
            assert.match(reevalBenchRole.check([{ index: 1, verdicts: 'x' }]), /同正式之單評 check/)
        })

        it('既有邊覆核:處置之研判同檢定標準題組之執行器——keep、同型改理由、封閉清單內之改型、不屬封閉清單之改型視為改理由(標記)、升為衝突、撤銷、unsure;同型同理由之 change 視同 keep;缺票與編號之邊界同衝突核對', () => {
            const t01 = caseOf('edge-review', 't01')
            const k01 = caseOf('edge-review', 'k01')
            const reason = '點出甲乙各自之具體內容之改寫理由'
            const v = (c, vote) => judgeOne('edge-review', c, [{ index: 1, ...vote }])
            assert.equal(v(t01, { verdict: 'change', type: '實作範例', reason }).cls, 'retype:實作範例')
            const norm = v(t01, { verdict: 'change', type: '互補搭配', reason })
            assert.deepEqual([norm.cls, norm.fields.normalized, norm.fields.replied], ['reason', '是', 'change→互補搭配'])
            assert.equal(edgeReviewBenchRole.detailOf({ cls: norm.cls, ...norm.fields }), '（回覆「change→互補搭配」不在型別改正之封閉清單，視為同型改理由）')
            assert.equal(v(k01, { verdict: 'change', type: '實作範例', reason }).cls, 'reason', '前置概念不屬可改正之型別(同類／互補)')
            assert.equal(v(k01, { verdict: 'change', type: k01.input.edge.type, reason }).cls, 'reason')
            assert.equal(v(k01, { verdict: 'change', type: k01.input.edge.type, reason: k01.input.edge.reason }).cls, 'keep')
            assert.equal(v(k01, { verdict: 'change', type: C, reason: '甲說此條件下成立；乙說同一條件下結論相反' }).cls, 'upgrade')
            assert.equal(v(k01, { verdict: 'keep', reason: '' }).cls, 'keep')
            assert.equal(v(k01, { verdict: 'retire', reason: '兩篇只有字面相同而無共同之機制' }).cls, 'retire')
            assert.equal(v(k01, { verdict: 'unsure', reason: '' }).cls, 'unsure')
            assert.equal(v(k01, { verdict: 'retire', reason: '太短' }).cls, null)
            // 與衝突核對對稱之邊界:非陣列、空陣列、缺項、編號字串、同編號矛盾或相同、型別不在清單、跨頁編號
            const w = (data) => judgeOne('edge-review', k01, data)
            assert.equal(w({ index: 1 }).problem, '回覆非 JSON 陣列（object）')
            assert.equal(w([]).problem, '回覆為空陣列')
            assert.equal(w([{ index: 2, verdict: 'keep', reason: '' }]).problem, '回覆無 index 1 之裁決')
            assert.equal(w([{ index: 1, verdict: 'Keep', reason: '' }]).cls, 'keep')
            assert.equal(w([{ index: '1', verdict: 'Keep', reason: '' }]).problem, '回覆無 index 1 之裁決', '編號須為整數(同正式)')
            assert.equal(w([{ index: 1, verdict: 'keep', reason: '' }, { index: 1, verdict: 'retire', reason: '兩篇只有字面相同而無共同之機制' }]).problem, '同編號 1 之裁決互相矛盾（同正式規則作廢為缺票）')
            assert.equal(w([{ index: 1, verdict: 'keep', reason: '' }, { index: 1, verdict: 'keep', reason: '另一說法' }]).cls, 'keep')
            assert.match(w([{ index: 1, verdict: 'change', type: '不存在', reason }]).problem, /^index 1 之裁決不合格（同正式之單票驗證，缺票）/)
            const pg = pageOf('edge-review', 1)
            assert.equal(pg.base, 10)
            const at = { index: 1, seq: pg.base + 1, domain: D, cases: pg.cases, roleOpt: {} }
            assert.equal(edgeReviewBenchRole.verdictOf([{ index: 11, ...reviewOracleVote(pg.cases[0], 11) }], pg.cases[0], at).cls, edgeReviewBenchRole.expectOf(pg.cases[0]))
            assert.equal(edgeReviewBenchRole.verdictOf([{ index: 1, verdict: 'keep', reason: '' }], pg.cases[0], at).problem, '回覆無 index 11 之裁決')
        })

        it('既有邊覆核之處置與正式判定同一規則:各類合法票之類別＝兩席(不同供應者)皆投此票時 rs6DecisionOf 之處置(retype 附型別);rs6VoteActionOf 之不確定 → undetermined、缺票 → retry', () => {
            const reason = '點出甲乙各自之具體內容之改寫理由'
            for (const c of [caseOf('edge-review', 't01'), caseOf('edge-review', 'k01')]) {
                const o = { relationTypes: D.relationTypes, resolveType: D.resolveType, conflictType: C, roles: D.relationTypeRoles, current: c.input.edge }
                const raws = [
                    { verdict: 'keep', reason: '' },
                    { verdict: 'change', type: c.input.edge.type, reason },
                    { verdict: 'change', type: c.input.edge.type, reason: c.input.edge.reason },
                    { verdict: 'change', type: '實作範例', reason },
                    { verdict: 'change', type: '延伸深化', reason },
                    { verdict: 'change', type: '互補搭配', reason },
                    { verdict: 'change', type: C, reason: '甲說此條件下成立；乙說同一條件下結論相反' },
                    { verdict: 'retire', reason: '兩篇只有字面相同而無共同之機制' },
                ]
                for (const raw of raws) {
                    const vote = reviewVerdictOf(raw, o)
                    const d = rs6DecisionOf([{ seat: 'first', provider: 'a', verdict: vote }, { seat: 'second', provider: 'b', verdict: vote }], { conflictType: C, current: c.input.edge, relationTypes: D.relationTypes })
                    const want = d.action === 'retype' ? `retype:${d.type}` : d.action
                    assert.equal(judgeOne('edge-review', c, [{ index: 1, ...raw }]).cls, want, `${c.id} ${JSON.stringify(raw)}`)
                    assert.deepEqual(rs6VoteActionOf(vote, { conflictType: C, current: c.input.edge, relationTypes: D.relationTypes }), { action: d.action, type: d.type })
                }
            }
            const cur = { type: '同類方法', reason: '兩者皆以同一指標排序候選' }
            assert.deepEqual(rs6VoteActionOf('unsure', { conflictType: C, current: cur }), { action: 'undetermined', type: '' })
            assert.deepEqual(rs6VoteActionOf(null, { conflictType: C, current: cur }), { action: 'retry', type: '' })
            // 現行型別已不在清單:keep 於型別層視同不確定 → type-split(評分之頁檢核已拒此類案;此處驗單票處置之定義與正式同)
            assert.equal(rs6VoteActionOf({ verdict: 'keep', reason: '' }, { conflictType: C, current: { type: '舊型別', reason: 'x' }, relationTypes: D.relationTypes }).action, 'type-split')
        })

        it('錯誤回覆經 runRelateBench:判錯之案逐回列原因、他案照常;同一模型兩回不一致不通過;呼叫失敗及於整頁', async () => {
            let k = 0
            const flip = (cases, base) => cases.map((c, i) => (c.id === 'c05' ? { index: base + i + 1, verdict: k++ % 2 === 0 ? 'keep' : 'retire', reason: '兩篇只有名稱相同而無共同之機制' } : checkOracleVote(c, base + i + 1)))
            const r = await runRelateBench('conflict-check', { models: ['m'], aiAdapter: benchStub({ reply: { 'conflict-check': flip } }), clock: FIXED })
            const m = r.models[0]
            assert.equal(m.score.pass, 14)
            const c05 = m.cases.find((c) => c.id === 'c05')
            assert.deepEqual([c05.pass, c05.consistent], [false, false])
            assert.match(c05.note, /^第 1 回判 keep（兩篇只有名稱相同而無共同之機制），應然 retire；各回不一致$/)
            // 整頁不合批合格判準 → 該頁各案呼叫失敗(回覆不合),不計入連續失敗
            const bad = await runRelateBench('relate', { models: ['m'], aiAdapter: benchStub({ reply: { relate: (cases) => cases.map((c, i) => ({ index: i + 1, relations: 'x' })) } }), clock: FIXED, runs: 1 })
            assert.deepEqual([bad.models[0].score.pass, bad.models[0].calls.failed, bad.models[0].calls.byKind.reply, bad.models[0].stopped], [0, 3, 3, ''])
            assert.match(bad.models[0].cases[0].note, /呼叫失敗（回覆非 JSON：.*回覆無一項合格/)
        })
    })

    // ══════════════════════════ ④詞彙注入與命令列 ══════════════════════════
    describe('④ 詞彙注入與命令列', function() {

        it('opt.vocab:提示詞隨詞彙改變(kbLabel 進首句)且指紋不同;詞彙不合 → 任何呼叫之前拋錯;換掉型別清單而題組之型別不在清單 → 拋錯;domain 注入(直給、或 vocab＋domainOf)', () => {
            const vocab = { kbLabel: '天文學知識庫' }
            const heads = { relate: '你是天文學知識庫的關聯建立器', reeval: '你是天文學知識庫的關聯覆核器', 'conflict-check': '你是天文學知識庫的衝突核對器', 'edge-review': '你是天文學知識庫的既有關聯覆核器' }
            for (const role of RELATE_BENCH_ROLES) {
                const p = planRelateBench(role.id, { vocab })
                assert.ok(p.pages.every((x) => x.prompt.startsWith(heads[role.id])), role.id)
                assert.notEqual(p.promptFp, planRelateBench(role.id).promptFp, `${role.id} 指紋`)
            }
            assert.match(msgOf(() => planRelateBench('relate', { vocab: { categories: ['觀測'] } })), /runRelateBench\(relate\) 之 vocab 不合：vocab 含不認得之鍵：categories/)
            const types = { relationTypes: ['相關', '衝突'], conflictType: '衝突', fallbackType: '相關' }
            assert.match(msgOf(() => planRelateBench('relate', { vocab: types })), /正向關聯之題組與詞彙不合（\d+ 項）：案 r01 之可接受型別「前置概念、實作範例」不在型別清單/)
            assert.match(msgOf(() => planRelateBench('reeval', { vocab: types })), /重評之題組與詞彙不合/)
            assert.match(msgOf(() => planRelateBench('conflict-check', { vocab: types })), /衝突核對之題組與詞彙不合.*非衝突型「衝突」/)
            assert.match(msgOf(() => planRelateBench('edge-review', { vocab: types })), /既有邊覆核之題組與詞彙不合/)
            // 程式端可注入同一工廠之產物(覆寫提示詞者):domain 直給(正式之提示詞覆寫 opt.prompts,或整組置換之 domain);或 vocab＋domainOf
            //   (核心:domainOf 只用於 vocab 與案自帶之詞彙)
            const prompts = { relate: (targets, map, ctx) => `${ctx.defaultPrompt(targets, map)}\n（附註）`, edgeReview: (items, ctx) => `${ctx.defaultPrompt(items)}\n（附註）` }
            assert.ok(planRelateBench('relate', { domain: createRelateDomain({ prompts }) }).pages.every((x) => x.prompt.endsWith('（附註）')), '正式之提示詞覆寫')
            assert.ok(planRelateBench('edge-review', { domain: createRelateDomain({ prompts }) }).pages.every((x) => x.prompt.endsWith('（附註）')))
            const wrapped = { ...D, buildPrompt: (t, m) => `${D.buildPrompt(t, m)}\n（附註）` }
            assert.ok(planRelateBench('relate', { domain: wrapped }).pages.every((x) => x.prompt.endsWith('（附註）')), '整組置換之 domain')
            const viaOf = planRelateBench('conflict-check', { vocab, domainOf: (v) => createRelateDomain({ vocab: v, prompts: { conflictCheck: (items, ctx) => `${ctx.defaultPrompt(items)}\n（附註）` } }) })
            assert.ok(viaOf.pages.every((x) => x.prompt.startsWith(heads['conflict-check']) && x.prompt.endsWith('（附註）')))
            assert.match(msgOf(() => planRelateBench('relate', { domain: { buildPrompt: () => 'x' } })), /runRelateBench\(relate\) 之 domain 須具 buildPrompt、seenTextOf、resolveType（缺 seenTextOf、resolveType）/)
            assert.match(msgOf(() => planRelateBench('edge-review', { domain: { ...D, relationTypeRoles: null } })), /之 domain 之 relationTypeRoles 須為物件/)
        })

        it('--role 解析:預設 all(依序四角色);--role x／--role=x;缺值、重複、不認得 → 拋;all 配 --cases 或 --batch → 拋;--help 不驗;用法說明列出四角色與其參數', () => {
            const a = parseRelateBenchArgs([])
            assert.deepEqual([a.role, a.roles.map((r) => r.id), a.rest, a.help], ['all', ROLE_IDS, [], false])
            assert.deepEqual(parseRelateBenchArgs(['--runs', '1', '--role', 'reeval']).rest, ['--runs', '1'])
            assert.equal(parseRelateBenchArgs(['--role=edge-review']).roles[0], edgeReviewBenchRole)
            assert.equal(relateBenchRoleOf('conflict-check'), conflictCheckBenchRole)
            assert.match(msgOf(() => parseRelateBenchArgs(['--role'])), /^--role 缺值$/)
            assert.match(msgOf(() => parseRelateBenchArgs(['--role', '--runs', '1'])), /^--role 缺值$/)
            assert.match(msgOf(() => parseRelateBenchArgs(['--role', 'reeval', '--role=relate'])), /^--role 重複給定$/)
            assert.match(msgOf(() => parseRelateBenchArgs(['--role', 'conflictCheck'])), /不認得之評分角色：conflictCheck（可用：relate、reeval、conflict-check、edge-review、all）/)
            assert.match(msgOf(() => parseRelateBenchArgs(['--cases', 'x.json'])), /--role all 不可給 --cases/)
            assert.match(msgOf(() => parseRelateBenchArgs(['--role', 'all', '--batch', '5'])), /--role all 不可給角色專屬參數 --batch/)
            assert.equal(parseRelateBenchArgs(['--role', 'nope', '-h']).help, true)
            for (const r of RELATE_BENCH_ROLES) assert.ok(RELATE_BENCH_USAGE.includes(`【${r.name}】`) && RELATE_BENCH_USAGE.includes(`node src/bench/cli.mjs --role ${r.id}`), r.id)
            assert.match(RELATE_BENCH_USAGE, /^用法：node src\/bench\/cli\.mjs \[--role <relate\|reeval\|conflict-check\|edge-review\|all>\]/)
            assert.match(RELATE_BENCH_USAGE, /--batch <n>/)
        })

        it('命令列單一角色:--vocab 詞彙檔進提示詞;--batch 改變分頁;報表與進度檔以角色 id 為檔名主幹;--help 印用法', async () => {
            const vf = path.join(TMP, 'vocab.json')
            const vocab = { kbLabel: '天文學知識庫' }
            fs.writeFileSync(vf, JSON.stringify(vocab), 'utf8')
            const out = path.join(TMP, 'cli-single')
            const log = plainLog()
            const stub = benchStub({ plan: { 'conflict-check': { vocab } } })
            const res = await runRelateBenchCli(['--role', 'conflict-check', '--models', 'm', '--vocab', vf, '--runs', '1', '--out', out], { aiAdapter: stub, log })
            assert.deepEqual([res.role, res.runs.map((x) => x.role)], ['conflict-check', ['conflict-check']])
            assert.ok(stub.calls.length === 2 && stub.calls.every((c) => c.role === 'conflict-check' && c.prompt.startsWith('你是天文學知識庫的衝突核對器')), '詞彙檔之稱呼進入提示詞')
            assert.equal(res.runs[0].result.models[0].score.pass, 15)
            const stamp = res.runs[0].result.meta.stamp
            assert.deepEqual(Object.values(res.runs[0].report.files).map((f) => path.basename(f)), [`conflict-check-bench-${stamp}-models.csv`, `conflict-check-bench-${stamp}-cases.csv`, `conflict-check-bench-${stamp}.md`, `conflict-check-bench-${stamp}.json`])
            assert.equal(path.basename(res.runs[0].progressFile), `conflict-check-bench-${stamp}.progress.jsonl`)
            assert.ok(log.lines.some((l) => l.startsWith('衝突核對 AI 能力評分：1 個模型 × 15 案 × 1 回（題組 RS4 v1')))
            const st2 = benchStub()
            await runRelateBenchCli(['--role', 'relate', '--batch', '5', '--models', 'm', '--runs', '1', '--out', out], { aiAdapter: st2, log: plainLog() })
            assert.equal(st2.calls.length, 3, '--batch 5 → 15 案 3 頁')
            const hl = plainLog()
            assert.deepEqual(await runRelateBenchCli(['--help'], { log: hl }), { help: true })
            assert.equal(hl.lines[0], RELATE_BENCH_USAGE)
        })

        it('--role all:四角色依序執行,逐角色報表;評比表(--board)四角色之列並存且同一表頭;再跑單一角色只覆蓋該角色之列', async () => {
            const out = path.join(TMP, 'cli-all')
            const board = path.join(TMP, 'board', '模型評比.csv')
            const log = plainLog()
            const stub = benchStub()
            const res = await runRelateBenchCli(['--role', 'all', '--models', 'good', '--runs', '1', '--out', out, '--board', board], { aiAdapter: stub, log })
            assert.deepEqual(res.runs.map((x) => x.role), ROLE_IDS)
            assert.deepEqual([...new Set(stub.calls.map((c) => c.role))], ROLE_IDS, '依序執行')
            assert.ok(log.lines.some((l) => l === '── 角色 1/4：正向關聯(relate) ──') && log.lines.some((l) => l === '── 角色 4/4：既有邊覆核(edge-review) ──'))
            for (const run of res.runs) for (const f of Object.values(run.report.files)) assert.ok(fs.statSync(f).size > 0, f)
            const rows = () => parseCsv(fs.readFileSync(board, 'utf8'))
            assert.equal(rows()[0].join(','), BENCH_BOARD_HEADER.join(','))
            assert.deepEqual(rows().slice(1).map((r) => [r[0], r[1], r[2], r[3]]).sort(), RELATE_BENCH_ROLES.map((r) => [r.name, 'good', String(SET[r.id].cases.length), String(SET[r.id].cases.length)]).sort())
            const before = Object.fromEntries(rows().slice(1).map((r) => [r[0], r.join(',')]))
            // 再跑單一角色(正向回空一案):只覆蓋正向之列,他角色之列原樣
            const wrong = (cases) => cases.map((c, i) => (c.id === 'r01' ? { index: i + 1, relations: [] } : relateOracleItem(c, i + 1)))
            await runRelateBenchCli(['--role', 'relate', '--models', 'good', '--runs', '1', '--out', out, '--board', board], { aiAdapter: benchStub({ reply: { relate: wrong } }), log: plainLog() })
            const after = rows().slice(1)
            assert.equal(after.length, 4)
            const rel = after.find((r) => r[0] === relateBenchRole.name)
            assert.deepEqual([rel[2], rel[10]], ['14', 'r01'])
            for (const r of after.filter((x) => x[0] !== relateBenchRole.name)) assert.equal(r.join(','), before[r[0]])
        })

        it('--role all:前面角色已停測之模型(限流)不再於後續角色受測(--models 兩種寫法皆換);受測模型皆已停測即略過其餘角色', async () => {
            const out = path.join(TMP, 'cli-stop')
            const LIMIT = 'FreeUsageLimitError: Rate limit exceeded'
            const stub = benchStub({ fail: { limited: LIMIT } })
            const log = plainLog()
            const res = await runRelateBenchCli(['--models=good,limited', '--runs', '1', '--out', out], { aiAdapter: stub, log })
            assert.deepEqual(res.runs.map((x) => x.role), ROLE_IDS)
            assert.deepEqual([res.stopped, res.skipped], [['limited'], []])
            assert.match(res.runs[0].result.models.find((m) => m.model === 'limited').stopped, /^額度用盡或限流，停測/)
            assert.equal(stub.calls.filter((c) => c.model === 'limited').length, 1, '限流後不再呼叫')
            assert.deepEqual(res.runs.map((x) => x.result.models.map((m) => m.model)), [['good', 'limited'], ['good'], ['good'], ['good']])
            assert.ok(res.runs.every((x) => x.result.models[0].score.pass === x.result.models[0].score.total), '他模型照跑')
            assert.ok(log.lines.some((l) => l === '── 角色 2/4：重評(reeval)（已停測不再受測：limited） ──'))
            const both = benchStub({ fail: { a: LIMIT, b: LIMIT } })
            const lg = plainLog()
            const res2 = await runRelateBenchCli(['--models', 'a,b', '--runs', '1', '--out', out], { aiAdapter: both, log: lg })
            assert.deepEqual([res2.runs.map((x) => x.role), res2.skipped], [['relate'], ['reeval', 'conflict-check', 'edge-review']])
            assert.equal(both.calls.length, 2)
            assert.ok(lg.lines.some((l) => /^── 其餘角色（reeval、conflict-check、edge-review）略過：受測模型皆已停測（a、b）──$/.test(l)))
        })

        it('--role all 之準備期:後面角色之錯誤(詞彙使題組之型別不在清單、詞彙檔不存在或非物件、參數不合)於任何呼叫與寫檔之前拋出', async () => {
            const vf = path.join(TMP, 'vocab-types.json')
            fs.writeFileSync(vf, JSON.stringify({ relationTypes: ['相關', '衝突'], conflictType: '衝突', fallbackType: '相關' }), 'utf8')
            const out = path.join(TMP, 'cli-pre')
            const stub = benchStub()
            await assert.rejects(runRelateBenchCli(['--models', 'm', '--vocab', vf, '--out', out], { aiAdapter: stub, log: plainLog() }), /正向關聯之題組與詞彙不合/)
            // 單一後段角色之錯誤亦於呼叫之前
            const kv = path.join(TMP, 'vocab-kb.json')
            fs.writeFileSync(kv, JSON.stringify({ relationTypes: ['前置概念', '延伸深化', '互補搭配', '衝突', '實作範例', '同類方法', '共用資料或指標'], conflictType: '衝突', fallbackType: '互補搭配' }), 'utf8')
            await assert.rejects(runRelateBenchCli(['--models', 'm', '--vocab', kv, '--out', out], { aiAdapter: stub, log: plainLog() }), /題組與詞彙不合/)
            await assert.rejects(runRelateBenchCli(['--models', 'm', '--vocab', path.join(TMP, 'none.json'), '--out', out], { aiAdapter: stub, log: plainLog() }), /--vocab 指定之詞彙檔不存在/)
            fs.writeFileSync(path.join(TMP, 'v-arr.json'), '[1]', 'utf8')
            await assert.rejects(runRelateBenchCli(['--models', 'm', '--vocab', path.join(TMP, 'v-arr.json'), '--out', out], { aiAdapter: stub, log: plainLog() }), /--vocab 詞彙檔須為 JSON 物件/)
            await assert.rejects(runRelateBenchCli(['--models', 'm', '--runs', '0', '--out', out], { aiAdapter: stub, log: plainLog() }), /--runs 須為正整數/)
            assert.equal(stub.calls.length, 0, '不燒任何呼叫')
            assert.ok(!fs.existsSync(out), '不建輸出目錄')
        })

        it('--vocab-pick:多段共用之詞彙表(含他段之鍵)→ 取本套件之鍵、子集檔寫入 --out 並以之評分;未給 --vocab-pick 者 → 準備期拋錯(不呼叫、不建目錄);--vocab-pick 帶值、重複或未配 --vocab → 拋', async () => {
            const vf = path.join(TMP, 'vocab-shared.json')
            fs.writeFileSync(vf, JSON.stringify({ kbLabel: '天文學知識庫', categories: ['觀測', '其他'], guide: { summarize: { target: '觀測紀錄' }, relate: { vagueReason: '都屬於天文學' } } }), 'utf8')
            const out = path.join(TMP, 'cli-pick')
            const st0 = benchStub()
            await assert.rejects(runRelateBenchCli(['--role', 'reeval', '--models', 'm', '--vocab', vf, '--runs', '1', '--out', out], { aiAdapter: st0, log: plainLog() }), /vocab 不合/)
            assert.deepEqual([st0.calls.length, fs.existsSync(out)], [0, false], '他段之鍵:不加 --vocab-pick 即拒收')
            const log = plainLog()
            const stub = benchStub()
            const res = await runRelateBenchCli(['--role', 'reeval', '--vocab-pick', '--models', 'm', '--vocab', vf, '--runs', '1', '--out', out], { aiAdapter: stub, log })
            assert.deepEqual(res.runs.map((x) => x.role), ['reeval'])
            assert.ok(stub.calls.length === 2 && stub.calls.every((c) => c.prompt.startsWith('你是天文學知識庫的關聯覆核器') && c.prompt.includes('不可只寫「都屬於天文學」')), '子集之稱呼與 guide.relate 進入提示詞')
            const picked = fs.readdirSync(out).filter((f) => /^relate-vocab-.+\.json$/.test(f))
            assert.equal(picked.length, 1)
            assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, picked[0]), 'utf8')), { kbLabel: '天文學知識庫', guide: { relate: { vagueReason: '都屬於天文學' } } }, '子集只含本套件之鍵(guide 只留 relate 段)')
            assert.ok(log.lines.some((l) => l.startsWith(`--vocab-pick：自 ${vf} 取本套件之鍵（kbLabel、guide）→ `)))
            assert.ok(log.lines.some((l) => l.includes(`，詞彙 ${path.join(out, picked[0])}）`)), '報表記之詞彙檔即子集檔')
            assert.match(msgOf(() => parseRelateBenchArgs(['--vocab-pick=1', '--vocab', vf])), /^--vocab-pick 不帶值/)
            assert.match(msgOf(() => parseRelateBenchArgs(['--vocab-pick', '--vocab-pick', '--vocab', vf])), /^--vocab-pick 重複給定$/)
            assert.match(msgOf(() => parseRelateBenchArgs(['--role', 'reeval', '--vocab-pick'])), /^--vocab-pick 須配 --vocab/)
            assert.deepEqual([parseRelateBenchArgs(['--vocab-pick', `--vocab=${vf}`]).pick, parseRelateBenchArgs([]).pick], [true, false])
        })

        it('受測名單:預設席位(relate.ai 之 use 與 fallback)在前,其餘為核心之免費名單(去重);cli.mjs 為薄殼(被 import 時不執行,轉出同一個 runRelateBenchCli);套件根之 模型評比.csv 表頭同核心之評比表', () => {
            const seat = [RELATE_DEFAULT.ai.use, ...RELATE_DEFAULT.ai.fallback]
            assert.deepEqual(RELATE_BENCH_MODELS.slice(0, seat.length), seat)
            assert.deepEqual([...RELATE_BENCH_MODELS].sort(), [...new Set([...seat, ...DEFAULT_FREE_MODELS])].sort())
            for (const r of RELATE_BENCH_ROLES) assert.deepEqual(r.models, RELATE_BENCH_MODELS)
            assert.equal(cli.runRelateBenchCli, runRelateBenchCli)
            assert.equal(cli.default, runRelateBenchCli)
            // 另起行程只 import(不直接執行):無輸出、離開碼 0——被 import 時不跑命令列
            const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(path.join(PKG, 'src', 'bench', 'cli.mjs')).href)})`], { encoding: 'utf8' })
            assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''])
            // 評比表:--board 併入時表頭須同核心(不同即拒寫);已寫入之列之角色皆為本套件之角色
            const text = fs.readFileSync(path.join(PKG, '模型評比.csv'), 'utf8')
            assert.equal(text.charCodeAt(0), 0xFEFF, '含 BOM(試算表軟體以之判 UTF-8)')
            const [head, ...rest] = parseCsv(text)
            assert.equal(head.join(','), BENCH_BOARD_HEADER.join(','))
            const names = RELATE_BENCH_ROLES.map((x) => x.name)
            assert.ok(rest.every((row) => names.includes(row[0])), JSON.stringify(rest.map((row) => row[0])))
        })

        it('印出之命令列用法與題組路徑為套件佈局下實際可用之路徑(node src/bench/cli.mjs、src/bench/cases/…):各角色 cli.command 之腳本與 cli.casesHelp 之題組於套件根存在;直接執行 --help 之首行、各角色用法行、題組路徑與失敗時之錯誤訊息皆指向同一佈局', () => {
            // 規則:套件原始碼在 src/,命令列為 src/bench/cli.mjs、內建題組為 src/bench/cases/<角色 id>-generic.json;用法字串不得仍印佈局改動前之 node bench/cli.mjs 與 bench/cases/(該路徑於套件根不存在)
            for (const r of RELATE_BENCH_ROLES) {
                const m = r.cli.command.match(/^node (\S+\.mjs) --role (\S+)$/)
                assert.ok(m, `${r.id} 之 command 形狀:${r.cli.command}`)
                assert.deepEqual([m[1], m[2]], ['src/bench/cli.mjs', r.id])
                assert.ok(fs.existsSync(path.join(PKG, m[1])), `${r.id} 之 command 所指腳本須存在:${m[1]}`)
                const c = r.cli.casesHelp.match(/\((src\/bench\/cases\/\S+\.json)\)$/)
                assert.ok(c, `${r.id} 之 casesHelp 須以(src/bench/cases/…json)結尾:${r.cli.casesHelp}`)
                assert.equal(c[1], `src/bench/cases/${r.id}-generic.json`)
                assert.ok(fs.existsSync(path.join(PKG, c[1])), `${r.id} 之 casesHelp 所指題組須存在:${c[1]}`)
            }
            const cwd = path.join(TMP, 'cli-spawn')
            fs.mkdirSync(cwd, { recursive: true })
            const run = (args) => spawnSync(process.execPath, [path.join(PKG, 'src', 'bench', 'cli.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 60_000 })
            const help = run(['--help'])
            assert.equal(help.status, 0)
            assert.ok(help.stdout.startsWith('用法：node src/bench/cli.mjs [--role <relate|reeval|conflict-check|edge-review|all>]'), `--help 首行須為 node src/bench/cli.mjs:${help.stdout.split('\n')[0]}`)
            for (const r of RELATE_BENCH_ROLES) {
                assert.ok(help.stdout.includes(`node src/bench/cli.mjs --role ${r.id}`), `--help 須印 ${r.id} 之用法`)
                assert.ok(help.stdout.includes(`(src/bench/cases/${r.id}-generic.json)`), `--help 須印 ${r.id} 之內建題組路徑`)
            }
            assert.ok(!/node bench\/cli\.mjs/.test(help.stdout), '--help 之首行與各角色用法不得仍印 node bench/cli.mjs')
            assert.ok(!/[(\s]bench\/cases\//.test(help.stdout), '--help 之題組路徑不得仍印 bench/cases/(缺 src/)')
            const bad = run(['--role', 'nope'])
            assert.equal(bad.status, 1)
            assert.ok(bad.stderr.includes('關聯 AI 能力評分失敗：不認得之評分角色：nope'), bad.stderr)
            assert.ok(bad.stderr.includes('（用法：node src/bench/cli.mjs --help）'), bad.stderr)
        })
    })

    // ══════════════════════════ ⑤領域中立 ══════════════════════════
    describe('⑤ 領域中立', function() {
        // 量化／金融類之詞彙(詞表與命中函數取抓取套件之 test/tools/domainTerms,經 test/tools/captureForTest;四套件同一份)與網址(bench/ 之全部檔——
        //   題組與評分原始碼——皆不得含;走訪而不手列,新增之檔自動納入;bench/ 以外之原始碼在 unit-relate-package ③)
        const hits = (text) => [...domainTermsIn(text), ...(/https?:\/\//i.test(text) ? ['網址'] : [])]
        const SRC = path.join(PKG, 'src') // 以下相對路徑皆相對 src/
        const FILES = fs.readdirSync(path.join(SRC, 'bench'), { recursive: true }).map((f) => path.join(SRC, 'bench', f)).filter((f) => fs.statSync(f).isFile())

        it('詞表自檢:領域詞與網址被抓到;中立詞不誤傷', () => {
            assert.deepEqual(hits('量化交易之股票回測、樣本外與 Alpha，見 https://x'), ['量化', '交易', '股票', '回測', '樣本外', 'alpha', '網址'])
            assert.deepEqual(hits('天文學知識庫：克卜勒定律、快速排序、HTTP 快取、震央距離、藍綠藻'), [])
        })

        it('bench/ 之全部檔(四份通用題組與評分原始碼;含註解)不含量化／金融詞與網址', () => {
            const rel = FILES.map((f) => path.relative(SRC, f).replace(/\\/g, '/'))
            assert.ok(['bench/relateBench.mjs', 'bench/cli.mjs', ...Object.values(RELATE_BENCH_CASES_FILES).map((f) => path.relative(SRC, f).replace(/\\/g, '/'))].every((f) => rel.includes(f)), `走訪須含題組與評分原始碼:${rel.join('、')}`)
            const bad = FILES.map((f) => [path.relative(SRC, f).replace(/\\/g, '/'), hits(fs.readFileSync(f, 'utf8'))]).filter(([, h]) => h.length)
            assert.deepEqual(bad, [])
        })
    })
})
