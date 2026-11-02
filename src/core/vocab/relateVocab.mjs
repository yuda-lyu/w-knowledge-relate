// relateVocab.mjs — 關聯之詞彙表:內建預設(領域中立)、驗證與合併、子集擷取
//
// 【安裝即用 vs 執行端擴充】內建預設讓零設定可跑;執行端給詞彙表時「整鍵替換」(給 relationTypes 就整組換 relationTypes,未給的鍵沿用內建)——
//   不做深合併:合併語意不可預期,整鍵替換一眼可斷。唯一例外是 guide:逐欄回退預設(只給部分欄位時其餘沿用預設;若整鍵替換,漏給一欄提示詞就缺句)。
// 【只認本套件讀取之鍵】不認得之鍵拋錯並列出可用鍵:打錯之鍵若靜默接受,正名鍵會維持預設而無人察覺。與其他知識處理段共用一份
//   詞彙表者,以 pickRelateVocab 取本套件所讀之鍵(guide 只取 relate 段)。
// 【抓取共用之鍵交抓取套件驗】domain、kbLabel、conceptRenames、conceptAliases 之預設與規則只在抓取套件(概念鍵之折疊為各套件共用,
//   同一份對照須同一份規則);本檔不另寫,鍵集亦取自抓取套件。
// 【領域中立】預設不綁任何領域:型別清單為通用之知識關聯型別;安裝方以 relationTypes／conflictType／fallbackType 給自己的型別、
//   以 relationTypeRoles 給型別之語意角色、以 guide.relate 給提示詞之領域句,即可把預設收斂到自己的主題。
// 【提示詞之兩種句子分居兩處】描述「輸出哪些欄位、什麼格式、怎麼驗證」的句子是套件解析輸出所依賴的契約,留在 domain 檔;
//   描述「這個領域裡什麼算泛泛關係、什麼算空泛理由、利弊隨何轉換、何謂實作或延伸」的句子是安裝方的政策,一律成為 guide 欄位
//   (預設值＝中立句)。安裝方填回自己調校過的措辭即可逐字重現其提示詞,而輸出契約仍隨套件演進,不會因安裝方複製整段模板而漂移。
// 【可重複套用】產物可再交本函數解析而結果不變(含 JSON 往返後之複本);型別角色於解析時推導並寫回,再解析時原樣通過。
// 【頭、子集、guide 與改名鏈取共用件】值為 undefined 之鍵視為未給、null 依逐鍵宣告(RELATE_VOCAB_NULL_AS)、不認得之鍵／段／欄位／角色之訊息、
//   guide 之逐欄回退與型別、改名鏈之檢核——皆取抓取套件之 vocabKit(各工作之詞彙表同一份);本檔只放關聯之鍵、型別角色之推導與別名之規則。
//
// 各鍵語意:
//   domain、kbLabel、conceptRenames、conceptAliases  抓取共用之鍵(語意與驗證見抓取套件之詞彙表)
//   relationTypes    關聯型別清單(提示詞之擇一清單;納入閘據以判清單外型別)
//   conflictType     衝突型(須在 relationTypes;型別序第一,衝突核對 RS4 之對象)
//   fallbackType     型別序殿後者(須在 relationTypes;合併時最低序、提示詞範例之退路)。清單外型別不落任何型別:以下兩表對映,否則該條不納入
//   relationTypeRenames { 舊型別: 新型別 }:關聯型別改名之宣告——舊型別自 relationTypes 移除;關聯段每輪維護時把既有邊之現值與 history 之型別
//                    機械改寫(邊 id 不變、updatedAt 不動);衝突型改名者,讀關聯之下游以 domain.conflictTypeNames 亦認得舊名。連續改名以對照鏈宣告
//   relationTypeAliases { 別名: 型別 }:模型輸出之同義寫法之明文對映;別名不得在清單或改名表內,值須在清單
//   relationTypeRoles { implementation, extension, sibling, complement: 型別 }:關聯型別之語意角色(既有邊覆核 RS6 之型別改正封閉清單);
//                    未給之角色依 RELATION_ROLE_NAMES 之候選名自動對應(不存在即該角色從缺,改正規則隨之停用)
//   guide            提示詞之領域句(段與欄位見 RELATE_GUIDE_FIELDS;值原樣插入)

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import {
    resolveCaptureVocab, captureVocabDefaultOf, CAPTURE_VOCAB_KEYS, pickCaptureVocab, kbLabelOf, cloneSettingsDefault, checkKeys, vocabHeadOf, pickVocabKeys, mergeGuideFields, renameChainProblems,
} from '../capturePackage.mjs'


/**
 * 提示詞領域句之欄位表:段 → 欄位 → 型別('string' 字串,空字串照填｜'estr' 非空字串——插入句中之條件,空字串會使規則成為殘句)
 *
 * @type {Object}
 */
export const RELATE_GUIDE_FIELDS = Object.freeze({
    relate: Object.freeze({
        broadRelation: 'string', // 「只有題材撞名、…這種泛泛關係」之例
        vagueReason: 'string', // 「不可只寫『…』」之空泛理由例(亦為檢定標準 RS2 之空泛片語)
        changeDrivers: 'string', // 「利弊會…，絕不可因為衝突而不選」之轉換條件
        implementationCase: 'estr', // 既有邊覆核之型別改正規則 (a):何謂一方為另一方之實作(「…，現行卻標為…→ 改為<實作型>」之前段)
        extensionCase: 'estr', // 同 (b):何謂一方在另一方之上延伸
    }),
})


/**
 * 提示詞領域句之預設值(中立句,不隨主題範圍變)
 *
 * @returns {Object} 回傳完整 guide 物件 { relate }，各欄位皆有值(欄位見 RELATE_GUIDE_FIELDS)
 * @example
 * console.log(relateGuideDefaultOf().relate.vagueReason)
 * // => 都與某主題有關
 */
export function relateGuideDefaultOf() {
    return {
        relate: {
            broadRelation: '同屬某一大領域',
            vagueReason: '都與某主題有關',
            changeDrivers: '隨時間與環境條件轉換',
            implementationCase: '一方是另一方之方法的具體實作或應用實例',
            extensionCase: '一方直接在另一方之模型或方法上延伸、修正或加入新變數',
        },
    }
}


/**
 * 關聯型別之語意角色 → 預設之候選型別名(依序取 relationTypes 中第一個存在者;安裝方以 vocab.relationTypeRoles 明給):
 *   implementation(一方為另一方之實作或應用實例)、extension(一方在另一方之上延伸修正)、sibling(同一類之不同方法)、
 *   complement(可合併使用、互相補足)。用於既有邊覆核(RS6)之型別改正封閉清單——型別無定義時,只有角色明確錯置才算型別錯
 *
 * @type {Object}
 */
export const RELATION_ROLE_NAMES = Object.freeze({
    implementation: Object.freeze(['實作範例']),
    extension: Object.freeze(['延伸深化']),
    sibling: Object.freeze(['同類方法']),
    complement: Object.freeze(['互補搭配']),
})


/**
 * 內建預設詞彙表(領域中立):抓取共用之鍵(抓取套件之 captureVocabDefaultOf——同一份預設、複本)＋關聯自有之鍵＋guide 之 relate 段。
 *   relationTypeRoles 之 {}＝未給(解析時依 RELATION_ROLE_NAMES 自型別清單推導)
 *
 * @type {Object}
 */
export const RELATE_VOCAB_DEFAULT = {
    ...captureVocabDefaultOf(),
    relationTypes: ['前置概念', '延伸深化', '互補搭配', '衝突或反例', '實作範例', '同類方法', '共用資料或指標'],
    conflictType: '衝突或反例',
    fallbackType: '互補搭配',
    relationTypeRenames: {},
    relationTypeAliases: {},
    relationTypeRoles: {},
    guide: relateGuideDefaultOf(),
}


/**
 * 詞彙表之全部可用鍵(resolveRelateVocab 據此拒絕不認得之鍵;pickRelateVocab 據此取子集)
 *
 * @type {Array}
 */
export const RELATE_VOCAB_KEYS = Object.freeze(Object.keys(RELATE_VOCAB_DEFAULT))

/**
 * 關聯自有之鍵(抓取共用之鍵與 guide 以外者;整鍵替換):關聯之型別定義所讀之鍵——借用本套件詞彙鍵之下游與多段共用之詞彙表以此取子集,不另抄一份
 *
 * @type {Array}
 */
export const RELATE_VOCAB_OWN_KEYS = Object.freeze(RELATE_VOCAB_KEYS.filter((k) => !CAPTURE_VOCAB_KEYS.includes(k) && k !== 'guide'))

/** 關聯自有之鍵(本檔內之簡稱) */
const OWN_KEYS = RELATE_VOCAB_OWN_KEYS

/**
 * null 之逐鍵政策(抓取套件之 vocabHeadOf):型別之改名／別名／語意角色之 null 為空對照(角色依候選名推導),guide 之 null 視為未給;
 *   未列之鍵之 null 照收,交其形狀檢核(型別清單、衝突型、後備型為必填——null 即拋)。抓取共用之鍵依抓取套件之宣告
 */
const RELATE_VOCAB_NULL_AS = Object.freeze({ relationTypeRenames: 'empty', relationTypeAliases: 'empty', relationTypeRoles: 'empty', guide: 'unset' })


/**
 * 合併內建預設詞彙表與執行端覆寫(整鍵替換;guide 逐欄回退預設):抓取共用之鍵交抓取套件驗與合併,關聯自有之鍵於此驗、型別角色於此推導
 *
 * 可重複套用:resolveRelateVocab(resolveRelateVocab(x)) 與 resolveRelateVocab(x) 相同;產物經 JSON 往返後再解析亦相同
 *
 * @param {Object} [override] 輸入覆寫物件，給定之鍵整鍵替換內建值(值為 undefined 者視為未給;null 依 RELATE_VOCAB_NULL_AS)，未給或非物件代表
 *   全用內建預設(鍵見 RELATE_VOCAB_KEYS)
 * @returns {Object} 回傳合併後詞彙表物件，含 RELATE_VOCAB_KEYS 之全部鍵;relationTypeRoles 為推導後之角色對照(從缺之角色不列)
 * @throws {Error} 含不認得之鍵(附可用鍵;他段之鍵亦然——以 pickRelateVocab 取子集)、抓取共用之鍵不合抓取套件之規則(kbLabel 非字串、概念對照形狀錯)，
 *   relationTypes 非非空字串陣列，conflictType／fallbackType 非非空字串或不在 relationTypes，relationTypeRenames 非物件、鍵值非非空字串、
 *   舊名仍在清單、新名循對照不可達清單或成環(問題一次列全)，relationTypeRoles 非物件、角色不認得(checkKeys 之格式)或型別不在清單，
 *   relationTypeAliases 非物件、鍵值非非空字串、別名在清單或改名表內、或值不在清單，guide 不合 RELATE_GUIDE_FIELDS(非物件、不認得之段或欄位、
 *   型別不符)時拋出
 * @example
 * let v = resolveRelateVocab({ domain: '天文學', relationTypes: ['前提', '延伸', '衝突', '補充'], conflictType: '衝突', fallbackType: '補充' })
 * console.log(v.domain, v.relationTypes.length, v.conflictType, v.relationTypeRoles)
 * // => 天文學 4 衝突 {}
 *
 * let v2 = resolveRelateVocab({ guide: { relate: { vagueReason: '都屬同一學科' } } })
 * console.log(v2.guide.relate.vagueReason, v2.guide.relate.broadRelation)
 * // => 都屬同一學科 同屬某一大領域
 */
export function resolveRelateVocab(override) {
    const o = vocabHeadOf(override, RELATE_VOCAB_KEYS, { nullAs: RELATE_VOCAB_NULL_AS, defaults: RELATE_VOCAB_DEFAULT })

    // 抓取共用之鍵:交抓取套件驗證與合併(同一份規則)
    const shared = resolveCaptureVocab(pickCaptureVocab(o))
    // 關聯自有之鍵:整鍵替換;未給者取預設之複本(各次解析之產物互不共用預設常數之參照)
    const v = { ...cloneSettingsDefault(RELATE_VOCAB_DEFAULT), ...pickVocabKeys(o, OWN_KEYS), ...shared }

    // 詞彙清單之形狀與交叉一致性於建構期檢核:conflictType 不在 relationTypes 時提示詞之型別清單與衝突規則自相矛盾、衝突永不成立——皆靜默
    if (!isarr(v.relationTypes) || v.relationTypes.length === 0 || !v.relationTypes.every(isestr)) throw new Error('vocab.relationTypes 須為非空字串陣列')
    for (const k of ['conflictType', 'fallbackType']) {
        if (!isestr(v[k])) throw new Error(`vocab.${k} 須為非空字串（relationTypes 之一）`)
        if (!v.relationTypes.includes(v[k])) throw new Error(`vocab.${k}「${v[k]}」不在 relationTypes（${v.relationTypes.join('、')}）`)
    }
    // 關聯型別改名之宣告:形狀與目標於建構期檢核(抓取套件之 renameChainProblems;打錯之對照會讓既有邊改到不存在之型別、或該改寫者靜默不動)
    const badRenames = renameChainProblems(v.relationTypeRenames, v.relationTypes, 'vocab.relationTypeRenames')
    if (badRenames.length) throw new Error(badRenames.join('；'))
    // 關聯型別之語意角色(既有邊覆核 RS6 之型別改正封閉清單):未給 → 依預設之候選名取 relationTypes 中第一個存在者;給了 → 每值須在清單
    if (!isobj(v.relationTypeRoles)) throw new Error('vocab.relationTypeRoles 須為物件 { 角色: 型別 }')
    checkKeys(v.relationTypeRoles, Object.keys(RELATION_ROLE_NAMES), 'vocab.relationTypeRoles')
    for (const [role, t] of Object.entries(v.relationTypeRoles)) {
        if (!isestr(t) || !v.relationTypes.includes(t)) throw new Error(`vocab.relationTypeRoles.${role} 之型別「${t}」不在 relationTypes（${v.relationTypes.join('、')}）`)
    }
    v.relationTypeRoles = Object.fromEntries(Object.entries(RELATION_ROLE_NAMES)
        .map(([role, names]) => [role, v.relationTypeRoles[role] || names.find((n) => v.relationTypes.includes(n)) || ''])
        .filter(([, t]) => t))
    // 關聯型別之別名(RS9):明文對映,不得與清單或改名表重疊(否則同一寫法兩種去處)
    if (!isobj(v.relationTypeAliases)) throw new Error('vocab.relationTypeAliases 須為物件 { 別名: 型別 }')
    for (const [from, to] of Object.entries(v.relationTypeAliases)) {
        if (!isestr(from) || !isestr(to)) throw new Error('vocab.relationTypeAliases 之鍵與值須為非空字串')
        if (v.relationTypes.includes(from)) throw new Error(`vocab.relationTypeAliases 之「${from}」在 relationTypes 內（別名須為清單外之寫法）`)
        if (Object.hasOwn(v.relationTypeRenames, from)) throw new Error(`vocab.relationTypeAliases 之「${from}」同時出現在 relationTypeRenames（改名與別名擇一）`)
        if (!v.relationTypes.includes(to)) throw new Error(`vocab.relationTypeAliases.${from} 之型別「${to}」不在 relationTypes（${v.relationTypes.join('、')}）`)
    }
    v.guide = mergeGuideFields(RELATE_GUIDE_FIELDS, relateGuideDefaultOf(), o.guide)
    return v
}


/**
 * 自任意詞彙表取本套件所讀之鍵(RELATE_VOCAB_KEYS;guide 只取 relate 段):他段與本套件共用一份詞彙表時,以此取子集交本套件
 *   (resolveRelateVocab 拒收其他鍵與他段)——鍵集只在本檔定義,呼叫端不另抄一份
 *
 * @param {Object} [vocab] 輸入詞彙表(可含他段之鍵)，非物件視為{}
 * @returns {Object} 回傳只含本套件所讀之鍵(未給者不列;guide 為物件時只留 relate 段〔有給才列〕)之新物件
 * @example
 * console.log(pickRelateVocab({ domain: '天文學', categories: ['觀測'], relationTypes: ['相關', '衝突'], guide: { summarize: { target: '知識' }, relate: { vagueReason: '同屬天文' } } }))
 * // => { domain: '天文學', relationTypes: [ '相關', '衝突' ], guide: { relate: { vagueReason: '同屬天文' } } }
 */
export function pickRelateVocab(vocab) {
    return pickVocabKeys(vocab, RELATE_VOCAB_KEYS, { guideSections: Object.keys(RELATE_GUIDE_FIELDS) })
}


export { kbLabelOf }

export default {
    RELATE_GUIDE_FIELDS, RELATE_VOCAB_DEFAULT, RELATE_VOCAB_KEYS, RELATE_VOCAB_OWN_KEYS, RELATION_ROLE_NAMES,
    relateGuideDefaultOf, resolveRelateVocab, pickRelateVocab, kbLabelOf,
}
