// unit-settings.test.mjs — 關聯之設定(core/relateSettings):預設值、逐鍵覆寫、設定錯誤一律拋錯(訊息含完整路徑與可用鍵)、免費席位、
//   關聯總覽標題、容量推導與容量自洽警告、判定小組之組成與同家警告、席位表、實例互不汙染
// 規則(出自 relateSettings 之設計):
//   ①兩段 ai(摘要套件之 ai 段,同一物件)、relate;另 relationIndexTitle;合併與型別規則取抓取套件之 mergeSettingsGroup／SETTING_TYPES,
//     本段專屬之型別(reevalApply、dateOrEmpty)經其 opt.types 帶入;ai 段給 providerPick 即拋(關聯恆以席位呼叫 AI)
//   ②組逐鍵遞迴合併、葉給了即整個取代;不認得之鍵、型別或值域不符、組形狀錯一律拋錯,絕不靜默改用預設
//   ③預設席位全為免費模型(opencode 匿名存取);反向段沿用關聯席位(null);判定小組預設全空且關閉;符合度掃描預設關閉
//   ④容量:關聯＝relate.rounds×ai.parallel×relate.notesPerCall;進料上界由組裝者給(inflow),只警告「進料 > 容量」
//   ⑤已開啟之判定小組,其任一投票組合之兩席首選同家且無不同家之第三席 → 警告永遠無法成立(重評 RS5;衝突核對／既有邊覆核 RS4／RS6,
//     含衝突核對之提案席)
//   ⑥席位表與 null 之選填席位不列;判定小組之組成之單一來源(relatePanelsOf)
//   ⑦各實例拿到之設定互不共用預設常數之參照
// 執行:自套件根 node <mocha> test/unit-settings.test.mjs(純函數,不連網、不寫檔)

import assert from 'node:assert/strict'
import providers from 'w-dispatch-ai/src/providers.mjs'
import {
    RELATE_AI_DEFAULT, RELATE_AI_SCHEMA, RELATE_DEFAULT, RELATE_SCHEMA, RELATE_SETTING_TYPES, RELATE_INDEX_TITLE,
    resolveRelateSettings, relateCapacityOf, RELATE_CAPACITY_DESC, callTimeoutMsOf, relateWarningsOf, relatePanelsOf, RELATE_SEAT_LABELS, relateSeatsOf,
    RELATE_FEATURES, relateFeatureProblems,
} from '../src/core/relateSettings.mjs'
import { SUMMARIZE_AI_DEFAULT, SUMMARIZE_AI_SCHEMA } from '../src/core/summarizePackage.mjs'
import { SETTING_TYPES, showSettingValue, msgOf } from './tools/captureForTest.mjs'

const RS = (cfg) => resolveRelateSettings(cfg)

/** 全部型別判準:抓取套件之共用表＋本段專屬者(同 mergeSettingsGroup 之合併) */
const TYPES = { ...SETTING_TYPES, ...RELATE_SETTING_TYPES }

/**
 * 序列化供比對:函數以原始碼、RegExp 以樣式與旗標表示,undefined 亦保留
 *
 * @param {*} v 輸入任意值
 * @returns {String} 回傳序列化字串
 */
const snap = (v) => JSON.stringify(v, (k, x) => {
    if (typeof x === 'function') return `fn:${x.toString()}`
    if (x instanceof RegExp) return `re:${x.source}/${x.flags}`
    return x === undefined ? '__undefined__' : x
})

/**
 * schema 之全部葉:路徑、型別、預設值
 *
 * @param {Object} schema 輸入 schema(鍵 → 型別名或子組 schema)
 * @param {Object} dflt 輸入同形之預設值
 * @param {Array} [prefix=[]] 輸入路徑前綴
 * @returns {Array} 回傳 [{ path:Array, type:String, dflt:* }]
 */
function leavesOf(schema, dflt, prefix = []) {
    const out = []
    for (const [k, node] of Object.entries(schema)) {
        if (typeof node === 'string') out.push({ path: [...prefix, k], type: node, dflt: dflt?.[k] })
        else out.push(...leavesOf(node, dflt?.[k], [...prefix, k]))
    }
    return out
}

/**
 * schema 之全部組(含根):路徑與其 schema、預設值
 *
 * @param {Object} schema 輸入 schema
 * @param {Object} dflt 輸入同形之預設值
 * @param {Array} [prefix=[]] 輸入路徑前綴
 * @returns {Array} 回傳 [{ path:Array, schema:Object, dflt:Object }]
 */
function groupsOf(schema, dflt, prefix = []) {
    const out = [{ path: prefix, schema, dflt }]
    for (const [k, node] of Object.entries(schema)) {
        if (typeof node !== 'string') out.push(...groupsOf(node, dflt?.[k], [...prefix, k]))
    }
    return out
}

/** 由路徑與值組出巢狀覆寫物件 */
const nest = (p, value) => p.reduceRight((acc, k) => ({ [k]: acc }), value)
/** 依路徑取值 */
const getAt = (obj, p) => p.reduce((o, k) => o?.[k], obj)
/** 設定值之顯示字串:合併規則之錯誤訊息所用之同一函數(抓取套件之 showSettingValue,經測試專用之橋接) */
const show = showSettingValue

// 各型別之邊界樣本(合格樣本須通過型別判準、不合格樣本須不通過——判準取抓取套件與本段之型別表,樣本先經其篩過再用;各型別須至少各留一個)
const SAMPLES = {
    pint: { valid: [7, 8], invalid: [0, -1, 1.5, '5', NaN, null, Infinity] },
    p0int: { valid: [7, 8], invalid: [-1, 1.5, '5', NaN, null] },
    bool: { valid: [true, false], invalid: ['true', 1, 0, null] },
    objArr: { valid: [[{ id: 'x' }], [{ a: 1 }, { b: 2 }]], invalid: [{}, [1], ['x'], 'x', null] },
    timeouts: { valid: [{ 'x:y': 1000 }], invalid: [{ a: 0 }, { a: 1.5 }, { a: '5' }, [], 'x', null] },
    pools: { valid: [{ oc: { log: 'auto' } }, { oc: { log: 'auto', resetUtcHour: 0 } }], invalid: ['x', [], null, 1, { xx: {} }, { oc: { resetUtcHour: 24 } }] },
    limits: { valid: [{ 'x:y': 30000 }, { a: 1 }], invalid: [{ a: 0 }, { a: 1.5 }, { a: '5' }, [], 'x', null] },
    seat: {
        valid: [{ use: 'x:y' }, { use: 'x:y', fallback: ['a:b'], timeoutMs: 1 }],
        invalid: ['x', {}, { use: '' }, { use: 'a', typo: 1 }, { use: 'a', fallback: 'b' }, { use: 'a', fallback: [1] }, { use: 'a', timeoutMs: 0 }, null],
    },
    seatOrNull: {
        valid: [{ use: 'x:y' }, null, { use: 'x:y', fallback: ['a:b'], budgetMs: 1 }],
        invalid: ['x', {}, { use: '' }, { use: 'a', typo: 1 }, { use: 'a', fallback: 'b' }, { use: 'a', timeoutMs: 0 }, 0, false],
    },
    reevalApply: { valid: [false, 'additive', 'all'], invalid: [true, 'none', 'ALL', 0, null, ''] },
    dateOrEmpty: { valid: ['', '2026-12-31', '2026-12-31T23:59:59+08:00'], invalid: ['年底', '2026-13-45', '2026/12/31', '2026-12-31 23:59', 20261231, null] },
}

/**
 * 某型別之樣本(經型別判準篩過)
 *
 * @param {String} type 輸入型別名
 * @returns {Object} 回傳 { valid:Array, invalid:Array }
 */
function samplesOf(type) {
    const t = TYPES[type]
    const s = SAMPLES[type]
    assert.ok(t, `型別「${type}」須在抓取套件之 SETTING_TYPES 或 RELATE_SETTING_TYPES`)
    assert.ok(s, `型別「${type}」缺邊界樣本(新增型別須補 SAMPLES)`)
    return { valid: s.valid.filter((v) => t.test(v)), invalid: s.invalid.filter((v) => !t.test(v)) }
}

const SECTIONS = [
    ['ai', RELATE_AI_SCHEMA, RELATE_AI_DEFAULT],
    ['relate', RELATE_SCHEMA, RELATE_DEFAULT],
]
const LEAVES = SECTIONS.flatMap(([name, schema, dflt]) => leavesOf(schema, dflt, [name]))
const GROUPS = SECTIONS.flatMap(([name, schema, dflt]) => groupsOf(schema, dflt, [name]))
const FREE = ['oc:opencode/mimo-v2.6-flash-free', 'oc:opencode/big-pickle']

describe('unit-settings', function() {

    describe('① 預設值', function() {

        it('回傳 ai、relate、relationIndexTitle、capacity、warnings;未給 cfg、給 {}、給非物件皆同;預設設定無警告', () => {
            const s = RS({})
            assert.deepEqual(Object.keys(s), ['ai', 'relate', 'relationIndexTitle', 'capacity', 'warnings'])
            assert.equal(snap(RS()), snap(s))
            assert.equal(snap(RS('x')), snap(s))
            assert.equal(snap(RS(null)), snap(s))
            assert.deepEqual(s.warnings, [])
        })

        it('預設與 schema 之鍵集逐組一致,且每個預設值本身通過所屬型別之判準;relate 段共 30 個葉(29＋產出鏈之 graphProduced 開關)', () => {
            for (const g of GROUPS) assert.deepEqual(Object.keys(g.dflt).sort(), Object.keys(g.schema).sort(), `${g.path.join('.')}:預設鍵集應等於 schema 鍵集`)
            for (const l of LEAVES) {
                assert.ok(TYPES[l.type], `${l.path.join('.')}:型別「${l.type}」須在型別表`)
                assert.ok(TYPES[l.type].test(l.dflt), `${l.path.join('.')} 之預設值須合型別「${l.type}」`)
            }
            assert.equal(leavesOf(RELATE_SCHEMA, RELATE_DEFAULT).length, 30)
        })

        it('ai 段＝摘要套件之 ai 段(同一物件,不另寫);本段專屬之型別只有 reevalApply、dateOrEmpty(不加進共用之型別表)', () => {
            assert.equal(RELATE_AI_DEFAULT, SUMMARIZE_AI_DEFAULT)
            assert.equal(RELATE_AI_SCHEMA, SUMMARIZE_AI_SCHEMA)
            assert.equal(RS({}).ai.parallel, 3)
            assert.deepEqual(Object.keys(RELATE_SETTING_TYPES), ['reevalApply', 'dateOrEmpty'])
            assert.ok(Object.isFrozen(RELATE_SETTING_TYPES))
            for (const k of Object.keys(RELATE_SETTING_TYPES)) assert.equal(k in SETTING_TYPES, false, `${k} 不在共用之型別表`)
        })

        it('relate 段之數值預設(30 葉);符合度掃描預設關閉;graph.json 帶產出鏈摘要之開關預設關', () => {
            const s = RS({}).relate
            assert.equal(s.graphProduced, false)
            assert.deepEqual([s.rounds, s.notesPerCall, s.candidatesPerNote], [2, 6, 25])
            assert.deepEqual(s.reverse, { perRun: 0, ai: null })
            assert.deepEqual(s.rotation, { perRun: 0 })
            assert.deepEqual(s.reeval, { perRun: 0, pagesPerRun: 24, pageSize: 10, apply: false, maxTries: 3, guard: 20, ai: { first: null, second: null, third: null } })
            assert.deepEqual(s.standards, {
                conflictCheck: { enabled: false, perRun: 0, pageSize: 10, maxTries: 3 },
                edgeReview: { enabled: false, perRun: 0, pageSize: 10, maxTries: 3, deadline: '' },
                ai: { first: null, second: null, third: null },
                scanEachRun: false,
            })
        })

        it('免費 AI 為主:關聯之預設席位全為 opencode 匿名免費條目(w-dispatch-ai 內建目錄,免金鑰),有遞補;反向沿用(null);判定小組關閉且空席', () => {
            const s = RS({}).relate
            const ids = [s.ai.use, ...s.ai.fallback]
            assert.deepEqual(ids, FREE)
            const catalogue = new Map(providers.map((p) => [p.id, p]))
            for (const id of ids) {
                assert.ok(id.startsWith('oc:opencode/'), id)
                const e = catalogue.get(id)
                assert.ok(e, `預設席位 ${id} 須在 w-dispatch-ai 內建目錄`)
                assert.deepEqual([e.kind, e.useStoredAuth, e.envVar], ['opencode', false, undefined], `預設席位 ${id} 須為匿名免金鑰之免費存取`)
            }
            assert.equal(s.reverse.ai, null)
            assert.deepEqual([s.reeval.perRun, s.standards.conflictCheck.enabled, s.standards.edgeReview.enabled], [0, false, false])
            assert.ok([...Object.values(s.reeval.ai), ...Object.values(s.standards.ai)].every((x) => x === null))
            assert.deepEqual(Object.keys(relateSeatsOf(RS({}))), ['relate.ai'], '預設只有關聯席位一席')
        })

        it('關聯總覽之標題:未給為 RELATE_INDEX_TITLE;明給之非空字串照用;空字串、空白、非字串、null → 拋錯', () => {
            assert.equal(RELATE_INDEX_TITLE, '知識關聯總覽')
            assert.equal(RS({}).relationIndexTitle, RELATE_INDEX_TITLE)
            assert.equal(RS({ relationIndexTitle: '天文關聯總覽' }).relationIndexTitle, '天文關聯總覽')
            for (const bad of ['', '  ', 5, null, ['x'], {}]) {
                assert.match(msgOf(() => RS({ relationIndexTitle: bad })), /^settings\.relationIndexTitle 須為非空字串（關聯總覽之標題），收到 /, JSON.stringify(bad))
            }
        })
    })

    describe('② 逐鍵覆寫與型別錯誤(兩段 × 全部葉)', function() {

        for (const [name, schema, dflt] of SECTIONS) {
            it(`${name}:每個葉逐一覆寫 → 該葉取給定值,其餘全部葉維持預設`, () => {
                const base = RS({})
                for (const leaf of leavesOf(schema, dflt, [name])) {
                    const sample = samplesOf(leaf.type).valid.find((v) => snap(v) !== snap(leaf.dflt))
                    assert.notEqual(sample, undefined, `${leaf.path.join('.')}:找不到與預設不同之合格樣本`)
                    const r = RS(nest(leaf.path, sample))
                    assert.equal(snap(getAt(r, leaf.path)), snap(sample), `${leaf.path.join('.')} 應取給定值`)
                    for (const other of LEAVES) {
                        if (other.path.join('.') !== leaf.path.join('.')) assert.equal(snap(getAt(r, other.path)), snap(getAt(base, other.path)), `${other.path.join('.')} 不應受 ${leaf.path.join('.')} 影響`)
                    }
                }
            })

            it(`${name}:每個葉給不合格值 → 拋錯,訊息含完整路徑、型別說明與收到之值`, () => {
                for (const leaf of leavesOf(schema, dflt, [name])) {
                    const { invalid } = samplesOf(leaf.type)
                    assert.ok(invalid.length, `${leaf.path.join('.')}:缺不合格樣本`)
                    for (const bad of invalid) {
                        const m = msgOf(() => RS(nest(leaf.path, bad)))
                        const prefix = `settings.${leaf.path.join('.')} 須為${TYPES[leaf.type].desc}，收到 ${show(bad)}`
                        assert.ok(m && m.startsWith(prefix), `${leaf.path.join('.')}=${snap(bad)}:${m}`)
                    }
                }
            })
        }

        it('各段給了但非物件 → 拋(訊息含路徑);組之形狀錯亦拋;undefined／null 之組視為未給', () => {
            assert.equal(msgOf(() => RS({ relate: [1, 2] })), 'settings.relate 須為物件，收到 array')
            assert.equal(msgOf(() => RS({ relate: 'x' })), 'settings.relate 須為物件，收到 "x"')
            assert.equal(msgOf(() => RS({ ai: 'xyz' })), 'settings.ai 須為物件，收到 "xyz"')
            assert.equal(msgOf(() => RS({ relate: { standards: 'on' } })), 'settings.relate.standards 須為物件，收到 "on"')
            assert.equal(msgOf(() => RS({ relate: { reeval: { ai: [] } } })), 'settings.relate.reeval.ai 須為物件，收到 array')
            assert.equal(snap(RS({ ai: null, relate: null })), snap(RS({})))
            assert.equal(snap(RS({ relate: { reverse: null, standards: undefined } }).relate), snap(RS({}).relate))
        })

        it('不認得之鍵 → 拋並列該組之可用鍵(每一組皆然;舊名與他段之鍵亦拒)', () => {
            for (const g of GROUPS) {
                const where = g.path.join('.')
                assert.equal(msgOf(() => RS(nest(g.path, { zz: 1 }))), `settings.${where} 含不認得之鍵：zz（可用：${Object.keys(g.schema).join('、')}）`, where)
            }
            assert.match(msgOf(() => RS({ relate: { reeval: { bogus: 1 } } })), /^settings\.relate\.reeval 含不認得之鍵：bogus（可用：/)
            assert.equal(msgOf(() => RS({ relate: { reeval: { ai: { executor: { use: 'x:y' } } } } })), 'settings.relate.reeval.ai 含不認得之鍵：executor（可用：first、second、third）', '判定小組之席名為 first／second／third')
            assert.match(msgOf(() => RS({ relate: { parallel: 3 } })), /^settings\.relate 含不認得之鍵：parallel/, 'parallel 在 ai 段')
        })

        it('只收 ai、relate、relationIndexTitle:他段(打錯之段名、他工作之段、總組裝之鍵;值為 undefined 者亦檢)→ 拋並列可用之段(總組裝只交原給之段)', () => {
            assert.equal(msgOf(() => RS({ relat: { rounds: 1 } })), 'settings 含不認得之鍵：relat（可用：ai、relate、relationIndexTitle）')
            assert.equal(msgOf(() => RS({ summarize: {}, workDir: 'x' })), 'settings 含不認得之鍵：summarize、workDir（可用：ai、relate、relationIndexTitle）')
            assert.equal(msgOf(() => RS({ extract: undefined })), 'settings 含不認得之鍵：extract（可用：ai、relate、relationIndexTitle）', '值為 undefined 之段亦檢')
            assert.equal(snap(RS({ ai: undefined, relate: undefined, relationIndexTitle: undefined })), snap(RS({})))
        })

        it('ai 段不收 providerPick(關聯恆以席位呼叫 AI)', () => {
            assert.equal(msgOf(() => RS({ ai: { providerPick: ['claude:sonnet'] } })), `settings.ai 含不認得之鍵：providerPick（可用：${Object.keys(RELATE_AI_SCHEMA).join('、')}）`)
        })

        it('席位放在用到它的那一組;葉給了即整個取代(不與預設之 fallback 合併);選填席位 null＝沿用;席位之鍵與數值依抓取套件之席位型別驗', () => {
            const seat = { use: 'oc:opencode/mimo-v2.6-flash-free', fallback: ['claude:sonnet'] }
            assert.deepEqual(RS({ relate: { ai: { use: 'claude:sonnet' } } }).relate.ai, { use: 'claude:sonnet' }, '未給 fallback 即無遞補')
            assert.deepEqual(RS({ relate: { reverse: { ai: seat } } }).relate.reverse, { perRun: 0, ai: seat })
            assert.deepEqual(RS({ relate: { reeval: { ai: { first: seat } } } }).relate.reeval.ai, { first: seat, second: null, third: null })
            assert.match(msgOf(() => RS({ relate: { reverse: { ai: 'muse' } } })), /^settings\.relate\.reverse\.ai 須為席位物件/)
            assert.match(msgOf(() => RS({ relate: { ai: { use: 'x:y', typo: 1 } } })), /^settings\.relate\.ai 須為席位物件 .*含不認得之鍵：typo/)
            assert.match(msgOf(() => RS({ relate: { standards: { ai: { second: 'x' } } } })), /^settings\.relate\.standards\.ai\.second 須為席位物件 .* 或 null/)
        })

        it('cfg 子組為有效物件 → 逐鍵遞迴合併(只給想調的鍵,同組與兄弟組其餘沿用預設)', () => {
            const s = RS({ relate: { reeval: { perRun: 5 } } })
            assert.equal(s.relate.reeval.perRun, 5)
            assert.equal(s.relate.reeval.pageSize, RELATE_DEFAULT.reeval.pageSize)
            assert.deepEqual(s.relate.reeval.ai, RELATE_DEFAULT.reeval.ai)
            assert.deepEqual(s.relate.standards, RS({}).relate.standards)
            assert.deepEqual([s.relate.rounds, s.relate.ai], [RELATE_DEFAULT.rounds, RELATE_DEFAULT.ai])
        })

        it('完成期限(relate.standards.edgeReview.deadline):預設 \'\';ISO 日期(含時刻)合法;非 ISO 日期或不可解析之日期 → 啟動期拋錯', () => {
            assert.equal(RS({}).relate.standards.edgeReview.deadline, '')
            assert.equal(RS({ relate: { standards: { edgeReview: { deadline: '2026-12-31' } } } }).relate.standards.edgeReview.deadline, '2026-12-31')
            assert.equal(RS({ relate: { standards: { edgeReview: { deadline: '2026-12-31T23:59:59+08:00' } } } }).relate.standards.edgeReview.deadline, '2026-12-31T23:59:59+08:00')
            assert.throws(() => RS({ relate: { standards: { edgeReview: { deadline: '年底' } } } }), /settings\.relate\.standards\.edgeReview\.deadline 須為''（不設）或 ISO 日期字串/)
            assert.throws(() => RS({ relate: { standards: { edgeReview: { deadline: '明年' } } } }), /settings\.relate\.standards\.edgeReview\.deadline 須為''（不設）或 ISO 日期字串/)
            assert.throws(() => RS({ relate: { standards: { edgeReview: { deadline: '2026-13-45' } } } }), /settings\.relate\.standards\.edgeReview\.deadline/)
        })

        it('重評之套用閘門(relate.reeval.apply):false｜\'additive\'｜\'all\';其餘 → 拋錯', () => {
            for (const v of [false, 'additive', 'all']) assert.equal(RS({ relate: { reeval: { apply: v } } }).relate.reeval.apply, v)
            assert.equal(msgOf(() => RS({ relate: { reeval: { apply: true } } })), "settings.relate.reeval.apply 須為false｜'additive'｜'all'，收到 true")
        })
    })

    describe('③ 容量推導', function() {

        it('預設:關聯 2×3×6＝36;relateCapacityOf 為唯一推導;推導式說明為常數', () => {
            const s = RS({})
            assert.deepEqual(s.capacity, { relate: 36 })
            assert.deepEqual(relateCapacityOf(s), s.capacity)
            assert.deepEqual(RELATE_CAPACITY_DESC, { relate: 'relate.rounds×ai.parallel×relate.notesPerCall' })
            assert.ok(Object.isFrozen(RELATE_CAPACITY_DESC))
        })

        it('公式:ai.parallel 參與;rounds 0 → 容量 0', () => {
            assert.equal(RS({ ai: { parallel: 2 }, relate: { rounds: 5, notesPerCall: 4 } }).capacity.relate, 40)
            assert.equal(RS({ relate: { rounds: 0 } }).capacity.relate, 0)
        })

        it('開工門檻 callTimeoutMsOf(各段同一函數):各席首選家之單次逾時取最大者——ai.providerTimeouts[首選] → ai.timeoutMs → 300000;席位自帶之 timeoutMs 不讀(取值序與既有門檻同);非物件之席位略過', () => {
            const s = RS({ ai: { timeoutMs: 120000, providerTimeouts: { 'x:slow': 600000 } } })
            assert.equal(callTimeoutMsOf(s, { use: 'x:fast' }), 120000, '未列逐家逾時 → ai.timeoutMs')
            assert.equal(callTimeoutMsOf(s, { use: 'x:slow' }), 600000, '逐家逾時優先')
            assert.equal(callTimeoutMsOf(s, [{ use: 'x:fast' }, { use: 'x:slow' }, null]), 600000, '多席取最大;null 略過')
            assert.equal(callTimeoutMsOf(s, { use: 'x:fast', timeoutMs: 999 }), 120000, '席位之 timeoutMs 不入開工門檻')
            assert.equal(callTimeoutMsOf(RS({}), { use: 'x:y' }), 300000, '預設 ai.timeoutMs')
            assert.equal(callTimeoutMsOf({ ai: {} }, []), 300000, '無席位、無設定 → 300000')
            assert.equal(callTimeoutMsOf(s, []), 120000, '無席位 → ai.timeoutMs')
        })
    })

    describe('④ 容量自洽警告(進料上界由組裝者給;只警告進料 > 容量;訊息逐字)', function() {
        const W = (max, desc, cap) => `筆記進料上界約 ${max} 篇（${desc}）大於關聯容量 ${cap}（relate.rounds×ai.parallel×relate.notesPerCall）：新筆記串不進知識網而堆積；調高 relate.rounds 或降低進料`

        it('進料上界 > 容量 → 警告;等於 → 不警告;未給進料 → 不判', () => {
            const s = RS({})
            assert.deepEqual(relateWarningsOf(s, { inflow: { max: 37, desc: '上游容量 74×產出率 0.5' } }), [W(37, '上游容量 74×產出率 0.5', 36)])
            assert.deepEqual(relateWarningsOf(s, { inflow: { max: 36, desc: '上游' } }), [])
            assert.deepEqual(relateWarningsOf(s, { inflow: { max: 0, desc: '上游' } }), [])
            assert.deepEqual([relateWarningsOf(s), relateWarningsOf(s, {}), relateWarningsOf(s, null), relateWarningsOf(s, { inflow: null })], [[], [], [], []])
            assert.deepEqual(relateWarningsOf(RS({ relate: { rounds: 1 } }), { inflow: { max: 37, desc: 'x' } }), [W(37, 'x', 18)])
        })

        it('進料上界之形狀錯 → 拋錯(組裝者之依賴不靜默略過)', () => {
            const s = RS({})
            for (const bad of [{ max: -1, desc: 'x' }, { max: '40', desc: 'x' }, { max: NaN, desc: 'x' }, { max: 40 }, { max: 40, desc: '' }, 'x', 40]) {
                assert.match(msgOf(() => relateWarningsOf(s, { inflow: bad })), /^relateWarningsOf 之 opt\.inflow 須為 \{ max: 非負數/, JSON.stringify(bad))
            }
        })

        it('resolveRelateSettings 之 warnings＝relateWarningsOf(不給進料)之結果;他總組裝之同形設定(ai 段可另有本套件不收之鍵)取同一組警告', () => {
            const a = { use: 'x:a' }
            const s = RS({ relate: { reeval: { perRun: 2, ai: { first: a, second: a } } } })
            assert.deepEqual(relateWarningsOf(s), s.warnings)
            assert.deepEqual(relateWarningsOf({ ...s, ai: { ...s.ai, providerPick: ['x:a'] } }), s.warnings, 'ai 段多出之鍵不影響')
        })
    })

    describe('⑤ 判定小組之組成與同家警告(已開啟之小組;訊息逐字)', function() {
        const W = (name, path, la, lb, use) => `${name}（${path}）：${la} 與 ${lb} 之首選同為「${use}」且無首選不同之第三席（third）——兩票為同一供應者，判定小組永遠無法成立（只會逐輪重試、逾次轉使用者）；請改其一席之 use，或設首選不同之 third`
        const RS5 = (la, lb, use) => W('關聯重評', 'relate.reeval.ai', la, lb, use)
        const RS46 = (la, lb, use) => W('衝突核對／既有邊覆核', 'relate.standards.ai', la, lb, use)
        const L1 = 'first（未設即 relate.ai）'
        const L2 = 'second（未設即 first）'

        it('relatePanelsOf:兩組(重評 RS5、衝突核對／既有邊覆核 RS4／RS6)之開啟、成員(重評 first 未設即 relate.ai、second 未設即 first)、必填與投票組合', () => {
            const seat = (n) => ({ use: `x:${n}` })
            const off = relatePanelsOf(RS({}))
            assert.deepEqual(off.map((g) => [g.std, g.path, g.name, g.on]), [['RS5', 'relate.reeval.ai', '關聯重評', false], ['RS4／RS6', 'relate.standards.ai', '衝突核對／既有邊覆核', false]])
            assert.deepEqual(off.map((g) => g.members.map((m) => [m.label, m.required])), [
                [[L1, true], [L2, true], ['third', false]],
                [['first', true], ['second', true], ['third', false], ['提案席 relate.ai', false]],
            ])
            const fwd = RS({}).relate.ai
            assert.deepEqual([off[0].members[0].seat, off[0].members[1].seat, off[0].members[2].seat], [fwd, fwd, null], '重評之席位未設:first 沿用關聯席位、second 以 first 再評')
            assert.deepEqual([off[1].members.slice(0, 3).map((m) => m.seat), off[1].members[3].seat], [[null, null, null], fwd])
            assert.deepEqual(off.map((g) => g.ballots), [[[0, 1, 2]], [[0, 1, 2], [3, 0, 2]]], '兩者皆未開啟:列出提案之組合(開啟前之提示用)')
            // 反向段之席位有設 → 第二個提案席與其投票組合;只開既有邊覆核 → 不列提案之組合(既有邊覆核無提案席之票)
            const on = relatePanelsOf(RS({ relate: { reverse: { ai: seat('r') }, reeval: { perRun: 1, ai: { first: seat('f'), third: seat('t') } }, standards: { conflictCheck: { enabled: true }, ai: { first: seat('c1'), second: seat('c2') } } } }))
            assert.deepEqual(on.map((g) => [g.on, g.members.map((m) => m.seat?.use ?? null)]), [[true, ['x:f', 'x:f', 'x:t']], [true, ['x:c1', 'x:c2', null, fwd.use, 'x:r']]])
            assert.deepEqual(on[1].members.map((m) => m.label).slice(3), ['提案席 relate.ai', '提案席 relate.reverse.ai'])
            assert.deepEqual(on[1].ballots, [[0, 1, 2], [3, 0, 2], [4, 0, 2]])
            assert.deepEqual(relatePanelsOf(RS({ relate: { standards: { edgeReview: { enabled: true } } } }))[1].ballots, [[0, 1, 2]])
            assert.deepEqual(relatePanelsOf(RS({ relate: { standards: { edgeReview: { enabled: true }, conflictCheck: { enabled: true } } } }))[1].ballots, [[0, 1, 2], [3, 0, 2]])
            assert.deepEqual(relatePanelsOf({}), [], '無 relate 段 → 空')
        })

        it('relatePanelsOf:RS4／RS6 之 first／second 之必填由已開啟之功能推導(功能表 RELATE_FEATURES)——只開衝突核對 → second 非必填(新衝突以提案席為另一票);開既有邊覆核 → 兩席必填;皆未開 → 兩席必填(開啟前之提示)', () => {
            const req = (relate) => relatePanelsOf(RS({ relate }))[1].members.slice(0, 3).map((m) => m.required)
            assert.deepEqual(req({ standards: { conflictCheck: { enabled: true } } }), [true, false, false])
            assert.deepEqual(req({ standards: { edgeReview: { enabled: true } } }), [true, true, false])
            assert.deepEqual(req({ standards: { conflictCheck: { enabled: true }, edgeReview: { enabled: true } } }), [true, true, false])
            assert.deepEqual(req({}), [true, true, false])
            assert.deepEqual(relatePanelsOf(RS({ relate: { reeval: { perRun: 1 } } })).map((g) => g.on), [true, false], '重評之開啟只看 reeval.perRun')
        })

        it('RELATE_FEATURES:功能表(重評、衝突核對、既有邊覆核;凍結);relateFeatureProblems 為其單一判定(席位在前、成員在後;同一小組之功能一句列出需要所缺之席之開啟者;未開之功能不檢;o.enabled 覆寫設定之開關)', () => {
            assert.deepEqual(RELATE_FEATURES.map((f) => [f.key, f.panel.path, f.panel.seats, f.members]), [
                ['reeval', 'relate.reeval.ai', [], ['buildReevalPrompt']],
                ['conflictCheck', 'relate.standards.ai', ['first'], ['buildConflictCheckPrompt']],
                ['edgeReview', 'relate.standards.ai', ['first', 'second'], ['buildEdgeReviewPrompt']],
            ])
            assert.ok(Object.isFrozen(RELATE_FEATURES) && RELATE_FEATURES.every((f) => Object.isFrozen(f)))
            assert.deepEqual(relateFeatureProblems(RS({}), {}), [], '皆未開 → 無問題')
            const on = RS({ relate: { reeval: { perRun: 1 }, standards: { conflictCheck: { enabled: true }, edgeReview: { enabled: true } } } })
            assert.deepEqual(relateFeatureProblems(on, {}), [
                '衝突核對(relate.standards.conflictCheck.enabled)、既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但缺席位 settings.relate.standards.ai.first、settings.relate.standards.ai.second',
                '關聯重評(relate.reeval.perRun > 0)已啟用,但 domain 缺 buildReevalPrompt',
                '衝突核對(relate.standards.conflictCheck.enabled)已啟用,但 domain 缺 buildConflictCheckPrompt',
                '既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但 domain 缺 buildEdgeReviewPrompt',
            ])
            assert.deepEqual(relateFeatureProblems(on, { buildConflictCheckPrompt: () => '' }, { enabled: ['conflictCheck'] }), ['衝突核對(relate.standards.conflictCheck.enabled)已啟用,但缺席位 settings.relate.standards.ai.first'], '各段之選項覆寫:只檢所給之功能')
            assert.deepEqual(relateFeatureProblems(RS({ relate: { reeval: { perRun: 1 } } }), { buildReevalPrompt: () => '' }), [], '重評無必填席(兩席皆有沿用之值)')
        })

        it('重評(RS5):開啟而兩席首選同家(含 second 未設而沿用 first)且無不同家之第三席 → 警告;第三席不同家、兩席不同家、未開啟 → 不警告', () => {
            const a = { use: 'x:a', fallback: ['x:b'] }
            const fwd = RS({}).relate.ai.use
            assert.deepEqual(RS({ relate: { reeval: { perRun: 1 } } }).warnings, [RS5(L1, L2, fwd)], '兩席皆未設 → 同一家(永不成立)')
            assert.deepEqual(RS({ relate: { reeval: { perRun: 1, ai: { first: a, second: { use: 'x:a', fallback: ['x:c'] } } } } }).warnings, [RS5(L1, L2, 'x:a')], '遞補不同仍以首選判同家')
            assert.deepEqual(RS({ relate: { reeval: { perRun: 1, ai: { first: a, second: a, third: { use: 'x:a' } } } } }).warnings, [RS5(L1, L2, 'x:a')])
            assert.deepEqual(RS({ relate: { reeval: { perRun: 1, ai: { first: a, third: { use: 'x:c' } } } } }).warnings, [])
            assert.deepEqual(RS({ relate: { reeval: { perRun: 1, ai: { second: { use: 'x:b' } } } } }).warnings, [])
            assert.deepEqual(RS({ relate: { reeval: { perRun: 0, ai: { first: a, second: a } } } }).warnings, [], '未開啟不判')
        })

        it('衝突核對／既有邊覆核(RS4／RS6):既有邊之兩席同家、衝突核對之提案席(relate.ai／relate.reverse.ai)與 first 同家且無不同家之第三席 → 警告;只開既有邊覆核時不判提案席;缺席不判', () => {
            const a = { use: 'x:a' }
            const fwd = RS({}).relate.ai.use
            assert.deepEqual(RS({ relate: { standards: { edgeReview: { enabled: true }, ai: { first: a, second: a } } } }).warnings, [RS46('first', 'second', 'x:a')])
            assert.deepEqual(RS({ relate: { standards: { edgeReview: { enabled: true }, ai: { first: a, second: a, third: { use: 'x:c' } } } } }).warnings, [])
            assert.deepEqual(RS({ relate: { standards: { edgeReview: { enabled: true }, ai: { first: { use: fwd }, second: a } } } }).warnings, [], '只開既有邊覆核:提案席不投票')
            assert.deepEqual(RS({ relate: { standards: { conflictCheck: { enabled: true }, ai: { first: { use: fwd }, second: a } } } }).warnings, [RS46('提案席 relate.ai', 'first', fwd)])
            assert.deepEqual(RS({ relate: { reverse: { ai: a }, standards: { conflictCheck: { enabled: true }, ai: { first: a, second: { use: 'x:b' } } } } }).warnings, [RS46('提案席 relate.reverse.ai', 'first', 'x:a')])
            assert.deepEqual(RS({ relate: { standards: { conflictCheck: { enabled: true }, ai: { first: null, second: null } } } }).warnings, [], '缺席屬組裝者之啟動期檢核')
            assert.deepEqual(RS({ relate: { standards: { ai: { first: a, second: a } } } }).warnings, [], '未開啟不判')
        })

        it('多條警告之順序:容量在前,其次重評、衝突核對／既有邊覆核', () => {
            const a = { use: 'x:a' }
            const s = RS({ relate: { reeval: { perRun: 1, ai: { first: a, second: a } }, standards: { edgeReview: { enabled: true }, ai: { first: a, second: a } } } })
            const w = relateWarningsOf(s, { inflow: { max: 99, desc: 'x' } })
            assert.equal(w.length, 3)
            assert.ok(w[0].startsWith('筆記進料上界約 99 篇'))
            assert.deepEqual(w.slice(1), [RS5(L1, L2, 'x:a'), RS46('first', 'second', 'x:a')])
        })
    })

    describe('⑥ 席位表', function() {

        it('RELATE_SEAT_LABELS:全部可設之席位(路徑 → 顯示名),序同組裝者列席位之序', () => {
            assert.deepEqual(RELATE_SEAT_LABELS, {
                'relate.ai': '關聯',
                'relate.reverse.ai': '關聯反向',
                'relate.reeval.ai.first': '關聯重評第一席',
                'relate.reeval.ai.second': '關聯重評第二席',
                'relate.reeval.ai.third': '關聯重評第三席',
                'relate.standards.ai.first': '衝突核對／既有邊覆核第一席',
                'relate.standards.ai.second': '衝突核對／既有邊覆核第二席',
                'relate.standards.ai.third': '衝突核對／既有邊覆核第三席',
            })
            assert.deepEqual(Object.keys(RELATE_SEAT_LABELS), ['relate.ai', 'relate.reverse.ai', 'relate.reeval.ai.first', 'relate.reeval.ai.second', 'relate.reeval.ai.third', 'relate.standards.ai.first', 'relate.standards.ai.second', 'relate.standards.ai.third'])
            assert.ok(Object.isFrozen(RELATE_SEAT_LABELS))
        })

        it('relateSeatsOf:只列已設之席位(null 不列——沿用關聯席位或空席),值即設定之席位;全設時路徑與席位表一致', () => {
            const seat = (n) => ({ use: `x:${n}` })
            const s = RS({ relate: { reverse: { ai: seat('r') }, reeval: { ai: { first: seat('e1'), second: seat('e2'), third: seat('e3') } }, standards: { ai: { first: seat('s1'), second: seat('s2'), third: seat('s3') } } } })
            const seats = relateSeatsOf(s)
            assert.deepEqual(Object.keys(seats), Object.keys(RELATE_SEAT_LABELS))
            assert.deepEqual(Object.values(seats).map((x) => x.use), [s.relate.ai.use, 'x:r', 'x:e1', 'x:e2', 'x:e3', 'x:s1', 'x:s2', 'x:s3'])
            assert.deepEqual(Object.keys(relateSeatsOf(RS({ relate: { standards: { ai: { second: seat('s2') } } } }))), ['relate.ai', 'relate.standards.ai.second'])
            assert.ok(!('relate.reverse.ai' in relateSeatsOf(RS({}))), 'null 之選填席位(沿用主席位)不列')
            assert.deepEqual(relateSeatsOf({}), {}, '無 relate 段 → 空')
        })
    })

    describe('⑦ 實例互不汙染', function() {

        it('就地修改某次解析之設定,不影響下次解析與預設常數', () => {
            const a = RS({})
            a.relate.ai.fallback.push('claude:sonnet')
            a.relate.reeval.ai.first = { use: 'x:y' }
            a.relate.standards.edgeReview.deadline = '2026-01-01'
            a.ai.providerTimeouts['x:y'] = 1
            const b = RS({})
            assert.deepEqual(b.relate.ai.fallback, FREE.slice(1))
            assert.equal(b.relate.reeval.ai.first, null)
            assert.equal(b.relate.standards.edgeReview.deadline, '')
            assert.deepEqual(b.ai.providerTimeouts, {})
            assert.deepEqual(RELATE_DEFAULT.ai.fallback, FREE.slice(1))
        })
    })
})
