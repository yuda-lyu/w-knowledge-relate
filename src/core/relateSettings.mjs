// relateSettings.mjs — 關聯之設定預設值、schema 與解析(安裝即用;執行端 cfg 逐鍵覆寫)
//
// 【兩段＋總覽標題】ai(AI 調度層:摘要套件之 ai 段——抓取套件之 ai 段＋parallel＋健康降序;本套件以 RELATE_AI_* 之名轉出同一物件,不另寫)、
//   relate(關聯之全部設定)、relationIndexTitle(關聯總覽之標題)。relate 依關聯之要點分組:要點 1 從無到有創建關聯(正向)、
//   要點 2 新知識加入時擴充關聯(反向、候選輪巡)、要點 3 知識變更時調整關聯(重評)、檢定標準(standards)。
//   AI 席位放在用到它的那一組(鍵名一律 ai)。推導值在 capacity(唯讀)。
// 【合併】組(物件節點)逐鍵遞迴合併:只給想調的鍵,其餘沿用預設;葉(席位)給了即整個取代。合併與型別規則一律取抓取套件之
//   mergeSettingsGroup／SETTING_TYPES(各套件同一份規則,不另寫);只本段用得到之型別(重評之套用閘門、完成期限)以 RELATE_SETTING_TYPES
//   經其 opt.types 帶入,席位之型別(seat／seatOrNull)沿用抓取套件者。
// 【免費 AI 為主】關聯之預設席位全為免費模型(opencode CLI 之匿名免費存取,免金鑰);反向段、輪巡未給席位即沿用關聯席位;判定小組預設全空且關閉。
//   付費家由安裝方加於 fallback 尾。
// 【設定錯誤一律啟動期拋錯,不靜默回預設】各組之鍵以 schema 逐鍵驗型別與值域、不認得之鍵拋錯、組給了但形狀錯亦拋——
//   安裝方之設定是刻意為之,靜默改用套件預設(如席位退回預設家、'27' 被算成字串)比拋錯更難察覺。
// 【容量自洽】關聯之每輪容量須 ≥ 筆記進料之上界——寧可稍慢,不可讓新筆記串不進知識網而持續堆積。進料上界屬上游之推導(如摘要之筆記產出上界),
//   由組裝者以 relateWarningsOf 之 inflow 給;只警告「進料 > 容量」,不警告「容量閒置」:容量是上限不是成本(批次池空即停,不空轉)。
// 【判定小組】兩票之實際成交供應者須不同才成立:已開啟之小組,其一起投票之兩席首選同家且無首選不同之第三席者,啟動期警告(永遠無法成立)。
//   小組之組成、同家之判定與警告之字樣取摘要套件之判定小組設定面(panelConfig;三工作同一份);小組之開啟與成員之必填由功能表(RELATE_FEATURES)推導。
// 【功能表】檢定標準與重評之各功能(稱呼、開啟判準、判定小組之必填席、所需之 domain 成員)只在 RELATE_FEATURES:執行期件之啟動期檢核、
//   各段之執行期檢核(抓取套件之 featureProblemsOf)、判定小組之必填與席位檢核工具同讀。

import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { mergeSettingsGroup, featureProblemsOf, seatsFrom, seatLabelsFrom, checkKeys } from './capturePackage.mjs'
import { SUMMARIZE_AI_DEFAULT, SUMMARIZE_AI_SCHEMA, PANEL_SCHEMA, panelGroupOf, panelSameProviderWarnings, panelSeatRowsOf, notesInflowProblem } from './summarizePackage.mjs'


/** ai 段之預設:摘要套件之 ai 段(抓取套件之 AI 調度層預設＋健康降序＋同時併發之 AI 呼叫數;同一物件,不另寫) */
export const RELATE_AI_DEFAULT = SUMMARIZE_AI_DEFAULT

/** ai 段之 schema:摘要套件之 ai 段(同一物件,不另寫) */
export const RELATE_AI_SCHEMA = SUMMARIZE_AI_SCHEMA

/** 關聯總覽之預設標題(總覽子階段未給標題、設定亦未給時用之) */
export const RELATE_INDEX_TITLE = '知識關聯總覽'

/** 關聯(relate)之預設 */
export const RELATE_DEFAULT = {
    // ── 要點 1:從無到有創建關聯——新筆記(與內容變更之筆記)與既有筆記比對(正向段)──
    rounds: 2, // 正向輪數;關聯容量＝本值×ai.parallel×notesPerCall(2×3×6＝36 篇/輪)
    notesPerCall: 6, // 每次 AI 呼叫比對幾篇
    // 每篇給 AI 之既有筆記候選數(依共享概念挑選):候選再多會稀釋模型判斷力;6 篇×25 候選之提示詞約 4.0～4.4 萬字元,
    //   超過命令列型供應商長度上限者由 AI 調度層於呼叫前改由遞補承接
    candidatesPerNote: 25,
    // 席位 { use, fallback?, timeoutMs?, minAttemptMs?, budgetMs? }:預設全為免費模型;付費家由安裝方加於 fallback 尾
    ai: { use: 'oc:opencode/mimo-v2.6-flash-free', fallback: ['oc:opencode/big-pickle'] },

    // ── 要點 2:新知識加入時擴充關聯 ──
    // 反向段:新筆記加入後,讓「若現在重判會把它排進前 K 名」之舊筆記以同一提示詞判一次。每輪至多幾個舊筆記目標;
    //   0＝停用(不算對、不落帳);開啟前宜以正式提示詞與正式席位評比反向之形狀(候選只有少數新筆記)
    reverse: {
        perRun: 0,
        ai: null, // 席位;null＝沿用 relate.ai(反向段為可延後之盡力工作,可另給只含免費家之鏈)
    },
    // 候選輪巡(檢定標準 RS10):每輪至多幾篇已關聯之舊筆記,以正向提示詞比對其共享概念候選清單之下一頁(正向只看前 candidatesPerNote 名;
    //   兩篇皆舊而彼此皆在前 K 名之外者從未比對)。席位同反向段;0＝停用
    rotation: {
        perRun: 0,
    },

    // ── 要點 3:知識變更時調整關聯——內容變更之筆記於正向重判後,其既有邊逐條裁決保留／改型／撤銷(重評,檢定標準 RS5)──
    reeval: {
        perRun: 0, // 每輪至多幾篇(0＝停用)
        pagesPerRun: 24, // 每輪至多幾頁
        pageSize: 10, // 每頁幾條邊
        // 套用閘門:false(只記候選帳)｜'additive'(升為衝突、非衝突間改型、理由更新)｜'all'(另含撤銷與衝突降級)——
        //   含標準答案之題組以正式兩席逐案達標前維持 false
        apply: false,
        maxTries: 3, // 同一篇逾此次數未評完即登錄待判(負責者為使用者)
        guard: 20, // 單輪待重評篇數逾此即不開工(防批次改寫一次排入大量重評;確認後以 reevalBaseline 重設基準)
        // 同一頁送 first、second 各評一次,判定小組成立才算判定;前兩席判不成者由 third 補判(缺則直接未能判定)。
        //   first null＝沿用 relate.ai;second null＝以 first 再評一次(同一家 → 永不成立);停用只由 perRun 0 表達
        ai: { first: null, second: null, third: null },
    },

    // ── 檢定標準 ──
    standards: {
        // 衝突核對(RS4):開啟時正向／反向之新衝突(新建或由非衝突升級)不直接落地,以提案席＋核對席(ai.first;未成立叫 ai.third)判定
        //   真衝突才寫入;並消化 RS4 待判與存量衝突邊(每輪 perRun 條,0＝不核存量;存量與待判之既有邊另需 ai.second)。
        //   開啟條件:衝突核對之評分題組以正式席位逐案兩次全過
        conflictCheck: {
            enabled: false,
            perRun: 0,
            pageSize: 10,
            maxTries: 3, // 待判逾此次數改由使用者判讀
        },
        // 既有邊覆核(RS6):開啟時非衝突型之既有邊以兩席＋第三席判關聯成立、型別正確(含漏標之衝突)、理由具體——改理由／改型／升為衝突
        //   (過納入閘)、無關聯撤出(可還原)、判不了隔離(可還原)＋待判。first、second 必填。
        //   開啟條件:既有邊覆核之評分題組以正式席位逐案兩次全過
        edgeReview: {
            enabled: false,
            perRun: 0, // 每輪至多幾條(0＝只消化待判)
            pageSize: 10,
            maxTries: 3,
            // 完成期限:ISO 日期('YYYY-MM-DD' 或含時刻;只給日期者以該日終為期限),'' 不設。給了即隨關聯段報告帶出(rs6Deadline),
            //   供外部巡檢依近輪消化速度判「趕不上」或「已逾期仍有未核」
            deadline: '',
        },
        // 衝突核對與既有邊覆核共用之判定小組;兩票之實際成交供應者須不同才成立,故三席宜取不同家族
        ai: { first: null, second: null, third: null },
        // 符合度掃描:每輪管線結束後掃一次關聯之確定性標準(RS*;不呼叫 AI),違反數入執行摘要。
        //   預設關閉:掃描逐邊讀兩端筆記,大庫耗時;由安裝端依庫規模開啟
        scanEachRun: false,
    },
}

/**
 * 本段專屬之設定型別(名稱 → { test, desc };經抓取套件 mergeSettingsGroup 之 opt.types 帶入,不加進各段共用之型別表)
 *
 * @type {Object}
 */
export const RELATE_SETTING_TYPES = Object.freeze({
    // 重評之套用閘門
    reevalApply: Object.freeze({ test: (v) => v === false || v === 'additive' || v === 'all', desc: "false｜'additive'｜'all'" }),
    // 期限:''(不設)或 ISO 日期／時刻字串(可解析者)
    dateOrEmpty: Object.freeze({
        test: (v) => v === '' || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\S+)?$/.test(v) && !Number.isNaN(Date.parse(v))),
        desc: "''（不設）或 ISO 日期字串（YYYY-MM-DD 或含時刻，如 2026-12-31T23:59:59+08:00）",
    }),
})

/** relate 段之 schema(與 RELATE_DEFAULT 同形;節點為字串＝葉之型別名,為物件＝組) */
export const RELATE_SCHEMA = {
    rounds: 'p0int', notesPerCall: 'pint', candidatesPerNote: 'pint', ai: 'seat',
    reverse: { perRun: 'p0int', ai: 'seatOrNull' },
    rotation: { perRun: 'p0int' },
    reeval: { perRun: 'p0int', pagesPerRun: 'pint', pageSize: 'pint', apply: 'reevalApply', maxTries: 'pint', guard: 'pint', ai: PANEL_SCHEMA },
    standards: {
        conflictCheck: { enabled: 'bool', perRun: 'p0int', pageSize: 'pint', maxTries: 'pint' },
        edgeReview: { enabled: 'bool', perRun: 'p0int', pageSize: 'pint', maxTries: 'pint', deadline: 'dateOrEmpty' },
        ai: PANEL_SCHEMA,
        scanEachRun: 'bool',
    },
}


/**
 * 關聯之每輪容量(由已解析設定推導之唯一來源;容量自洽檢核與外部巡檢取用,不另推導)
 *
 * @param {Object} settings 輸入已解析之設定(resolveRelateSettings 之產物,或同形之 { ai, relate })
 * @returns {Object} 回傳 { relate:關聯容量＝relate.rounds×ai.parallel×relate.notesPerCall }
 * @example
 * console.log(relateCapacityOf(resolveRelateSettings({})))
 * // => { relate: 36 }
 */
export function relateCapacityOf(settings) {
    const { ai, relate } = settings
    return { relate: relate.rounds * ai.parallel * relate.notesPerCall }
}

/**
 * 容量之推導式說明(警告與巡檢訊息引用;式之單一來源為 relateCapacityOf)
 *
 * @type {Object}
 */
export const RELATE_CAPACITY_DESC = Object.freeze({
    relate: 'relate.rounds×ai.parallel×relate.notesPerCall',
})

/** 未設任何逾時時之單次呼叫逾時(毫秒;同 AI 調度層 ai.timeoutMs 之預設) */
const CALL_TIMEOUT_FALLBACK_MS = 300_000

/**
 * 開工門檻:一次 AI 呼叫所需之時間——各席首選家之單次逾時(ai.providerTimeouts[席位之 use] → ai.timeoutMs → 300000)取最大者。
 *   正向段(有保留時)與選配段(反向、輪巡、重評、既有邊覆核、衝突核對)扣保留時間後須夠此數才開工;各段同一函數,席位集合由各段給
 *
 * @param {Object} settings 輸入已解析之設定(取 ai)
 * @param {Object|Array} seats 輸入席位或席位陣列(非物件者略過;全無時以 ai.timeoutMs → 300000 計)
 * @returns {Number} 回傳毫秒數
 * @example
 * console.log(callTimeoutMsOf({ ai: { timeoutMs: 1000, providerTimeouts: { 'x:a': 5000 } } }, [{ use: 'x:a' }, { use: 'x:b' }]))
 * // => 5000
 */
export function callTimeoutMsOf(settings, seats) {
    const ai = isobj(settings?.ai) ? settings.ai : {}
    const of = (seat) => Number(ai.providerTimeouts?.[seat?.use]) || Number(ai.timeoutMs) || CALL_TIMEOUT_FALLBACK_MS
    const list = (Array.isArray(seats) ? seats : [seats]).filter(isobj)
    return list.length ? Math.max(...list.map(of)) : of(null)
}


/**
 * 關聯之功能表(唯一一份;抓取套件之 featureProblemsOf 之表):重評與檢定標準之各功能——稱呼(含開啟之設定)、開啟判準、判定小組之必填席、
 *   所需之關聯 domain 之函數成員。重評之兩席皆有沿用之規則(first 未設即 relate.ai、second 未設即 first),故無必填席;衝突核對之新衝突以
 *   提案席為另一票,只須 first(既有邊另需 second,未設時既有邊不核——見 stages/conflictCheckSegment);既有邊覆核無提案席,first、second 皆須給。
 *   執行期件之啟動期檢核、各段之執行期檢核(relateFeatureProblems)、判定小組之開啟與成員之必填(relatePanelsOf)、席位檢核工具同讀
 *
 * @type {Array}
 */
export const RELATE_FEATURES = Object.freeze([
    {
        key: 'reeval',
        what: '關聯重評(relate.reeval.perRun > 0)',
        on: (s) => s?.relate?.reeval?.perRun > 0,
        panel: { path: 'relate.reeval.ai', seats: [] },
        members: ['buildReevalPrompt'],
    },
    {
        key: 'conflictCheck',
        what: '衝突核對(relate.standards.conflictCheck.enabled)',
        on: (s) => s?.relate?.standards?.conflictCheck?.enabled === true,
        panel: { path: 'relate.standards.ai', seats: ['first'] },
        members: ['buildConflictCheckPrompt'],
    },
    {
        key: 'edgeReview',
        what: '既有邊覆核(relate.standards.edgeReview.enabled)',
        on: (s) => s?.relate?.standards?.edgeReview?.enabled === true,
        panel: { path: 'relate.standards.ai', seats: ['first', 'second'] },
        members: ['buildEdgeReviewPrompt'],
    },
].map((x) => Object.freeze(x)))

/**
 * 關聯之功能之問題(功能表之單一判定;抓取套件之 featureProblemsOf):已開啟之功能所需之判定小組必填席與關聯 domain 之函數成員
 *
 * @param {Object} settings 輸入已解析之設定(取 relate)
 * @param {Object} domain 輸入關聯 domain(非物件視為缺全部成員)
 * @param {Object} [o={}] 輸入 { enabled?:Array(開啟之功能鍵;各段之選項覆寫設定時用), domainLabel?:String }
 * @returns {Array} 回傳問題說明陣列(無問題為空陣列)
 * @example
 * console.log(relateFeatureProblems(resolveRelateSettings({ relate: { standards: { edgeReview: { enabled: true } } } }), {}))
 * // => [ '既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但缺席位 settings.relate.standards.ai.first、settings.relate.standards.ai.second',
 * //      '既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但 domain 缺 buildEdgeReviewPrompt' ]
 */
export function relateFeatureProblems(settings, domain, o = {}) {
    return featureProblemsOf(RELATE_FEATURES, settings, domain, o)
}

/**
 * 判定小組之定義(唯一一份;摘要套件之 panelConfig 之小組定義):成員(members 之索引)與一起投票之組合(ballots:[首票, 次票, 第三席])——
 *   判定須兩票明確、相同、且實際成交之供應者不同才成立;未成立而可成立者叫第三席。
 *   ①重評(RS5):first 未設即沿用 relate.ai、second 未設即以 first 再評(兩席皆有沿用之值,故以不具 key 之成員明定必填)。
 *   ②衝突核對／既有邊覆核(RS4／RS6;共用 relate.standards.ai):既有邊＝first＋second(＋third);衝突核對之新衝突＝提案席(正向／反向段之
 *     實際成交者;首選取 relate.ai、relate.reverse.ai)＋first(＋third)——衝突核對開啟或兩者皆未開啟時列提案之組合,只開既有邊覆核時不列;
 *     first／second 之必填由已開啟之功能推導(只開衝突核對時 second 非必填)
 *
 * @type {Array}
 */
const PANEL_DEFS = Object.freeze([
    {
        std: 'RS5',
        path: 'relate.reeval.ai',
        name: '關聯重評',
        members: (s) => [
            { label: 'first（未設即 relate.ai）', seat: relateSeatOf(s, 'reeval.first'), required: true },
            { label: 'second（未設即 first）', seat: relateSeatOf(s, 'reeval.second'), required: true },
            { label: 'third', seat: relateSeatOf(s, 'reeval.third'), required: false },
        ],
    },
    {
        std: 'RS4／RS6',
        path: 'relate.standards.ai',
        name: '衝突核對／既有邊覆核',
        members: (s) => [
            ...['first', 'second', 'third'].map((k) => ({ key: k, label: k, seat: s.relate.standards.ai[k] })),
            { label: '提案席 relate.ai', seat: s.relate.ai, required: false },
            ...(s.relate.reverse.ai ? [{ label: '提案席 relate.reverse.ai', seat: s.relate.reverse.ai, required: false }] : []),
        ],
        ballots: (s, on) => [
            [0, 1, 2],
            ...(on.has('conflictCheck') || !on.has('edgeReview') ? [[3, 0, 2], ...(s.relate.reverse.ai ? [[4, 0, 2]] : [])] : []),
        ],
    },
].map((x) => Object.freeze(x)))

/**
 * 關聯之判定小組(席位檢核工具與啟動期同家警告同讀;呼叫端不另寫小組之組成;摘要套件之 panelGroupOf):各組之標準、設定路徑、名稱、是否開啟、
 *   成員(顯示名、席位〔null＝未設〕、是否必填——由功能表推導)與一起投票之組合(ballots:[首票, 次票, 第三席] 之成員索引)
 *
 * @param {Object} settings 輸入已解析之設定(取 relate;本套件或組裝者之 resolve 產物皆可)
 * @returns {Array} 回傳 [{ std, path, name, on:Boolean, members:[{ label, seat:Object|null, required:Boolean }], ballots:[[i, j, k]] }](無 relate 段回 [])
 * @example
 * console.log(relatePanelsOf(resolveRelateSettings({})).map((g) => `${g.std}:${g.on}`))
 * // => [ 'RS5:false', 'RS4／RS6:false' ]
 */
export function relatePanelsOf(settings) {
    if (!isobj(settings?.relate)) return []
    return PANEL_DEFS.map((d) => panelGroupOf(d, settings, RELATE_FEATURES))
}

/**
 * 關聯之啟動期警告:容量自洽(只在組裝者給進料上界時判;只警告「進料 > 容量」)、已開啟之判定小組兩席同家。resolveRelateSettings 之
 *   warnings 即本函數不給 inflow 之結果;他總組裝以自己解析之同形設定(含 relate、ai.parallel;其 ai 段可另有本套件不收之鍵)取同一組警告,
 *   不另寫判準與字樣
 *
 * @param {Object} settings 輸入已解析之設定 { ai, relate }
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.inflow] 輸入筆記進料之上界 { max:非負數(篇/輪), desc:非空字串(推導式說明,入警告訊息) },未給則不判容量
 * @returns {Array} 回傳警告字串陣列(容量在前,其次重評、衝突核對／既有邊覆核之判定小組)
 * @throws {Error} opt.inflow 給了而形狀不符時拋出
 * @example
 * console.log(relateWarningsOf(resolveRelateSettings({}), { inflow: { max: 40, desc: '上游產出上界' } }).length)
 * // => 1
 */
export function relateWarningsOf(settings, opt = {}) {
    const inflow = isobj(opt) ? opt.inflow : undefined
    const warnings = []
    if (inflow !== undefined && inflow !== null) {
        // 形狀之判準與字樣取摘要套件之 notesInflowProblem(筆記進料上界之產出者;下游各關同讀)
        const p = notesInflowProblem(inflow)
        if (p) throw new Error(`relateWarningsOf 之 opt.inflow ${p}`)
        const cap = relateCapacityOf(settings).relate
        if (inflow.max > cap) {
            warnings.push(`筆記進料上界約 ${inflow.max} 篇（${inflow.desc}）大於關聯容量 ${cap}（${RELATE_CAPACITY_DESC.relate}）：新筆記串不進知識網而堆積；調高 relate.rounds 或降低進料`)
        }
    }
    return [...warnings, ...panelSameProviderWarnings(relatePanelsOf(settings))]
}


/** 設定之段(resolveRelateSettings 只收此三者;總組裝只交原給之段——不把整份 cfg 交出) */
const SECTIONS = Object.freeze(['ai', 'relate', 'relationIndexTitle'])

/**
 * ai／relate 兩段逐組覆寫,每組依 schema 驗鍵集、型別與值域(檔頭);另取關聯總覽之標題、推導容量(capacity)並產生啟動期警告(warnings;
 *   進料上界屬組裝者,此處只含判定小組之同家警告——容量警告見 relateWarningsOf 之 inflow)
 *
 * @param {Object} [cfg={}] 輸入執行端設定覆寫物件，非物件時視為{};只收 ai、relate、relationIndexTitle(總組裝只交原給之段)
 * @param {Object} [cfg.ai] 輸入 AI 調度層與併發之覆寫(鍵見 RELATE_AI_SCHEMA)
 * @param {Object} [cfg.relate] 輸入關聯之覆寫(鍵見 RELATE_SCHEMA)
 * @param {String} [cfg.relationIndexTitle] 輸入關聯總覽之標題(非空字串),未給為 RELATE_INDEX_TITLE
 * @returns {Object} 回傳 { ai, relate, relationIndexTitle, capacity:{ relate }, warnings:字串陣列 }
 * @throws {Error} 含上述以外之段(打錯之段名若靜默略過,該段即維持預設而無人察覺)、任一組給了但非物件、含不認得之鍵、或值型別與值域不符
 *   (訊息含完整設定路徑與可用鍵),或 relationIndexTitle 給了而非非空字串時拋出——不可讓安裝方之設定靜默失效
 * @example
 * let s = resolveRelateSettings({ relate: { rounds: 4, reeval: { perRun: 2 } } })
 * console.log(s.relate.rounds, s.relate.notesPerCall, s.relate.reeval.perRun, s.relate.reeval.pageSize, s.capacity.relate)
 * // => 4 6 2 10 72
 */
export function resolveRelateSettings(cfg = {}) {

    //check
    if (!isobj(cfg)) {
        cfg = {}
    }
    checkKeys(cfg, SECTIONS, 'settings')

    const s = {
        ai: mergeSettingsGroup('ai', cfg.ai, RELATE_AI_SCHEMA, RELATE_AI_DEFAULT),
        relate: mergeSettingsGroup('relate', cfg.relate, RELATE_SCHEMA, RELATE_DEFAULT, { types: RELATE_SETTING_TYPES }),
        relationIndexTitle: RELATE_INDEX_TITLE,
    }
    const title = cfg.relationIndexTitle
    if (title !== undefined) {
        if (!isestr(title) || !title.trim()) throw new Error(`settings.relationIndexTitle 須為非空字串（關聯總覽之標題），收到 ${JSON.stringify(title) ?? String(title)}`)
        s.relationIndexTitle = title
    }
    s.capacity = relateCapacityOf(s)
    s.warnings = relateWarningsOf(s)
    return s
}


/**
 * 關聯之 AI 席位表(唯一一份):設定路徑、顯示名、自 settings.relate 取席位之函數(序同組裝者列席位之序)
 *
 * @type {Array}
 */
const RELATE_SEATS = Object.freeze([
    { path: 'relate.ai', label: '關聯', of: (r) => r?.ai },
    { path: 'relate.reverse.ai', label: '關聯反向', of: (r) => r?.reverse?.ai },
    ...panelSeatRowsOf('relate.reeval.ai', [['first', '關聯重評第一席'], ['second', '關聯重評第二席'], ['third', '關聯重評第三席']], (r) => r?.reeval?.ai),
    ...panelSeatRowsOf('relate.standards.ai', [['first', '衝突核對／既有邊覆核第一席'], ['second', '衝突核對／既有邊覆核第二席'], ['third', '衝突核對／既有邊覆核第三席']], (r) => r?.standards?.ai),
].map((x) => Object.freeze(x)))

/**
 * 關聯之 AI 席位之顯示名(設定路徑 → 名稱;全部可設之席位,含預設為 null 者;席位檢核工具與報表用)
 *
 * @type {Object}
 */
export const RELATE_SEAT_LABELS = seatLabelsFrom(RELATE_SEATS)

/**
 * 關聯之 AI 席位(設定路徑 → 席位;只列已設者——null＝沿用關聯席位或未啟用之空席,不列):啟動期席位檢核、主力供應商計算與席位檢核工具取用,
 *   呼叫端不另寫席位路徑
 *
 * @param {Object} settings 輸入已解析之設定(取 relate;本套件或組裝者之 resolve 產物皆可)
 * @returns {Object} 回傳 { '<設定路徑>': { use, fallback, … } }
 * @example
 * console.log(Object.keys(relateSeatsOf(resolveRelateSettings({}))))
 * // => [ 'relate.ai' ]
 */
export function relateSeatsOf(settings) {
    return seatsFrom(RELATE_SEATS, settings?.relate)
}

/** 席位沿用之鍵(relateSeatOf) */
export const RELATE_SEAT_KEYS = Object.freeze(['relate', 'reverse', 'rotation', 'reeval.first', 'reeval.second', 'reeval.third'])

/**
 * 各段實際使用之席位(「未設即沿用」之唯一規則;各段、判定小組之定義與席位檢核同讀,不各自手寫沿用):
 *   relate ＝ relate.ai;reverse、rotation ＝ relate.reverse.ai,未設即 relate.ai;reeval.first ＝ relate.reeval.ai.first,未設即 relate.ai;
 *   reeval.second ＝ relate.reeval.ai.second,未設即 reeval.first;reeval.third ＝ relate.reeval.ai.third,未設即 null(不叫第三席)
 *
 * @param {Object} settings 輸入已解析之設定(取 relate)
 * @param {String} key 輸入 RELATE_SEAT_KEYS 之一
 * @returns {Object|null} 回傳席位(未設且無可沿用者為 null)
 * @throws {Error} key 不在 RELATE_SEAT_KEYS 時拋出
 * @example
 * const s = resolveRelateSettings({})
 * console.log(relateSeatOf(s, 'reverse') === s.relate.ai, relateSeatOf(s, 'reeval.second') === s.relate.ai, relateSeatOf(s, 'reeval.third'))
 * // => true true null
 */
export function relateSeatOf(settings, key) {
    const rl = settings?.relate || {}
    switch (key) {
    case 'relate': return rl.ai || null
    case 'reverse':
    case 'rotation': return rl.reverse?.ai || rl.ai || null
    case 'reeval.first': return rl.reeval?.ai?.first || rl.ai || null
    case 'reeval.second': return rl.reeval?.ai?.second || relateSeatOf(settings, 'reeval.first')
    case 'reeval.third': return rl.reeval?.ai?.third || null
    default: throw new Error(`relateSeatOf 之 key 須為 ${RELATE_SEAT_KEYS.join('、')} 之一，收到：${String(key)}`)
    }
}


export default {
    RELATE_AI_DEFAULT, RELATE_AI_SCHEMA, RELATE_DEFAULT, RELATE_SCHEMA, RELATE_SETTING_TYPES, RELATE_INDEX_TITLE,
    resolveRelateSettings, relateCapacityOf, RELATE_CAPACITY_DESC, callTimeoutMsOf, relateWarningsOf,
    RELATE_FEATURES, relateFeatureProblems, relatePanelsOf, RELATE_SEAT_LABELS, relateSeatsOf, RELATE_SEAT_KEYS, relateSeatOf,
}
