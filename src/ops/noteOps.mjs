// noteOps.mjs — 知識之明示刪除與其撤銷／還原、懸空邊清理、全庫投影、重評之基準重設與重排、被撤出之邊之還原(維運 API;知識刪除 → 刪除關聯)
//
// 【刪除只走明示】md 消失或記錄消失都不自動視為刪除(可能是暫時之檔案系統狀況、誤刪或開錯集合——自動刪會連帶刪掉邊庫之真理)。
// 【刪除步驟固定、每步可重跑】墓碑(relate-tombstones.json;記時刻與理由——理由必填,刪除須可追溯)→ 封存(記錄＋理由＋其邊＋涉及該篇之
//   反向待處理對＋md 副本;stores/deletions)→ 鄰居記待投影 → 撤邊(stores/edgeRetire:事件帳、稽核先記再刪、刪後回驗)→ 刪記錄(回驗)
//   → 刪 md(與封存副本相同者)→ 清帳(待投影、反向待處理對)→ 總覽待重建。中途中斷:重跑本 op 續完(理由取自墓碑;md 路徑與鄰居取自
//   封存——前次已刪之記錄與邊只在封存裡);未重跑者,關聯段每輪依墓碑清掉殘留邊並發必看字樣(stores/deletions 之半狀態)。
//   前次還原或撤銷未歸檔封存者拒刪(否則新封存誤併舊封存之邊)。
// 【撤銷與還原是兩種契約】(撤銷不過新進之閘;使用者之重新收件過閘——兩者不同 API)
//   ①undoDeleteNote＝撤銷該次刪除(存量處置之回退等):原樣放回封存之記錄、md 與兩端仍在之邊(型別改名照詞彙表之改名表機械改寫,與每輪
//     維護同一規則 domainTypeRenamerOf;不過納入閘、不過筆記標準、不登錄新待判)、涉及該篇之反向待處理對(兩端仍在且未相連者,原樣含 tries)。
//     其後之改動不被撤銷蓋掉:現值已在而不同之邊不覆寫(edgesKept)、刪除後另被他途撤出之邊不放回(edgesKept;稽核最後一筆非本次刪除)、
//     md 與封存副本不同者不覆寫(mdConflict)。可續作(含半刪之逆:刪除停在中途者)。
//   ②restoreNote＝使用者把已刪之筆記重新收件:筆記過筆記標準(摘要套件之還原閘,deps.noteGate 注入;未注入 → WARN,原樣還原)、邊過納入閘
//     (與新進同一接受規則)、帶回之衝突邊依衝突核對之開關登錄 RS4 待判(檔頭【還原之邊與 AI 標準】②);可預演(opt.dryRun:純讀,不開帳)、可續作。
//   兩者皆:先記後寫(本篇與鄰居記待投影、總覽待重建先於任何寫入;筆記之待判先於放回記錄)、放回之邊各追加稽核 { reason:'restored',
//     restoredFrom:'note-deleted', note, via, edge }(完成之標記:續作時現值已為放回之值而稽核仍為撤出者補記)、刪除期間對方內容變更且已評完
//     既有邊者清其評完標記(放回之邊未經對方本版本裁決——未判不記已審)、先放回後移除墓碑、最後歸檔封存(.undone-／.restored-<時戳>)、
//     回傳鄰居(呼叫端據以投影)、預設當場投影。「墓碑在而記錄在」即刪除或還原停在中途(關聯段不以之為對象)。
// 【domain 於任何寫入前驗】撤邊須衝突型之名(衝突邊之撤出寫事件帳,下游據以判「衝突已不成立」)、投影須型別序、還原須型別解析與納入閘、
//   撤銷須改名表——缺 domain 即拋,不以「衝突邊不寫事件」或「寫到一半才拋」靜默降級(deleteNote、pruneDangling 之寫入、undoDeleteNote、
//   restoreNote、restoreEdge、projectAll)。
// 【還原過納入閘(檢定標準 RS1／RS2／RS3／RS8;standards/edgeGate)】還原筆記之邊與 restoreEdge 皆先過閘(材料＝兩端筆記之存量材料,
//   摘要套件之 noteMaterialText;還原中之本篇取將放回之 md);不合格者不還原並列出理由(還原路徑與新進同一接受規則)。
// 【來源文件不重開】來源文件之 noteSlug 指向已刪筆記者不重開,避免下一輪重新摘要出同一篇(刪除即「不要這篇」)。
// 【以之為出處之下游產物由下游處置】本 op 只列出以該篇為出處者(選用集合 stores.cores 之 noteIds;未開即空清單);下游依刪除墓碑自行
//   撤出處、還原後恢復——關聯不編入下游之知識。
// 【還原之筆記過筆記標準】仍不合格 → 不還原並列出(與邊之還原同一接受規則);使用者明示接受(opt.withHolds)→ 照還原並登錄待判;未能判定 →
//   照還原並登錄待判。修正後之 md 與記錄(同步欄位、syncHash)一併寫入,不寫 knowledgeChangedAt;內容或標題有修正而已被下游使用者,
//   呼叫端據 std.contentChanged／std.titleChanged(兩旗標分列,與存量處置之帳列同義)請下游重設基準。續作時記錄已放回者不再判。
// 【還原之邊與 AI 標準】還原回庫之邊與新進同受兩席核對,不另立接受規則:
//   ①restoreEdge 還原「AI 標準撤出或隔離」之邊(rs4-retire／rs4-quarantine → RS4;rs6-retire／rs6-quarantine → RS6)＝使用者對該標準之裁示
//     (隔離待判之下一步即寫「確認為真衝突／關聯成立者以 restoreEdge 還原」):該邊該標準之未結待判結案(記處置方式)、檢核紀錄記合格
//     (seats 'user'、還原後之值之雜湊)——存量佇列不再重排、不再派兩席(否則再隔離而迴圈);之後邊值或內容版本變了照常重核。裁示須記
//     檢核紀錄:未開 checks 集合即於任何寫入前拋。
//   ②其餘還原(restoreEdge 之他種撤出理由、restoreNote 帶回之邊)之衝突型邊:檢核紀錄未涵蓋其現值者登錄 RS4 待判(standards/edgeQueue 之
//     queueConflictCheck;已有未結者不重登;使用者已豁免而邊未再變者不重開——已裁示者不重提),由衝突核對段下輪兩席核對。衝突核對未開啟者
//     不登錄(否則待判無人消化而逾期):opt.conflictCheck 明給者從之;未給而 deps.settings 有 relate.standards.conflictCheck 者依其 enabled;
//     皆無 → 登錄。未開 holds／checks 集合者略過(回報 false)。撤銷(undoDeleteNote)不登錄。
// 【restoreEdge】依稽核還原一條被撤出之邊(兩端皆在、現值不在;note-deleted 亦可——還原筆記時未過納入閘或對方當時不在之邊之補救);
//   撤出之理由本身不合標準(如 RS6 判關聯成立而理由修不了之 std-retire)時,使用者可給新理由還原(opt.reason;同過納入閘;updatedAt＝還原時刻)。
//   可續作(現值已為還原之值而稽核仍為撤出者補完裁示與稽核);非裁示之還原另清兩端之過時評完標記(同上);預設當場投影兩端。
// 【revertEdgeRevision(AI 改寫之逆)】撤回一條邊最後一筆由判定小組套用之改寫:三段帳(重評 relate-reeval.jsonl 之 applied、衝突核對
//   relate-conflict-check.jsonl 之 reason／downgrade、既有邊覆核 relate-edge-review.jsonl 之 reason／retype／upgrade——皆帶改寫前之邊值 edge 與
//   寫入值 written)中該邊之列與本 op 之 reverted 列合併依時刻取最後一筆:為 reverted 者不可逆(其後無新改寫);現值之型別與理由須＝該列之寫入值
//   (其後另被改動者不覆寫)、兩端須在;改寫前之值重組提案過納入閘(兩端存量材料;不給新理由——改寫前之值本不合格者即不該回復,那是 restoreEdge 之事)
//   → stores/edgeRewrite 改寫(AI 寫入之值入 history、updatedAt＝現在、衝突降級寫事件帳)→ 視為使用者對該段標準之裁示(同 restoreEdge ①:核對帳之列
//   而回復衝突型 → RS4、覆核帳之列而回復非衝突型 → RS6:該邊該標準之未結待判結案、檢核記合格 seats 'user';重評帳之列 → RS5:該邊之 RS5 未結待判結案、
//   回復之值為衝突型而檢核未涵蓋者登錄 RS4 待判〔同②〕)→ 同一段帳追加 { at, entry:'user', edgeId, edge:撤回前之值, outcome:'reverted', revertOf:該列 at,
//   written:回復後之值 }(帳讀者以 outcome 分)→ 預設當場投影兩端。不清兩端之評完標記(裁示即使用者之判定)。提案列(核對帳 written／written-reason／
//   written-other-type:新衝突之落地,含重評、覆核升級交核對而落地者)不在列——其 edge 為提案本身而非改寫前之現值,逆操作無據。可預演(非 apply 純讀)。
// 【世代】寫入前檢核邊庫世代(未遷移之有序對庫拒寫)。呼叫端負責取執行鎖。

import fs from 'fs'
import path from 'path'
import isestr from 'wsemi/src/isestr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import { writeFileAtomic } from '../core/capturePackage.mjs'
import { readMd, writeMd } from '../core/summarizePackage.mjs'
import { noteMaterialText } from '../core/summarizePackage.mjs'
import { STATUS } from '../core/capturePackage.mjs'
import { resolveHold, waiveHold, holdKey, listHolds } from '../core/capturePackage.mjs'
import { checkKey, needsCheck, recordCheck } from '../core/stores/checks.mjs'
import { typeRankOf, persistEdge, generationMismatchOf, buildAdjacency, sameEdge, edgeId, mergeEdge, domainTypeRenamerOf, makeEdge } from '../stores/edgeStore.mjs'
import { openRelateLedgers, appendAudit, readAuditRows, LEDGER_FILES } from '../stores/relateLedgers.mjs'
import { retiredEdgesOf } from '../stores/edgeAudit.mjs'
import { retireEdge, RESTORABLE_REASONS } from '../stores/edgeRetire.mjs'
import { rewriteEdge } from '../stores/edgeRewrite.mjs'
import { archiveFilesOf, readArchive, openDeletions } from '../stores/deletions.mjs'
import { gateEdgeProposal, gateCtxOf } from '../standards/edgeGate.mjs'
import { reviewEdgesOf } from '../stores/reevalPolicy.mjs'
import { needsEdgeReview, edgesReviewedOf } from '../stores/relatedNotes.mjs'
import { RS4 } from '../stores/conflictCheckPolicy.mjs'
import { relationTypesVersionOf } from '../stores/edgeCheckKit.mjs'
import { createCheckHasher } from '../stores/checkMaterial.mjs'
import { RS6 } from '../stores/edgeReviewPolicy.mjs'
import { RS5, waiverCoversEdge, RELATE_API_HINT, RELATE_BASELINE_RULING_PREFIX } from '../stores/relateHolds.mjs'
import { queueConflictCheck } from '../standards/edgeQueue.mjs'
import { projectAffected } from './projectOps.mjs'
import { projectNotes } from '../stores/noteProjection.mjs'

/** restoreEdge 之撤出理由 → 視為使用者裁示之 AI 標準(檔頭【還原之邊與 AI 標準】①) */
const RULING_STD = Object.freeze({ 'rs4-retire': RS4, 'rs4-quarantine': RS4, 'rs6-retire': RS6, 'rs6-quarantine': RS6 })

/** 段帳之可逆改寫列(檔頭【revertEdgeRevision】):帳 → 標準、套用之改寫之 outcome(列須有改寫前之邊值 edge 與寫入值 written)、段名(字樣) */
const REVISION_LEDGERS = Object.freeze([
    Object.freeze({ key: 'reeval', std: RS5, outcomes: Object.freeze(['applied']), label: '重評' }),
    Object.freeze({ key: 'conflictCheck', std: RS4, outcomes: Object.freeze(['reason', 'downgrade']), label: '衝突核對' }),
    Object.freeze({ key: 'edgeReview', std: RS6, outcomes: Object.freeze(['reason', 'retype', 'upgrade']), label: '既有邊覆核' }),
])
/** 逆操作之帳列 outcome(三段帳同一字) */
const REVERTED_OUTCOME = 'reverted'

/**
 * 兩時刻之先後(以時刻比較;任一無法解析時依字面)
 *
 * @param {String} a 輸入時刻
 * @param {String} b 輸入時刻
 * @returns {Boolean} 回傳 a 是否晚於 b
 */
function later(a, b) {
    const x = Date.parse(a)
    const y = Date.parse(b)
    if (Number.isFinite(x) && Number.isFinite(y)) return x > y
    return String(a ?? '') > String(b ?? '')
}

/**
 * 兩邊之可見欄位(from／to／type／reason)是否相同(續作時判「現值即前次放回之值」;updatedAt 等時刻不比——新理由之還原以還原時刻為 updatedAt)
 *
 * @param {Object} a 輸入邊
 * @param {Object} b 輸入邊
 * @returns {Boolean} 回傳是否相同
 */
const sameVisible = (a, b) => isobj(a) && isobj(b) && ['from', 'to', 'type', 'reason'].every((k) => String(a[k] ?? '') === String(b[k] ?? ''))

/**
 * 維運 op 之 domain(任何寫入前檢核;檔頭【domain 於任何寫入前驗】)
 *
 * @param {Object} deps 輸入維運 deps
 * @param {String} op 輸入 op 名(錯誤訊息用)
 * @returns {Object} 回傳 deps.domain
 * @throws {Error} deps.domain 缺或缺型別清單、衝突型之名、型別解析時拋出
 */
function domainOf(deps, op) {
    const d = deps?.domain
    if (!isobj(d) || !isarr(d.relationTypes) || !isarr(d.conflictTypeNames) || !isfun(d.resolveType)) {
        throw new Error(`${op} 需要 deps.domain（關聯 domain，createRelateDomain 之產物——撤邊之衝突事件、投影與還原之納入閘皆讀之）`)
    }
    return d
}

/**
 * 還原後衝突邊是否登錄 RS4 待判(檔頭【還原之邊與 AI 標準】②):opt.conflictCheck 明給(布林)者從之;否則 deps.settings 有
 *   relate.standards.conflictCheck 者依其 enabled;皆無回 undefined(登錄)
 *
 * @param {Object} deps 輸入維運 deps(可含 settings)
 * @param {Object} opt 輸入 op 之 opt
 * @returns {Boolean|undefined} 回傳是否開啟衝突核對(undefined＝未知,照登錄)
 */
function conflictCheckOf(deps, opt) {
    if (typeof opt.conflictCheck === 'boolean') return opt.conflictCheck
    const cc = deps?.settings?.relate?.standards?.conflictCheck
    return isobj(cc) ? cc.enabled === true : undefined
}

/**
 * 還原之邊之 AI 標準處置(檔頭【還原之邊與 AI 標準】):使用者裁示(RS4／RS6)或衝突型登錄 RS4 待判
 *
 * @param {Object} deps 輸入 { stores, clock, domain }
 * @param {Object} edge 輸入還原後(落庫)之邊值
 * @param {Map} notes 輸入兩端筆記 id → 記錄
 * @param {Object} o 輸入 { retiredAs:String(restoreEdge 之撤出理由;還原筆記為 'note-deleted'), apply:Boolean(false 只預判不寫), conflictCheck:Boolean|undefined, source:String(說明),
 *   std?:Object(明給之裁示標準 RS4｜RS6——revertEdgeRevision 用;未給依 retiredAs), how?:String(裁示之處置方式;未給為 restoreEdge 之句) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ruling:'RS4'|'RS6'|'', rs4Queued:Boolean }
 */
async function restoredStandards(deps, edge, notes, o) {
    const { stores, domain } = deps
    const at = deps.clock.iso8()
    const isConflict = edge.type === domain.conflictType
    // 檢核雜湊與關聯段同一算法、同一型別版本、同一素材讀法(stores/checkMaterial.createCheckHasher)——不同即裁示之紀錄被當過時而重核
    const hash = createCheckHasher({ byId: notes, domain, typesVer: relationTypesVersionOf(domain) }).hashOf(edge)
    const std = o.std || RULING_STD[o.retiredAs]
    // ①使用者裁示(RS4 只對衝突型、RS6 只對非衝突型——各標準之對象)
    if (std && (std === RS4) === isConflict) {
        if (o.apply === true) {
            const how = isestr(o.how) ? o.how : `使用者以 restoreEdge 還原（撤出理由 ${o.retiredAs}）——裁示${std === RS4 ? '為真衝突' : '關聯成立'}；此值不再自動${std === RS4 ? '核對' : '覆核'}`
            const h = stores.holds ? await stores.holds.get(holdKey(std.objectEdge, edge.id, std.std)) : null
            if (h?.status === 'open') await resolveHold(stores.holds, h.id, { at, how })
            await recordCheck(stores.checks, { object: std.objectEdge, oid: edge.id, hash, std: std.std, v: std.v, at, status: STATUS.PASS, seats: 'user', reason: how })
        }
        return { ruling: std.std, rs4Queued: false }
    }
    // ②衝突型而檢核紀錄未涵蓋現值 → RS4 待判(pipeline;已有未結者不重登;使用者已豁免而邊未再變者不重開)
    if (!isConflict || o.conflictCheck === false || !stores.holds || !stores.checks) return { ruling: '', rs4Queued: false }
    if (!needsCheck(await stores.checks.get(checkKey(RS4.objectEdge, edge.id)), { hash, std: RS4.std, v: RS4.v })) return { ruling: '', rs4Queued: false }
    const cur = await stores.holds.get(holdKey(RS4.objectEdge, edge.id, RS4.std))
    if (cur?.status === 'open') return { ruling: '', rs4Queued: false }
    if (waiverCoversEdge(cur, edge)) return { ruling: '', rs4Queued: false }
    if (o.apply === true) {
        await queueConflictCheck(stores.holds, { edgeId: edge.id, from: edge.from, to: edge.to, reason: `${o.source}之衝突邊尚未經衝突核對（RS4）`, ctx: { restoredFrom: o.retiredAs }, at })
    }
    return { ruling: '', rs4Queued: true }
}

/**
 * 開帳＋世代檢核(寫入類 op 共用;壞帳之告警經 deps.log,字樣同關聯段——stores/relateLedgers 之 ledgerCorruptTextOf)
 *
 * @param {Object} deps 輸入 { stores, dirs, clock, log }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ledgers, edges }
 * @throws {Error} 邊庫世代不符(未遷移之有序對庫)、關鍵帳損壞且無法隔離時拋出
 */
async function openChecked(deps) {
    const ledgers = openRelateLedgers(deps.dirs.state, { stamp: deps.clock.stamp8(), log: deps.log })
    const edges = await deps.stores.relations.select()
    assertGeneration(edges)
    return { ledgers, edges }
}

/**
 * 邊庫世代檢核(寫入前;預演之純讀路徑同用)
 *
 * @param {Array} edges 輸入邊陣列
 * @throws {Error} 邊庫世代不符時拋出
 */
function assertGeneration(edges) {
    const mismatch = generationMismatchOf(edges)
    if (mismatch > 0) throw new Error(`關聯邊庫世代不符：${mismatch} 條邊之 id 不是無序對雜湊——${RELATE_API_HINT.migrate}`)
}

/**
 * 筆記之存量材料(RS8;md 之原文標題＋內容章;記錄不在或 md 讀不到回 null)
 *
 * @param {Object|null} note 輸入筆記記錄
 * @returns {String|null} 回傳材料文字
 */
function materialOfNote(note) {
    const md = note ? readMd(note.file) : null
    return md ? noteMaterialText(md.body) : null
}

/**
 * 還原路徑之納入閘(兩端之存量材料;domain 提供型別解析與空泛片語)
 *
 * @param {Object} edge 輸入欲還原之邊(稽核或封存之值)
 * @param {Object} domain 輸入關聯 domain
 * @param {Map} notes 輸入兩端筆記 id → 記錄(不在者為 null)
 * @param {Map} [given] 輸入已知之材料 id → 文字(還原中之本篇:將放回之 md;未給者讀記錄之 md)
 * @param {Object} [locale] 輸入語言設定(deps.locale;納入閘之正體修正與 RS3 之適用依之,未給＝臺灣正體)
 * @returns {Object} 回傳 gateEdgeProposal 之結果
 */
function gateRestore(edge, domain, notes, given, locale) {
    const material = new Map([...notes].map(([id, n]) => [id, given?.has(id) ? given.get(id) : materialOfNote(n)]))
    return gateEdgeProposal(edge, gateCtxOf(domain, { hasNote: (id) => !!notes.get(id), materialOf: (id) => (material.has(id) ? material.get(id) : null), locale }))
}

/**
 * 以某篇筆記為出處之下游產物(選用集合 stores.cores 之 noteIds;未開即空清單)
 *
 * @param {Object} stores 輸入集合(取 cores)
 * @param {String} slug 輸入筆記 id
 * @returns {Promise} 回傳 Promise，resolve 回傳產物 id 陣列
 */
async function coresCiting(stores, slug) {
    if (!stores.cores?.select) return []
    const cores = await stores.cores.select()
    return cores.filter((c) => Array.isArray(c.noteIds) && c.noteIds.includes(slug)).map((c) => c.id)
}

/**
 * 筆記是否在(逐 id 快取;同一次 op 之內)
 *
 * @param {Object} stores 輸入集合(取 notes)
 * @returns {Function} 回傳 async (id) => 記錄｜null
 */
function noteReader(stores) {
    const cache = new Map()
    return async (id) => {
        if (!cache.has(id)) cache.set(id, (await stores.notes.get(id)) || null)
        return cache.get(id)
    }
}

/**
 * 邊之對方中仍在者(依 id 排序;刪除之鄰居＝現存之邊與封存之邊之對方)
 *
 * @param {Array} edges 輸入邊
 * @param {String} slug 輸入筆記 id
 * @param {Function} noteOf 輸入 noteReader 之產物
 * @returns {Promise} 回傳 Promise，resolve 回傳鄰居 id 陣列
 */
async function presentOthersOf(edges, slug, noteOf) {
    const out = []
    for (const id of [...new Set(edges.map((e) => (e.from === slug ? e.to : e.from)))].sort()) if (await noteOf(id)) out.push(id)
    return out
}

/**
 * 撤銷與還原之逐邊計畫(純讀;先算後寫——鄰居與先記之待投影依計畫):對方不在 → skipped;刪除後另被他途撤出(現值不在而稽核最後一筆為他種撤出)
 *   → kept(不放回);現值在而從未撤出(刪除停在撤邊之前)→ intact;現值在而為本次欲放回之值(續作)→ 待補完;現值在而不同 → kept(不覆寫);
 *   其餘 → 待放回(由 decide 定其值或拒絕)
 *
 * @param {Object} o 輸入 { arc(封存), slug, noteOf, last:Map(retiredEdgesOf 之產物), get:(id)=>現值, decide:(e, other, otherNote)=>{ ok, edge?, reasons? }
 *   (欲放回之值;不 ok 者列 rejected), same:(cur, edge)=>Boolean(現值即欲放回之值) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { put:[{ e, other, otherNote, edge, cur }](待放回或待補完), skipped, kept, rejected, neighbors(放回後仍相連之對方;依 id 排序) }
 */
async function edgePlanOf(o) {
    const out = { put: [], skipped: [], kept: [], rejected: [], neighbors: [] }
    const linked = new Set()
    for (const e of o.arc.edges) {
        const other = e.from === o.slug ? e.to : e.from
        const otherNote = await o.noteOf(other)
        if (!otherNote) {
            out.skipped.push({ id: e.id, other })
            continue
        }
        const retiredAs = o.last.get(e.id)?.reason || ''
        const cur = await o.get(e.id)
        if (!cur && retiredAs && retiredAs !== 'note-deleted') {
            out.kept.push({ id: e.id, other, why: `刪除後另被撤出（${retiredAs}）` })
            continue
        }
        if (cur && retiredAs !== 'note-deleted') {
            linked.add(other) // 從未撤出(刪除停在撤邊之前):原樣在庫
            continue
        }
        const d = o.decide(e, other, otherNote)
        if (cur) {
            linked.add(other)
            if (d.ok && o.same(cur, d.edge)) out.put.push({ e, other, otherNote, edge: cur, cur, retiredAs })
            else out.kept.push({ id: e.id, other, why: '現值已在而不同' })
            continue
        }
        if (!d.ok) {
            out.rejected.push({ id: e.id, other, reasons: d.reasons })
            continue
        }
        linked.add(other)
        out.put.push({ e, other, otherNote, edge: d.edge, cur: null, retiredAs })
    }
    out.neighbors = [...linked].sort()
    return out
}

/**
 * 封存之反向待處理對中可放回者(撤銷與還原同一規則):對方仍在且兩端未相連(相連即已無須再判——同反向段之出隊重驗)
 *
 * @param {Object} arc 輸入封存(取 reverse)
 * @param {String} slug 輸入筆記 id
 * @param {Function} noteOf 輸入 noteReader 之產物
 * @param {Object} relations 輸入邊集合(get)
 * @returns {Promise} 回傳 Promise，resolve 回傳反向待處理對陣列(原樣,含 tries)
 */
async function reversePairsBackOf(arc, slug, noteOf, relations) {
    const out = []
    for (const p of arc.reverse) {
        const other = p.o === slug ? p.n : p.o
        if (!(await noteOf(other)) || await relations.get(edgeId(p.o, p.n))) continue
        out.push(p)
    }
    return out
}

/**
 * 放回之邊未經對方本版本之重評裁決:對方在 since(撤出時刻)之後內容變更、且已記本版本評完者,清其評完標記(下輪重評——未判不記已審)
 *
 * @param {Object} stores 輸入集合(取 notes)
 * @param {Array} ids 輸入對方之筆記 id
 * @param {String} since 輸入邊被撤出之時刻
 * @returns {Promise} 回傳 Promise，resolve 回傳清除之篇數
 */
async function clearStaleReview(stores, ids, since) {
    let n = 0
    for (const id of [...new Set(ids)]) {
        const x = await stores.notes.get(id)
        if (x && edgesReviewedOf(x) && later(x.knowledgeChangedAt, since)) {
            await stores.notes.patch(id, { edgesReviewedChangeAt: '', edgesReviewed: '' })
            n++
        }
    }
    return n
}

/**
 * 封存歸檔(還原或撤銷完成;改名留存,不刪)
 *
 * @param {Object} files 輸入 archiveFilesOf 之產物
 * @param {String} tag 輸入 'restored'｜'undone'
 * @param {String} stamp 輸入時戳
 */
function settleArchive(files, tag, stamp) {
    for (const f of [files.json, files.md]) if (fs.existsSync(f)) fs.renameSync(f, f.replace(/(\.\w+)$/, `.${tag}-${stamp}$1`))
}

/**
 * 明示刪除一篇筆記(含其全部關聯)
 *
 * @param {Object} deps 輸入 { stores, dirs, clock, log, domain(預演以外必給;撤邊之衝突事件與當場投影讀之) }
 * @param {String} slug 輸入筆記 id
 * @param {Object} [opt={}] 輸入 { reason:String(刪除理由;記入墓碑與封存,非預演必填——續作中斷之刪除可省,取墓碑或封存之理由),
 *        dryRun:Boolean, project:Boolean(預設 true:當場投影鄰居) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { slug, dryRun, resumed(本次之前已有墓碑:續作), reason, edges(本次撤出之邊數), neighbors:Array(仍在之鄰居;
 *   續作時含前次已撤之邊之對方), cores:Array(以之為出處之下游產物), mdLeft:Boolean(md 與封存副本不同而未刪), projected? }
 * @throws {Error} 非預演而缺 deps.domain、筆記不存在且無墓碑、前次還原或撤銷未歸檔封存、未給理由、世代不符、刪除回驗失敗時拋出(缺 domain 於任何寫入前拋)
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async () => [...m.values()],
 *         insertNew: async (xs) => { xs.forEach((x) => m.set(x.id, x)); return { addCount: xs.length } },
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *         del: async (id) => m.delete(id),
 *     }
 * }
 * let domain = createRelateDomain({})
 * let edge = makeEdge({ from: 'a', to: 'b', type: domain.relationTypes[0], reason: 'a 與 b 共用同一組參數', nowIso: '2026-11-01T00:00:00+08:00' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]), relations: mem([edge]) },
 *     dirs: { state },
 *     clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     domain,
 * }
 * let dry = await deleteNote(deps, 'a', { dryRun: true })
 * console.log(dry.dryRun, dry.edges, dry.neighbors)
 * let r = await deleteNote(deps, 'a', { reason: '內容與 b 重複', project: false })
 * console.log(r.resumed, r.reason, r.edges, r.neighbors, await deps.stores.notes.get('a'), (await deps.stores.relations.select()).length)
 * fs.rmSync(state, { recursive: true, force: true })
 * // => true 1 [ 'b' ]
 * // => false 內容與 b 重複 1 [ 'b' ] null 0
 */
export async function deleteNote(deps, slug, opt = {}) {
    if (!isestr(slug)) throw new Error('deleteNote 需要筆記 id')
    const dry = opt.dryRun === true
    const domain = dry ? null : domainOf(deps, 'deleteNote')
    const { stores, dirs, clock } = deps
    // 預演純讀:不開帳(開帳會隔離壞檔)、不建檔;墓碑以唯讀讀之(世代檢核照做)
    let ledgers = null
    let edges
    if (dry) {
        edges = await stores.relations.select()
        assertGeneration(edges)
    }
    else ({ ledgers, edges } = await openChecked(deps))
    const tombs = dry ? openDeletions(dirs.state) : ledgers.tombstones
    const note = await stores.notes.get(slug)
    const tomb = tombs.has(slug)
    if (!note && !tomb) throw new Error(`筆記不存在：${slug}`)
    const files = archiveFilesOf(dirs.state, slug)
    const prev = readArchive(files.json)
    if (note && !tomb && prev) throw new Error(`筆記 ${slug} 之前次還原或撤銷未完成（封存未歸檔）——${RELATE_API_HINT.deletionResume}`)
    const mine = edges.filter((e) => e.from === slug || e.to === slug)
    const neighbors = await presentOthersOf([...mine, ...(prev?.edges || [])], slug, noteReader(stores))
    const cores = await coresCiting(stores, slug)
    const reason = String(opt.reason ?? '').trim() || tombs.reasonOf(slug) || String(prev?.reason || '')
    if (dry) return { slug, dryRun: true, resumed: tomb, reason, edges: mine.length, neighbors, cores }
    if (!reason) throw new Error(`deleteNote 需要刪除理由（opt.reason；記入墓碑與封存）：${slug}`)
    const at = clock.iso8()
    // ① 墓碑(時刻＋理由)
    if (!tomb) ledgers.tombstones.add(slug, at, reason)
    // ② 封存(記錄＋理由＋其邊＋反向待處理對＋md 副本);續作時與既有封存合併(邊與對取聯集——前次已撤之邊、已清之對只在封存裡);記錄已無則保留既有封存
    if (note) {
        fsCreateFolder(files.dir)
        const byEdge = new Map([...(prev?.edges || []), ...mine].map((e) => [e.id, e]))
        const mineReverse = ledgers.reverse.pairs().filter((p) => p.o === slug || p.n === slug)
        const byPair = new Map([...(prev?.reverse || []), ...mineReverse].map((p) => [`${p.o}|${p.n}`, p]))
        writeFileAtomic(files.json, JSON.stringify({ deletedAt: prev?.deletedAt || at, reason: prev?.reason || reason, record: note, edges: [...byEdge.values()], reverse: [...byPair.values()] }, null, 2))
        if (isestr(note.file) && fs.existsSync(note.file)) fs.copyFileSync(note.file, files.md)
    }
    // ③ 鄰居待投影＋總覽待重建(帳之 touch;先記後寫)
    ledgers.touch(neighbors)
    // ④ 撤邊(事件帳、稽核先記再刪、刪後回驗)
    for (const e of mine) {
        await retireEdge({ relations: stores.relations, ledgers, stateDir: dirs.state }, e, { reason: 'note-deleted', at, note: slug, detail: reason, conflictTypes: domain.conflictTypeNames, hasNote: (id) => id !== slug })
    }
    // ⑤ 刪記錄(回驗)
    if (note) {
        await stores.notes.del(slug)
        if (await stores.notes.get(slug)) throw new Error(`筆記記錄 ${slug} 刪除後回驗仍在`)
    }
    // ⑥ 刪 md(路徑取記錄,續作時取封存;與封存副本相同者才刪——不同者非本次刪除之物,留著並回報)
    const file = note?.file || prev?.record?.file
    let mdLeft = false
    if (isestr(file) && fs.existsSync(file) && fs.existsSync(files.md)) {
        if (fs.readFileSync(file).equals(fs.readFileSync(files.md))) fs.rmSync(file, { force: true })
        else mdLeft = true
    }
    // ⑦ 清帳(總覽待重建已於 ③ 記)
    ledgers.dirty.remove([slug])
    ledgers.reverse.remove((p) => p.o === slug || p.n === slug)
    let projected = null
    if (opt.project !== false && neighbors.length) {
        projected = await projectNotes(deps, neighbors, { ledger: ledgers.dirty })
    }
    return { slug, dryRun: false, resumed: tomb, reason, edges: mine.length, neighbors, cores, mdLeft, projected }
}

/**
 * 一篇之刪除狀態(唯讀;存量處置之連鎖斷言、維運查詢用):刪除完整＝記錄不在、墓碑在、封存在、無邊連到該篇、md 不在
 *
 * @param {Object} deps 輸入 { stores:{ notes, relations }, dirs:{ state } }
 * @param {String} slug 輸入筆記 id
 * @param {Object} [o={}] 輸入 { edges:Array(邊庫之邊;多篇連查時一次讀入共用,未給即讀) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { record:Boolean, tombstone:Boolean, archive:Boolean, edges:Integer(仍連到該篇之邊數), md:Boolean(md 仍在), complete:Boolean }
 * @throws {Error} 封存壞或形狀不符時拋出
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async () => [...m.values()],
 *         insertNew: async (xs) => { xs.forEach((x) => m.set(x.id, x)); return { addCount: xs.length } },
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *         del: async (id) => m.delete(id),
 *     }
 * }
 * let domain = createRelateDomain({})
 * let edge = makeEdge({ from: 'a', to: 'b', type: domain.relationTypes[0], reason: 'a 與 b 共用同一組參數', nowIso: '2026-11-01T00:00:00+08:00' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]), relations: mem([edge]) },
 *     dirs: { state },
 *     clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     domain,
 * }
 * let before = await deletionStatusOf(deps, 'a')
 * await deleteNote(deps, 'a', { reason: '內容與 b 重複', project: false })
 * let after = await deletionStatusOf(deps, 'a')
 * console.log(before.complete, before.record, before.edges)
 * console.log(after.complete, after.record, after.tombstone, after.archive, after.edges, after.md)
 * fs.rmSync(state, { recursive: true, force: true })
 * // => false true 1
 * // => true false true true 0 false
 */
export async function deletionStatusOf(deps, slug, o = {}) {
    const arc = readArchive(archiveFilesOf(deps.dirs.state, slug).json)
    const record = !!(await deps.stores.notes.get(slug))
    const tombstone = openDeletions(deps.dirs.state).has(slug)
    const edges = (isarr(o.edges) ? o.edges : await deps.stores.relations.select()).filter((e) => e.from === slug || e.to === slug).length
    const file = arc?.record?.file
    const md = isestr(file) && fs.existsSync(file)
    return { record, tombstone, archive: !!arc, edges, md, complete: !record && tombstone && !!arc && edges === 0 && !md }
}

/**
 * 撤銷一次明示刪除(檔頭【撤銷與還原是兩種契約】①;存量處置之回退等):原樣放回,不過納入閘、不過筆記標準、不登錄新待判;可續作
 *
 * @param {Object} deps 輸入 { stores, dirs, clock, log, domain }
 * @param {String} slug 輸入筆記 id
 * @param {Object} [opt={}] 輸入 { project:Boolean(預設 true:當場投影本篇與鄰居) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { slug, undone:Boolean(false＝未被刪除,無可撤銷), resumed(記錄已在:續作或半刪之逆),
 *   edgesRestored(放回或補完稽核之邊數), edgesKept:[{ id, other, why }](現值已在而不同、或刪除後另被他途撤出——不覆寫), edgesSkipped:[{ id, other }](對方已不在),
 *   mdConflict:Boolean(md 已在而與封存副本不同——不覆寫), reversePairs(放回之反向待處理對數), neighbors:Array(仍在之鄰居), projected? }
 * @throws {Error} 缺 deps.domain、找不到封存(且非「只記了墓碑」之半刪)、封存壞或不屬該篇、世代不符、放回後回驗不符時拋出(前三者於任何寫入前)
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async () => [...m.values()],
 *         insertNew: async (xs) => { xs.forEach((x) => m.set(x.id, x)); return { addCount: xs.length } },
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *         del: async (id) => m.delete(id),
 *     }
 * }
 * let domain = createRelateDomain({})
 * let edge = makeEdge({ from: 'a', to: 'b', type: domain.relationTypes[0], reason: 'a 與 b 共用同一組參數', nowIso: '2026-11-01T00:00:00+08:00' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]), relations: mem([edge]) },
 *     dirs: { state },
 *     clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     domain,
 * }
 * await deleteNote(deps, 'a', { reason: '誤刪', project: false })
 * console.log((await deps.stores.relations.select()).length, await deps.stores.notes.get('a'))
 * let r = await undoDeleteNote(deps, 'a', { project: false })
 * console.log(r.undone, r.resumed, r.edgesRestored, r.neighbors, (await deps.stores.relations.select()).length, (await deps.stores.notes.get('a')).title)
 * console.log((await undoDeleteNote(deps, 'a', { project: false })).undone)
 * fs.rmSync(state, { recursive: true, force: true })
 * // => 0 null
 * // => true false 1 [ 'b' ] 1 甲
 * // => false
 */
export async function undoDeleteNote(deps, slug, opt = {}) {
    if (!isestr(slug)) throw new Error('undoDeleteNote 需要筆記 id')
    const domain = domainOf(deps, 'undoDeleteNote')
    const { stores, dirs, clock } = deps
    const { ledgers } = await openChecked(deps)
    const files = archiveFilesOf(dirs.state, slug)
    const arc = readArchive(files.json)
    const tomb = ledgers.tombstones.has(slug)
    const rec0 = await stores.notes.get(slug)
    const out = { slug, undone: false, resumed: !!rec0, edgesRestored: 0, edgesKept: [], edgesSkipped: [], mdConflict: false, reversePairs: 0, neighbors: [], projected: null }
    if (!arc) {
        // 刪除停在封存之前(只記了墓碑):撤銷＝移除墓碑;未被刪除(或已撤銷完):無可撤銷
        if (rec0 && tomb) {
            ledgers.tombstones.remove(slug)
            return { ...out, undone: true }
        }
        if (rec0) return out
        throw new Error(`找不到封存：${files.json}`)
    }
    if (arc.record.id !== slug) throw new Error(`封存之記錄不是 ${slug}：${files.json}`)
    const at = clock.iso8()
    const noteOf = noteReader(stores)
    // 邊之計畫:型別改名照改名表機械改寫(每輪維護同一規則);其後之改動不覆寫(edgePlanOf)
    const renameOf = domainTypeRenamerOf(domain)
    const plan = await edgePlanOf({
        arc, slug, noteOf, last: retiredEdgesOf(readAuditRows(ledgers.files.retired)), get: (id) => stores.relations.get(id),
        decide: (e) => ({ ok: true, edge: (renameOf && renameOf(e)) || e }), same: sameEdge,
    })
    // 先記後寫:本篇與鄰居記待投影、總覽待重建
    ledgers.touch([slug, ...plan.neighbors])
    // md:不在 → 自封存副本原樣放回(原子寫);在而與副本不同 → 不覆寫(報衝突)
    const mdFile = isestr(arc.record.file) ? arc.record.file : ''
    if (mdFile && fs.existsSync(files.md)) {
        if (!fs.existsSync(mdFile)) writeFileAtomic(mdFile, fs.readFileSync(files.md, 'utf8')) // 副本為本套件所寫之 UTF-8 文字,以字串回寫即逐位元組相同
        else if (!fs.readFileSync(mdFile).equals(fs.readFileSync(files.md))) out.mdConflict = true
    }
    // 記錄:不在 → 原樣放回;在者(半刪或前次撤銷已放回)不動
    if (!rec0) {
        const ins = await stores.notes.insertNew([arc.record])
        if (ins.addCount !== 1) throw new Error(`筆記記錄 ${slug} 放回失敗`)
    }
    // 邊:放回(續作時已放回者不重寫)→ 稽核記 restored(完成之標記;本次刪除所撤者)
    for (const x of plan.put) {
        if (!x.cur) {
            const ins = await stores.relations.insertNew([x.edge])
            if (ins.addCount !== 1 || !sameEdge(await stores.relations.get(x.edge.id), x.edge)) throw new Error(`關聯邊 ${x.edge.id} 放回後回驗不符`)
        }
        if (x.retiredAs === 'note-deleted') appendAudit(ledgers.files.retired, { at, reason: 'restored', restoredFrom: 'note-deleted', note: slug, via: 'undoDeleteNote', edge: x.edge })
        out.edgesRestored++
    }
    out.edgesKept = plan.kept
    out.edgesSkipped = plan.skipped
    // 反向待處理對:兩端仍在且未相連者原樣放回(含 tries;已有者不動)
    out.reversePairs = ledgers.reverse.restore(await reversePairsBackOf(arc, slug, noteOf, stores.relations))
    await clearStaleReview(stores, plan.put.map((x) => x.other), arc.deletedAt)
    ledgers.tombstones.remove(slug)
    settleArchive(files, 'undone', clock.stamp8())
    if (opt.project !== false) out.projected = await projectNotes(deps, [slug, ...plan.neighbors], { ledger: ledgers.dirty })
    return { ...out, undone: true, neighbors: plan.neighbors }
}

/**
 * 還原一篇已刪除之筆記(使用者之重新收件:由封存,過筆記標準與納入閘;檔頭【撤銷與還原是兩種契約】②)
 *
 * @param {Object} deps 輸入 { stores, dirs, clock, log, domain, noteGate?(筆記標準閘;摘要套件之 createNoteRestoreGate,呼叫端注入——檔頭【還原之筆記過筆記標準】),
 *   settings?(取 relate.standards.conflictCheck.enabled;opt.conflictCheck 未給時用) }
 * @param {String} slug 輸入筆記 id
 * @param {Object} [opt={}] 輸入 { dryRun:Boolean(預演:純讀,不開帳、不寫), project:Boolean(預設 true), conflictCheck:Boolean(false → 帶回之衝突邊不登錄
 *   RS4 待判;未給依 deps.settings,皆無則登錄), withHolds:Boolean(筆記仍不合格時照還原並登錄待判——使用者明示接受;預設不還原) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { slug, dryRun, resumed(記錄已在:續作), refused?(預演:實跑會拒絕之理由), edgesRestored(預演為將還原者),
 *   edgesSkipped:[{ id, other }](對方已不在), edgesRejected:[{ id, other, reasons }](未過納入閘), edgesKept:[{ id, other, why }](現值已在而不同、或刪除後另被他途撤出),
 *   rs4Queued:Integer(帶回之衝突邊登錄 RS4 待判之條數;預演為將登錄), reversePairs:Integer(放回之反向待處理對數;預演為將放回), std:{ fixed:Array, held:Array, contentChanged:Boolean(內容章有變),
 *   titleChanged:Boolean(標題有變) }|null, neighbors:Array(仍在之鄰居), projected? }
 * @throws {Error} 缺 deps.domain、找不到封存(且非「只記了墓碑」之半刪)、封存壞、世代不符、筆記仍未達標準(未明示 withHolds;預演不拋,記 refused)、
 *   封存之 md 讀不到而須以筆記標準判定時拋出(皆於任何寫入前)
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async () => [...m.values()],
 *         insertNew: async (xs) => { xs.forEach((x) => m.set(x.id, x)); return { addCount: xs.length } },
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *         del: async (id) => m.delete(id),
 *     }
 * }
 * let domain = createRelateDomain({})
 * let edge = makeEdge({ from: 'a', to: 'b', type: domain.relationTypes[0], reason: '兩篇皆以波動度調整部位，屬同一機制之延伸', nowIso: '2026-11-01T00:00:00+08:00' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]), relations: mem([edge]) },
 *     dirs: { state },
 *     clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     domain,
 * }
 * await deleteNote(deps, 'a', { reason: '誤刪', project: false })
 * let dry = await restoreNote(deps, 'a', { dryRun: true })
 * console.log(dry.dryRun, dry.edgesRestored, await deps.stores.notes.get('a'))
 * let r = await restoreNote(deps, 'a', { project: false })
 * console.log(r.resumed, r.edgesRestored, r.edgesRejected, r.neighbors, (await deps.stores.relations.select()).length, (await deps.stores.notes.get('a')).title)
 * fs.rmSync(state, { recursive: true, force: true })
 * // => true 1 null
 * // => false 1 [] [ 'b' ] 1 甲
 */
export async function restoreNote(deps, slug, opt = {}) {
    if (!isestr(slug)) throw new Error('restoreNote 需要筆記 id')
    const domain = domainOf(deps, 'restoreNote')
    const dry = opt.dryRun === true
    const { stores, dirs, clock } = deps
    // 預演純讀:不開帳(開帳會隔離壞檔),墓碑以唯讀讀之
    let ledgers = null
    if (dry) assertGeneration(await stores.relations.select())
    else ledgers = (await openChecked(deps)).ledgers
    const files = archiveFilesOf(dirs.state, slug)
    const arc = readArchive(files.json)
    const tomb = dry ? openDeletions(dirs.state).has(slug) : ledgers.tombstones.has(slug)
    const rec0 = await stores.notes.get(slug)
    const out = { slug, dryRun: dry, resumed: !!rec0, edgesRestored: 0, edgesSkipped: [], edgesRejected: [], edgesKept: [], rs4Queued: 0, reversePairs: 0, std: null, neighbors: [], projected: null }
    if (!arc) {
        // 刪除停在封存之前(只記了墓碑):還原＝移除墓碑
        if (rec0 && tomb) {
            if (!dry) ledgers.tombstones.remove(slug)
            return out
        }
        throw new Error(`找不到封存：${files.json}`)
    }
    if (arc.record.id !== slug) throw new Error(`封存之記錄不是 ${slug}：${files.json}`)
    const conflictCheck = conflictCheckOf(deps, opt)
    const noteOf = noteReader(stores)
    // 筆記過筆記標準(記錄不在時;續作時記錄已放回者不再判):先判、不合格即拋(未寫任何東西)
    const mdFile = isestr(arc.record.file) ? arc.record.file : ''
    let rec = rec0 || arc.record
    let std = null
    let mdNext = null
    if (!rec0) {
        const srcMd = mdFile && fs.existsSync(mdFile) ? mdFile : (fs.existsSync(files.md) ? files.md : '')
        const gate = deps.noteGate || null
        if (!gate) deps.log?.warn?.(`還原筆記 ${slug}：未注入筆記標準閘（deps.noteGate），筆記本身未經筆記標準`)
        else {
            const md0 = srcMd ? readMd(srcMd) : null
            if (!md0) throw new Error(`還原筆記 ${slug}：封存之 md 讀不到，無法以筆記標準判定`)
            std = await gate.check({ record: rec, md: md0 })
            if (std.violations.length && opt.withHolds !== true) {
                const msg = `筆記 ${slug} 確定性修正後仍未達筆記標準（${std.violations.map((r) => `${r.std} ${r.detail}`).join('；').slice(0, 300)}）——不還原；${RELATE_API_HINT.withHolds}`
                if (!dry) throw new Error(msg)
                out.refused = msg
            }
            rec = { ...rec, ...std.recordPatch }
        }
        mdNext = std?.mdChanged ? std.md : (srcMd ? readMd(srcMd) : null)
    }
    // 邊之計畫(預演與實跑同一判定;edgePlanOf):欲放回之值＝過納入閘之值(本篇之材料取將放回之 md);續作以可見欄位比對現值
    const given = mdNext ? new Map([[slug, noteMaterialText(mdNext.body)]]) : null
    const rank = typeRankOf(domain)
    const plan = await edgePlanOf({
        arc, slug, noteOf, last: retiredEdgesOf(readAuditRows(path.join(dirs.state, LEDGER_FILES.retired))), get: (id) => stores.relations.get(id),
        decide: (e, other, otherNote) => {
            const g = gateRestore(e, domain, new Map([[slug, rec], [other, otherNote]]), given, deps.locale)
            return g.ok ? { ok: true, edge: g.edge } : { ok: false, reasons: g.reasons }
        },
        same: sameVisible,
    })
    Object.assign(out, { edgesSkipped: plan.skipped, edgesKept: plan.kept, edgesRejected: plan.rejected, neighbors: plan.neighbors })
    const pairOf = (x) => new Map([[slug, rec], [x.other, x.otherNote]])
    const stdOut = (held) => (std ? { fixed: std.changes, held, contentChanged: std.contentChanged === true, titleChanged: std.titleChanged === true } : null)
    if (dry) {
        for (const x of plan.put) {
            const edge = x.cur || mergeEdge(null, x.edge, { rank }).edge
            if ((await restoredStandards(deps, edge, pairOf(x), { retiredAs: 'note-deleted', apply: false, conflictCheck, source: `還原筆記 ${slug} 帶回` })).rs4Queued) out.rs4Queued++
        }
        // 預演之反向待處理對:以現況(未放回邊前)判之,實跑放回邊後才判——將放回之邊之兩端不計
        const linked = new Set(plan.put.map((x) => x.other))
        out.reversePairs = (await reversePairsBackOf(arc, slug, noteOf, stores.relations)).filter((p) => !linked.has(p.o === slug ? p.n : p.o)).length
        return { ...out, edgesRestored: plan.put.length, std: stdOut([]) }
    }
    // 先記後寫:本篇與鄰居記待投影、總覽待重建
    ledgers.touch([slug, ...plan.neighbors])
    let held = []
    if (!rec0) {
        // md(修正後者寫入;不在者自封存副本放回)
        if (mdFile && std?.mdChanged) {
            fsCreateFolder(path.dirname(mdFile))
            writeMd(mdFile, std.md.front, std.md.body)
        }
        else if (mdFile && !fs.existsSync(mdFile) && fs.existsSync(files.md)) writeFileAtomic(mdFile, fs.readFileSync(files.md, 'utf8'))
        // 筆記之待判先於放回記錄(先記後寫)
        if (std && (std.violations.length || std.undetermined.length)) {
            const h = await deps.noteGate.hold(rec, std.results)
            held = h.held
            if (h.noHolds) deps.log?.warn?.(`還原筆記 ${slug}：未開 holds 集合，仍未達標準／未能判定之標準（${[...std.violations, ...std.undetermined].map((r) => r.std).join('、')}）未登錄待判`)
        }
        const ins = await stores.notes.insertNew([rec])
        if (ins.addCount !== 1) throw new Error(`筆記記錄 ${slug} 還原失敗`)
    }
    const at = clock.iso8()
    for (const x of plan.put) {
        // 帶回之衝突邊不繞過衝突核對(RS4;檔頭【還原之邊與 AI 標準】②):以落庫後之值判檢核紀錄是否涵蓋;稽核最後記(完成之標記)
        const edge = x.cur || (await persistEdge(stores.relations, x.edge, { rank, conflictType: domain.conflictType, allowTypeChange: false })).edge
        if ((await restoredStandards(deps, edge, pairOf(x), { retiredAs: 'note-deleted', apply: true, conflictCheck, source: `還原筆記 ${slug} 帶回` })).rs4Queued) out.rs4Queued++
        if (x.retiredAs === 'note-deleted') appendAudit(ledgers.files.retired, { at, reason: 'restored', restoredFrom: 'note-deleted', note: slug, via: 'restoreNote', edge })
        out.edgesRestored++
    }
    // 反向待處理對:兩端仍在且未相連者原樣放回(同撤銷)
    out.reversePairs = ledgers.reverse.restore(await reversePairsBackOf(arc, slug, noteOf, stores.relations))
    await clearStaleReview(stores, plan.put.map((x) => x.other), arc.deletedAt)
    ledgers.tombstones.remove(slug)
    settleArchive(files, 'restored', clock.stamp8())
    if (opt.project !== false) out.projected = await projectNotes(deps, [slug, ...plan.neighbors], { ledger: ledgers.dirty })
    return { ...out, std: stdOut(held) }
}

/**
 * 懸空邊(端點不在筆記庫)之清理:預設只列出;apply 才撤出(stores/edgeRetire;可由 restoreEdge 還原)並當場投影存活之端點
 *
 * @param {Object} deps 輸入 { stores, dirs, clock, log, domain(apply 必給;衝突邊之撤出寫事件帳、投影) }
 * @param {Object} [opt={}] 輸入 { apply:Boolean, project:Boolean(預設 true:當場投影存活之端點;false 只記待投影) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { dangling, removed, sample:Array, projected? }
 * @throws {Error} apply 而缺 deps.domain(任何寫入前)、世代不符時拋出
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async () => [...m.values()],
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *         del: async (id) => m.delete(id),
 *     }
 * }
 * let domain = createRelateDomain({})
 * let edge = makeEdge({ from: 'a', to: 'ghost', type: domain.relationTypes[0], reason: 'a 與 ghost 共用同一組參數', nowIso: '2026-11-01T00:00:00+08:00' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', title: '甲' }]), relations: mem([edge]) },
 *     dirs: { state },
 *     clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     domain,
 * }
 * console.log(await pruneDangling(deps))
 * let r = await pruneDangling(deps, { apply: true, project: false })
 * console.log(r.dangling, r.removed, (await deps.stores.relations.select()).length)
 * fs.rmSync(state, { recursive: true, force: true })
 * // => { dangling: 1, removed: 0, sample: [ 'a → ghost' ] }
 * // => 1 1 0
 */
export async function pruneDangling(deps, opt = {}) {
    const domain = opt.apply === true ? domainOf(deps, 'pruneDangling') : null
    const { stores, clock } = deps
    // 預演純讀:只讀邊庫＋世代檢核、不開帳(開帳會隔離壞檔);apply 才開帳
    let ledgers = null
    let edges
    if (opt.apply === true) ({ ledgers, edges } = await openChecked(deps))
    else {
        edges = await stores.relations.select()
        assertGeneration(edges)
    }
    const ids = new Set((await stores.notes.select()).map((n) => n.id))
    const dangling = edges.filter((e) => !ids.has(e.from) || !ids.has(e.to))
    const out = { dangling: dangling.length, removed: 0, sample: dangling.slice(0, 5).map((e) => `${e.from} → ${e.to}`) }
    if (opt.apply !== true || !dangling.length) return out
    const at = clock.iso8()
    for (const e of dangling) {
        await retireEdge({ relations: stores.relations, ledgers, stateDir: deps.dirs.state }, e, { reason: 'prune-dangling', at, conflictTypes: domain.conflictTypeNames, hasNote: (x) => ids.has(x) })
        out.removed++
    }
    const alive = [...new Set(dangling.flatMap((e) => [e.from, e.to]).filter((x) => ids.has(x)))].sort()
    if (opt.project !== false && alive.length) out.projected = await projectNotes(deps, alive, { ledger: ledgers.dirty })
    return out
}

/**
 * 投影:全庫(all)或待投影帳(預設);供遷移後全庫重投與帳檔損壞後補回
 *
 * @param {Object} deps 輸入 { stores, dirs, clock, log, domain }
 * @param {Object} [opt={}] 輸入 { all:Boolean, onProgress }
 * @returns {Promise} 回傳 Promise，resolve 回傳 projectNotes 之統計＋{ total, backlog }
 * @throws {Error} 缺 deps.domain(任何寫入前)、世代不符時拋出
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async () => [...m.values()],
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *     }
 * }
 * let mdOf = (id, title) => `---\ntitle: ${title}\nslug: ${id}\n---\n# ${title}\n\n## 一句話重點\n\n${title} 之重點\n\n## 核心知識\n\n- 要點\n`
 * let fileA = path.join(state, 'a.md')
 * let fileB = path.join(state, 'b.md')
 * fs.writeFileSync(fileA, mdOf('a', '甲'))
 * fs.writeFileSync(fileB, mdOf('b', '乙'))
 * let domain = createRelateDomain({})
 * let edge = makeEdge({ from: 'a', to: 'b', type: domain.relationTypes[0], reason: '兩篇皆以波動度調整部位，屬同一機制之延伸', nowIso: '2026-11-01T00:00:00+08:00' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', title: '甲', file: fileA }, { id: 'b', title: '乙', file: fileB }]), relations: mem([edge]) },
 *     dirs: { state },
 *     clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     domain,
 * }
 * let r = await projectAll(deps, { all: true })
 * console.log(r.total, r.projected, r.changed, r.failed, r.backlog)
 * console.log(fs.readFileSync(fileA, 'utf8').includes('[[b]]'), fs.readFileSync(fileB, 'utf8').includes('[[a]]'))
 * fs.rmSync(state, { recursive: true, force: true })
 * // => 2 2 2 0 0
 * // => true true
 */
export async function projectAll(deps, opt = {}) {
    domainOf(deps, 'projectAll')
    const { stores } = deps
    const { ledgers, edges } = await openChecked(deps)
    const notes = await stores.notes.select()
    const ids = opt.all === true ? notes.map((n) => n.id) : ledgers.dirty.ids()
    const det = await projectNotes(deps, ids, { ledger: ledgers.dirty, notes, edges, onProgress: opt.onProgress })
    return { ...det, total: ids.length, backlog: ledgers.dirty.size() }
}

/**
 * 重評之基準重設(大量內容變更守門觸發後):待重評之筆記一律記為已評完、不呼叫 AI;預設只列出,apply 才寫。
 *   「記為評完而未判」是使用者之裁示(未判不記已審之例外):apply 須給裁示者(by)與裁示內容(ruling),每篇寫一筆重評帳
 *   (relate-reeval.jsonl,outcome 'baseline':裁示者、內容、版本、本版本未判之邊數);該篇本版本之 RS5 未結待判(物件 edge 之判不了、
 *   物件 note 之逾次未評完)一併以同一裁示豁免(waiveHold;重評段對豁免之邊本版本不再評)——否則待判逾期仍掛著。
 *
 * @param {Object} deps 輸入 { stores, dirs, clock }
 * @param {Object} [opt={}] 輸入 { apply:Boolean, by:String(裁示者;apply 必填), ruling:String(裁示內容;apply 必填) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { pending, unjudged(本版本未判之邊數合計), applied, waived(豁免之待判數), sample:Array }
 * @throws {Error} apply 而缺裁示者或裁示內容(預演不需裁示)、世代不符時拋出(預演亦檢)
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async () => [...m.values()],
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *     }
 * }
 * let domain = createRelateDomain({})
 * let V = '2026-11-01T00:00:00+08:00'
 * let edge = makeEdge({ from: 'a', to: 'b', type: domain.relationTypes[0], reason: 'a 與 b 共用同一組參數', nowIso: '2026-10-01T00:00:00+08:00' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', title: '甲', knowledgeChangedAt: V, relatedChangeAt: V }, { id: 'b', title: '乙' }]), relations: mem([edge]) },
 *     dirs: { state },
 *     clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 * }
 * console.log(await reevalBaseline(deps))
 * let r = await reevalBaseline(deps, { apply: true, by: 'semi', ruling: '大量內容變更，接受現況' })
 * console.log(r.applied, (await deps.stores.notes.get('a')).edgesReviewedChangeAt === V)
 * console.log(readAuditRows(path.join(state, LEDGER_FILES.reeval)).map((x) => [x.outcome, x.by, x.unjudged]))
 * fs.rmSync(state, { recursive: true, force: true })
 * // => { pending: 1, unjudged: 1, applied: 0, waived: 0, sample: [ 'a' ] }
 * // => 1 true
 * // => [ [ 'baseline', 'semi', 1 ] ]
 */
export async function reevalBaseline(deps, opt = {}) {
    const apply = opt.apply === true
    const by = String(opt.by ?? '').trim()
    const ruling = String(opt.ruling ?? '').trim()
    if (apply && (!by || !ruling)) throw new Error(RELATE_API_HINT.reevalBaselineRuling)
    const all = await deps.stores.notes.select()
    const notes = all.filter(needsEdgeReview)
    const out = { pending: notes.length, unjudged: 0, applied: 0, waived: 0, sample: notes.slice(0, 5).map((n) => n.id) }
    if (!notes.length) return out
    // 本版本未判之邊數(與重評段同一選邊規則 reviewEdgesOf:兩端皆在、不在墓碑、本版本未裁、判定時刻不晚於版本;待判中者亦計未判)
    //   預演純讀:只讀邊庫＋世代檢核、墓碑以唯讀讀之、不開帳(開帳會隔離壞檔);apply 才開帳
    let ledgers = null
    let edges
    if (apply) ({ ledgers, edges } = await openChecked(deps))
    else {
        edges = await deps.stores.relations.select()
        assertGeneration(edges)
    }
    const tombs = apply ? ledgers.tombstones : openDeletions(deps.dirs.state)
    const adj = buildAdjacency(edges)
    const byId = new Map(all.map((n) => [n.id, n]))
    const leftOf = (n) => reviewEdgesOf(n, { adj, byId, isTombstoned: (id) => tombs.has(id) }).edges.length
    const holds = deps.stores.holds
    const openRs5 = holds ? await listHolds(holds, { status: 'open', std: RS5.std }) : []
    for (const n of notes) out.unjudged += leftOf(n)
    if (!apply) return out
    const at = deps.clock.iso8()
    for (const n of notes) {
        const version = n.knowledgeChangedAt
        const unjudged = leftOf(n)
        await deps.stores.notes.patch(n.id, { edgesReviewedChangeAt: version, edgesReviewed: '', reevalTries: 0 })
        // 該篇本版本之 RS5 未結待判:以同一裁示豁免
        let waived = 0
        for (const h of openRs5.filter((x) => (x.object === RS5.objectNote && x.oid === n.id) || (x.object === RS5.objectEdge && x.ctx?.note === n.id)).filter((x) => x.ctx?.version === version)) {
            await waiveHold(holds, h.id, { by, ruling: `${RELATE_BASELINE_RULING_PREFIX}${ruling}`, at })
            waived++
        }
        appendAudit(ledgers.files.reeval, { at, note: n.id, version, outcome: 'baseline', by, ruling, unjudged, waivedHolds: waived })
        out.waived += waived
        out.applied++
    }
    return out
}

/**
 * 閘門開啟後之重排:重評帳中仍為本版本、只記候選(閘門擋下)之筆記,清除其評完標記,下輪以新鮮評估確認——
 *   關閘期間之候選不回溯套用;預設只列出,apply 才寫
 *
 * @param {Object} deps 輸入 { stores, dirs }
 * @param {Object} [opt={}] 輸入 { apply:Boolean }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { notes:Array(筆記 id), candidates, applied }
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *     }
 * }
 * let V = '2026-11-01T00:00:00+08:00'
 * appendAudit(path.join(state, LEDGER_FILES.reeval), { at: '2026-11-01T12:00:00+08:00', note: 'a', version: V, edgeId: 'e1', outcome: 'candidate' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', knowledgeChangedAt: V, edgesReviewedChangeAt: V, edgesReviewed: '' }]) },
 *     dirs: { state },
 * }
 * console.log(await reevalRequeue(deps))
 * console.log(await reevalRequeue(deps, { apply: true }), JSON.stringify((await deps.stores.notes.get('a')).edgesReviewedChangeAt))
 * console.log(await reevalRequeue(deps))
 * fs.rmSync(state, { recursive: true, force: true })
 * // => { notes: [ 'a' ], candidates: 1, applied: 0 }
 * // => { notes: [ 'a' ], candidates: 1, applied: 1 } ""
 * // => { notes: [], candidates: 1, applied: 0 }
 */
export async function reevalRequeue(deps, opt = {}) {
    const cand = readAuditRows(path.join(deps.dirs.state, LEDGER_FILES.reeval)).filter((x) => x?.outcome === 'candidate')
    const ids = []
    for (const nid of [...new Set(cand.map((x) => x.note))].sort()) {
        const n = await deps.stores.notes.get(nid)
        if (n && cand.some((x) => x.note === nid && x.version === n.knowledgeChangedAt) && edgesReviewedOf(n)) ids.push(nid)
    }
    const out = { notes: ids, candidates: cand.length, applied: 0 }
    if (opt.apply !== true) return out
    for (const nid of ids) {
        await deps.stores.notes.patch(nid, { edgesReviewedChangeAt: '', edgesReviewed: '', reevalTries: 0 })
        out.applied++
    }
    return out
}

/**
 * 依稽核還原一條被撤出之邊(撤出理由須在 RESTORABLE_REASONS;檔頭【restoreEdge】):以該邊最後一筆稽核為準(retiredEdgesOf);兩端皆在、
 *   現值不存在、且過納入閘才重入;預設只列出,apply 才寫(先記待投影 → 寫邊 → AI 標準之處置 → 稽核 restored〔完成之標記〕→ 當場投影)。
 *   還原 AI 標準撤出／隔離之邊＝使用者裁示(須 checks 集合);其餘還原之衝突邊登錄 RS4 待判(檔頭【還原之邊與 AI 標準】)。撤出時之理由本身不合
 *   標準者可給 opt.reason 以新理由還原。
 *
 * @param {Object} deps 輸入 { stores, dirs, clock, log, domain, settings?(取 relate.standards.conflictCheck.enabled;opt.conflictCheck 未給時用) }
 * @param {String} id 輸入邊 id
 * @param {Object} [opt={}] 輸入 { apply:Boolean, reason?:String(新理由;取代稽核之理由,同過納入閘), conflictCheck?:Boolean(未給依 deps.settings,皆無則登錄),
 *   project?:Boolean(預設 true:套用後當場投影兩端) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { id, found, restorable, reason(不可還原之原因), applied, resumed?(現值已為還原之值:續作), retiredAs?, fixes?, edge?,
 *   reasonReplaced?, ruling:'RS4'|'RS6'|''(視為使用者裁示之標準), rs4Queued:Boolean(登錄 RS4 待判;預演為「將登錄」), projected? }
 * @throws {Error} 缺 deps.domain(任何寫入前)、世代不符、套用裁示而未開 checks 集合(任何寫入前)時拋出
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async () => [...m.values()],
 *         insertNew: async (xs) => { xs.forEach((x) => m.set(x.id, x)); return { addCount: xs.length } },
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *         del: async (id) => m.delete(id),
 *     }
 * }
 * let domain = createRelateDomain({})
 * let edge = makeEdge({ from: 'a', to: 'b', type: domain.relationTypes[0], reason: '兩篇皆以波動度調整部位，屬同一機制之延伸', nowIso: '2026-11-01T00:00:00+08:00' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]), relations: mem([edge]) },
 *     dirs: { state },
 *     clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     domain,
 * }
 * await retireEdge({ relations: deps.stores.relations, ledgers: openRelateLedgers(state), stateDir: state }, edge, { reason: 'std-retire', at: '2026-11-01T12:00:00+08:00', conflictTypes: domain.conflictTypeNames, hasNote: () => true, detail: '示範撤出' })
 * console.log(await deps.stores.relations.get(edge.id))
 * let pv = await restoreEdge(deps, edge.id)
 * console.log(pv.found, pv.restorable, pv.applied, pv.retiredAs)
 * let r = await restoreEdge(deps, edge.id, { apply: true, project: false })
 * console.log(r.applied, JSON.stringify(r.ruling), (await deps.stores.relations.get(edge.id)).type === domain.relationTypes[0])
 * console.log((await restoreEdge(deps, edge.id)).reason)
 * fs.rmSync(state, { recursive: true, force: true })
 * // => null
 * // => true true false std-retire
 * // => true "" true
 * // => 稽核最後一筆為已還原
 */
export async function restoreEdge(deps, id, opt = {}) {
    const domain = domainOf(deps, 'restoreEdge')
    const { stores } = deps
    // 預演(非 apply)純讀:不開帳(開帳會隔離壞檔),稽核直讀;世代檢核照做
    let ledgers = null
    if (opt.apply === true) ledgers = (await openChecked(deps)).ledgers
    else assertGeneration(await stores.relations.select())
    const none = { ruling: '', rs4Queued: false }
    const rows = readAuditRows(path.join(deps.dirs.state, LEDGER_FILES.retired))
    const rec = retiredEdgesOf(rows).get(id)
    if (!rec) {
        const seen = rows.some((x) => x?.edge?.id === id)
        return { id, found: seen, restorable: false, reason: seen ? '稽核最後一筆為已還原' : '稽核中無此邊之撤出紀錄', applied: false, ...none }
    }
    if (!RESTORABLE_REASONS.includes(rec.reason)) return { id, found: true, restorable: false, reason: `撤出理由「${rec.reason}」不可單獨還原`, applied: false, retiredAs: rec.reason, ...none }
    // 使用者之新理由:取代稽核之理由(截短標記歸零——新理由若逾長由閘重記)、updatedAt＝還原時刻(理由變更)
    const reasonReplaced = isestr(opt.reason) && opt.reason.trim() !== ''
    const e = reasonReplaced
        ? { ...rec.edge, reason: opt.reason.trim(), updatedAt: deps.clock.iso8(), ...(Object.hasOwn(rec.edge, 'reasonCut') ? { reasonCut: 0 } : {}) }
        : rec.edge
    const [a, b] = [await stores.notes.get(e.from), await stores.notes.get(e.to)]
    if (!a || !b) return { id, found: true, restorable: false, reason: `端點筆記不在（已刪除）${rec.reason === 'note-deleted' ? `——${RELATE_API_HINT.restoreNote}` : ''}`, applied: false, retiredAs: rec.reason, ...none }
    const pair = new Map([[e.from, a], [e.to, b]])
    const g = gateRestore(e, domain, pair, undefined, deps.locale)
    const cur = await stores.relations.get(id)
    // 現值已在:為前次還原之值而稽核仍為撤出 → 續作;否則不覆寫
    const resumed = !!cur && g.ok && sameVisible(cur, g.edge)
    if (cur && !resumed) return { id, found: true, restorable: false, reason: '現值已存在（已被重建或從未刪成）', applied: false, retiredAs: rec.reason, ...none }
    if (!g.ok) return { id, found: true, restorable: false, reason: `未達檢定標準：${g.reasons.join('；')}${reasonReplaced ? '' : `（${RELATE_API_HINT.newReason}）`}`, applied: false, retiredAs: rec.reason, reasonReplaced, ...none }
    const view = { from: g.edge.from, to: g.edge.to, type: g.edge.type, ...(reasonReplaced ? { reason: g.edge.reason } : {}) }
    const std0 = { retiredAs: rec.reason, conflictCheck: conflictCheckOf(deps, opt), source: `restoreEdge 還原（撤出理由 ${rec.reason}）` }
    const ruling = RULING_STD[rec.reason]
    const isRuling = !!ruling && (ruling === RS4) === (g.edge.type === domain.conflictType)
    if (opt.apply !== true) return { id, found: true, restorable: true, reason: '', applied: false, resumed, retiredAs: rec.reason, fixes: g.fixes, edge: view, reasonReplaced, ...(await restoredStandards(deps, g.edge, pair, { ...std0, apply: false })) }
    // 裁示須記檢核紀錄(否則存量佇列再核對而迴圈):任何寫入前驗
    if (isRuling && !stores.checks) throw new Error(`restoreEdge 還原撤出理由 ${rec.reason} 之邊即裁示（${ruling.std}），須 stores.checks 記檢核紀錄——否則存量佇列會再核對而迴圈`)
    await projectAffected(deps, [e.from, e.to], { ledgers, project: false })
    const rank = typeRankOf(domain)
    const edge = resumed ? cur : (await persistEdge(stores.relations, g.edge, { rank, conflictType: domain.conflictType, allowTypeChange: false })).edge
    const st = await restoredStandards(deps, edge, pair, { ...std0, apply: true })
    appendAudit(ledgers.files.retired, { at: deps.clock.iso8(), reason: 'restored', restoredFrom: rec.reason, ...(reasonReplaced ? { reasonReplaced: true } : {}), edge })
    // 非裁示之還原:兩端在撤出後內容變更且已評完者清其評完標記(放回之邊未經其本版本裁決——未判不記已審);裁示即使用者之判定,不重評
    if (!isRuling) await clearStaleReview(stores, [e.from, e.to], rec.at)
    let projected = null
    if (opt.project !== false) projected = await projectNotes(deps, [e.from, e.to], { ledger: ledgers.dirty })
    return { id, found: true, restorable: true, reason: '', applied: true, resumed, retiredAs: rec.reason, fixes: g.fixes, edge: view, reasonReplaced, ...st, projected }
}

/**
 * 一條邊最後一筆套用之改寫(或其逆;檔頭【revertEdgeRevision】):三段帳中 edgeId 相符之可逆改寫列與 reverted 列合併依時刻取最後一筆
 *   (同時刻依帳序 重評 → 衝突核對 → 既有邊覆核;穩定排序)
 *
 * @param {String} stateDir 輸入 dirs.state
 * @param {String} id 輸入邊 id
 * @returns {Object|null} 回傳 { ledger(REVISION_LEDGERS 之列), row } 或 null(無紀錄)
 */
function lastRevisionOf(stateDir, id) {
    const rows = []
    for (const L of REVISION_LEDGERS) {
        for (const r of readAuditRows(path.join(stateDir, LEDGER_FILES[L.key]))) {
            if (!isobj(r) || r.edgeId !== id) continue
            if (r.outcome === REVERTED_OUTCOME || (L.outcomes.includes(r.outcome) && isobj(r.written) && isobj(r.edge))) rows.push({ ledger: L, row: r })
        }
    }
    const t = (x) => {
        const n = Date.parse(String(x.row.at ?? ''))
        return Number.isFinite(n) ? n : 0
    }
    rows.sort((a, b) => t(a) - t(b))
    return rows.at(-1) || null
}

/**
 * 撤回之裁示(檔頭【revertEdgeRevision】):核對帳而回復衝突型 → RS4、覆核帳而回復非衝突型 → RS6(同 restoreEdge ①);重評帳 → RS5(該邊之 RS5 未結待判結案;
 *   回復之值為衝突型而檢核未涵蓋者登錄 RS4 待判——同②)
 *
 * @param {Object} deps 輸入 { stores, clock, domain }
 * @param {Object} edge 輸入回復後(落庫)之邊值
 * @param {Map} notes 輸入兩端筆記 id → 記錄
 * @param {Object} o 輸入 { ledger:REVISION_LEDGERS 之列, ruling:Boolean(是否為 RS4／RS6 之裁示), how:String, apply:Boolean, conflictCheck:Boolean|undefined, source:String }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ruling:String(裁示之標準 id——該段帳之標準;無裁示為 ''), rs4Queued:Boolean }
 */
async function revertedStandards(deps, edge, notes, o) {
    const std = o.ledger.std
    if (std === RS5) {
        const st = await restoredStandards(deps, edge, notes, { apply: o.apply, conflictCheck: o.conflictCheck, source: o.source, retiredAs: '' })
        if (o.apply === true && deps.stores.holds) {
            const h = await deps.stores.holds.get(holdKey(RS5.objectEdge, edge.id, RS5.std))
            if (h?.status === 'open') await resolveHold(deps.stores.holds, h.id, { at: deps.clock.iso8(), how: o.how })
        }
        return { ...st, ruling: RS5.std }
    }
    return restoredStandards(deps, edge, notes, { apply: o.apply, conflictCheck: o.conflictCheck, source: o.source, retiredAs: '', ...(o.ruling ? { std, how: o.how } : {}) })
}

/**
 * 撤回一條邊最後一筆由判定小組套用之改寫(檔頭【revertEdgeRevision】):以三段帳之最後一筆可逆改寫為準;現值＝其寫入值、兩端皆在、改寫前之值過納入閘才回復;
 *   預設只列出,apply 才寫(改寫 → 裁示之待判結案與檢核 → 段帳追加 reverted → 當場投影)。撤回核對／覆核之改寫＝使用者對該標準之裁示(須 checks 集合);
 *   撤回重評之改寫 → RS5 待判結案,回復之衝突型邊未經核對者登錄 RS4 待判。
 *
 * @param {Object} deps 輸入 { stores, dirs, clock, log, domain, settings?(取 relate.standards.conflictCheck.enabled;opt.conflictCheck 未給時用) }
 * @param {String} id 輸入邊 id
 * @param {Object} [opt={}] 輸入 { apply:Boolean, conflictCheck?:Boolean(未給依 deps.settings,皆無則登錄), project?:Boolean(預設 true:套用後當場投影兩端) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { id, found, ledger?:'reeval'|'conflictCheck'|'edgeReview', std?, revertOf?(該改寫列之 at), revertible, reason(不可撤回之原因),
 *   applied, from?:{ type, reason }(撤回前＝AI 寫入之值), to?:{ type, reason }(回復後之值), fixes?, ruling:String(視為使用者裁示之標準 id——該段帳之標準;無為 ''),
 *   rs4Queued:Boolean(預演為「將登錄」), projected? }
 * @throws {Error} 缺 deps.domain(任何寫入前)、世代不符、套用裁示而未開 checks 集合(任何寫入前)時拋出
 * @example
 * let state = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let mem = (rows) => {
 *     let m = new Map(rows.map((r) => [r.id, r]))
 *     return {
 *         get: async (id) => m.get(id) || null,
 *         select: async () => [...m.values()],
 *         patch: async (id, f) => { Object.assign(m.get(id), f) },
 *         replace: async (r) => { m.set(r.id, r) },
 *     }
 * }
 * let domain = createRelateDomain({})
 * let [T0, T1] = domain.relationTypes.filter((t) => t !== domain.conflictType)
 * let R0 = '兩篇皆以波動度調整部位，屬同一機制之延伸'
 * let R1 = '甲之波動度目標化提供乙之部位縮放所需之波動度估計'
 * let edge = makeEdge({ from: 'a', to: 'b', type: T1, reason: R1, nowIso: '2026-11-01T12:00:00+08:00' })
 * let deps = {
 *     stores: { notes: mem([{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }]), relations: mem([edge]) },
 *     dirs: { state },
 *     clock: { iso8: () => '2026-11-02T00:00:00+08:00', stamp8: () => '20261102' },
 *     log: { info: () => {}, warn: () => {}, error: () => {} },
 *     domain,
 * }
 * let file = path.join(state, LEDGER_FILES.reeval)
 * appendAudit(file, { at: '2026-11-01T12:00:00+08:00', note: 'a', version: '2026-11-01T00:00:00+08:00', edgeId: edge.id, edge: { from: 'a', to: 'b', type: T0, reason: R0 }, written: { type: T1, reason: R1 }, outcome: 'applied' })
 * let pv = await revertEdgeRevision(deps, edge.id)
 * console.log(pv.found, pv.revertible, pv.ledger, pv.std, pv.applied, pv.from.type === T1, pv.to.type === T0)
 * let r = await revertEdgeRevision(deps, edge.id, { apply: true, project: false })
 * let cur = await deps.stores.relations.get(edge.id)
 * console.log(r.applied, cur.type === T0, cur.reason === R0, readAuditRows(file).map((x) => x.outcome))
 * console.log((await revertEdgeRevision(deps, edge.id)).reason)
 * fs.rmSync(state, { recursive: true, force: true })
 * // => true true reeval RS5 false true true
 * // => true true true [ 'applied', 'reverted' ]
 * // => 最後一筆已是撤回（其後無新改寫）
 */
export async function revertEdgeRevision(deps, id, opt = {}) {
    const domain = domainOf(deps, 'revertEdgeRevision')
    const { stores } = deps
    // 預演(非 apply)純讀:不開帳,段帳直讀;世代檢核照做
    let ledgers = null
    if (opt.apply === true) ledgers = (await openChecked(deps)).ledgers
    else assertGeneration(await stores.relations.select())
    const none = { ruling: '', rs4Queued: false }
    const last = lastRevisionOf(deps.dirs.state, id)
    if (!last) return { id, found: false, revertible: false, reason: '重評、衝突核對、既有邊覆核之帳中無此邊之套用改寫', applied: false, ...none }
    const { ledger, row } = last
    const base = { id, found: true, ledger: ledger.key, std: ledger.std.std, revertOf: String(row.at ?? '') }
    const no = (reason) => ({ ...base, revertible: false, reason, applied: false, ...none })
    if (row.outcome === REVERTED_OUTCOME) return no('最後一筆已是撤回（其後無新改寫）')
    const cur = await stores.relations.get(id)
    if (!cur) return no(`邊不在（已撤出；${RELATE_API_HINT.restoreEdge}）`)
    if (String(cur.type) !== String(row.written.type) || String(cur.reason) !== String(row.written.reason)) return no('現值已非該次改寫之結果（其後另被改動，不覆寫）')
    const pre = row.edge
    const [a, b] = [await stores.notes.get(pre.from), await stores.notes.get(pre.to)]
    if (!a || !b) return no('端點筆記不在（已刪除）')
    const pair = new Map([[pre.from, a], [pre.to, b]])
    const now = deps.clock.iso8()
    const g = gateRestore(makeEdge({ from: pre.from, to: pre.to, type: pre.type, reason: pre.reason, nowIso: now }), domain, pair, undefined, deps.locale)
    if (!g.ok) return no(`改寫前之值未達檢定標準：${g.reasons.join('；')}`)
    const from = { type: cur.type, reason: cur.reason }
    const to = { type: g.edge.type, reason: g.edge.reason }
    const std = ledger.std
    const isConflict = g.edge.type === domain.conflictType
    const ruling = (std === RS4 && isConflict) || (std === RS6 && !isConflict)
    const how = `使用者以 revertEdgeRevision 撤回${ledger.label}之改寫（${base.revertOf}）——${std === RS5 ? '回復改寫前之值' : `裁示${std === RS4 ? '為真衝突' : '關聯成立'}；此值不再自動${std === RS4 ? '核對' : '覆核'}`}`
    const std0 = { ledger, ruling, how, conflictCheck: conflictCheckOf(deps, opt), source: `revertEdgeRevision 撤回${ledger.label}之改寫` }
    if (opt.apply !== true) return { ...base, revertible: true, reason: '', applied: false, from, to, fixes: g.fixes, ...(await revertedStandards(deps, g.edge, pair, { ...std0, apply: false })) }
    // 裁示須記檢核紀錄(否則存量佇列再核對而迴圈):任何寫入前驗
    if (ruling && !stores.checks) throw new Error(`revertEdgeRevision 撤回${ledger.label}之改寫即裁示（${std.std}），須 stores.checks 記檢核紀錄——否則存量佇列會再核對而迴圈`)
    // 改寫(兩端記待投影、總覽待重建、衝突降級事件、AI 寫入之值入 history、updatedAt＝現在;與各段之改寫同一件)
    const w = await rewriteEdge({ relations: stores.relations, ledgers, stateDir: deps.dirs.state }, cur, g.edge, { rank: typeRankOf(domain), at: now, conflictTypes: domain.conflictTypeNames, hasNote: (x) => pair.has(x) })
    const st = await revertedStandards(deps, w.edge, pair, { ...std0, apply: true })
    appendAudit(ledgers.files[ledger.key], { at: now, entry: 'user', edgeId: id, edge: { from: cur.from, to: cur.to, type: cur.type, reason: cur.reason }, outcome: REVERTED_OUTCOME, revertOf: row.at, written: { type: w.edge.type, reason: w.edge.reason }, ...(ledger.key === 'reeval' ? { note: row.note, version: row.version } : {}) })
    let projected = null
    if (opt.project !== false) projected = await projectNotes(deps, [cur.from, cur.to], { ledger: ledgers.dirty })
    return { ...base, revertible: true, reason: '', applied: true, from, to, fixes: g.fixes, ...st, projected }
}

export default { deleteNote, deletionStatusOf, undoDeleteNote, restoreNote, pruneDangling, projectAll, reevalBaseline, reevalRequeue, restoreEdge, revertEdgeRevision }
