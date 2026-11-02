// unit-relate-locale.test.mjs — 語言設定(cfg.lang;抓取套件之 core/locale)於關聯套件之落點:四支提示詞之理由語言句、邊標準 RS3 之適用、
//   納入閘與存量修正之字形政策、執行期件與總組裝之接線
// 規則(出自 relateRuntime、relateDomain、edgeStandards、edgeGate、stockFix 之檔頭與 JSDoc):
//   ①預設逐字不變:未給 lang 時四支提示詞與語言設定出現前相同(golden 另有 unit-relate-domain 守);lang 給了只換理由之語言句
//   ②RS3 只適用於臺灣正體:語言設定非繁體中文 → checkEdge 列不適用(共同字樣)、掃描逐邊列不適用;正規化、納入閘、存量修正不轉字形
//   ③執行期件:cfg.lang 解析一次,domain 工廠與每輪依賴同讀
// 執行:自套件根 node <mocha> test/unit-relate-locale.test.mjs(純函數與記憶體集合;不連網、不呼叫 AI、不落檔)

import assert from 'node:assert/strict'
import { memStore, msgOf, setConceptFold, SCRIPT_NONE } from './tools/captureForTest.mjs'
import { SCRIPT_NA_DETAIL, resolveLocale } from '../src/core/capturePackage.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { createRelateRuntime } from '../src/relateRuntime.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { checkEdge, EDGE_STANDARDS } from '../src/standards/edgeStandards.mjs'
import { normalizeEdgeProposal, gateEdgeProposal, reasonRewriteProblemsOf } from '../src/standards/edgeGate.mjs'
import { edgeFixOf } from '../src/standards/stockFix.mjs'
import { auditRelateStandards } from '../src/standards/audit.mjs'
import { CFG_KEYS } from '../src/createKnowledgeRelate.mjs'

const SETTINGS = resolveRelateSettings({})
const DOMAIN = createRelateDomain({})
const TYPES = DOMAIN.relationTypes
const T0 = TYPES.find((t) => t !== DOMAIN.conflictType)
const SIMP = '两篇都用动量因子建构组合并扣除交易成本之后比较'
const E = (o = {}) => ({ id: 'e1', from: 'a', to: 'b', type: T0, reason: SIMP, ...o })
const ctx = { relationTypes: TYPES, vague: DOMAIN.vagueReasons, hasNote: (id) => ['a', 'b'].includes(id), resolveType: DOMAIN.resolveType }
const by = (rs, std) => rs.find((r) => r.std === std)

describe('unit-relate-locale', function() {

    after(() => setConceptFold(null))

    it('①四支提示詞:預設逐字含「繁體中文」之理由句;lang en 換為「英文」且不含「繁體中文」;錯值拋錯並點名', () => {
        const d1 = createRelateDomain({ locale: 'en' })
        const pairs = [
            [DOMAIN.buildPrompt([], new Map()), d1.buildPrompt([], new Map()), 'reason 用繁體中文一句話說明', 'reason 用英文一句話說明'],
            [DOMAIN.buildReevalPrompt([]), d1.buildReevalPrompt([]), 'reason 用繁體中文一句話寫出新的具體關聯', 'reason 用英文一句話寫出新的具體關聯'],
            [DOMAIN.buildConflictCheckPrompt([]), d1.buildConflictCheckPrompt([]), 'reason 一律用繁體中文、至少十個字', 'reason 一律用英文、至少十個字'],
            [DOMAIN.buildEdgeReviewPrompt([]), d1.buildEdgeReviewPrompt([]), 'reason 一律用繁體中文、至少十個字', 'reason 一律用英文、至少十個字'],
        ]
        for (const [p0, p1, s0, s1] of pairs) {
            assert.ok(p0.includes(s0), p0.slice(0, 80))
            assert.ok(p1.includes(s1) && !p1.includes('繁體中文'), p1.slice(0, 80))
            assert.equal(p0.replaceAll('繁體中文', '英文'), p1, '只換語言句,其餘逐字相同')
        }
        assert.equal(createRelateDomain({ locale: resolveLocale('en') }).buildPrompt([], new Map()), d1.buildPrompt([], new Map()))
        assert.match(msgOf(() => createRelateDomain({ locale: '!!' })), /^createRelateDomain 之 opt\.locale 不是合法之語言代碼/)
    })

    it('②checkEdge:RS3 宣告 appliesTo zh-Hant-TW;預設判違反;ctx.locale en 列不適用(共同字樣);zh-Hant 仍判;錯值拋錯', () => {
        assert.deepEqual(EDGE_STANDARDS.find((s) => s.id === 'RS3').appliesTo, ['zh-Hant-TW'])
        assert.equal(by(checkEdge(E(), ctx), 'RS3').status, 'violation')
        const na = by(checkEdge(E(), { ...ctx, locale: 'en' }), 'RS3')
        assert.deepEqual([na.status, na.detail], ['na', SCRIPT_NA_DETAIL])
        assert.equal(by(checkEdge(E(), { ...ctx, locale: SCRIPT_NONE }), 'RS3').status, 'na')
        assert.equal(by(checkEdge(E({ history: [{ reason: '旧理由之后续' }] }), { ...ctx, locale: 'zh-Hant' }), 'RS3').status, 'violation')
        assert.deepEqual(checkEdge(E(), { ...ctx, locale: 'en' }).map((r) => r.std), ['RS1', 'RS2', 'RS3'], '其餘標準照判')
        assert.match(msgOf(() => checkEdge(E(), { ...ctx, locale: 5 })), /^checkEdge 之 ctx\.locale 須為/)
    })

    it('②normalizeEdgeProposal／gateEdgeProposal／reasonRewriteProblemsOf／edgeFixOf:預設轉正體;locale en 不轉、納入閘通過、無須改寫、存量修正回 null', () => {
        const n0 = normalizeEdgeProposal(E(), { resolveType: DOMAIN.resolveType })
        const n1 = normalizeEdgeProposal(E(), { resolveType: DOMAIN.resolveType, locale: 'en' })
        assert.ok(n0.fixes.includes('理由轉正體') && n0.edge.reason !== SIMP, JSON.stringify(n0))
        assert.deepEqual([n1.edge.reason, n1.fixes], [SIMP, []])
        const g1 = gateEdgeProposal(E(), { ...ctx, locale: 'en' })
        assert.deepEqual([g1.ok, g1.edge.reason, g1.reasons], [true, SIMP, []])
        assert.deepEqual(reasonRewriteProblemsOf(E(), { ...ctx, locale: 'en' }), [])
        assert.notEqual(edgeFixOf(E()), null)
        assert.equal(edgeFixOf(E(), { locale: 'en' }), null)
        assert.equal(edgeFixOf(E(), { locale: resolveLocale('zh-TW') }).edge.reason, n0.edge.reason)
        assert.match(msgOf(() => edgeFixOf(E(), { locale: '!!' })), /^edgeFixOf 之 ctx\.locale 不是合法之語言代碼/)
    })

    it('②符合度掃描:deps.locale en 時 RS3 逐邊列不適用', async () => {
        const stores = () => ({ relations: memStore([E()]), notes: memStore([{ id: 'a' }, { id: 'b' }]) })
        const r0 = (await auditRelateStandards({ stores: stores(), domain: DOMAIN }, { only: ['RS3'] })).standards.RS3
        const r1 = (await auditRelateStandards({ stores: stores(), domain: DOMAIN, locale: 'en' }, { only: ['RS3'] })).standards.RS3
        assert.deepEqual([[r0.total, r0.violation, r0.na], [r1.total, r1.violation, r1.na]], [[1, 1, 0], [1, 0, 1]])
    })

    it('③createRelateRuntime 讀 cfg.lang:locale、domain 之語言句、折疊依之;預設 zh-TW;錯值拋錯並點名 cfg.lang;lang 在總組裝之 CFG_KEYS', () => {
        const rt = createRelateRuntime({ lang: 'en' }, SETTINGS)
        assert.deepEqual([rt.locale.code, rt.folds], ['en', { fold: null, clueFold: null }])
        assert.ok(rt.domains.relate.buildPrompt([], new Map()).includes('reason 用英文一句話說明'))
        assert.equal(createRelateRuntime({}, SETTINGS).locale.code, 'zh-TW')
        assert.match(msgOf(() => createRelateRuntime({ lang: 'zh_TW' }, SETTINGS)), /^cfg\.lang 不是合法之語言代碼/)
        assert.ok(CFG_KEYS.includes('lang'))
        setConceptFold(null)
    })
})
