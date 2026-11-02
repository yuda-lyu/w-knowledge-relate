// WKnowledgeRelate.mjs — 主入口:通用知識關聯套件
//
// 安裝即用(僅 workDir 必填);設定、詞彙、提示詞皆有通用預設,安裝方逐鍵覆寫即可收斂到自己的主題。
// 全部積木具名匯出,並預設匯出同一物件——安裝方依自己的管線自由組裝,不需改套件。
//
// 【匯出單一來源:模組清單】各公開模組於下方各列一次「命名空間匯入＋export *」;預設匯出物件由同一組命名空間合成,
//   具名匯出與預設物件必然同一組名稱(不另手寫名稱清單——三處各寫一份必然漂移)。
// 【名稱衝突即拋】兩模組匯出同名而不同實體時,export * 會靜默剔除該名(以具名匯入取用時才爆),故載入時即檢查並拋錯(合成之規則取抓取套件之
//   composeNamespaces,四套件同一份)。
// 【不轉出抓取與摘要套件之件】core/capturePackage.mjs(抓取埠)與 core/summarizePackage.mjs(摘要埠)為取用兩套件之單一匯入點,
//   不是本套件之公開模組;抓取與摘要之件(含待判之列表、逾期、要求重試、豁免等處置 API)請自其套件取用。

import { composeNamespaces } from './core/capturePackage.mjs'
import * as createKnowledgeRelateNs from './createKnowledgeRelate.mjs'
import * as relateObjectNs from './relateObject.mjs'
// ── 關聯執行期件之組裝(總組裝共用)與日誌／報告契約 ──
import * as relateRuntimeNs from './relateRuntime.mjs'
import * as logContractNs from './logContract.mjs'
// ── 設定預設、詞彙與核心件(本套件自有;兩套件無之模組)──
import * as relateSettingsNs from './core/relateSettings.mjs'
import * as relateVocabNs from './core/vocab/relateVocab.mjs'
import * as checksNs from './core/stores/checks.mjs'
// ── 子階段工廠、閘與逐項動作鏈、開工前維護、佇列段執行器、mw 積木與各段(重評、衝突核對、既有邊覆核)──
import * as relateStageNs from './stages/relateStage.mjs'
import * as relateChainNs from './stages/relateChain.mjs'
import * as relateMaintainNs from './stages/relateMaintain.mjs'
import * as relateQueueSegmentNs from './stages/relateQueueSegment.mjs'
import * as projectStageNs from './stages/projectStage.mjs'
import * as relationIndexStageNs from './stages/relationIndexStage.mjs'
import * as reevalSegmentNs from './stages/reevalSegment.mjs'
import * as conflictCheckSegmentNs from './stages/conflictCheckSegment.mjs'
import * as edgeReviewSegmentNs from './stages/edgeReviewSegment.mjs'
import * as checkPanelPagesNs from './stages/checkPanelPages.mjs'
import * as relateAiCallNs from './stages/relateAiCall.mjs'
// ── 提示詞與型別定義 ──
import * as relateDomainNs from './domain/relateDomain.mjs'
// ── 邊庫、候選、投影、帳、判定之純函數與待判 ──
import * as edgeStoreNs from './stores/edgeStore.mjs'
import * as candidatesNs from './stores/candidates.mjs'
import * as noteProjectionNs from './stores/noteProjection.mjs'
import * as relateLedgersNs from './stores/relateLedgers.mjs'
import * as relatedNotesNs from './stores/relatedNotes.mjs'
import * as edgeRetireNs from './stores/edgeRetire.mjs'
import * as edgeRewriteNs from './stores/edgeRewrite.mjs'
import * as edgeAuditNs from './stores/edgeAudit.mjs'
import * as deletionsNs from './stores/deletions.mjs'
import * as conflictEventsNs from './stores/conflictEvents.mjs'
import * as reverseCandidatesNs from './stores/reverseCandidates.mjs'
import * as rotationPolicyNs from './stores/rotationPolicy.mjs'
import * as edgeCheckKitNs from './stores/edgeCheckKit.mjs'
import * as reevalPolicyNs from './stores/reevalPolicy.mjs'
import * as conflictCheckPolicyNs from './stores/conflictCheckPolicy.mjs'
import * as edgeReviewPolicyNs from './stores/edgeReviewPolicy.mjs'
import * as checkMaterialNs from './stores/checkMaterial.mjs'
import * as relateHoldsNs from './stores/relateHolds.mjs'
// ── 檢定標準(邊標準、納入閘)、標準之登記、存量掃描、存量處置、交判定小組之排入(RS4／RS6 之待判登錄)──
import * as edgeStandardsNs from './standards/edgeStandards.mjs'
import * as edgeGateNs from './standards/edgeGate.mjs'
import * as registryNs from './standards/registry.mjs'
import * as auditNs from './standards/audit.mjs'
import * as stockFixNs from './standards/stockFix.mjs'
import * as edgeQueueNs from './standards/edgeQueue.mjs'
// ── 維運(明示刪除與還原、懸空清理、全庫投影、重評之基準、被撤出之邊之還原;受影響者之投影)──
import * as noteOpsNs from './ops/noteOps.mjs'
import * as projectOpsNs from './ops/projectOps.mjs'
// ── AI 能力評分(四角色;核心為抓取套件之 benchKit;命令列 bench/cli.mjs 被 import 時不執行,只轉出同一實體)──
import * as relateBenchNs from './bench/relateBench.mjs'
import * as benchCliNs from './bench/cli.mjs'

export * from './createKnowledgeRelate.mjs'
export * from './relateObject.mjs'
export * from './relateRuntime.mjs'
export * from './logContract.mjs'
export * from './core/relateSettings.mjs'
export * from './core/vocab/relateVocab.mjs'
export * from './core/stores/checks.mjs'
export * from './stages/relateStage.mjs'
export * from './stages/relateChain.mjs'
export * from './stages/relateMaintain.mjs'
export * from './stages/relateQueueSegment.mjs'
export * from './stages/projectStage.mjs'
export * from './stages/relationIndexStage.mjs'
export * from './stages/reevalSegment.mjs'
export * from './stages/conflictCheckSegment.mjs'
export * from './stages/edgeReviewSegment.mjs'
export * from './stages/checkPanelPages.mjs'
export * from './stages/relateAiCall.mjs'
export * from './domain/relateDomain.mjs'
export * from './stores/edgeStore.mjs'
export * from './stores/candidates.mjs'
export * from './stores/noteProjection.mjs'
export * from './stores/relateLedgers.mjs'
export * from './stores/relatedNotes.mjs'
export * from './stores/edgeRetire.mjs'
export * from './stores/edgeRewrite.mjs'
export * from './stores/edgeAudit.mjs'
export * from './stores/deletions.mjs'
export * from './stores/conflictEvents.mjs'
export * from './stores/reverseCandidates.mjs'
export * from './stores/rotationPolicy.mjs'
export * from './stores/edgeCheckKit.mjs'
export * from './stores/reevalPolicy.mjs'
export * from './stores/conflictCheckPolicy.mjs'
export * from './stores/edgeReviewPolicy.mjs'
export * from './stores/checkMaterial.mjs'
export * from './stores/relateHolds.mjs'
export * from './standards/edgeStandards.mjs'
export * from './standards/edgeGate.mjs'
export * from './standards/registry.mjs'
export * from './standards/audit.mjs'
export * from './standards/stockFix.mjs'
export * from './standards/edgeQueue.mjs'
export * from './ops/noteOps.mjs'
export * from './ops/projectOps.mjs'
export * from './bench/relateBench.mjs'
export * from './bench/cli.mjs'

/**
 * 公開模組之命名空間(預設匯出物件之來源;與上方 export * 為同一組模組)
 *
 * @type {Array}
 */
const NAMESPACES = [
    createKnowledgeRelateNs, relateObjectNs, relateRuntimeNs, logContractNs,
    relateSettingsNs, relateVocabNs, checksNs,
    relateStageNs, relateChainNs, relateMaintainNs, relateQueueSegmentNs, projectStageNs, relationIndexStageNs, reevalSegmentNs, conflictCheckSegmentNs, edgeReviewSegmentNs, checkPanelPagesNs, relateAiCallNs,
    relateDomainNs,
    edgeStoreNs, candidatesNs, noteProjectionNs, relateLedgersNs, relatedNotesNs, edgeRetireNs, edgeRewriteNs, edgeAuditNs, deletionsNs, conflictEventsNs,
    reverseCandidatesNs, rotationPolicyNs, edgeCheckKitNs, reevalPolicyNs, conflictCheckPolicyNs, edgeReviewPolicyNs, checkMaterialNs, relateHoldsNs,
    edgeStandardsNs, edgeGateNs, registryNs, auditNs, stockFixNs, edgeQueueNs,
    noteOpsNs, projectOpsNs,
    relateBenchNs, benchCliNs,
]

/**
 * 通用知識關聯套件
 *
 * 提供一輪關聯之完整管線(關聯 → 投影 → 總覽):
 * ① 安裝即用:createKnowledgeRelate({ workDir }) 零注入即可跑,讀摘要套件交出之筆記,預設席位為免金鑰之免費模型
 * ② 逐層可覆寫:cfg 設定逐鍵覆寫、cfg.data.vocab 型別清單與提示詞之領域句、cfg.prompts 提示詞、cfg.domains 整組 domain、
 *    cfg.stages／stageOpts 子階段與動作鏈 tap(含重評鏈)、cfg.aiAdapter 調度層
 * ③ 領域中立:主題範圍、知識庫稱呼、關聯型別與衝突型、型別之語意角色皆由安裝方決定
 * ④ 知識之加入、變更與刪除:新筆記之正向關聯、反向段與候選輪巡擴充關聯;內容變更之重判與既有邊之重評;明示刪除與還原
 * ⑤ 檢定標準:邊之納入閘與各標準之純函數判定、標準之登記(RELATE_STANDARDS)、存量掃描(auditRelateStandards)與存量處置
 *    (planEdgeStockFix 等)、衝突核對與既有邊覆核之判定小組,供測試與維運檢查功能是否正常
 * ⑥ 免費 AI 能力評分:四角色(關聯、重評、衝突核對、既有邊覆核)以正式提示詞量模型(runRelateBench、runRelateBenchCli)
 *
 * @returns {Object} 回傳套件物件,含 createKnowledgeRelate、createRelateObject、createRelateRuntime、子階段工廠(stage*)、mw 積木(mw*)、
 *     設定預設(resolveRelateSettings、RELATE_*)、詞彙(resolveRelateVocab 等)、domain 工廠、檢定標準、存量掃描與處置、維運件、
 *     AI 能力評分與日誌契約等(與具名匯出同一組)
 * @throws {Error} 兩個公開模組匯出同名而不同實體時於載入期拋出
 * @example
 * import WKnowledgeRelate from 'w-knowledge-relate/src/WKnowledgeRelate.mjs'
 *
 * //零注入:僅 workDir 必填(金鑰放 workDir/.env;預設 AI 席位為免金鑰之免費模型)
 * let flow = WKnowledgeRelate.createKnowledgeRelate({
 *     workDir: './my-kb', //notes 集合中之筆記(摘要套件交出)即本套件之輸入
 *     data: { vocab: { domain: '天文學' } }, //主題範圍(選填), 未給即不限主題
 * })
 * let report = await flow.run() //關聯一輪, 兩端 md 之關聯章與 my-kb/knowledge/relations 之總覽隨之更新, 結束後寫 log/<day>/<stamp>-run.json
 * console.log(report.ok)
 */
const WKnowledgeRelate = composeNamespaces('WKnowledgeRelate', NAMESPACES)


export default WKnowledgeRelate
