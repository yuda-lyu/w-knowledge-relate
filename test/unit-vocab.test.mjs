// unit-vocab.test.mjs — 關聯之詞彙表(core/vocab/relateVocab):預設、只認本套件之鍵、抓取共用之鍵交抓取套件驗、關聯鍵之逐條驗證
//   (型別清單、衝突型與後備型別、改名表之對照鏈、別名表、型別角色之推導)、guide.relate 之逐欄回退與型別、新欄位之落點、子集擷取、
//   可重複套用、預設領域中立
// 規則(出自 relateVocab 之設計):
//   ①只認 RELATE_VOCAB_KEYS(抓取共用之 domain／kbLabel／conceptRenames／conceptAliases＋關聯自有之鍵＋guide);不認得之鍵(含他段之鍵)
//     拋錯並列可用鍵——與他段共用一份詞彙表者以 pickRelateVocab 取子集
//   ②抓取共用之鍵之驗證取抓取套件(同一份規則);關聯自有之鍵逐條驗證,錯誤訊息列出路徑;值為 undefined 之鍵視為未給
//   ③guide 只認 relate 段;逐欄回退預設;欄位皆為字串;implementationCase／extensionCase 落於既有邊覆核提示詞之型別改正規則 (a)(b)
//   ④型別角色:未給依 RELATION_ROLE_NAMES 自型別清單推導(從缺即不列)、給了須在清單;推導後寫回,再解析不變
//   ⑤可重複套用(含 JSON 往返後再解析);各次解析之產物互不共用預設常數之參照
//   ⑥預設值與定義預設之原始碼(含註解)不含特定產業領域之詞彙
// 執行:自套件根 node <mocha> test/unit-vocab.test.mjs(純函數與唯讀原始碼掃描,不連網、不寫檔)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    RELATE_GUIDE_FIELDS, RELATE_VOCAB_DEFAULT, RELATE_VOCAB_KEYS, RELATE_VOCAB_OWN_KEYS, RELATION_ROLE_NAMES,
    relateGuideDefaultOf, resolveRelateVocab, pickRelateVocab, kbLabelOf,
} from '../src/core/vocab/relateVocab.mjs'
import { RELATE_DEFAULT, RELATE_AI_DEFAULT, resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { resolveCaptureVocab } from '../src/core/capturePackage.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { DOMAIN_TERMS, domainTermsIn, msgOf } from './tools/captureForTest.mjs'

// 套件根(以本檔位置定,不依 cwd)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const snap = (v) => JSON.stringify(v)
const R = (o) => resolveRelateVocab(o)
const TYPES = RELATE_VOCAB_DEFAULT.relationTypes
const C = RELATE_VOCAB_DEFAULT.conflictType
const T0 = TYPES.find((t) => t !== C)
const ROLES = { implementation: '實作範例', extension: '延伸深化', sibling: '同類方法', complement: '互補搭配' }

// 特定產業領域之詞彙(中英)與命中函數取抓取套件之 test/tools/domainTerms(經 test/tools/captureForTest;四套件同一份;本檔自身不含該等詞彙之字面)
const TERMS = DOMAIN_TERMS
const termsIn = domainTermsIn

describe('unit-vocab', function() {

    describe('① 預設與鍵集', function() {

        it('可用鍵:抓取共用之鍵(鍵集取自抓取套件)＋關聯自有之鍵＋guide', () => {
            const shared = Object.keys(resolveCaptureVocab({}))
            assert.deepEqual(shared, ['domain', 'kbLabel', 'conceptRenames', 'conceptAliases'])
            assert.deepEqual([...RELATE_VOCAB_KEYS], [...shared, 'relationTypes', 'conflictType', 'fallbackType', 'relationTypeRenames', 'relationTypeAliases', 'relationTypeRoles', 'guide'])
            assert.ok(Object.isFrozen(RELATE_VOCAB_KEYS))
            // 關聯自有之鍵(抓取共用之鍵與 guide 以外者)單獨匯出:借用之下游與共用之詞彙表以之取子集
            assert.deepEqual([...RELATE_VOCAB_OWN_KEYS], ['relationTypes', 'conflictType', 'fallbackType', 'relationTypeRenames', 'relationTypeAliases', 'relationTypeRoles'])
            assert.ok(Object.isFrozen(RELATE_VOCAB_OWN_KEYS))
            // 內建預設之抓取共用之鍵為複本(改之不汙染抓取套件之預設)
            assert.notEqual(RELATE_VOCAB_DEFAULT.conceptRenames, resolveCaptureVocab({}).conceptRenames)
        })

        it('預設值通用:主題與稱呼空、通用之關聯型別清單、衝突型與後備型別在清單內、宣告類為空、guide 為中立句', () => {
            const d = RELATE_VOCAB_DEFAULT
            assert.deepEqual([d.domain, d.kbLabel, d.conceptRenames, d.conceptAliases], ['', '', {}, {}])
            assert.deepEqual(d.relationTypes, ['前置概念', '延伸深化', '互補搭配', '衝突或反例', '實作範例', '同類方法', '共用資料或指標'])
            assert.deepEqual([d.conflictType, d.fallbackType], ['衝突或反例', '互補搭配'])
            assert.ok(d.relationTypes.includes(d.conflictType) && d.relationTypes.includes(d.fallbackType), '預設自洽')
            assert.deepEqual([d.relationTypeRenames, d.relationTypeAliases, d.relationTypeRoles], [{}, {}, {}], '型別角色之 {}＝未給(解析時推導)')
            assert.deepEqual(d.guide, relateGuideDefaultOf())
        })

        it('零設定之解析:全部可用鍵皆有值、稱呼為「知識庫」、型別角色由預設型別清單推導;非物件視為全用預設', () => {
            for (const v of [R(), R({}), R(null), R('x')]) {
                assert.deepEqual(Object.keys(v), [...RELATE_VOCAB_KEYS])
                assert.equal(kbLabelOf(v), '知識庫')
                assert.deepEqual(v.relationTypeRoles, ROLES)
            }
            assert.equal(snap(R({})), snap({ ...RELATE_VOCAB_DEFAULT, relationTypeRoles: ROLES }))
        })

        it('不認得之鍵 → 拋並列全部可用鍵(他段之鍵亦拒收,以 pickRelateVocab 取子集;值為 undefined 之鍵亦檢)', () => {
            const m = (k) => `vocab 含不認得之鍵：${k}（可用：${RELATE_VOCAB_KEYS.join('、')}）`
            assert.equal(msgOf(() => R({ categories: ['x'] })), m('categories'))
            assert.equal(msgOf(() => R({ relationType: ['x'], evidenceCaps: {} })), m('relationType、evidenceCaps'))
            assert.equal(msgOf(() => R({ relationTypez: undefined })), m('relationTypez'))
        })
    })

    describe('② 抓取共用之鍵(交抓取套件驗)', function() {

        it('合法值原樣帶入;kbLabelOf 由稱呼或主題推導', () => {
            const v = R({ domain: '天文學', conceptRenames: { 黑洞吸積: '吸積盤' }, conceptAliases: { 吸积盘: '吸積盤' } })
            assert.deepEqual([v.domain, v.conceptRenames, v.conceptAliases], ['天文學', { 黑洞吸積: '吸積盤' }, { 吸积盘: '吸積盤' }])
            assert.equal(kbLabelOf(v), '「天文學」知識庫')
            assert.equal(kbLabelOf(R({ domain: '天文學', kbLabel: '星空知識庫' })), '星空知識庫')
        })

        it('不合規則 → 拋抓取套件之訊息(kbLabel 非字串、概念對照形狀錯或值空)', () => {
            assert.equal(msgOf(() => R({ kbLabel: 5 })), 'vocab.kbLabel 須為字串')
            assert.equal(msgOf(() => R({ conceptRenames: [] })), 'vocab.conceptRenames 須為物件 { 原寫法: 新寫法 }')
            assert.equal(msgOf(() => R({ conceptAliases: { a: '' } })), 'vocab.conceptAliases 之「a」須對應非空字串')
        })
    })

    describe('③ 關聯自有之鍵:逐條驗證', function() {

        it('交叉檢核:relationTypes 須為非空字串陣列;conflictType／fallbackType 須為非空字串且在 relationTypes(否則提示詞自相矛盾、衝突永不成立)', () => {
            for (const bad of ['a', [], ['a', ''], ['a', 1], null, {}]) assert.equal(msgOf(() => R({ relationTypes: bad })), 'vocab.relationTypes 須為非空字串陣列', JSON.stringify(bad))
            assert.equal(msgOf(() => R({ conflictType: '反例' })), `vocab.conflictType「反例」不在 relationTypes（${TYPES.join('、')}）`)
            assert.equal(msgOf(() => R({ relationTypes: ['甲', '乙'] })), 'vocab.conflictType「衝突或反例」不在 relationTypes（甲、乙）', '換了 relationTypes 而未同步 conflictType')
            assert.match(msgOf(() => R({ relationTypes: ['衝突或反例', '乙'] })), /^vocab\.fallbackType「互補搭配」不在 relationTypes/)
            for (const k of ['conflictType', 'fallbackType']) assert.equal(msgOf(() => R({ [k]: '' })), `vocab.${k} 須為非空字串（relationTypes 之一）`)
            assert.doesNotThrow(() => R({ relationTypes: ['衝突或反例', '互補搭配'] }))
            assert.deepEqual(R({ relationTypes: undefined, conflictType: undefined }).relationTypes, TYPES, '值為 undefined 之鍵視為未給')
        })

        it('別名與改名表:relationTypeAliases 之別名不得在清單或改名表、值須在清單;relationTypeRenames 之舊名不在清單、終點在清單、可成鏈、不得成環;預設皆空', () => {
            assert.throws(() => R({ relationTypeAliases: { 互補搭配: C } }), /relationTypeAliases 之「互補搭配」在 relationTypes 內/)
            assert.throws(() => R({ relationTypeAliases: { 衝突: '不存在' } }), /relationTypeAliases\.衝突 之型別「不存在」不在 relationTypes/)
            assert.throws(() => R({ relationTypeAliases: 'x' }), /relationTypeAliases 須為物件/)
            assert.throws(() => R({ relationTypeAliases: { 衝突: '' } }), /relationTypeAliases 之鍵與值須為非空字串/)
            assert.throws(() => R({ relationTypeRenames: { 互補搭配: C } }), /relationTypeRenames 之「互補搭配」仍在現行清單/)
            assert.throws(() => R({ relationTypeRenames: { 舊: '不存在' } }), /relationTypeRenames\.舊 之新名「不存在」不在現行清單/)
            assert.equal(msgOf(() => R({ relationTypeRenames: { A: 'B', B: 'A' } })), [['A', 'B'], ['B', 'A']].map(([f, t]) => `vocab.relationTypeRenames.${f} 之新名「${t}」不在現行清單（${TYPES.join('、')}），且對照成環`).join('；'), '問題一次列全(抓取套件之 renameChainProblems)')
            assert.throws(() => R({ relationTypeRenames: [] }), /vocab\.relationTypeRenames 須為物件 \{ 舊名: 新名 \}/)
            assert.throws(() => R({ relationTypeRenames: { 舊: T0 }, relationTypeAliases: { 舊: T0 } }), /同時出現在 relationTypeRenames/)
            const v = R({ relationTypeRenames: { 甲型: '乙型', 乙型: T0 } })
            assert.deepEqual(v.relationTypeRenames, { 甲型: '乙型', 乙型: T0 }, '連續改名以對照鏈宣告')
            assert.deepEqual([R({}).relationTypeAliases, R({}).relationTypeRenames], [{}, {}], '預設皆空(領域中立)')
            assert.deepEqual([R({ relationTypeAliases: null }).relationTypeAliases, R({ relationTypeRenames: null }).relationTypeRenames], [{}, {}], 'null 視為空')
        })

        it('型別角色:未給依候選名自型別清單推導(從缺即不列,封閉清單隨之停用);給了須為已知角色且型別在清單;明給者優先;推導結果寫回', () => {
            assert.deepEqual(R({ relationTypes: ['相關', '衝突或反例'], fallbackType: '相關' }).relationTypeRoles, {}, '自訂清單無對應之候選名 → 皆從缺')
            assert.deepEqual(R({ relationTypes: ['實作範例', '延伸深化', '衝突或反例', '互補搭配'] }).relationTypeRoles, { implementation: '實作範例', extension: '延伸深化', complement: '互補搭配' }, '從缺之角色不列')
            const own = ['前提', '實作', '延伸', '同族', '互補', '衝突或反例']
            const v = R({ relationTypes: own, fallbackType: '互補', relationTypeRoles: { implementation: '實作', extension: '延伸', sibling: '同族', complement: '互補' } })
            assert.deepEqual(v.relationTypeRoles, { implementation: '實作', extension: '延伸', sibling: '同族', complement: '互補' })
            assert.deepEqual(R({ relationTypeRoles: { sibling: '前置概念' } }).relationTypeRoles, { ...ROLES, sibling: '前置概念' }, '明給者優先、其餘照推導')
            assert.equal(msgOf(() => R({ relationTypeRoles: { cousin: T0 } })), 'vocab.relationTypeRoles 含不認得之鍵：cousin（可用：implementation、extension、sibling、complement）', '不認得之角色為 checkKeys 之格式')
            assert.equal(msgOf(() => R({ relationTypeRoles: { sibling: '不存在' } })), `vocab.relationTypeRoles.sibling 之型別「不存在」不在 relationTypes（${TYPES.join('、')}）`)
            assert.equal(msgOf(() => R({ relationTypeRoles: 'x' })), 'vocab.relationTypeRoles 須為物件 { 角色: 型別 }')
            assert.deepEqual(R({ relationTypeRoles: null }).relationTypeRoles, ROLES, 'null 視為未給')
        })

        it('預設之角色候選名中立:sibling 只有「同類方法」;型別角色之推導經 domain 生效', () => {
            assert.deepEqual(RELATION_ROLE_NAMES, { implementation: ['實作範例'], extension: ['延伸深化'], sibling: ['同類方法'], complement: ['互補搭配'] })
            assert.ok(Object.isFrozen(RELATION_ROLE_NAMES) && Object.values(RELATION_ROLE_NAMES).every(Object.isFrozen))
            assert.deepEqual(createRelateDomain({}).relationTypeRoles, ROLES)
        })
    })

    describe('④ guide.relate:逐欄回退、型別、新欄位之落點', function() {

        it('欄位表:relate 段 5 欄(泛泛關係例、空泛理由例、轉換條件為字串——空字串照填;型別改正規則 (a)(b) 之情形為非空字串——插入句中之條件);預設值為中立句', () => {
            assert.deepEqual(Object.keys(RELATE_GUIDE_FIELDS), ['relate'])
            assert.deepEqual(RELATE_GUIDE_FIELDS.relate, { broadRelation: 'string', vagueReason: 'string', changeDrivers: 'string', implementationCase: 'estr', extensionCase: 'estr' })
            assert.ok(Object.isFrozen(RELATE_GUIDE_FIELDS) && Object.isFrozen(RELATE_GUIDE_FIELDS.relate))
            assert.deepEqual(relateGuideDefaultOf(), {
                relate: {
                    broadRelation: '同屬某一大領域',
                    vagueReason: '都與某主題有關',
                    changeDrivers: '隨時間與環境條件轉換',
                    implementationCase: '一方是另一方之方法的具體實作或應用實例',
                    extensionCase: '一方直接在另一方之模型或方法上延伸、修正或加入新變數',
                },
            })
            assert.notEqual(relateGuideDefaultOf(), relateGuideDefaultOf(), '每次回傳新物件')
        })

        it('逐欄回退預設:只給一欄,其餘欄位為預設;空字串照填;null／undefined 視為未給;提示詞只在該處不同', () => {
            const v = R({ guide: { relate: { vagueReason: '都屬同一學科' } } })
            const exp = relateGuideDefaultOf()
            exp.relate.vagueReason = '都屬同一學科'
            assert.deepEqual(v.guide, exp)
            assert.equal(R({ guide: { relate: { broadRelation: '' } } }).guide.relate.broadRelation, '')
            assert.deepEqual(R({ guide: null }).guide, relateGuideDefaultOf())
            assert.deepEqual(R({ guide: { relate: null } }).guide, relateGuideDefaultOf())
            assert.deepEqual(R({ guide: { relate: { vagueReason: null, changeDrivers: undefined } } }).guide, relateGuideDefaultOf())
            const base = createRelateDomain({}).buildPrompt([], new Map())
            const now = createRelateDomain({ vocab: { guide: { relate: { vagueReason: '都屬同一學科' } } } }).buildPrompt([], new Map())
            assert.equal(now, base.replace('「都與某主題有關」', '「都屬同一學科」'))
        })

        it('形狀與型別錯 → 拋:guide 非物件、不認得之段(含他段 triage／summarize／extract)、段非物件、不認得之欄位、欄位非字串、非空字串欄給空字串或空白', () => {
            assert.equal(msgOf(() => R({ guide: 'x' })), 'vocab.guide 須為物件 { relate }')
            assert.equal(msgOf(() => R({ guide: [] })), 'vocab.guide 須為物件 { relate }')
            for (const sec of ['triage', 'summarize', 'extract', 'relat']) assert.equal(msgOf(() => R({ guide: { [sec]: {} } })), `vocab.guide 含不認得之鍵：${sec}（可用：relate）`)
            assert.equal(msgOf(() => R({ guide: { summarize: undefined } })), 'vocab.guide 含不認得之鍵：summarize（可用：relate）', '值為 undefined 之段亦檢')
            assert.equal(msgOf(() => R({ guide: { relate: 'x' } })), 'vocab.guide.relate 須為物件')
            assert.equal(msgOf(() => R({ guide: { relate: { vagueReson: 'x' } } })), 'vocab.guide.relate 含不認得之鍵：vagueReson（可用：broadRelation、vagueReason、changeDrivers、implementationCase、extensionCase）')
            assert.equal(msgOf(() => R({ guide: { relate: { vagueReason: 3 } } })), 'vocab.guide.relate.vagueReason 須為字串')
            assert.equal(msgOf(() => R({ guide: { relate: { implementationCase: ['x'] } } })), 'vocab.guide.relate.implementationCase 須為非空字串')
            // (a)(b) 之情形插入句中:空字串會使型別改正規則成為殘句(「 ，現行卻標為…」)
            for (const k of ['implementationCase', 'extensionCase']) {
                for (const bad of ['', '   ', 3]) assert.equal(msgOf(() => R({ guide: { relate: { [k]: bad } } })), `vocab.guide.relate.${k} 須為非空字串`, `${k}=${JSON.stringify(bad)}`)
            }
            assert.equal(R({ guide: { relate: { changeDrivers: '' } } }).guide.relate.changeDrivers, '', '字串欄之空字串照填(對照)')
        })

        it('implementationCase／extensionCase 只落於既有邊覆核提示詞之型別改正規則 (a)(b)(預設之 (b) 為原句、(a) 為中立句);安裝方給回原句即逐字重現;型別角色從缺時不出現', () => {
            const items = []
            const rule = (p, tag) => p.split('\n').find((l) => l.startsWith(`   (${tag}) `))
            const d0 = createRelateDomain({})
            const p0 = d0.buildEdgeReviewPrompt(items)
            assert.equal(rule(p0, 'a'), '   (a) 一方是另一方之方法的具體實作或應用實例，現行卻標為「同類方法」或「互補搭配」→ 改為「實作範例」；')
            assert.equal(rule(p0, 'b'), '   (b) 一方直接在另一方之模型或方法上延伸、修正或加入新變數，現行卻標為「同類方法」或「互補搭配」→ 改為「延伸深化」。')
            const IMPL = '⟦implementationCase⟧'
            const EXT = '⟦extensionCase⟧'
            const d1 = createRelateDomain({ vocab: { guide: { relate: { implementationCase: IMPL, extensionCase: EXT } } } })
            const p1 = d1.buildEdgeReviewPrompt(items)
            assert.equal(rule(p1, 'a'), `   (a) ${IMPL}，現行卻標為「同類方法」或「互補搭配」→ 改為「實作範例」；`)
            assert.equal(rule(p1, 'b'), `   (b) ${EXT}，現行卻標為「同類方法」或「互補搭配」→ 改為「延伸深化」。`)
            assert.equal(p1.replace(IMPL, '一方是另一方之方法的具體實作或應用實例').replace(EXT, '一方直接在另一方之模型或方法上延伸、修正或加入新變數'), p0, '其餘逐字不變')
            for (const p of [d1.buildPrompt([], new Map()), d1.buildReevalPrompt([]), d1.buildConflictCheckPrompt([])]) assert.ok(!p.includes(IMPL) && !p.includes(EXT), '不落於其他提示詞')
            const noRole = createRelateDomain({ vocab: { relationTypes: ['相關', '衝突或反例'], fallbackType: '相關', guide: { relate: { implementationCase: IMPL, extensionCase: EXT } } } })
            assert.ok(!noRole.buildEdgeReviewPrompt(items).includes(IMPL), '型別角色從缺 → 封閉清單停用,改正規則 (a)(b) 不出現')
        })
    })

    describe('⑤ 子集擷取、可重複套用、互不汙染', function() {

        it('pickRelateVocab:只取本套件之鍵(未給者不列)、guide 只取 relate 段(有給才列)、不改輸入;非物件 → {}', () => {
            const src = {
                domain: '天文學', kbLabel: undefined, categories: ['甲', '其他'], relationTypes: ['相關', '衝突'], conflictType: '衝突', evidenceCaps: {},
                guide: { triage: { scopeLine: '' }, relate: { vagueReason: '同屬天文' }, extract: {} },
            }
            const before = JSON.stringify(src)
            const p = pickRelateVocab(src)
            assert.deepEqual(p, { domain: '天文學', relationTypes: ['相關', '衝突'], conflictType: '衝突', guide: { relate: { vagueReason: '同屬天文' } } })
            assert.equal(JSON.stringify(src), before)
            assert.deepEqual(pickRelateVocab({ guide: { summarize: {} } }), { guide: {} }, '無 relate 段 → guide 為空物件(解析時全用預設)')
            assert.deepEqual([pickRelateVocab(null), pickRelateVocab('x')], [{}, {}])
            assert.equal(pickRelateVocab({ guide: 'x' }).guide, 'x', 'guide 非物件原樣交解析(由解析拋錯)')
            assert.throws(() => R(src), /vocab 含不認得之鍵：categories、evidenceCaps/, '整份共用詞彙未取子集 → 拋')
            assert.doesNotThrow(() => R({ ...p, fallbackType: '相關' }))
        })

        it('可重複套用:resolve(resolve(x)) 與 resolve(x) 相同(含型別角色之推導、改名之對照鏈);JSON 往返後再解析亦相同', () => {
            const cases = [
                {}, { domain: '天文學', kbLabel: '星空知識庫' },
                { relationTypes: ['前提', '延伸', '衝突', '補充'], conflictType: '衝突', fallbackType: '補充', relationTypeRenames: { 舊延伸: '中延伸', 中延伸: '延伸' }, relationTypeAliases: { 衝突關係: '衝突' } },
                { relationTypeRoles: { sibling: '前置概念' }, guide: { relate: { broadRelation: '同屬某一學門', implementationCase: '一方實作另一方' } } },
                { conceptRenames: { 甲: '乙' }, relationTypes: ['相關', '衝突或反例'], fallbackType: '相關' },
            ]
            for (const x of cases) {
                const a = R(x)
                assert.equal(snap(R(a)), snap(a), JSON.stringify(x))
                assert.equal(snap(R(JSON.parse(JSON.stringify(a)))), snap(a), `JSON 往返:${JSON.stringify(x)}`)
                assert.equal(snap(R(pickRelateVocab(a))), snap(a))
            }
        })

        it('各次解析之產物互不共用預設常數之參照:就地修改不影響下次解析與預設', () => {
            const a = R({})
            a.relationTypes.push('雜')
            a.relationTypeRenames.x = 'y'
            a.guide.relate.vagueReason = '改'
            a.relationTypeRoles.sibling = '雜'
            const b = R({})
            assert.deepEqual(b.relationTypes, TYPES)
            assert.deepEqual([b.relationTypeRenames, b.guide.relate.vagueReason, b.relationTypeRoles], [{}, '都與某主題有關', ROLES])
            assert.ok(!RELATE_VOCAB_DEFAULT.relationTypes.includes('雜'))
            assert.deepEqual(RELATE_VOCAB_DEFAULT.relationTypeRenames, {})
        })
    })

    describe('⑥ 預設領域中立', function() {

        it('詞表自檢:領域詞被抓到;中立詞、識別字與模型條目 id 之片段不誤判', () => {
            assert.deepEqual(termsIn(`前 ${TERMS[0]} 後`), [TERMS[0]])
            assert.deepEqual(termsIn(`a ${TERMS[TERMS.length - 1]} b`), [TERMS[TERMS.length - 1]])
            assert.deepEqual(termsIn('quantum tunneling、planEdgeStockFix、oc:opencode/fledge-alpha-free、future work'), [])
        })

        it('預設詞彙、預設 guide、角色候選名、解析後之詞彙與預設設定皆不含特定產業領域之詞彙', () => {
            const targets = {
                vocabDefault: snap(RELATE_VOCAB_DEFAULT),
                vocabResolved: snap(R({})),
                guideDefault: snap(relateGuideDefaultOf()),
                roleNames: snap(RELATION_ROLE_NAMES),
                settingsDefault: snap([RELATE_DEFAULT, RELATE_AI_DEFAULT]),
                settingsResolved: snap(resolveRelateSettings({})),
            }
            for (const [name, text] of Object.entries(targets)) assert.deepEqual(termsIn(text), [], `${name} 含領域詞彙`)
        })

        it('定義預設之原始碼(含註解)不含特定產業領域之詞彙:詞彙表、設定、兩個匯入點', () => {
            for (const f of ['core/vocab/relateVocab.mjs', 'core/relateSettings.mjs', 'core/capturePackage.mjs', 'core/summarizePackage.mjs']) {
                assert.deepEqual(termsIn(fs.readFileSync(path.join(PKG, 'src', f), 'utf8')), [], `${f} 含領域詞彙(註解範例亦須中立)`)
            }
        })
    })
})
