// relateRuntime.mjs — 關聯執行期件之組裝(唯一一份):本套件之總組裝 createKnowledgeRelate 與他總組裝(多工作之知識套件)共用,
//   呼叫端不另組任何關聯件
//
// 【組裝之件】資料檢核(cfg.data 之 vocab)、詞彙解析(關聯自有之鍵＋抓取共用之鍵)、概念鍵之折疊(與抓取套件同一單例、同一規則)、
//   關聯 domain(內建工廠＋提示詞覆寫 → 與 opt.domains 合併)、啟用之功能所需之 domain 成員與判定小組席位之啟動期檢核。資料之解析、折疊之套用、
//   提示詞覆寫之驗證與其和注入 domain 之衝突、domain 之合併取抓取套件之共用件(各工作之執行期件同一份)。符合度掃描結果之
//   對外形狀(relateScanOf)在 standards/audit,計數摘要取抓取套件之 standardsCountsOf——兩個總組裝之掃描與計數同一份。
// 【為何獨立】總組裝各自逐段同型實作時,任一側新增 domain 成員、檢核條件或依賴,另一側即漂移;他總組裝以本函數組出同一組關聯件。
// 【呼叫端負責】cfg 之鍵集檢核(含 cfg.data、cfg.prompts 之鍵)、設定解析(resolveRelateSettings 或同形之設定)、AI 調度層與本機網路判斷、
//   集合之開關與每輪管線——關聯以外之件不在此。
// 【生效之 domain 只有一份】回傳之 domains 即每輪依賴之 deps.domains 與總組裝之 info().domains:管線、維運 API 與評分用同一套提示詞與
//   型別定義;子階段 opt.domain 仍可另給(屬自組)。提示詞覆寫(opt.prompts)作用於內建 domain;注入整組 domain(opt.domains)者即不經
//   提示詞覆寫——兩者給在同一 domain 即拋(其一會靜默失效)。
// 【domain 之注入只經 opt.domains】本函數不讀 cfg.domains:獨立總組裝把其 cfg.domains 交 opt.domains;他總組裝交其 cfg.domains 中屬本套件之子集。
// 【設定錯誤一律啟動期拋錯】重評、衝突核對、既有邊覆核開啟而 domain 缺對應之提示詞、衝突核對／既有邊覆核開啟而缺判定小組之必填席位、
//   注入之 domain 缺成員或其型別定義不合(型別清單與衝突型是納入閘、投影與掃描之依據,不在此擋即於每輪靜默錯判)、詞彙表不合規格——
//   皆在建構期拋,不等到該段第一次執行才爆。
// 【概念鍵之折疊為模組級單例】本函數以 cfg.conceptFold 之決定與詞彙表之概念改名／別名設定抓取套件之折疊(候選之共享概念比對讀之);
//   同行程多個實例以最後建構者為準(同一份詞彙之多工作共用時,各工作設定之值相同)。
// 【他總組裝之接法】(與摘要套件之 createSummarizeRuntime 同一接法)他總組裝以自己解析之詞彙表取本套件之子集、以 RELATE_DOMAIN_KEYS
//   取其 cfg.domains 中屬本套件者:
//     createRelateRuntime(cfg, settings, { vocab: pickRelateVocab(整份詞彙), domains: <cfg.domains 中鍵在 RELATE_DOMAIN_KEYS 者> })
//   回傳之件與自建之件逐一對應:domains.relate ⇔ 以整份詞彙自建之 createRelateDomain 產物併入注入之 relate 者(成員同一組);folds ⇔ 抓取套件之
//   applyConceptFold(cfg.conceptFold, 詞彙)(同一函數、同形 { fold, clueFold });啟用功能之檢核 ⇔ 功能表(RELATE_FEATURES)之單一判定。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { applyConceptFold, promptOverridesOf, promptDomainConflicts, promptDomainOf, promptsForDomain, mergeDomains, resolveDataCfg, resolveLocale } from './core/capturePackage.mjs'
import { resolveRelateVocab } from './core/vocab/relateVocab.mjs'
import { RELATE_FEATURES, relateFeatureProblems } from './core/relateSettings.mjs'
import { createRelateDomain, RELATE_PROMPT_SIGS } from './domain/relateDomain.mjs'

/**
 * 關聯所用之集合(對外名;關聯子階段與維運 API 讀寫者):筆記(摘要套件寫入;關聯寫其關聯端欄位)、邊庫、待判登錄(RS4／RS5／RS6)、
 *   檢核紀錄(RS4／RS6)。總組裝之開集合須至少含這些(他工作之集合另加;以之為出處之下游產物集合 cores 為選開)
 *
 * @type {Array}
 */
export const RELATE_STORE_KEYS = Object.freeze(['notes', 'relations', 'holds', 'checks'])

/**
 * 關聯所讀之資料鍵(cfg.data):詞彙覆寫 vocab
 *
 * @type {Array}
 */
export const RELATE_DATA_KEYS = Object.freeze(['vocab'])

/**
 * 關聯之輸出目錄(相對 workDir;交 resolveDirsCfg／expandDirs 之 extra):relations＝關聯總覽 index.md 與 graph.json(不隨 knowledge 之覆寫移動)
 *
 * @type {Object}
 */
export const RELATE_DIRS = Object.freeze({ relations: 'knowledge/relations' })

/**
 * 關聯之 domain 鍵(每輪 deps.domains 中屬本套件者;他總組裝之 cfg.domains 另有他工作之 domain 時,以此取子集交 opt.domains)
 *
 * @type {Array}
 */
export const RELATE_DOMAIN_KEYS = Object.freeze(['relate'])

// 提示詞覆寫之鍵與函數形式(定義在 domain/relateDomain;此處轉出同一實體,組裝者一處取齊)
export { RELATE_PROMPT_SIGS }

/** 各提示詞所屬之 domain(提示詞覆寫交該 domain 之工廠;與注入之同一 domain 擇一;由 domain 檔之 SIGS 推導——抓取套件之 promptDomainOf) */
const PROMPT_DOMAIN = promptDomainOf({ relate: RELATE_PROMPT_SIGS })

/** 各 domain 之工廠之寫法(注入之建議;錯誤訊息用) */
const DOMAIN_FACTORY = Object.freeze({ relate: 'createRelateDomain({ vocab })' })

/** 選填之 domain 成員:功能表(RELATE_FEATURES)中依功能而必填者——缺之則對應功能不可開啟(開啟而缺之即於建構期拋錯) */
const OPTIONAL_DOMAIN_MEMBERS = Object.freeze({ relate: Object.freeze([...new Set(RELATE_FEATURES.flatMap((f) => f.members || []))]) })

/**
 * 關聯所讀之資料(cfg.data 之 vocab)之檢核與正規化(抓取套件之 resolveDataCfg;各工作同一份);cfg.data 之鍵集由呼叫端檢核(各總組裝之 cfg.data 可另有其鍵)
 *
 * @param {*} d 輸入 cfg.data，未給代表全用預設
 * @returns {Object} 回傳 { vocab:Object|null(安裝方原給之詞彙覆寫;null＝用內建預設) }
 * @throws {Error} 非物件、或 vocab 非物件時拋出
 * @example
 * console.log(resolveRelateData({ vocab: { domain: '天文學' } }).vocab.domain)
 * // => 天文學
 */
export function resolveRelateData(d) {
    return resolveDataCfg(d, { keys: RELATE_DATA_KEYS, vocabKeysOf: 'core/vocab/relateVocab 之 RELATE_VOCAB_KEYS' })
}

/**
 * 注入之關聯 domain 之型別定義之問題(型別清單非空字串陣列、衝突型與後備型別不在清單、衝突型之名不含衝突型、空泛片語非字串陣列、
 *   改名表與角色表非物件)——納入閘、投影之型別序與掃描皆讀之,形狀錯即每輪靜默錯判(抓取套件之 mergeDomains 之 check)
 *
 * @param {Object} d 輸入注入之 domain
 * @returns {Array} 回傳問題說明陣列(無問題為空陣列)
 */
function domainShapeProblems(d) {
    const out = []
    const types = d.relationTypes
    if (!isarr(types) || types.length === 0 || !types.every(isestr)) out.push('relationTypes 須為非空字串陣列')
    else {
        for (const k of ['conflictType', 'fallbackType']) if (!types.includes(d[k])) out.push(`${k}「${d[k]}」不在 relationTypes`)
        if (!isarr(d.conflictTypeNames) || !d.conflictTypeNames.includes(d.conflictType)) out.push('conflictTypeNames 須為含 conflictType 之陣列')
    }
    if (!isarr(d.vagueReasons) || !d.vagueReasons.every((x) => typeof x === 'string')) out.push('vagueReasons 須為字串陣列')
    for (const k of ['relationTypeRenames', 'relationTypeRoles']) if (!isobj(d[k])) out.push(`${k} 須為物件`)
    return out
}

/**
 * 組裝關聯執行期件(檔頭):建構期即驗資料、解析詞彙、設定概念鍵之折疊、建 domain 並檢核啟用之功能——設定錯誤要在啟動期爆
 *
 * @param {Object} cfg 輸入總組裝之 cfg(讀 lang、data、conceptFold)
 * @param {Object} settings 輸入解析後之設定(讀 relate;本套件之 resolveRelateSettings 或他總組裝之同形設定)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab] 輸入交本套件之詞彙(只含本套件所讀之鍵,見 core/vocab/relateVocab 之 pickRelateVocab);未給即用 cfg.data.vocab
 * @param {Object} [opt.prompts] 輸入提示詞覆寫 { relate?, reeval?, conflictCheck?, edgeReview? }(鍵與函數形式見 RELATE_PROMPT_SIGS;
 *   呼叫端已檢核之 cfg.prompts),作用於內建 domain
 * @param {Object} [opt.domains] 輸入交本套件之 domain 注入 { relate? }(檔頭【domain 之注入只經 opt.domains】;未給＝無注入)
 * @returns {Object} 回傳 { data:{ vocab }(原給), vocab(已解析), locale(語言設定:抓取套件 resolveLocale 之產物), folds:{ fold, clueFold }, domains:{ relate }(生效之一份) }
 * @throws {Error} settings 不含 relate、cfg.lang 不合、cfg.data 形狀不合、詞彙表不合規格、cfg.conceptFold 型別不合、opt.prompts 不合(非物件、不認得之鍵、
 *   值非函數)、提示詞覆寫與注入之 domain 給在同一 domain、opt.domains 不合規格(非物件、不認得之鍵、缺成員、型別定義不合)、
 *   重評／衝突核對／既有邊覆核開啟而 domain 缺對應成員、衝突核對／既有邊覆核開啟而缺判定小組之必填席位時拋出
 * @example
 * need test in nodejs.
 *
 * let rt = createRelateRuntime({ data: { vocab: { domain: '天文學' } } }, resolveRelateSettings({}))
 * console.log(rt.vocab.domain, rt.domains.relate.conflictType)
 * // => 天文學 衝突或反例
 */
export function createRelateRuntime(cfg, settings, opt = {}) {
    if (!isobj(cfg)) cfg = {}
    if (!isobj(opt)) opt = {}
    const rl = settings?.relate
    if (!isobj(rl)) throw new Error('createRelateRuntime 需要解析後之 settings(含 relate)')

    // ── 語言設定(cfg.lang;抓取套件之 core/locale):提示詞之輸出語言句、字形政策、折疊方向——與抓取套件同讀此一份 ──
    const locale = resolveLocale(cfg.lang)

    // ── 資料與詞彙(型別清單、衝突型、改名／別名、角色、提示詞之領域句之設定錯誤在建構期即爆)、概念鍵之折疊(檔頭)──
    const data = resolveRelateData(cfg.data)
    const vocab = resolveRelateVocab(isobj(opt.vocab) ? opt.vocab : data.vocab)
    const folds = applyConceptFold(cfg.conceptFold, vocab, locale)

    // ── domain:內建工廠(詞彙、提示詞覆寫)→ 與注入者合併(生效之一份;注入之型別定義須合規格——納入閘、投影與掃描讀之)──
    const prompts = promptOverridesOf(opt.prompts, RELATE_PROMPT_SIGS, 'createRelateRuntime')
    const conflicts = promptDomainConflicts(prompts, opt.domains, PROMPT_DOMAIN)
    if (conflicts.length) throw new Error(conflicts.join('；'))
    const domains = mergeDomains({ relate: createRelateDomain({ vocab, locale, prompts: promptsForDomain(prompts, PROMPT_DOMAIN, 'relate') }) }, opt.domains, {
        optional: OPTIONAL_DOMAIN_MEMBERS,
        factories: DOMAIN_FACTORY,
        check: (k, d) => domainShapeProblems(d),
    })

    // ── 啟用之功能所需之判定小組席位與 domain 成員(功能表 RELATE_FEATURES 之單一判定;判定小組:既有邊之覆核沒有「提案席」之一票,
    //    first、second 皆須給——只有一席永遠判不成;衝突核對之新衝突以提案席為另一票,只須 first)——缺者啟動期拋錯,不等到該段第一次執行才爆 ──
    const problems = relateFeatureProblems(settings, domains.relate, { domainLabel: 'cfg.domains.relate' })
    if (problems.length) throw new Error(problems.join('；'))

    return { data, vocab, locale, folds, domains }
}

export default {
    RELATE_STORE_KEYS, RELATE_DATA_KEYS, RELATE_DIRS, RELATE_DOMAIN_KEYS, RELATE_PROMPT_SIGS,
    resolveRelateData, createRelateRuntime,
}
