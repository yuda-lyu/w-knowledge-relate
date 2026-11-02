// relateDomain.mjs — 關聯的內建領域預設:prompt 與品質標注摘要、型別解析、AI 所見之區塊
//
// 【套件開發者擁有、隨版本演進】四支提示詞(正向／反向／輪巡共用之關聯、重評、衝突核對、既有邊覆核)是內建能力(領域中立)。安裝方之覆寫有三層:
//   ①詞彙表(型別清單與衝突型、主題範圍 domain、稱呼 kbLabel、提示詞之領域句 guide.relate 逐欄——泛泛關係例、空泛理由例、利弊轉換條件、
//   既有邊覆核之型別改正規則所指之實作與延伸情形)②整個提示詞函數(opt.prompts 之 relate、reeval、conflictCheck、edgeReview;收原參數＋
//   末參數 ctx { kbLabel, domain, vocab, defaultPrompt },defaultPrompt 為內建提示詞函數,可包裝之;函數形式見 RELATE_PROMPT_SIGS)
//   ③整組 domain(組裝者之 cfg.domains)。輸出之驗證(納入閘、裁決驗證)與 AI 所見之區塊(seenTextOf;RS8 之新進材料)不隨提示詞覆寫改變——
//   覆寫者須依輸出契約要求模型輸出,否則其輸出會被驗證擋下;改寫區塊文字者,數字紮根仍以內建區塊判。
// 候選挑選與 slug 容錯在 stores/candidates.mjs、納入閘與逐項鏈在 stages/relateChain.mjs、邊之合併落庫在 stores/edgeStore.mjs;兩端 md 之投影在 stores/noteProjection.mjs。
// 【型別解析(檢定標準 RS9、RS1′)】resolveType:清單內原樣;改名表(relationTypeRenames,循對照鏈)或別名表(relationTypeAliases)對映;
//   其餘回 ''(該條不納入——程式不替模型斷言型別,不落後備型別)。conflictTypeNames＝衝突型現名＋改名表中終點為衝突型之舊名。
// 【AI 所見(RS8 之新進材料)】seenTextOf 回傳某篇在提示詞中之區塊原文;buildPrompt／buildReevalPrompt／buildConflictCheckPrompt 以同一組函數組字,
//   理由中之數字只可來自模型實際看到之文字。
// 【衝突核對(檢定標準 RS4)】buildConflictCheckPrompt:一對筆記＋現行(或被提議)之衝突關聯 → keep／change／retire／unsure;
//   不確定為合法裁決(判定小組據以叫第三席或列未能判定)。
// 【既有邊覆核(檢定標準 RS6)】buildEdgeReviewPrompt:一對筆記＋現行之非衝突型關聯(內容未變)→ 成立／型別(含漏標之衝突)／理由具體;同上之裁決形狀。
// 【衝突之定義單一來源】四支提示詞對「衝突」用同一組句子(CONFLICT_DEFINITION):對同一問題相反之結論、同一參數矛盾之數值或方向、
//   適用條件互斥才是衝突;一方為另一方之特例、只是側重不同面向、或在不同條件下各自成立而條件不互斥者不是衝突。提案之段(正向、重評)
//   與核對之段(RS4、RS6)判準一致——提案寬於核對,提出之衝突即被核對撤回。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { oneline, kbLabelOf } from '../core/capturePackage.mjs'
import { resolveRelateVocab } from '../core/vocab/relateVocab.mjs'
import { NOTE_PLACEHOLDERS, NOTE_SECTION_TITLES } from '../core/summarizePackage.mjs'
import { promptOverridesOf, promptCtxOf, overridablePrompt, resolveLocale } from '../core/capturePackage.mjs'


/**
 * 提示詞覆寫(opt.prompts)之鍵與覆寫函數之形式(唯一一份;抓取套件之提示詞覆寫之 SIGS 形狀——cfg 層、執行期件與本工廠同讀;輸出契約固定):
 *   relate＝正向／反向／輪巡之關聯提示詞、reeval＝重評、conflictCheck＝衝突核對、edgeReview＝既有邊覆核;末參數 ctx 為 { kbLabel, domain, vocab, defaultPrompt }
 *
 * @type {Object}
 */
export const RELATE_PROMPT_SIGS = Object.freeze({
    relate: Object.freeze({ params: '(targets, candidateMap, ctx)' }),
    reeval: Object.freeze({ params: '(items, ctx)' }),
    conflictCheck: Object.freeze({ params: '(items, ctx)' }),
    edgeReview: Object.freeze({ params: '(items, ctx)' }),
})

/**
 * 「衝突」之定義(四支內建提示詞同讀,見檔頭):same＝是衝突之情形,compatible＝可以同時成立而不是衝突之情形(接在「回答不同問題、或」之後)
 *
 * @type {Object}
 */
export const CONFLICT_DEFINITION = Object.freeze({
    same: '對同一個問題給出相反的結論、對同一參數給出互相矛盾的數值或方向、或兩者的適用條件互斥',
    compatible: '一方是另一方的特例、只是側重不同面向、或在不同條件下各自成立而條件並不互斥',
})


/**
 * 讀關聯之下游所需之 domain 成員之缺漏(衝突型 conflictType〔非空字串〕、衝突型之現名與舊名 conflictTypeNames〔陣列〕、型別現名化 resolveType〔函數〕):
 *   下游於組裝期與執行期以之判定所交之關聯 domain 是否可用(判準一份,在關聯套件;缺之則衝突之讀法與型別之現名化靜默失能)
 *
 * @param {*} d 輸入關聯 domain(createRelateDomain 之產物或同形之注入者)
 * @returns {Array} 回傳缺之成員名(依 conflictType、conflictTypeNames、resolveType 之序;無缺為空陣列)
 * @example
 * console.log(relateDomainNeedsOf(createRelateDomain({})), relateDomainNeedsOf({ conflictType: '', conflictTypeNames: [] }))
 * // => [] [ 'conflictType', 'resolveType' ]
 */
export function relateDomainNeedsOf(d) {
    return [
        !(isestr(d?.conflictType) && d.conflictType) && 'conflictType',
        !isarr(d?.conflictTypeNames) && 'conflictTypeNames',
        !isfun(d?.resolveType) && 'resolveType',
    ].filter(Boolean)
}


/**
 * 筆記的品質標注摘要行(供 prompt 對照證據強弱與衝突判斷用;缺證據等級者以摘要之缺值字樣 NOTE_PLACEHOLDERS)
 *
 * @param {Object} n 輸入筆記記錄，可含 evidenceLevel、caveats
 * @returns {String} 回傳摘要字串，例如 '證據:中｜⚠樣本小'
 */
function qualityTag(n) {
    const cv = (n.caveats || []).length ? `｜⚠${(n.caveats || []).join('/')}` : ''
    return `證據:${n.evidenceLevel || NOTE_PLACEHOLDERS.evidenceLevel}${cv}`
}


/**
 * 建立關聯之內建領域預設
 *
 * 回傳物件之全部函數皆可由組裝者整組置換(cfg.domains);提示詞可個別覆寫(opt.prompts)
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件(見 resolveRelateVocab)，含 domain、kbLabel、relationTypes、conflictType、fallbackType、guide.relate(領域句)等，預設null代表全用內建
 * @param {Object} [opt.prompts] 輸入提示詞覆寫 { relate?, reeval?, conflictCheck?, edgeReview? }：各為函數,收原參數＋末參數
 *   ctx { kbLabel, domain, vocab, defaultPrompt(內建提示詞函數,參數同原方法) }，須回傳非空字串;未給者用內建(函數形式見 RELATE_PROMPT_SIGS)
 * @param {String|Object} [opt.locale='zh-TW'] 輸入語言設定(語言代碼或抓取套件 resolveLocale 之產物;理由之語言句取其稱呼)
 * @returns {Object} 回傳 domain 物件，含 relationTypes、conflictType、fallbackType、relationTypeRenames、relationTypeRoles(型別之語意角色;
 *   既有邊覆核之型別改正封閉清單)、conflictTypeNames(衝突型現名＋改名表之舊名)、vagueReasons(RS2 之空泛片語)、resolveType(raw)、
 *   seenTextOf(note, role, extra)、buildPrompt(targets, candidateMap)、buildReevalPrompt(items)、buildConflictCheckPrompt(items)、buildEdgeReviewPrompt(items)
 * @throws {Error} opt.vocab 不合規格時拋出(見 resolveRelateVocab;含關聯以外之鍵亦拋——與他段共用之詞彙表請先以 pickRelateVocab 取子集)、
 *   或 opt.prompts 不合規格(非物件、不認得之鍵、值非函數;覆寫函數於組提示詞時回傳非空字串以外者亦拋)時拋出
 * @example
 * let domain = createRelateDomain({})
 * console.log(domain.conflictType, domain.relationTypes.includes(domain.fallbackType))
 * // => 衝突或反例 true
 *
 * let d2 = createRelateDomain({ prompts: { reeval: (items, ctx) => `${ctx.defaultPrompt(items)}\n（附註）` } })
 * console.log(d2.buildReevalPrompt([]).endsWith('（附註）'))
 * // => true
 */
export function createRelateDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const vocab = resolveRelateVocab(opt.vocab)
    const custom = promptOverridesOf(opt.prompts, RELATE_PROMPT_SIGS, 'createRelateDomain')
    const kb = kbLabelOf(vocab)
    const L = resolveLocale(opt.locale, 'createRelateDomain 之 opt.locale').label // 輸出語言之稱呼(預設「繁體中文」,提示詞逐字不變)
    const g = vocab.guide.relate // 領域句(安裝方可經 vocab.guide.relate 逐欄覆寫;輸出格式留在本檔)
    /** 覆寫函數之末參數(抓取套件之 promptCtxOf;defaultPrompt＝該提示詞之內建函數) */
    const ctxOf = (defaultPrompt) => promptCtxOf(vocab, kb, defaultPrompt)

    /** 改名對照鏈之終點(在清單內者;resolveRelateVocab 已檢核無環) */
    const renameEnd = (t) => {
        let end = t
        const seen = new Set()
        while (!vocab.relationTypes.includes(end) && Object.hasOwn(vocab.relationTypeRenames, end) && !seen.has(end)) {
            seen.add(end)
            end = vocab.relationTypeRenames[end]
        }
        return vocab.relationTypes.includes(end) ? end : ''
    }

    /**
     * 型別解析(RS9、RS1′):清單內原樣;改名表、別名表對映;其餘回 ''
     *
     * @param {*} raw 輸入型別(模型輸出或既有邊之型別)
     * @returns {String} 回傳清單內之型別,無對映回 ''
     */
    function resolveType(raw) {
        const t = String(raw ?? '').trim()
        if (!t) return ''
        if (vocab.relationTypes.includes(t)) return t
        if (Object.hasOwn(vocab.relationTypeRenames, t)) return renameEnd(t)
        if (Object.hasOwn(vocab.relationTypeAliases, t)) return vocab.relationTypeAliases[t]
        return ''
    }

    // 提示詞之區塊(buildPrompt／buildReevalPrompt 與 seenTextOf 同一組函數)
    const targetLines = (t) => [`標題：${t.title}`, `類別：${t.category}｜${qualityTag(t)}`, `概念：${(t.concepts || []).join('、')}`, `重點：${oneline(t.summary, 200)}`]
    const candidateLine = (c) => `slug: ${c.id}｜標題: ${c.title}｜類別: ${c.category}｜${qualityTag(c)}｜概念: ${(c.concepts || []).join('、')}｜重點: ${oneline(c.summary, 80)}`
    // 筆記版型之章名(摘要套件之常數):提示詞所引之一句話重點、核心知識、適用條件之標籤與材料讀法同名
    const NT = NOTE_SECTION_TITLES
    const reevalTargetLines = (t, summary) => [`標題：${t.title}`, `類別：${t.category}｜${qualityTag(t)}`, `概念：${(t.concepts || []).join('、')}`, `${NT.summary}：${oneline(summary || t.summary, 2000)}`]
    const reevalNeighborLine = (c, e) => `slug: ${c.id}｜標題: ${c.title}｜類別: ${c.category}｜概念: ${(c.concepts || []).join('、')}｜重點: ${oneline(c.summary, 120)}｜現行型別: ${e.type}｜現行理由: ${oneline(e.reason, 200)}`
    // 衝突核對(檢定標準 RS4)之一方:一句話重點全文、核心知識與適用條件(條件互斥須看條件);清單各至多 8／6 條
    const listLines = (label, xs, n) => (isarr(xs) && xs.length ? [`${label}：`, ...xs.slice(0, n).map((x) => `- ${oneline(x, 200)}`)] : [])
    const checkSideLines = (n, extra = {}) => [`標題：${n.title}`, `類別：${n.category}｜${qualityTag(n)}`, `概念：${(n.concepts || []).join('、')}`, `${NT.summary}：${oneline(extra.summary || n.summary, 2000)}`,
        ...listLines(NT.keyPoints, extra.keyPoints, 8), ...listLines(NT.conditions, extra.conditions, 6)]

    /**
     * 某篇在提示詞中之區塊原文(RS8 之新進材料:模型實際看到之文字)
     *
     * @param {Object} note 輸入筆記記錄
     * @param {String} role 輸入 'target'(關聯之目標)｜'candidate'(候選列)｜'reevalTarget'(重評之目標;extra.summary＝一句話重點全文)｜
     *        'reevalNeighbor'(重評之鄰居列;extra.edge＝現行邊)｜'checkSide'(衝突核對之一方;extra.summary／keyPoints／conditions 取自 md)
     * @param {Object} [extra={}] 輸入 { summary, edge, keyPoints, conditions }
     * @returns {String} 回傳區塊原文
     */
    function seenTextOf(note, role, extra = {}) {
        const n = isobj(note) ? note : {}
        if (role === 'candidate') return candidateLine(n)
        if (role === 'reevalTarget') return reevalTargetLines(n, extra?.summary).join('\n')
        if (role === 'reevalNeighbor') return reevalNeighborLine(n, isobj(extra?.edge) ? extra.edge : {})
        if (role === 'checkSide') return checkSideLines(n, isobj(extra) ? extra : {}).join('\n')
        return targetLines(n).join('\n')
    }

    /**
     * 內建之單批關聯 prompt(正向、反向、輪巡同一支)
     *
     * @param {Array} targets 輸入待建立關聯之筆記陣列，各項需含 id、title、category、concepts、summary
     * @param {Map} candidateMap 輸入各目標之候選清單對照(筆記 id → 候選筆記陣列)
     * @returns {String} 回傳 prompt 字串
     */
    function builtinPrompt(targets, candidateMap) {
        if (!isarr(targets)) targets = []
        if (!(candidateMap instanceof Map)) candidateMap = new Map()
        const blocks = targets.map((t, i) => {
            const cands = candidateMap.get(t.id) || []
            const list = cands.map((c) => `  - ${candidateLine(c)}`).join('\n')
            return [
                `--- 第${i + 1}篇（待建立關聯）---`,
                ...targetLines(t),
                `候選關聯對象：`,
                list || '  （無候選）',
            ].join('\n')
        }).join('\n\n')

        return `你是${kb}的關聯建立器。針對每一篇「待建立關聯」的筆記，從它自己的候選清單中找出真正有知識關聯的對象。

要求：
1. 只能選候選清單內出現過的 slug，不可自創 slug。
2. 每篇最多選 4 個，寧缺勿濫：只有題材撞名、${g.broadRelation}這種泛泛關係，不算關聯，請不要選。
3. type 從此清單擇一：${vocab.relationTypes.join('、')}。
4. reason 用${L}一句話說明兩篇之間的具體關聯（要指出共同的機制、參數或前提，不可只寫「${g.vagueReason}」）。
5. **主動獵取衝突**：兩篇${CONFLICT_DEFINITION.same}時，務必選為「${vocab.conflictType}」並在 reason 寫明衝突的具體內容（甲說 X、乙說 Y）；回答不同問題、或可以同時成立者（${CONFLICT_DEFINITION.compatible}）不是衝突，依實際關聯選型別。衝突是知識庫裡最有價值的關聯——觀點本就多元、利弊會${g.changeDrivers}，絕不可因為衝突而不選、或硬把衝突寫成互補。
6. 若某篇確實找不到夠格的關聯，relations 給空陣列。

只回覆 JSON 陣列，不要任何其他說明文字，格式：
[{"index":1,"relations":[{"to":"候選slug","type":"${vocab.relationTypes[1] || vocab.fallbackType}","reason":"..."}]}]

${blocks}`
    }

    /**
     * 內建之單批重評 prompt(內容變更之筆記 × 其既有關聯之一頁;stages/reevalSegment)。
     *   拿不準回 unsure(判定小組之合法裁決,不以 keep 代替——未判不記已審);改為衝突須寫得出「甲說 X、乙說 Y」;
     *   原為衝突而結論不再相反者改為適當之非衝突型別,仍有知識關聯就不撤銷。不列提案方向(提案方向非語意方向)。
     *
     * @param {Array} items 輸入 [{ target:筆記記錄, summary:一句話重點全文, neighbors:[{ note:鄰居記錄, edge:現行邊 }] }]
     * @returns {String} 回傳 prompt 字串
     */
    function builtinReevalPrompt(items) {
        if (!isarr(items)) items = []
        const blocks = items.map((it, i) => {
            const t = it.target || {}
            const list = (it.neighbors || []).map(({ note: c, edge: e }) => `  - ${reevalNeighborLine(c, e)}`).join('\n')
            return [
                `--- 第${i + 1}項（內容已更新之筆記）---`,
                ...reevalTargetLines(t, it.summary),
                `既有關聯：`,
                list || '  （無）',
            ].join('\n')
        }).join('\n\n')

        return `你是${kb}的關聯覆核器。下列每一項是一篇「內容已更新」的筆記，以及它目前既有的關聯（每條附對象筆記、現行型別與理由）。請依筆記的新內容，逐條裁決每一條既有關聯：

裁決：
1. keep：關聯仍成立（型別與理由仍適用）。只有能具體指出新內容哪一點改變了關聯時，才可 change 或 retire。
2. change：關聯仍在但型別或理由須調整。type 從此清單擇一：${vocab.relationTypes.join('、')}；type 與現行相同表示只更新理由。reason 用${L}一句話寫出新的具體關聯（指出共同的機制、參數或前提，不可只寫「${g.vagueReason}」）。
3. retire：新內容與對象已沒有知識關聯（不是「變弱」，而是不再有共同的機制、參數或前提）；reason 寫明新內容中哪一點使關聯不再成立。只有題材撞名、${g.broadRelation}這種泛泛關係，也算沒有關聯。
4. 衝突：兩篇${CONFLICT_DEFINITION.same}時為「${vocab.conflictType}」；回答不同問題、或可以同時成立者（${CONFLICT_DEFINITION.compatible}）不是衝突。reason 必須寫出衝突的具體內容（甲說 X、乙說 Y）；寫不出就不要改為衝突。現行為「${vocab.conflictType}」而新內容與對象之結論已不再相反者，改為適當之非衝突型別——仍有知識關聯就不要撤銷。
5. unsure：材料不足以判斷這條關聯是否仍成立（例如新內容與對象之關係說不清、無法確認是否指同一件事）；拿不準就回 unsure，不要猜，也不要用 keep 代替不確定。
6. 每一條既有關聯都要回一個裁決，以對象之 slug 指稱；只能用該項列出之 slug。

只回覆 JSON 陣列，不要任何其他說明文字，格式：
[{"index":1,"verdicts":[{"to":"對象slug","verdict":"keep","reason":"..."},{"to":"對象slug","verdict":"change","type":"${vocab.relationTypes[1] || vocab.fallbackType}","reason":"..."},{"to":"對象slug","verdict":"retire","reason":"..."},{"to":"對象slug","verdict":"unsure","reason":"..."}]}]

${blocks}`
    }

    /**
     * 內建之單批衝突核對 prompt(檢定標準 RS4;stages/conflictCheckSegment):每項一對筆記與其現行(或被提議)之衝突型關聯,
     *   判是否為真衝突。不確定為合法裁決(unsure;由判定小組叫第三席或列未能判定),不要求模型猜。
     *   項之編號由呼叫端給(第二席之順序打亂而編號不變,以編號對回)。
     *   現行理由確定未達標準(RS2／RS3／RS8;段以存量材料判,standards/edgeGate 之 reasonRewriteProblemsOf)之項,呼叫端給 edge.reasonProblem,
     *   該項之「現行理由」行另附「須以 change 改寫、
     *   不可 keep」之指示——只在有此項時出現,其餘項逐字不變(keep 之 reason 未定義為理由,不可拿來改寫邊,故明示要求 change)。
     *
     * @param {Array} items 輸入 [{ index:Integer, a:{ note, extra }, b:{ note, extra }, edge:{ type, reason, reasonProblem? } }](extra 同 seenTextOf 之 checkSide)
     * @returns {String} 回傳 prompt 字串
     */
    function builtinConflictCheckPrompt(items) {
        if (!isarr(items)) items = []
        const others = vocab.relationTypes.filter((t) => t !== vocab.conflictType)
        const blocks = items.map((it) => [
            `--- 第${it.index}項 ---`,
            `【甲】`,
            ...checkSideLines(it.a?.note || {}, it.a?.extra || {}),
            `【乙】`,
            ...checkSideLines(it.b?.note || {}, it.b?.extra || {}),
            `現行型別：${it.edge?.type || vocab.conflictType}`,
            `現行理由：${oneline(it.edge?.reason, 300)}${it.edge?.reasonProblem ? `（現行理由未達標準：${oneline(it.edge.reasonProblem, 120)}——是真衝突者須以 change（type 填「${vocab.conflictType}」）改寫為「甲說…；乙說…」，不可 keep）` : ''}`,
        ].join('\n')).join('\n\n')

        return `你是${kb}的衝突核對器。下列每一項是一對筆記（甲、乙），以及它們之間被標為「${vocab.conflictType}」的關聯與理由。請逐項判斷這是不是真衝突。

判準：
- 真衝突＝甲乙${CONFLICT_DEFINITION.same}；理由必須寫出雙方各自的主張（甲說 X、乙說 Y）。
- 甲乙回答的是不同問題、或兩者可以同時成立（例如${CONFLICT_DEFINITION.compatible}），都不是衝突。
- 只有題材撞名、${g.broadRelation}這種泛泛關係，不算有知識關聯。

裁決（每項一個）：
1. keep：是真衝突，而且現行理由已經寫出雙方各自的具體主張（甲主張什麼、乙主張什麼；措辭簡短也算，不要為了把理由寫得更完整而改用 change）。
2. change：
   - type 填「${vocab.conflictType}」：是真衝突，但現行理由「沒有」寫出雙方各自的具體主張（例如只寫「看法不同」「結論不一致」「可對照閱讀」）；reason 改寫成「甲說…；乙說…」的形式。
   - type 填其他型別（${others.join('、')}）：不是衝突，但甲乙仍有知識關聯；reason 用一句話寫出具體關聯（指出共同的機制、參數或前提，不可只寫「${g.vagueReason}」）。
3. retire：甲乙沒有知識關聯；reason 寫明為何沒有。
4. unsure：材料不足以判斷（例如重點太簡略，無法確認雙方是否在談同一問題或同一條件）；reason 寫明缺什麼。拿不準就回 unsure，不要猜。
reason 一律用${L}、至少十個字。

只回覆 JSON 陣列，每項一個物件，以項之編號對應，不要任何其他說明文字，格式：
[{"index":1,"verdict":"keep","reason":"..."},{"index":2,"verdict":"change","type":"${vocab.conflictType}","reason":"甲說…；乙說…"},{"index":3,"verdict":"change","type":"${others[0] || vocab.fallbackType}","reason":"..."},{"index":4,"verdict":"retire","reason":"..."},{"index":5,"verdict":"unsure","reason":"..."}]

${blocks}`
    }

    /**
     * 內建之單批既有邊覆核 prompt(檢定標準 RS6;stages/edgeReviewSegment):每項一對筆記與其現行之非衝突型關聯(兩篇內容自建立後皆未變),
     *   判關聯是否成立、型別是否正確(含漏標之衝突)、理由是否具體。不確定為合法裁決(unsure)。材料與 RS4 同一組區塊(seenTextOf 'checkSide')。
     *   現行型別已不在型別清單者(型別退役而未宣告改名),該項之「現行型別」行另附須改為清單內型別之指示——只在有此項時出現,其餘項逐字不變。
     *   現行理由確定未達標準(RS2／RS3／RS8)之項同 RS4:呼叫端給 edge.reasonProblem,該項另附「須以 change 改寫理由、不可 keep」(只在有此項時出現)。
     *
     * @param {Array} items 輸入 [{ index:Integer, a:{ note, extra }, b:{ note, extra }, edge:{ type, reason } }](extra 同 seenTextOf 之 checkSide)
     * @returns {String} 回傳 prompt 字串
     */
    function builtinEdgeReviewPrompt(items) {
        if (!isarr(items)) items = []
        const offListNote = (t) => (t && !vocab.relationTypes.includes(t) ? `（「${t}」已不在型別清單：有知識關聯者須 change 為清單內最符合兩篇關係之型別，不可 keep）` : '')
        const blocks = items.map((it) => [
            `--- 第${it.index}項 ---`,
            `【甲】`,
            ...checkSideLines(it.a?.note || {}, it.a?.extra || {}),
            `【乙】`,
            ...checkSideLines(it.b?.note || {}, it.b?.extra || {}),
            `現行型別：${it.edge?.type || ''}${offListNote(it.edge?.type)}`,
            `現行理由：${oneline(it.edge?.reason, 300)}${it.edge?.reasonProblem ? `（現行理由未達標準：${oneline(it.edge.reasonProblem, 120)}——有知識關聯者須以 change 改寫理由，不可 keep；只因理由不合格者 type 填現行型別）` : ''}`,
        ].join('\n')).join('\n\n')

        const [impl, ext] = [vocab.relationTypeRoles?.implementation, vocab.relationTypeRoles?.extension]
        const sibling = [vocab.relationTypeRoles?.sibling, vocab.relationTypeRoles?.complement].filter(Boolean)
        const typeRules = impl && ext && sibling.length
            ? `（只有下列兩種情形算型別錯，其餘一律維持現行型別——兩篇之關係常可用不只一種型別描述，不要改成另一個也說得通的型別）：
   (a) ${g.implementationCase}，現行卻標為「${sibling.join('」或「')}」→ 改為「${impl}」；
   (b) ${g.extensionCase}，現行卻標為「${sibling.join('」或「')}」→ 改為「${ext}」。`
            : '（只有型別與兩篇之關係明顯不符才算型別錯，其餘一律維持現行型別——不要改成另一個也說得通的型別）。'

        return `你是${kb}的既有關聯覆核器。下列每一項是一對筆記（甲、乙），以及它們之間現有的關聯（型別與理由）；這條關聯建立後，兩篇的內容都沒有變更。請依下列順序逐項判斷。

步驟：
1. 有沒有知識關聯：甲乙之間有共同的機制、參數、前提、資料或方法，讀其中一篇有助於理解或運用另一篇，才算有；只有題材撞名、${g.broadRelation}這種泛泛關係，不算有 → retire。
2. 是不是衝突：甲乙${CONFLICT_DEFINITION.same}，就是「${vocab.conflictType}」；回答不同問題、或可以同時成立者（${CONFLICT_DEFINITION.compatible}）不是衝突。是衝突而現行未標為衝突 → change，type 填「${vocab.conflictType}」，reason 寫「甲說…；乙說…」。
3. 型別是否錯${typeRules}
4. 理由是否具體：理由須點出甲乙各自的具體內容（指名共同的機制、參數、指標、資料或方法；措辭簡短也算）。只寫兩者之關係類別或籠統說法（例如「${g.vagueReason}」「兩者相關」「主題相近」「可以一起看」「可互相參考」）而沒有點出具體內容，即不具體。

裁決（每項一個）：
1. keep：有關聯、不是漏標之衝突、型別不屬第 3 步之錯、理由具體——不要為了把理由寫得更完整而改用 change。
2. change：第 2 步漏標之衝突、第 3 步之型別錯、或第 4 步理由不具體。只因理由不具體而 change 時，type 填現行型別（只改理由）。reason 用一句話寫出具體關聯。
3. retire：第 1 步判定沒有知識關聯；reason 寫明為何沒有。
4. unsure：材料不足以判斷（例如重點太簡略，無法確認兩篇是否談同一機制或同一條件）；reason 寫明缺什麼。拿不準就回 unsure，不要猜。
type 只能從此清單擇一：${vocab.relationTypes.join('、')}。reason 一律用${L}、至少十個字。

只回覆 JSON 陣列，每項一個物件，以項之編號對應，不要任何其他說明文字，格式：
[{"index":1,"verdict":"keep","reason":"..."},{"index":2,"verdict":"change","type":"${vocab.relationTypes.find((t) => t !== vocab.conflictType) || vocab.fallbackType}","reason":"..."},{"index":3,"verdict":"change","type":"${vocab.conflictType}","reason":"甲說…；乙說…"},{"index":4,"verdict":"retire","reason":"..."},{"index":5,"verdict":"unsure","reason":"..."}]

${blocks}`
    }

    // ── 對外之提示詞:有覆寫者交覆寫函數(opt.prompts;收經正規化之原參數＋ctx,回傳須為非空字串——呼叫期檢查),否則用內建(抓取套件之 overridablePrompt)──
    const listArg = (items) => [isarr(items) ? items : []]
    /** 組單批關聯 prompt (targets, candidateMap:Map(筆記 id → 候選筆記陣列)) => String(正向、反向、輪巡同一支) */
    const buildPrompt = overridablePrompt(custom, 'relate', builtinPrompt, { ctxOf, norm: (targets, candidateMap) => [isarr(targets) ? targets : [], candidateMap instanceof Map ? candidateMap : new Map()] })
    /** 組單批重評 prompt (items:[{ target, summary, neighbors:[{ note, edge }] }]) => String */
    const buildReevalPrompt = overridablePrompt(custom, 'reeval', builtinReevalPrompt, { ctxOf, norm: listArg })
    /** 組單批衝突核對 prompt (items:[{ index, a:{ note, extra }, b:{ note, extra }, edge:{ type, reason, reasonProblem? } }]) => String */
    const buildConflictCheckPrompt = overridablePrompt(custom, 'conflictCheck', builtinConflictCheckPrompt, { ctxOf, norm: listArg })
    /** 組單批既有邊覆核 prompt (items:同衝突核對) => String */
    const buildEdgeReviewPrompt = overridablePrompt(custom, 'edgeReview', builtinEdgeReviewPrompt, { ctxOf, norm: listArg })

    return {
        relationTypes: vocab.relationTypes,
        conflictType: vocab.conflictType,
        fallbackType: vocab.fallbackType,
        relationTypeRenames: { ...vocab.relationTypeRenames },
        relationTypeRoles: { ...vocab.relationTypeRoles }, // 型別之語意角色(既有邊覆核 RS6 之型別改正封閉清單;詞彙表之 RELATION_ROLE_NAMES 推導)
        conflictTypeNames: [vocab.conflictType, ...Object.keys(vocab.relationTypeRenames).filter((k) => renameEnd(k) === vocab.conflictType)],
        vagueReasons: [g.vagueReason, g.broadRelation].filter(Boolean), // RS2:理由去掉這些空泛片語後須 ≥10 字
        resolveType,
        seenTextOf,
        buildPrompt,
        buildReevalPrompt,
        buildConflictCheckPrompt,
        buildEdgeReviewPrompt,
    }
}


export default createRelateDomain
