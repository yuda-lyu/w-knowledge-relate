// projectOps.mjs — 受影響之筆記之投影與鄰居查詢(維運 API;存量處置與其回退、筆記與邊之明示還原共用)
//
// 【記帳先於投影】受影響之筆記先記入待投影帳、總覽待重建,再當場投影——當場投影中途失敗(或呼叫端選擇不當場投影),下輪之投影子階段
//   依帳補投,不靜默遺失。
// 【只記現存之筆記】已不存在之筆記不記帳、不投影(其邊之撤出另有刪除流程)。
// 【鄰居】鄰居＝邊庫中與之相連之筆記(一次讀邊庫、一次建鄰接表):標題有變之筆記,其鄰居之關聯章顯示本篇標題,須重投。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { buildAdjacency } from '../stores/edgeStore.mjs'
import { openRelateLedgers } from '../stores/relateLedgers.mjs'
import { projectNotes } from '../stores/noteProjection.mjs'

/**
 * 筆記 id 之去重(非空字串;依輸入序)
 *
 * @param {*} ids 輸入 id 陣列
 * @returns {Array} 回傳去重後之 id 陣列
 */
const uniqIds = (ids) => [...new Set((isarr(ids) ? ids : []).filter(isestr))]

/**
 * 筆記之鄰居:ids 中各篇之鄰居之聯集(邊庫一次讀、一次建鄰接表;ids 本身相連者亦列——互為鄰居者各為對方之鄰居)
 *
 * @param {Object} stores 輸入集合(relations 之 select)
 * @param {Array} ids 輸入筆記 id 陣列(空陣列不讀邊庫)
 * @returns {Promise} 回傳 Promise，resolve 回傳鄰居 id 陣列(去重;依 ids 之序、各篇之鄰接序)
 * @throws {Error} ids 非空而 stores.relations 缺 select 方法時拋出
 * @example
 * need test in nodejs.
 *
 * const nbs = await neighborsOf(stores, ['n1'])
 * console.log(nbs)
 */
export async function neighborsOf(stores, ids) {
    const want = uniqIds(ids)
    if (!want.length) return []
    if (!isfun(stores?.relations?.select)) throw new Error('neighborsOf 需要 stores.relations（具 select 方法）')
    const adj = buildAdjacency(await stores.relations.select())
    const out = new Set()
    for (const id of want) for (const nb of (adj.get(id) || new Map()).keys()) out.add(nb)
    return [...out]
}

/**
 * 受影響之筆記之投影:現存者記入待投影帳、總覽待重建、當場投影(檔頭【記帳先於投影】)
 *
 * @param {Object} deps 輸入 { stores:{ notes(get；投影另需 select／patch), relations(投影需 select) }, dirs:{ state }(未給 opt.ledgers 時開帳),
 *   clock?(stamp8;投影另需), log?(帳檔損壞之告警), domain(當場投影必給:型別序與衝突章) }
 * @param {Array} ids 輸入筆記 id 陣列(可重複;不存在者略過)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.ledgers] 輸入已開之關聯帳(openRelateLedgers 之產物;未給即以 deps.dirs.state 開)
 * @param {Boolean} [opt.project=true] 輸入是否當場投影;false 只記帳(下輪之投影子階段補投)
 * @returns {Promise} 回傳 Promise，resolve 回傳 { ids:Array(現存而記入待投影者;去重、依輸入序), projected:projectNotes 之統計|null(未投影) }
 * @throws {Error} deps.stores.notes 缺 get 方法、未給 opt.ledgers 而缺 deps.dirs.state、或當場投影而缺 deps.domain 時拋出(任何寫入前)
 * @example
 * need test in nodejs.
 *
 * const r = await applyEdgeStockFix(deps, plan)
 * const p = await projectAffected(deps, r.affected)
 * console.log(p.ids.length, p.projected?.changed)
 */
export async function projectAffected(deps, ids, opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }
    const project = opt.project !== false
    const stores = deps?.stores
    if (!isfun(stores?.notes?.get)) {
        throw new Error('projectAffected 需要 deps.stores.notes（具 get 方法）')
    }
    if (!opt.ledgers && !isestr(deps?.dirs?.state)) {
        throw new Error('projectAffected 需要 deps.dirs.state（關聯帳之位置）或 opt.ledgers')
    }
    const d = deps.domain
    if (project && (!isobj(d) || !isarr(d.relationTypes) || !isestr(d.conflictType))) {
        throw new Error('projectAffected 需要 deps.domain（關聯 domain——當場投影之型別序與衝突章讀之）；只記帳者給 opt.project:false')
    }

    const exist = []
    for (const id of uniqIds(ids)) if (await stores.notes.get(id)) exist.push(id)
    if (!exist.length) return { ids: [], projected: null }
    const ledgers = opt.ledgers || openRelateLedgers(deps.dirs.state, { stamp: deps.clock?.stamp8?.(), log: deps.log })
    ledgers.touch(exist)
    const projected = project ? await projectNotes(deps, exist, { ledger: ledgers.dirty }) : null
    return { ids: exist, projected }
}

export default { neighborsOf, projectAffected }
