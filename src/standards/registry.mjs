// registry.mjs — 關聯檢定標準之全集(定義表;純資料,不判定)
//
// 【一條一列】{ id, title, object(對象與入口), kind, v, proves(能證明), notProves(不能證明), enforcedAt(執行處), scan, scanNote }:
//   kind:'program'＝程式判定(判定可重算);'ai'＝由判定小組(兩席,不一致時第三席)判定、以題組逐案評。
//   enforcedAt:執行之所在,「套件內檔案:函數」(路徑相對套件根);同一標準多處執行者皆列——判定之純函數、正向／反向／輪巡之納入閘
//   (同一逐項鏈)、合併時浮上之 history、重評改寫、衝突核對改寫、既有邊覆核改寫、改寫之逆(revertEdgeRevision)、restoreEdge、restoreNote、維護、
//   存量處置、符合度掃描各入口依實際之碼列出。
//   scan:auditRelateStandards(standards/audit)是否以本條 id 逐件判定並計數;scanNote 寫掃描之範圍,或不掃之理由。
// 【版本單一來源】程式判定之邊標準(RS1、RS2、RS3、RS8)之標題與版本取自 standards/edgeStandards 之 EDGE_STANDARDS(判定改變即升版,
//   掃描與存量處置據以判斷是否須重掃);RS4、RS6 之識別與版本取自其判定模組(stores/conflictCheckPolicy 之 RS4、stores/edgeReviewPolicy 之
//   RS6;檢核紀錄據以判重核;兩標準共用之核對件——一席回覆 → 票、檢核雜湊、型別定義版本——在 stores/edgeCheckKit);RS5 之識別取自
//   stores/relateHolds——RS5 不寫檢核紀錄(重評之結果寫於重評帳與邊本身),無版本,v 為 null;其餘為 1。
// 【編號】RS7 不列為檢定標準:刪除與撤出之可追溯(理由必填、稽核先記再刪、可還原)是刪除與撤出之資料契約(stores/edgeRetire、
//   ops/noteOps),由其單元測試釘住,不是對知識之判定;編號不再用,新標準另取新號。型別改名之宣告(詞彙表 relationTypeRenames;既有邊之
//   型別由維護機械改寫)是 RS1「型別在清單」之型別生命週期面,併入 RS1 之說明與執行處,不另列。
// 【能證明／不能證明】程式標準只證明形式、來源與結構;AI 標準證明的是兩個不同供應者之席位對該案得出同一類別(題組以應然釘住判準),
//   不證明客觀真偽。「不能證明」即該標準之已知盲區,由所列之他標準或使用者判讀補位。
// 【不經納入閘之寫邊入口(刻意)】RELATE_UNGATED_WRITE_ENTRIES:撤銷(回退該次處置之效果——原樣放回,不是新進;撤銷與重新收件是兩種契約,
//   重新收件〔restoreNote、restoreEdge〕照過閘而列於各標準之執行處)與機械改寫(詞彙表宣告之型別改名,不改內容)。寫邊之入口須在各標準之
//   寫入入口或本表之內,不在者即缺陷。

import { EDGE_STANDARDS, REASON_MIN_CHARS } from './edgeStandards.mjs'
import { REASON_MAX_CHARS } from './edgeGate.mjs'
import { RS4 } from '../stores/conflictCheckPolicy.mjs'
import { RS6 } from '../stores/edgeReviewPolicy.mjs'
import { RS5 } from '../stores/relateHolds.mjs'

/**
 * 邊標準之 id、標題與版本(EDGE_STANDARDS 為唯一來源;缺者即拋——表與判定脫節時於載入當下發現)
 *
 * @param {String} id 輸入標準 id
 * @returns {Object} 回傳 { id, title, v }
 * @throws {Error} EDGE_STANDARDS 無此 id 時拋出
 */
function edgeStd(id) {
    const s = EDGE_STANDARDS.find((x) => x.id === id)
    if (!s) throw new Error(`registry:EDGE_STANDARDS 缺 ${id}`)
    return { id: s.id, title: s.title, v: s.v }
}

/** 寫入入口與判定之執行處(各標準共用;各條另加其專屬者) */
const E = Object.freeze({
    judge: 'standards/edgeStandards.mjs:checkEdge',
    normalize: 'standards/edgeGate.mjs:normalizeEdgeProposal',
    gate: 'standards/edgeGate.mjs:gateEdgeProposal',
    admit: 'stages/relateChain.mjs:admitRelation',
    build: 'stages/relateChain.mjs:mwBuildEdges',
    segments: 'stages/relateStage.mjs:stageRelate',
    // 開工前維護(型別改名之機械改寫、清單外型別交既有邊覆核、墓碑內端點之殘留邊撤出;公開之寫邊入口)
    maintain: 'stages/relateMaintain.mjs:maintainRelations',
    persist: 'stages/relateChain.mjs:mwPersistEdges',
    merge: 'stores/edgeStore.mjs:mergeEdge',
    reeval: 'stages/reevalSegment.mjs:mwReevalApply',
    conflictCheck: 'stages/conflictCheckSegment.mjs:runConflictCheckSegment',
    edgeReview: 'stages/edgeReviewSegment.mjs:runEdgeReviewSegment',
    // 衝突核對與既有邊覆核之判定小組(兩席、第三席、中止與缺票)之逐頁執行(兩段同一份)
    panel: 'stages/checkPanelPages.mjs:runCheckPanelPages',
    restoreEdge: 'ops/noteOps.mjs:restoreEdge',
    restoreNote: 'ops/noteOps.mjs:restoreNote',
    // AI 改寫之逆(撤回判定小組套用之改寫;改寫前之值過閘才回復;視為使用者對該段標準之裁示)
    revert: 'ops/noteOps.mjs:revertEdgeRevision',
    domain: 'domain/relateDomain.mjs:createRelateDomain',
    queueReview: 'standards/edgeQueue.mjs:queueEdgeReview',
    queueCheck: 'standards/edgeQueue.mjs:queueConflictCheck',
    rewrite: 'standards/edgeGate.mjs:reasonRewriteProblemsOf',
    waiver: 'standards/edgeQueue.mjs:stockWaiverKeyOf',
    stockPlan: 'standards/stockFix.mjs:planEdgeStockFix',
    stockApply: 'standards/stockFix.mjs:applyEdgeStockFix',
    scan: 'standards/audit.mjs:auditRelateStandards',
})

/** 新進之納入閘(正向、反向、輪巡同一逐項鏈)與各改寫路徑(含改寫之逆):RS1、RS2、RS3、RS8 共同之寫入入口 */
const WRITE_ENTRIES = [E.gate, E.admit, E.build, E.segments, E.reeval, E.conflictCheck, E.edgeReview, E.restoreEdge, E.restoreNote, E.revert]

/** 關聯檢定標準全集(依 id 排序) */
export const RELATE_STANDARDS = Object.freeze([
    {
        ...edgeStd('RS1'),
        object: '邊(現值;history 之型別另計資訊);入口 正向、反向、輪巡之納入閘(同一逐項鏈)、合併時浮上之 history、重評改寫、衝突核對改寫、既有邊覆核改寫、restoreEdge、restoreNote、維護(型別改名之機械改寫、清單外型別交既有邊覆核、刪除紀錄內端點之殘留邊)、懸空邊之清理(pruneDangling)',
        kind: 'program',
        proves: '兩端皆為現存筆記、非自指、型別在詞彙表之清單內;清單外之型別不由程式改落後備型別(寫入時之型別解析見 RS9)。型別改名須以詞彙表 relationTypeRenames 宣告,既有邊之現值與 history 由維護機械改寫(id、updatedAt 不動)',
        notProves: '型別是否恰當(RS6);端點不在而不在刪除紀錄內之懸空邊只列出,由使用者以 pruneDangling 清理',
        enforcedAt: [E.judge, E.normalize, ...WRITE_ENTRIES, E.persist, E.merge, E.maintain, 'stores/edgeStore.mjs:renameEdgeTypes', 'ops/noteOps.mjs:pruneDangling', E.queueReview, E.waiver, E.scan],
        scan: true,
        scanNote: '全部邊;與新進閘同一判定(checkEdge;型別清單取關聯 domain);history 條目之型別不合計資訊(info.history),不算違反;清單外之型別經維護登錄覆核待判而使用者豁免者記已豁免',
    },
    {
        ...edgeStd('RS2'),
        object: '邊之理由(現值;history 之理由另計資訊);入口 正向、反向、輪巡之納入閘、合併時浮上之 history、重評改寫、衝突核對改寫、既有邊覆核改寫、restoreEdge、restoreNote;存量處置交既有邊覆核或衝突核對改寫',
        kind: 'program',
        proves: `理由非佔位字(封閉清單),去掉空泛片語(詞彙表 guide.relate 之 vagueReason、broadRelation)與標點空白後至少 ${REASON_MIN_CHARS} 字;逾 ${REASON_MAX_CHARS} 字者於句界截短並於邊上記原字數(reasonCut;截斷明示,不靜默)`,
        notProves: '理由是否指出兩篇之共同機制或真正之對立(RS4、RS6)',
        enforcedAt: ['standards/edgeStandards.mjs:reasonFormProblem', E.judge, 'standards/edgeGate.mjs:cutReason', E.normalize, ...WRITE_ENTRIES, E.persist, E.merge, 'standards/edgeStandards.mjs:edgeInfoOf', E.rewrite, E.stockPlan, E.stockApply, E.queueReview, E.queueCheck, E.waiver, E.scan],
        scan: true,
        scanNote: '全部邊;與新進閘同一判定(空泛片語取關聯 domain);history 條目之違反、理由之句界截短計資訊(info.history、info.cut),不算違反;存量之該問題經覆核待判而使用者豁免者記已豁免',
    },
    {
        ...edgeStd('RS3'),
        object: '邊之理由與 history 之理由([[連結]] 與網址不計);入口 正向、反向、輪巡之納入閘、合併時浮上之 history、重評改寫、衝突核對改寫、既有邊覆核改寫、restoreEdge、restoreNote;存量處置之確定性修正(修不了者:現行理由交兩席改寫,只剩沿革者交使用者判讀)',
        kind: 'program',
        proves: '簡體專用字、同形字誤用、誤用詞皆為 0;納入閘與存量修正只改違規處,連結與網址不轉、updatedAt 不動(正體修正不是內容變更);確定性修正後現行理由仍不合格者,兩席覆核與衝突核對不記合格、須改寫',
        notProves: '錯字(錯字仍是正體字)',
        enforcedAt: [E.judge, E.normalize, ...WRITE_ENTRIES, E.persist, E.merge, E.rewrite, 'standards/stockFix.mjs:edgeFixOf', E.stockPlan, E.stockApply, E.queueReview, E.queueCheck, E.waiver, E.scan],
        scan: true,
        scanNote: '全部邊(history 之理由計入邊本身:正體可確定性修正,存量處置即修);與新進閘同一判定;存量之該問題經覆核待判(或使用者待判)而使用者豁免者記已豁免',
    },
    {
        id: RS4.std,
        title: '衝突型之邊為真衝突且理由陳述雙方(兩席核對)',
        object: '衝突型之邊;入口 正向、反向、輪巡之新衝突(寫入前)、待判(還原帶回、存量處置與既有邊覆核轉交、下游交回、前輪未判完)、存量衝突邊(配額);衝突核對預設關',
        kind: 'ai',
        v: RS4.v,
        proves: '衝突為真(結論相反、參數矛盾或條件互斥)且理由陳述雙方:兩個不同供應者之席位得出同一類別(不一致時第三席;題組逐案評);非衝突者改型或撤出,判不了者不落地或隔離並登錄待判(使用者;restoreEdge 還原即裁示為真衝突)',
        notProves: '何方正確(下游之爭議處置);未開衝突核對時寫入之衝突邊(存量佇列日後補核)',
        enforcedAt: [
            'stores/conflictCheckPolicy.mjs:checkVerdictOf',
            'stores/edgeCheckKit.mjs:seatVotesOf',
            'stores/conflictCheckPolicy.mjs:rs4DecisionOf',
            'stores/edgeCheckKit.mjs:edgeCheckHashOf',
            'stores/edgeCheckKit.mjs:relationTypesVersionOf',
            'stores/conflictCheckPolicy.mjs:stockQueueOf',
            E.conflictCheck,
            E.panel,
            E.persist,
            E.domain,
            E.queueCheck,
            E.restoreEdge,
            E.revert,
            E.restoreNote,
            E.edgeReview,
            E.stockApply,
            E.scan,
        ],
        scan: false,
        scanNote: '未掃:AI 判定以題組逐案評;掃描列檢核紀錄之已檢、四態、版本過時與待判之未結、已豁免(見掃描之 ai.RS4;來源集合未給者為 null)',
    },
    {
        id: RS5.std,
        title: '內容變更後之既有邊仍成立(兩席重評)',
        object: '內容變更之筆記之既有邊;入口 重評段(relate.reeval.perRun;套用依閘門 relate.reeval.apply),預設停用',
        kind: 'ai',
        v: null,
        proves: '內容變更後之既有邊仍成立、型別正確:兩席各評一次,裁決相同且實際供應者不同才算判定(不一致時第三席;不確定為合法裁決;題組逐案評);判定成立且閘門允許該級別才改型或撤銷(撤銷可 restoreEdge 還原),判不了者登錄待判(使用者)',
        notProves: '內容未變之既有邊(RS6);閘門關閉期間之候選(只記重評帳,不套用)',
        enforcedAt: [
            'stores/reevalPolicy.mjs:verdictsOf',
            'stores/reevalPolicy.mjs:decideOf',
            'stores/reevalPolicy.mjs:levelOf',
            'stores/reevalPolicy.mjs:gateAllows',
            'stages/reevalSegment.mjs:runReevalSegment',
            'stages/reevalSegment.mjs:mwReevalVerdict',
            'stages/reevalSegment.mjs:mwReevalAgree',
            E.reeval,
            'stages/reevalSegment.mjs:mwReevalMarkReviewed',
            E.domain,
            'ops/noteOps.mjs:reevalBaseline',
            'ops/noteOps.mjs:reevalRequeue',
            E.revert,
            E.scan,
        ],
        scan: false,
        scanNote: '未掃:AI 判定以題組逐案評;不寫檢核紀錄,掃描只列待判之未結、已豁免(見掃描之 ai.RS5;未給待判集合者為 null)',
    },
    {
        id: RS6.std,
        title: '內容未變之既有邊仍成立、型別正確、理由具體(兩席覆核)',
        object: '非衝突型之既有邊;入口 待判(存量處置轉交、型別不在清單之邊、前輪未判完)、存量(配額);既有邊覆核預設關',
        kind: 'ai',
        v: RS6.v,
        proves: '內容未變之既有邊仍成立、型別正確(型別改正之封閉清單內之錯置、漏標之衝突)、理由具體:兩個不同供應者之席位得出同一類別(不一致時第三席;題組逐案評);現行理由確定不合格(RS2、RS3、RS8;正體可確定性修正者不算)而改寫不過者撤出(可 restoreEdge 以新理由還原),判不了者隔離並登錄待判(使用者;restoreEdge 還原即裁示關聯成立)',
        notProves: '封閉清單外之型別取捨(維持現行);衝突型之邊(RS4)',
        enforcedAt: [
            'stores/edgeReviewPolicy.mjs:retypeAllowed',
            'stores/edgeReviewPolicy.mjs:reviewVerdictOf',
            'stores/edgeReviewPolicy.mjs:rs6DecisionOf',
            'stores/edgeReviewPolicy.mjs:reviewQueueOf',
            'stores/edgeCheckKit.mjs:seatVotesOf',
            'stores/edgeCheckKit.mjs:edgeCheckHashOf',
            'stores/edgeCheckKit.mjs:relationTypesVersionOf',
            E.edgeReview,
            E.panel,
            E.domain,
            E.queueReview,
            E.segments,
            E.maintain,
            E.restoreEdge,
            E.revert,
            E.stockApply,
            E.scan,
        ],
        scan: false,
        scanNote: '未掃:AI 判定以題組逐案評;掃描列檢核紀錄之已檢、四態、版本過時與待判之未結、已豁免(見掃描之 ai.RS6;來源集合未給者為 null)',
    },
    {
        ...edgeStd('RS8'),
        object: '邊之理由;入口 正向、反向、輪巡之納入閘、重評改寫、衝突核對改寫、既有邊覆核改寫、restoreEdge、restoreNote;存量處置交既有邊覆核或衝突核對改寫',
        kind: 'program',
        proves: '理由中之數字事實皆見於兩端之材料(依精度比對;新進之材料＝模型所見之兩端區塊,還原與掃描＝兩端筆記之內容章＋原文標題);材料不可得而理由含數字 → 未能判定(新進不納入,掃描不報為零)',
        notProves: '數字所指是否正確(RS4、RS6)',
        enforcedAt: [E.judge, ...WRITE_ENTRIES, 'standards/edgeStandards.mjs:edgeInfoOf', E.rewrite, E.stockPlan, E.stockApply, E.queueReview, E.queueCheck, E.waiver, E.scan],
        scan: true,
        scanNote: '全部邊;材料＝兩端筆記之內容章＋原文標題(md 讀不到者記未能判定,不報為零;呼叫端可給 materialOf 共用其走訪);material:false 不讀材料,理由含數字者記未能判定並註明;history 條目之違反計資訊;存量之該問題經覆核待判而使用者豁免者記已豁免',
    },
    {
        id: 'RS9',
        title: '清單外型別不落後備型別(別名對映或不納入)',
        object: '寫入之型別(模型之輸出、還原之邊);入口 正向、反向、輪巡之納入閘、重評與核對之裁決驗證、restoreEdge、restoreNote',
        kind: 'program',
        v: 1,
        proves: '型別經型別解析:清單內原樣、改名表循對照鏈、別名表(詞彙表 relationTypeAliases)明文對映;其餘不納入(程式不替模型斷言型別);別名不得與清單或改名表重疊(詞彙解析時檢核)',
        notProves: '模型給了清單內之型別而型別不恰當(RS6)',
        enforcedAt: [
            E.domain,
            'core/vocab/relateVocab.mjs:resolveRelateVocab',
            E.normalize,
            E.gate,
            E.admit,
            E.build,
            'stores/reevalPolicy.mjs:verdictsOf',
            'stores/conflictCheckPolicy.mjs:checkVerdictOf',
            'stores/edgeReviewPolicy.mjs:reviewVerdictOf',
            E.restoreEdge,
            E.restoreNote,
            E.revert,
        ],
        scan: false,
        scanNote: '未掃:型別解析於寫入當下為之(對映不到者不納入);落地之邊之型別在清單與否由 RS1 掃描',
    },
    {
        id: 'RS10',
        title: '候選涵蓋之召回(已關聯之筆記間公平輪巡、進度可查)',
        object: '已關聯之筆記(兩篇皆已關聯而從未比較之對);入口 輪巡段(relate.rotation.perRun),預設停用',
        kind: 'program',
        v: 1,
        proves: '已關聯之筆記依上次輪巡時刻排隊,逐頁比對其共享概念之候選清單之後段(頁內之既有鄰居不重送;失敗者只排隊尾、不前進頁;取盡即用盡);進度(用盡篇數／已關聯篇數)每輪計數。頁內之關聯由關聯提示詞判定,經同一納入閘(RS1、RS2、RS3、RS8、RS9)',
        notProves: '輪巡以外之召回(全庫兩兩比對不可行);刪除筆記或概念重標使排名前移時,少數對可能跳過',
        enforcedAt: [
            'stores/rotationPolicy.mjs:rotationPageOf',
            'stores/rotationPolicy.mjs:rotationQueueOf',
            'stores/rotationPolicy.mjs:rotationProgressOf',
            E.segments,
            'stages/relateChain.mjs:mwMarkRelated',
        ],
        scan: false,
        scanNote: '未掃:召回無從以存量掃描判定;輪巡之進度隨每輪報告(rotationDone、rotationTotal)',
    },
].map((s) => Object.freeze({
    // 欄序固定(報表與比對之輸出可重現)
    id: s.id, title: s.title, object: s.object, kind: s.kind, v: s.v, proves: s.proves, notProves: s.notProves,
    enforcedAt: Object.freeze([...s.enforcedAt]), scan: s.scan, scanNote: s.scanNote,
})))

/** 不經納入閘之寫邊入口(檔頭【不經納入閘之寫邊入口】;每列 { entry:'檔:函數', kind:'undo'＝撤銷｜'mechanical'＝機械改寫, why }) */
export const RELATE_UNGATED_WRITE_ENTRIES = Object.freeze([
    { entry: 'ops/noteOps.mjs:undoDeleteNote', kind: 'undo', why: '撤銷明示刪除:原樣放回封存之記錄、md、邊與反向待處理對(型別改名照機械改寫;不登錄新待判)' },
    { entry: 'standards/stockFix.mjs:rollbackEdgeStockFix', kind: 'undo', why: '存量處置之回退:寫回處置前之邊值' },
    { entry: 'stores/edgeStore.mjs:domainTypeRenamerOf', kind: 'mechanical', why: '型別改名之機械改寫(詞彙表 relationTypeRenames;每輪維護與撤銷刪除同一規則;id、updatedAt 不動)' },
    { entry: 'stages/relateMaintain.mjs:maintainRelations', kind: 'mechanical', why: '每輪開工前之維護:以 domainTypeRenamerOf 把改名之型別寫回現值與 history;清單外型別只登錄覆核待判(不改寫)、墓碑內端點之殘留邊撤出' },
].map((x) => Object.freeze(x)))

/** 符合度掃描逐件判定之標準 id(scan 為 true 者;依全集之序) */
export const RELATE_AUDITED_STANDARD_IDS = Object.freeze(RELATE_STANDARDS.filter((s) => s.scan).map((s) => s.id))

/** 符合度掃描列檢核紀錄與待判之 AI 標準 id(kind 為 'ai' 者;依全集之序) */
export const RELATE_AI_STANDARD_IDS = Object.freeze(RELATE_STANDARDS.filter((s) => s.kind === 'ai').map((s) => s.id))

export default { RELATE_STANDARDS, RELATE_UNGATED_WRITE_ENTRIES, RELATE_AUDITED_STANDARD_IDS, RELATE_AI_STANDARD_IDS }
