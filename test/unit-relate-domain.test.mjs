// unit-relate-domain.test.mjs — 關聯之 domain 層(domain/relateDomain):四支提示詞(關聯、重評、衝突核對、既有邊覆核)之逐字契約與領域句之落點
// 規則(出自 domain/relateDomain 與 core/vocab/relateVocab 檔頭):
//   ①預設提示詞逐字等於標準檔(test/golden/prompts-default.json;兩組詞彙 × 6 類固定輸入;產生與比對:test/tools/genPromptGolden.mjs)。
//     稱呼(kbLabel)為各支提示詞首句;型別之擇一清單取詞彙表;衝突之定義四支同一組句子(CONFLICT_DEFINITION)
//   ②提示詞之領域句:guide.relate 各欄位各有唯一落點(泛泛關係例、空泛理由例落於四支;轉換條件只在關聯;型別改正規則 (a)(b) 之情形只在
//     既有邊覆核);guide 不影響輸出格式說明;逐欄回退預設
//   ③AI 所見之區塊(seenTextOf;RS8 之新進材料)與提示詞同一組函數:各角色之區塊原文皆見於對應之提示詞
//   ④領域中立:預設提示詞(無詞彙與 { domain:'天文學' })與本層之原始碼(含註解)不含特定產業領域之詞彙
//   (提示詞覆寫 opt.prompts 之各案見 unit-relate-prompts;詞彙之解析與型別角色見 unit-vocab)
// 執行:自套件根 node <mocha> test/unit-relate-domain.test.mjs(純函數與唯讀之原始碼掃描;不連網、不呼叫 AI、不寫檔)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderRelatePrompts, renderPromptGolden, PROMPT_VARIANTS, PROMPT_NOTES } from './tools/promptFixtures.mjs'
import { domainTermsIn, goldenDiffOf } from './tools/captureForTest.mjs'
import { RELATE_GUIDE_FIELDS, relateGuideDefaultOf, resolveRelateVocab } from '../src/core/vocab/relateVocab.mjs'
import { createRelateDomain, CONFLICT_DEFINITION } from '../src/domain/relateDomain.mjs'

// 套件根(以本檔位置定,不依 cwd)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GOLDEN = JSON.parse(fs.readFileSync(path.join(PKG, 'test/golden/prompts-default.json'), 'utf8'))
const count = (s, m) => s.split(m).length - 1

/** 固定輸入之提示詞鍵 → 其提示詞之角色(domain 之方法) */
const ROLE_OF = Object.freeze({ relate: 'relate', reeval: 'reeval', conflictCheck: 'conflictCheck', conflictCheckReasonProblem: 'conflictCheck', edgeReview: 'edgeReview', edgeReviewOffList: 'edgeReview' })

/** 各欄位之落點(角色) */
const TARGETS = Object.freeze({
    broadRelation: ['relate', 'reeval', 'conflictCheck', 'edgeReview'],
    vagueReason: ['relate', 'reeval', 'conflictCheck', 'edgeReview'],
    changeDrivers: ['relate'],
    implementationCase: ['edgeReview'],
    extensionCase: ['edgeReview'],
})

/** 各欄位之標記值 */
function markerGuide() {
    return { relate: Object.fromEntries(Object.keys(RELATE_GUIDE_FIELDS.relate).map((k) => [k, `⟦relate.${k}⟧`])) }
}

describe('unit-relate-domain', function() {

    // ══════════════════════════ ①預設提示詞 ══════════════════════════
    describe('① 預設提示詞與標準檔', function() {

        it('兩組詞彙(無、domain)× 6 類固定輸入之提示詞與標準檔逐字相同', () => {
            const now = renderPromptGolden()
            assert.deepEqual(Object.keys(now), Object.keys(PROMPT_VARIANTS))
            // 逐鍵差異取標準檔共用件(goldenDiffOf;產生器 test/tools/genPromptGolden.mjs 同一份判準):不同者與標準檔多出者皆列
            assert.deepEqual(goldenDiffOf(now, GOLDEN), [], '須與標準檔逐字相同(重產見 test/tools/genPromptGolden.mjs)')
            assert.deepEqual(Object.keys(now.noDomain), Object.keys(ROLE_OF))
        })

        it('衝突之定義單一來源:四支提示詞(正向、重評、衝突核對、既有邊覆核)皆恰含 CONFLICT_DEFINITION 之兩句各一次——提案與核對之判準一致', () => {
            for (const items of Object.values(renderPromptGolden())) {
                for (const [k, text] of Object.entries(items)) {
                    assert.equal(count(text, CONFLICT_DEFINITION.same), 1, `${k}:是衝突之情形`)
                    assert.equal(count(text, CONFLICT_DEFINITION.compatible), 1, `${k}:可同時成立而不是衝突之情形`)
                }
            }
            assert.ok(Object.isFrozen(CONFLICT_DEFINITION))
        })

        it('稱呼為各支提示詞之首句:未給為「知識庫」、給 domain 為「「天文學」知識庫」、明給 kbLabel 者優先;四支之角色名各不相同', () => {
            const head = { relate: '的關聯建立器。', reeval: '的關聯覆核器。', conflictCheck: '的衝突核對器。', edgeReview: '的既有關聯覆核器。' }
            for (const [vocab, label] of [[null, '知識庫'], [{ domain: '天文學' }, '「天文學」知識庫'], [{ domain: '天文學', kbLabel: '星空知識庫' }, '星空知識庫']]) {
                for (const [k, p] of Object.entries(renderRelatePrompts(vocab))) assert.ok(p.startsWith(`你是${label}${head[ROLE_OF[k]]}`), `${JSON.stringify(vocab)}:${k}`)
            }
        })

        it('型別之擇一清單與衝突型取詞彙表(換清單即換提示詞;JSON 範例之型別亦取清單)', () => {
            const V = { relationTypes: ['前提', '延伸', '衝突', '補充'], conflictType: '衝突', fallbackType: '補充' }
            const ps = renderRelatePrompts(V)
            assert.match(ps.relate, /type 從此清單擇一：前提、延伸、衝突、補充。/)
            assert.match(ps.relate, /務必選為「衝突」/)
            assert.match(ps.relate, /"type":"延伸"/, 'JSON 範例之型別取清單第二項')
            assert.match(ps.reeval, /type 從此清單擇一：前提、延伸、衝突、補充；/)
            assert.match(ps.conflictCheck, /被標為「衝突」的關聯與理由/)
            assert.match(ps.edgeReview, /type 只能從此清單擇一：前提、延伸、衝突、補充。/)
            for (const p of Object.values(ps)) assert.equal(count(p, '衝突或反例'), 0, '預設之衝突型名不殘留')
        })
    })

    // ══════════════════════════ ②領域句 ══════════════════════════
    describe('② 提示詞之領域句(vocab.guide.relate／kbLabel)', function() {

        it('每個欄位各有唯一落點:標記只出現在對應角色之提示詞一次、不出現在其他提示詞;kbLabel 出現在各支提示詞首句各一次', () => {
            const now = renderRelatePrompts({ kbLabel: '⟦kbLabel⟧', guide: markerGuide() })
            assert.deepEqual(Object.keys(TARGETS).sort(), Object.keys(RELATE_GUIDE_FIELDS.relate).sort(), '欄位表與落點表同一組欄位')
            for (const k of Object.keys(RELATE_GUIDE_FIELDS.relate)) {
                const m = `⟦relate.${k}⟧`
                for (const [key, s] of Object.entries(now)) assert.equal(count(s, m), TARGETS[k].includes(ROLE_OF[key]) ? 1 : 0, `${m} 於 ${key}`)
            }
            for (const [key, s] of Object.entries(now)) {
                assert.equal(count(s, '⟦kbLabel⟧'), 1, `kbLabel 於 ${key}`)
                assert.ok(s.startsWith('你是⟦kbLabel⟧的'), `${key} 首句用 kbLabel`)
            }
            assert.equal(Object.keys(RELATE_GUIDE_FIELDS.relate).length, 5, '欄位共 5 個(＋kbLabel＝6)')
        })

        it('輸出格式說明不受欄位影響(全部欄位換成標記,「只回覆 JSON 陣列」起之段落與預設逐字相同;題目之區塊不含領域句)', () => {
            const base = renderRelatePrompts(null)
            const now = renderRelatePrompts({ guide: markerGuide() })
            for (const key of Object.keys(base)) {
                const mark = '只回覆 JSON 陣列'
                assert.ok(base[key].includes(mark), `${key} 含 ${mark}`)
                assert.equal(now[key].slice(now[key].indexOf(mark)), base[key].slice(base[key].indexOf(mark)), `${key} 之輸出格式段與題目區塊不變`)
            }
        })

        it('逐欄回退預設:只給一欄,提示詞只在該處不同(他欄、他支提示詞逐字同標準檔);空字串照填(非空欄位除外)', () => {
            const def = relateGuideDefaultOf().relate
            const now = renderRelatePrompts({ guide: { relate: { changeDrivers: '隨觀測條件轉換' } } })
            for (const [k, s] of Object.entries(now)) {
                const exp = k === 'relate' ? GOLDEN.noDomain.relate.replace(`利弊會${def.changeDrivers}，`, '利弊會隨觀測條件轉換，') : GOLDEN.noDomain[k]
                assert.equal(s, exp, k)
            }
            assert.notEqual(now.relate, GOLDEN.noDomain.relate)
            const empty = renderRelatePrompts({ guide: { relate: { broadRelation: '' } } })
            assert.ok(empty.relate.includes('只有題材撞名、這種泛泛關係'), '字串欄之空字串照填')
            assert.throws(() => renderRelatePrompts({ guide: { relate: { implementationCase: '' } } }), /vocab\.guide\.relate\.implementationCase 須為非空字串/, '型別改正規則之情形為非空字串欄')
        })

        it('型別改正規則 (a)(b) 依型別角色:角色齊備者列兩條;角色從缺者改為通則句(不出現情形描述)', () => {
            const rule = (p, tag) => p.split('\n').find((l) => l.startsWith(`   (${tag}) `))
            const d = renderRelatePrompts(null).edgeReview
            const g = relateGuideDefaultOf().relate
            assert.ok(rule(d, 'a').startsWith(`   (a) ${g.implementationCase}，現行卻標為「`), rule(d, 'a'))
            assert.ok(rule(d, 'b').startsWith(`   (b) ${g.extensionCase}，現行卻標為「`), rule(d, 'b'))
            const noRoles = renderRelatePrompts({ relationTypes: ['前提', '延伸', '衝突', '補充'], conflictType: '衝突', fallbackType: '補充' }).edgeReview
            assert.equal(rule(noRoles, 'a'), undefined)
            assert.match(noRoles, /3\. 型別是否錯（只有型別與兩篇之關係明顯不符才算型別錯/)
            assert.equal(count(noRoles, g.implementationCase), 0)
        })
    })

    // ══════════════════════════ ③AI 所見之區塊 ══════════════════════════
    describe('③ AI 所見之區塊(seenTextOf)與提示詞同一組函數', function() {

        it('各角色之區塊原文皆見於對應之提示詞:目標與候選(關聯)、目標與鄰居(重評)、甲乙兩方(衝突核對、既有邊覆核)', () => {
            const d = createRelateDomain({})
            const { T1, C1 } = PROMPT_NOTES
            const ps = renderRelatePrompts(null)
            assert.ok(ps.relate.includes(d.seenTextOf(T1, 'target')), 'target')
            assert.ok(ps.relate.includes(d.seenTextOf(C1, 'candidate')), 'candidate')
            const t0 = d.relationTypes.find((t) => t !== d.conflictType)
            assert.ok(ps.reeval.includes(d.seenTextOf(T1, 'reevalTarget', { summary: '目標甲之一句話重點全文(內容已更新)' })), 'reevalTarget')
            assert.ok(ps.reeval.includes(d.seenTextOf(C1, 'reevalNeighbor', { edge: { type: t0, reason: '目標甲延伸候選丙之觀測方法與誤差修正' } })), 'reevalNeighbor')
            const extra = (n) => ({ summary: `${n.title}之一句話重點全文`, keyPoints: [`${n.title}之要點一`, `${n.title}之要點二`], conditions: [`${n.title}之適用條件`] })
            for (const k of ['conflictCheck', 'edgeReview']) {
                assert.ok(ps[k].includes(d.seenTextOf(T1, 'checkSide', extra(T1))), `${k}:甲`)
                assert.ok(ps[k].includes(d.seenTextOf(C1, 'checkSide', extra(C1))), `${k}:乙`)
            }
        })

        it('提示詞之覆寫不改 AI 所見之區塊與型別定義(納入閘以內建區塊判)', () => {
            const plain = createRelateDomain({ vocab: resolveRelateVocab({ domain: '天文學' }) })
            const custom = createRelateDomain({ vocab: { domain: '天文學' }, prompts: { relate: () => '自訂' } })
            for (const role of ['target', 'candidate', 'reevalTarget', 'checkSide']) assert.equal(custom.seenTextOf(PROMPT_NOTES.T1, role), plain.seenTextOf(PROMPT_NOTES.T1, role), role)
            for (const k of ['relationTypes', 'conflictType', 'fallbackType', 'conflictTypeNames', 'vagueReasons', 'relationTypeRoles']) assert.deepEqual(custom[k], plain[k], k)
        })
    })

    // ══════════════════════════ ④領域中立 ══════════════════════════
    describe('④ 領域中立', function() {
        const hits = domainTermsIn

        it('預設提示詞(無詞彙與 { domain:"天文學" } 兩組;四支之全部固定輸入)不含領域詞彙', () => {
            for (const vocab of Object.values(PROMPT_VARIANTS)) {
                for (const [name, p] of Object.entries(renderRelatePrompts(vocab))) assert.deepEqual(hits(p), [], `${JSON.stringify(vocab)}:${name}`)
            }
        })

        it('本層之原始碼(domain 與詞彙表;含註解)不含領域詞彙', () => {
            const bad = []
            for (const f of ['domain/relateDomain.mjs', 'core/vocab/relateVocab.mjs']) {
                const h = hits(fs.readFileSync(path.join(PKG, 'src', f), 'utf8'))
                if (h.length) bad.push(`${f}：${h.join('、')}`)
            }
            assert.deepEqual(bad, [])
        })
    })
})
