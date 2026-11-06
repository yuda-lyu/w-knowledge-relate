// unit-relate-package.test.mjs — 套件結構測試:邊界(兩個單一匯入點)、package.json 之依賴與實際 import 對帳、預設領域中立、舊名、沿革與
//   面向使用者之字樣
//
// 【佈局】原始碼全在 src/(主入口 src/WKnowledgeRelate.mjs);套件根另有 g.mjs(範例)、toolg/(編譯與文件工具)、test/;下文路徑除註明外皆相對套件根
// ① 邊界:套件內全部 .mjs(排除 node_modules、test/_tmp 與產物夾 tmp、dist、docs)之 import 只限套件內相對路徑、npm 套件,以及兩個單一匯入點——抓取埠
//   src/core/capturePackage.mjs(抓取套件之主入口)、摘要埠 src/core/summarizePackage.mjs(摘要套件之主入口);測試專用之兩個橋接
//   (test/tools/captureForTest.mjs、test/tools/summarizeForTest.mjs;另可取上游之共用測試件 test/tools/*,如領域中立詞表)亦許可;
//   不得引用專案既有程式與資料;本套件之 src/core/ 不得有與抓取套件、
//   摘要套件之 core/ 同相對路徑之檔(同名異實;各套件各自之匯入點以檔名清單豁免);匯入點所列名稱皆可自其主入口解析;非測試檔不引用 test/ 下之檔
//   【指定詞以骨架比對】先剝註解與字串(抓取套件之 test/tools/sourceScan 之 specifiersOf,經 test/tools/captureForTest 取用)再比對 import／export 之形式:註解含分號、引號或
//   「import … from …」之字樣時不會漏抓或誤抓(掃描器自檢釘住)
// ② package.json:名稱與入口、scripts 為 test(mocha 標準指令)與 deploy;dependencies＝src/ 實際 import 之 npm 套件＋兩套件(經匯入點)、devDependencies＝
//   測試與編譯工具(g.mjs、toolg/)另 import 者(測試執行器 mocha 經 scripts.test 呼叫、不 import,隨編譯工具套件 w-package-tools 安裝;wsemi 自帶之依賴依自有套件之慣例不列);
//   兩套件之版本合於所列範圍;入口可載入;發布面(main 指向 dist 之 UMD、不設 exports 與 files,使下游得以「套件名/src/…」與「套件名/test/tools/…」深層路徑取用;
//   不提供 .npmignore〔npm 包＝git 版控內容,依 .gitignore〕,npm pack --dry-run 之清單含 sgud/ 與 test/tools/、不含 CLAUDE*.md 與暫存;LICENSE 為 MIT);範例 g.mjs 離線可執行且 README 含其全文;
//   發布內容(README、*.csv、非測試 .mjs)不含宿主之痕跡:磁碟機絕對路徑與使用者目錄
// ③ 預設領域中立:預設設定、詞彙、提示詞、零設定組裝之 info()、README、package.json、g.mjs 與原始碼(含註解、日誌與待判字樣;不含測試與評分題組)
//   不含特定產業領域之詞彙;具名例外只有 'stock'(核對帳與覆核帳之入口欄之持久化值＝存量)
// ④ 舊名、沿革與面向使用者之字樣:原始碼(非測試,含 bench)、package.json 與 README 逐行不含舊之套件名與以 extract 指稱之名、沿革指標、
//   他工作之名與執行端之指令;字串字面與 README 不含執行端之指令名、他工作名與帳本代號(判準取抓取套件之 test/tools/historyMarks)
// 執行:在套件根 node <mocha> test/unit-relate-package.test.mjs(暫存 test/_tmp/relate-package-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import * as CapturePort from '../src/core/capturePackage.mjs'
import * as SummarizePort from '../src/core/summarizePackage.mjs'
import { createKnowledgeRelate } from '../src/createKnowledgeRelate.mjs'
import { resolveRelateSettings, RELATE_DEFAULT, RELATE_AI_DEFAULT } from '../src/core/relateSettings.mjs'
import { RELATE_VOCAB_DEFAULT, resolveRelateVocab, relateGuideDefaultOf, RELATION_ROLE_NAMES } from '../src/core/vocab/relateVocab.mjs'
import { renderRelatePrompts, PROMPT_VARIANTS } from './tools/promptFixtures.mjs'
import { tmpRoot, removeRoots, resetConceptFold, scriptedAi } from './tools/relateTestKit.mjs'
import {
    domainTermsIn, specifiersOf, lexSource, exportedNamesOf, namedImportsOf, sourceFilesOf, HOST_CLI, historyHitsOf, userTextHitsOf, historyScanOf, userTextScanOf, benchCaseNotesOf,
} from './tools/captureForTest.mjs'

/** 套件根(以本檔位置推導,與 cwd 無關) */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/')

/** 宿主之痕跡:磁碟機絕對路徑(盤符＋反斜線;字串字面中之跳脫形亦含)與使用者目錄 */
const HOST_PATH = /\b[A-Za-z]:\\|\/Users\/|C:\/Users/
/** 宿主之名(專案名與其通知管道;本套件為通用套件,發布內容不得提及) */
//宿主專屬功能之字樣;使用端專案代號之檢查由發布流程之守門負責(名單不入公開庫)
const HOST_NAME = /telegram/i

// ═══════════════════════ 掃描工具(①②共用) ═══════════════════════

/**
 * 套件內全部指定副檔名之檔(預設 .mjs;相對路徑,正斜線;排除 node_modules、test/_tmp 與產物夾 tmp、dist、docs)——走訪取抓取套件之 sourceFilesOf(四套件同一份)
 *
 * @param {String} [ext='.mjs'] 輸入副檔名
 * @returns {Array} 回傳相對路徑陣列
 */
const sourceFiles = (ext = '.mjs') => sourceFilesOf(ROOT, { ext, exclude: ['tmp', 'dist', 'docs'] })

/** 讀檔;讀取當下已被他行程刪除者回 null */
function readText(rel) {
    try {
        return fs.readFileSync(path.join(ROOT, rel), 'utf8')
    }
    catch {
        return null
    }
}

/**
 * 兩個單一匯入點:檔、測試專用之橋接、套件名、主入口、原始碼根(入口所在)與套件根(package.json 所在)——依匯入點之指定詞解析:
 *   已安裝之 npm 套件(「套件名/src/入口檔」;local 為 false)或相對路徑(本地套件;入口在其根)
 *
 * @type {Object}
 */
const PORTS = Object.fromEntries([
    ['capture', { label: '抓取套件', file: 'src/core/capturePackage.mjs', bridge: 'test/tools/captureForTest.mjs', pkg: 'w-knowledge-capture', entryName: 'WKnowledgeCapture.mjs' }],
    ['summarize', { label: '摘要套件', file: 'src/core/summarizePackage.mjs', bridge: 'test/tools/summarizeForTest.mjs', pkg: 'w-knowledge-summarize', entryName: 'WKnowledgeSummarize.mjs' }],
].map(([k, p]) => {
    const spec = specifiersOf(readText(p.file) || '')[0] || ''
    const local = spec.startsWith('.')
    const entry = (local ? path.resolve(ROOT, 'src/core', spec) : fileURLToPath(import.meta.resolve(spec))).replace(/\\/g, '/')
    const root = path.dirname(entry)
    const pkgRoot = local ? root : path.dirname(fileURLToPath(import.meta.resolve(`${p.pkg}/package.json`))).replace(/\\/g, '/')
    return [k, { ...p, spec, local, entry, root, pkgRoot, entrySpec: `${p.pkg}/src/${p.entryName}` }]
}))

/** 專案內不屬本套件之目錄名:指定詞以之起頭即引用專案既有程式或資料 */
const PROJECT_DIRS = ['srcPack', 'src', 'test', 'data', 'srcCapture', 'srcSummarize']
/**
 * 分類一個指定詞
 *
 * @param {String} file 輸入引用者(相對套件根)
 * @param {String} spec 輸入指定詞
 * @returns {Object} 回傳 { kind:'builtin'|'relative'|'package', pkg?:套件名, problem?:問題說明 }
 */
function classify(file, spec) {
    if (spec.startsWith('node:') || isBuiltin(spec)) return { kind: 'builtin' }
    if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
        const target = path.resolve(path.dirname(path.join(ROOT, file)), spec).replace(/\\/g, '/')
        const rel = path.relative(ROOT, target).replace(/\\/g, '/')
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            // 兩套件只經匯入點(與測試專用之橋接)取用,且指向其主入口:其指定詞即該套件(移植後為 npm 套件名);
            //   測試專用之橋接另可取該套件之共用測試件(其 test/tools/ 下,如四套件同一份之領域中立詞表)
            for (const p of Object.values(PORTS)) {
                if ((file === p.file || file === p.bridge) && target === p.entry && fs.existsSync(target)) return { kind: 'package', pkg: p.pkg }
                if (file === p.bridge && (`${target}/`).startsWith(`${p.root}/test/tools/`) && fs.existsSync(target)) return { kind: 'package', pkg: p.pkg }
            }
            const port = Object.values(PORTS).find((p) => (`${target}/`).startsWith(`${p.root}/`))
            return { kind: 'relative', problem: `相對 import 跑出套件根 → ${spec}${port ? `(取${port.label}須經 ${port.file},且指向其主入口;測試專用之橋接另可取其 test/tools/)` : ''}` }
        }
        if (!fs.existsSync(target)) return { kind: 'relative', problem: `目標不存在 → ${spec}` }
        return { kind: 'relative' }
    }
    if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) || /^[a-z][a-z0-9+.-]*:/i.test(spec)) return { kind: 'package', problem: `絕對路徑或 URL 形式之指定詞 → ${spec}` }
    if (PROJECT_DIRS.some((d) => spec === d || spec.startsWith(`${d}/`))) return { kind: 'package', problem: `引用專案既有程式或資料 → ${spec}` }
    const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    const port = Object.values(PORTS).find((p) => p.pkg === pkg)
    if (port) {
        // npm 套件之形:匯入點(與橋接)只指向其主入口「套件名/src/入口檔」;測試專用之橋接另可取其共用測試件「套件名/test/tools/<檔>」(須為實有檔)
        if (file !== port.file && file !== port.bridge) return { kind: 'package', pkg, problem: `${port.label}須經單一匯入點 ${port.file} 取用 → ${spec}` }
        if (spec === port.entrySpec) return { kind: 'package', pkg }
        if (file === port.bridge && spec.startsWith(`${pkg}/test/tools/`) && fs.existsSync(path.join(port.pkgRoot, spec.slice(pkg.length + 1)))) return { kind: 'package', pkg }
        return { kind: 'package', pkg, problem: `取${port.label}須指向其主入口 ${port.entrySpec}(測試專用之橋接另可取其 test/tools/)→ ${spec}` }
    }
    return { kind: 'package', pkg }
}

/** 全套件掃描結果(逐檔之指定詞與分類) */
function scanAll() {
    const files = sourceFiles()
    const rows = []
    for (const f of files) {
        const code = readText(f)
        if (code === null) continue
        for (const spec of specifiersOf(code)) rows.push({ file: f, spec, ...classify(f, spec) })
    }
    return { files, rows }
}

describe('unit-relate-package', function() {

    this.timeout(60_000)

    after(() => {
        resetConceptFold()
    })

    // ═══════════════════════ ① 邊界 ═══════════════════════
    describe('① 邊界(只經兩個單一匯入點取抓取與摘要套件;套件須能整份移植)', () => {
        let scan = null
        before(() => {
            scan = scanAll()
        })

        it('掃描器自檢:各種 import 形式皆能取出指定詞;註解(含分號與引號)、字串、樣板與正規表示式字面不干擾;分類器抓得到跑出套件、專案目錄、繞過匯入點與絕對路徑', () => {
            // 動態 import 之固定樣本以拼接組成:本檔自身亦在掃描範圍,不可含完整之 import(...) 字樣
            const fixture = [
                "import a from './a.mjs'",
                'import {',
                '    b, // 註解含;分號與 \'單引號\' 與 "雙引號"',
                "} from '../../srcPack/x.mjs'",
                'export {',
                "    c, // 註解;含 'quote'",
                "} from './c.mjs'",
                "export * from 'wsemi/src/isobj.mjs'",
                "import 'side-effect-pkg'",
                `const m = await ${'imp'}${"ort('../../src/y.mjs')"}`,
                "// import d from 'commented-out'",
                "/* import e from 'in-block' */",
                '/**',
                " * import f from 'in-jsdoc'",
                ' */',
                "const s = \"import g from './in-string.mjs'\"",
                "const t = `import h from './in-template.mjs'`",
                "const u = `x${'y'}\nimport i from './in-template-expr.mjs'\n`",
                "const re = /['\"]/g; import k from './after-regex.mjs'",
                "const z = a / 2; import l from './after-division.mjs'",
            ].join('\n')
            assert.deepEqual(specifiersOf(fixture).sort(), ['../../src/y.mjs', '../../srcPack/x.mjs', './a.mjs', './after-division.mjs', './after-regex.mjs', './c.mjs', 'side-effect-pkg', 'wsemi/src/isobj.mjs'])
            // 骨架:註解、字串與正規表示式字面之內容不留(比對只見程式之結構)
            const sk = lexSource("const x = 'import y from \"z\"' // 註解 import w from 'v'\nconst r = /from 'q'/").skeleton
            assert.doesNotMatch(sk, /import|from|註解/)
            assert.match(classify('test/x.test.mjs', '../../srcPack/x.mjs').problem, /跑出套件根/)
            assert.match(classify('src/stages/x.mjs', PORTS.capture.entrySpec).problem, /抓取套件須經單一匯入點 src\/core\/capturePackage\.mjs/)
            assert.match(classify('src/stages/x.mjs', PORTS.summarize.entrySpec).problem, /摘要套件須經單一匯入點 src\/core\/summarizePackage\.mjs/)
            assert.match(classify(PORTS.capture.file, `${PORTS.capture.pkg}/src/core/kernel.mjs`).problem, /指向其主入口/, '匯入點只可指向主入口')
            assert.match(classify(PORTS.capture.bridge, `${PORTS.capture.pkg}/test/tools/nope.mjs`).problem, /指向其主入口/, '橋接只可取其 test/tools/ 之實有檔')
            assert.match(classify(PORTS.summarize.file, `${PORTS.summarize.pkg}/src/core/md/md.mjs`).problem, /指向其主入口/, '摘要埠只可指向主入口')
            assert.deepEqual(classify(PORTS.summarize.bridge, `${PORTS.summarize.pkg}/test/tools/noteKit.mjs`), { kind: 'package', pkg: PORTS.summarize.pkg }, '橋接可取摘要套件 test/tools/ 之實有檔')
            assert.match(classify('src/stages/x.mjs', PORTS.capture.pkg).problem, /須經單一匯入點/)
            assert.match(classify('src/stages/x.mjs', PORTS.summarize.pkg).problem, /須經單一匯入點/)
            assert.deepEqual(classify(PORTS.capture.file, PORTS.capture.spec), { kind: 'package', pkg: PORTS.capture.pkg })
            assert.deepEqual(classify(PORTS.summarize.file, PORTS.summarize.spec), { kind: 'package', pkg: PORTS.summarize.pkg })
            assert.match(classify('src/core/x.mjs', '../nope/none.mjs').problem, /目標不存在/)
            assert.match(classify('src/core/x.mjs', 'srcPack/core/kernel.mjs').problem, /引用專案既有程式或資料/)
            assert.match(classify('src/core/x.mjs', 'srcSummarize/core/md/md.mjs').problem, /引用專案既有程式或資料/)
            assert.match(classify('src/core/x.mjs', 'data/vocab.json').problem, /引用專案既有程式或資料/)
            assert.match(classify('src/core/x.mjs', 'C:/proj/a.mjs').problem, /絕對路徑或 URL/)
            assert.deepEqual(classify('src/core/x.mjs', 'wsemi/src/isobj.mjs'), { kind: 'package', pkg: 'wsemi' })
            assert.deepEqual(classify('src/core/x.mjs', 'node:fs'), { kind: 'builtin' })
            assert.deepEqual(classify('src/core/x.mjs', '../core/relateSettings.mjs'), { kind: 'relative' })
            for (const f of ['src/WKnowledgeRelate.mjs', 'src/createKnowledgeRelate.mjs', 'src/relateRuntime.mjs', PORTS.capture.file, PORTS.summarize.file, 'src/stages/relateStage.mjs', 'g.mjs', 'toolg/gDistRollup.mjs', 'test/unit-relate-package.test.mjs', 'test/tools/relateTestKit.mjs']) {
                assert.ok(scan.files.includes(f), `掃描須含 ${f}`)
            }
            assert.ok(scan.files.length >= 70 && scan.rows.length >= 500, `掃描量過少：${scan.files.length} 檔／${scan.rows.length} 條指定詞`)
            assert.ok(!scan.files.some((f) => f.includes('node_modules') || f.startsWith('test/_tmp/') || /^(tmp|dist|docs)\//.test(f)), '須排除 node_modules、test/_tmp 與產物夾 tmp、dist、docs')
        })

        it('全部相對 import 解析後不跑出套件根、目標存在;取兩套件者只有其單一匯入點(與測試專用之橋接),其目標即該套件之主入口', () => {
            const bad = scan.rows.filter((r) => r.problem).map((r) => `${r.file}：${r.problem}`)
            assert.deepEqual(bad, [])
            for (const p of Object.values(PORTS)) {
                const via = [...new Set(scan.rows.filter((r) => r.pkg === p.pkg).map((r) => r.file))]
                assert.ok(via.includes(p.file), `${p.file} 引用${p.label}`)
                assert.deepEqual(via.filter((f) => f !== p.file && f !== p.bridge), [], `${p.label}只經匯入點與測試橋接`)
                assert.equal(path.basename(p.entry), p.entryName)
                assert.deepEqual(specifiersOf(readText(p.file)), [p.spec], `${p.file} 只有一個指定詞(移植時只改此處)`)
            }
        })

        it('層序(終審 D7):core ← stores ← standards ← { stages, ops };四層之檔只取同層或更低層、stages 與 ops 互不引用;domain 與 bench 為葉、根檔(入口、總組裝、物件、執行期件)不被四層取;logContract(自身只取 stores)只供 standards 以上取', () => {
            // 層:數字小者為下層;根之 logContract 視為 standards 同層(自身取 stores,供 standards／stages／ops 取)
            const LAYER = { core: 0, stores: 1, logContract: 2, standards: 2, stages: 3, ops: 3 }
            const LEAF = new Set(['domain', 'bench'])
            // 檔與目標皆以套件根為基準(原始碼在 src/):層名取 src/ 之下一層;src/ 以外(test/、toolg/、g.mjs)不在 LAYER 內
            const dirOf = (f) => {
                const s = f.startsWith('src/') ? f.slice(4) : f
                return s.includes('/') ? s.split('/')[0] : s.replace(/\.mjs$/, '')
            }
            const targetOf = (file, spec) => path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, file)), spec)).replace(/\\/g, '/')
            // 守門範圍:LAYER 內之檔(四層、core、logContract);根之入口與總組裝、葉自身可取全部
            const judge = (file, spec) => {
                const from = dirOf(file)
                if (!(from in LAYER)) return false
                const to = dirOf(targetOf(file, spec))
                if (LEAF.has(to)) return true
                if (!(to in LAYER)) return true
                return LAYER[to] > LAYER[from] || (from === 'stages' && to === 'ops') || (from === 'ops' && to === 'stages')
            }
            const violations = scan.rows.filter((r) => r.kind === 'relative' && !r.problem && !r.file.startsWith('test/') && judge(r.file, r.spec)).map((r) => `${r.file} → ${r.spec}`)
            // 判準自檢:越層、平層互引、取葉、取根檔皆抓得到;合法之向下取不抓
            assert.deepEqual([
                judge('src/stores/x.mjs', '../standards/y.mjs'), judge('src/standards/x.mjs', '../stages/y.mjs'), judge('src/stages/x.mjs', '../ops/y.mjs'), judge('src/ops/x.mjs', '../stages/y.mjs'),
                judge('src/core/x.mjs', '../stores/y.mjs'), judge('src/stores/x.mjs', '../logContract.mjs'), judge('src/stores/x.mjs', '../domain/y.mjs'), judge('src/stages/x.mjs', '../bench/y.mjs'), judge('src/standards/x.mjs', '../relateObject.mjs'),
            ], [true, true, true, true, true, true, true, true, true])
            assert.deepEqual([
                judge('src/stages/x.mjs', '../standards/y.mjs'), judge('src/ops/x.mjs', '../stores/y.mjs'), judge('src/standards/x.mjs', '../logContract.mjs'), judge('src/stages/x.mjs', '../logContract.mjs'),
                judge('src/stores/x.mjs', '../core/y.mjs'), judge('src/core/x.mjs', './y.mjs'), judge('src/logContract.mjs', './stores/relateHolds.mjs'), judge('src/WKnowledgeRelate.mjs', './ops/noteOps.mjs'), judge('src/bench/x.mjs', '../stages/y.mjs'),
            ], [false, false, false, false, false, false, false, false, false])
            assert.deepEqual(violations, [])
        })

        it('非測試檔不引用 test/ 下之檔(測試工具與測試專用之橋接只供測試;發布之套件可不帶 test/)', () => {
            const intoTestOf = (rows) => rows.filter((r) => !r.file.startsWith('test/') && r.kind === 'relative' && !r.problem)
                .filter((r) => path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, r.file)), r.spec)).replace(/\\/g, '/').startsWith('test/'))
                .map((r) => `${r.file} → ${r.spec}`)
            const probes = [
                { file: 'src/stages/x.mjs', spec: '../../test/tools/relateTestKit.mjs' },
                { file: 'test/a.test.mjs', spec: './tools/relateTestKit.mjs' },
                { file: 'src/stages/x.mjs', spec: '../stores/edgeStore.mjs' },
            ].map((p) => ({ ...p, ...classify(p.file, p.spec) }))
            assert.deepEqual(intoTestOf(probes), ['src/stages/x.mjs → ../../test/tools/relateTestKit.mjs'], '判準自檢')
            assert.deepEqual(intoTestOf(scan.rows), [])
        })

        it('匯入點所列名稱皆可自主入口解析(非 undefined);本套件之 core/ 與抓取、摘要套件之 core/ 無同相對路徑之檔(各套件各自之匯入點以檔名清單豁免)', () => {
            for (const [name, port] of [['抓取埠', CapturePort], ['摘要埠', SummarizePort]]) {
                const names = Object.keys(port)
                assert.ok(names.length >= 20, `${name}之名過少:${names.length}`)
                assert.deepEqual(names.filter((k) => port[k] === undefined), [], name)
            }
            const listCore = (root) => {
                const out = []
                const walk = (rel) => {
                    for (const d of fs.readdirSync(path.join(root, 'core', rel), { withFileTypes: true })) {
                        const r = rel ? `${rel}/${d.name}` : d.name
                        if (d.isDirectory()) walk(r)
                        else if (d.name.endsWith('.mjs')) out.push(r)
                    }
                }
                walk('')
                return out
            }
            // 豁免:各套件各自之匯入點(取用他套件之單一入口;同名而各指其上游,不是同名異實之核心件)
            const EXEMPT = ['capturePackage.mjs', 'summarizePackage.mjs']
            const mine = listCore(`${ROOT}/src`)
            assert.ok(EXEMPT.every((f) => mine.includes(f)), '前提:兩個匯入點在 src/core/')
            for (const p of Object.values(PORTS)) {
                const theirs = new Set(listCore(p.root))
                assert.ok(theirs.size >= 3, `前提:${p.label}之 core/ 有檔`)
                assert.deepEqual(mine.filter((f) => theirs.has(f) && !EXEMPT.includes(f)), [], `與${p.label}之 core/ 同相對路徑之檔`)
            }
        })

        it('兩匯入點只列套件程式碼所需之名:所列每一名,非測試檔至少一檔經該匯入點具名取用(只供測試之名經測試專用之橋接)', () => {
            // 規則:上層可依賴之面以埠明列之名為準——埠多列只供測試之名,即把測試之需求寫成套件之依賴面(移植時誤以為套件需要)
            // 判準自檢:轉出取對外之名(x as y → y)、匯入取被匯入之名(y as z → y);多行、註解與字串不干擾
            assert.deepEqual(exportedNamesOf("export {\n    a, // 說明;b\n    c as d,\n} from '../x.mjs'\nconst s = \"export { q } from './q.mjs'\""), ['a', 'd'])
            assert.deepEqual(namedImportsOf("import { d as e, a } from '../core/capturePackage.mjs'\n// import { q } from './q.mjs'").map((x) => `${x.spec}:${x.name}`), ['../core/capturePackage.mjs:d', '../core/capturePackage.mjs:a'])
            const lib = scan.files.filter((f) => !f.startsWith('test/'))
            for (const p of Object.values(PORTS)) {
                const names = exportedNamesOf(readText(p.file))
                assert.deepEqual([...names].sort(), Object.keys(p.file === PORTS.capture.file ? CapturePort : SummarizePort).sort(), `${p.file}:解析之清單＝匯入點之命名空間`)
                const target = path.join(ROOT, p.file).replace(/\\/g, '/')
                const used = new Set()
                for (const f of lib.filter((x) => x !== p.file)) {
                    const code = readText(f)
                    if (code === null) continue
                    for (const { spec, name } of namedImportsOf(code)) {
                        if (spec.startsWith('.') && path.resolve(path.dirname(path.join(ROOT, f)), spec).replace(/\\/g, '/') === target) used.add(name)
                    }
                }
                assert.deepEqual(names.filter((n) => !used.has(n)), [], `${p.file}:只供測試之名改列 ${p.bridge}`)
            }
        })
    })

    // ═══════════════════════ ② package.json ═══════════════════════
    describe('② package.json', () => {
        const pkg = JSON.parse(fs.readFileSync(`${ROOT}/package.json`, 'utf8'))
        /** 測試執行器(由 scripts.test 呼叫,不被 import;隨編譯工具套件 BUILD_TOOLS 安裝) */
        const TEST_RUNNER = 'mocha'
        /** 編譯與文件工具套件(toolg/ 以 w-package-tools 之 src 深層路徑取用;同自有套件之 devDependencies) */
        const BUILD_TOOLS = 'w-package-tools'
        /** 檔案所屬群組:src/ 為套件原始碼(lib)、test/ 為測試、其餘(g.mjs、toolg/)為範例與編譯工具(tool) */
        const groupOf = (file) => (file.startsWith('test/') ? 'test' : file.startsWith('src/') ? 'lib' : 'tool')

        /**
         * wsemi 自行規定並安裝之依賴:自有套件之慣例是依賴由該自有套件統籌,使用端不重列(自 node_modules 之 wsemi/package.json 讀取,由近而遠)
         *
         * @returns {Set} 回傳套件名集合
         */
        function providedByWsemi() {
            for (let dir = ROOT; ; dir = path.dirname(dir)) {
                const f = `${dir}/node_modules/wsemi/package.json`
                if (fs.existsSync(f)) return new Set(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).dependencies || {}))
                if (path.dirname(dir) === dir) throw new Error('找不到 node_modules/wsemi(須先安裝套件依賴)')
            }
        }

        it('scripts 為 test(mocha --parallel 之標準指令)與 deploy(文件發布,同自有套件之範本),不增設其他指令', () => {
            // 規則:套件之 package.json 提供 npm test(有 parallel 之標準寫法)與 deploy(gh-pages -d docs;自有套件範本皆有)
            assert.deepEqual(Object.keys(pkg.scripts), ['test', 'deploy'])
            assert.equal(pkg.scripts.test, 'mocha --parallel "test/*.test.mjs" --timeout 180000')
            assert.equal(pkg.scripts.deploy, 'gh-pages -d docs')
        })

        it('依賴對帳:src/ 之 import 套件＝dependencies(wsemi 自帶者除外;兩套件經匯入點);測試與編譯工具(g.mjs、toolg/)另 import 者在 devDependencies;所列者皆有使用者', () => {
            const scan = scanAll()
            const deps = new Set(Object.keys(pkg.dependencies || {}))
            const dev = new Set(Object.keys(pkg.devDependencies || {}))
            const byWsemi = providedByWsemi()
            assert.ok(deps.has('wsemi') && byWsemi.has('lodash-es'), '前提:wsemi 為依賴且其依賴含 lodash-es')
            const used = { lib: new Set(), test: new Set(), tool: new Set() }
            for (const r of scan.rows.filter((x) => x.kind === 'package' && x.pkg && !x.problem)) used[groupOf(r.file)].add(r.pkg)
            const libMissing = [...used.lib].filter((p) => !deps.has(p) && !byWsemi.has(p))
            const devMissing = [...used.test, ...used.tool].filter((p) => !deps.has(p) && !dev.has(p) && !byWsemi.has(p))
            assert.deepEqual([libMissing, devMissing], [[], []], '被 import 之套件須列於 package.json')
            assert.deepEqual([...deps].filter((p) => !used.lib.has(p)), [], 'dependencies 不得有 src/ 未使用者')
            // 測試執行器 mocha 由 scripts.test 呼叫、不被 import:隨編譯工具套件安裝(同自有套件),不在 import 對帳之內,但須可解析
            assert.ok(dev.has(BUILD_TOOLS) && used.tool.has(BUILD_TOOLS), `編譯工具套件 ${BUILD_TOOLS} 須列於 devDependencies 且被 toolg/ 使用`)
            assert.doesNotThrow(() => import.meta.resolve(TEST_RUNNER), `測試執行器 ${TEST_RUNNER} 須已安裝`)
            assert.deepEqual([...dev].filter((p) => !used.test.has(p) && !used.tool.has(p)), [], 'devDependencies 不得有測試與編譯工具未使用者')
            assert.deepEqual([...dev].filter((p) => used.lib.has(p)), [], 'src/ 使用者須列於 dependencies')
            for (const p of [PORTS.capture.pkg, PORTS.summarize.pkg, 'wsemi']) assert.ok(used.lib.has(p), `掃描非空洞:${p} 被掃到`)
        })

        it('依賴為 semver 範圍(不指向本機路徑);兩套件之實際版本合於所列範圍', () => {
            for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
                assert.match(range, /^[\^~>=<]*\d+\.\d+\.\d+/, `${name} 之版本範圍須為 semver：${range}`)
            }
            for (const p of Object.values(PORTS)) {
                const up = JSON.parse(fs.readFileSync(`${p.pkgRoot}/package.json`, 'utf8'))
                assert.equal(up.name, p.pkg)
                const [maj, min] = up.version.split('.').map(Number)
                const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.dependencies[p.pkg])
                assert.ok(m, pkg.dependencies[p.pkg])
                assert.ok(Number(m[1]) === 0 ? maj === 0 && min === Number(m[2]) : maj === Number(m[1]), `${p.label} ${up.version} 須合於 ${pkg.dependencies[p.pkg]}`)
            }
        })

        it('入口可載入:main 指向 dist 之 UMD(dist 由發布流程產製,不要求存在),ESM 入口 src/WKnowledgeRelate.mjs 存在;預設匯出物件與具名匯出為同一組(含 createKnowledgeRelate)', async () => {
            // 規則(移植指定詞):自有套件發布後 main 指 UMD、原始碼在 src/,下游一律以「套件名/src/入口檔」取 ESM 入口——
            //   套件不設 exports(設了即擋掉該子路徑與 test/tools 之深層路徑),入口檔須實際存在於 src/
            assert.equal(pkg.main, `dist/${pkg.name}.umd.js`)
            assert.ok(fs.existsSync(`${ROOT}/src/WKnowledgeRelate.mjs`), 'ESM 入口 src/WKnowledgeRelate.mjs 須存在')
            const mod = await import('../src/WKnowledgeRelate.mjs')
            assert.equal(typeof mod.createKnowledgeRelate, 'function')
            assert.equal(mod.default.createKnowledgeRelate, mod.createKnowledgeRelate)
            assert.deepEqual(Object.keys(mod.default).sort(), Object.keys(mod).filter((k) => k !== 'default').sort())
        })

        it('發布面:不設 exports 與 files(下游以深層路徑取用 src/ 與 test/tools/);不提供 .npmignore(npm 包＝git 版控內容,依 .gitignore;.gitignore 列 CLAUDE*.md、不排除 sgud、src、dist、test/tools);套件根範本檔齊備;LICENSE 為 MIT 且署名同作者', () => {
            // 規則:設 exports 即擋掉「套件名/src/…」「套件名/test/tools/…」之深層路徑(下游套件與專案以之取用);設 files 白名單則套件根新增檔案時易漏
            assert.equal(pkg.exports, undefined, '不設 exports')
            assert.equal(pkg.files, undefined, '不設 files(發布範圍＝git 版控內容,由 .gitignore 決定)')
            assert.equal(pkg.name, 'w-knowledge-relate')
            assert.deepEqual([pkg.repository.type, pkg.repository.url], ['git', 'git+https://github.com/yuda-lyu/w-knowledge-relate.git'])
            assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length >= 3 && typeof pkg.author === 'string' && pkg.author.length > 0, 'keywords 與 author 須有')
            // 發布範圍(使用者 2026-11-01 裁示):預設不提供 .npmignore,npm 包＝git 版控內容(依 .gitignore);只有外部執行檔與單一資料夾 ≥10MB 之非程式碼資料才提供——
            //   本套件兩者皆無(test/、docs/ 皆 <10MB),故不得有 .npmignore(有則 npm 不再讀 .gitignore);sgud/(經驗、處理要點、規則帳本、現況)、test/(含 test/tools/)、docs/ 皆隨包;
            //   CLAUDE*.md 由 .gitignore 排除,不入版控亦不入包。實際打包清單見下一案
            assert.equal(fs.existsSync(`${ROOT}/.npmignore`), false, '不得有 .npmignore(本套件無外部執行檔、無 ≥10MB 之非程式碼資料夾;發布範圍＝git 版控內容)')
            const gitignore = (readText('.gitignore') || '').split(/\r?\n/).map((l) => l.trim())
            assert.ok(gitignore.includes('CLAUDE*.md') && !gitignore.some((l) => /^!?sgud/.test(l) || l === '!CLAUDE.md'), '.gitignore 須列 CLAUDE*.md、不得排除 sgud、不得加 !CLAUDE.md')
            assert.ok(!gitignore.some((l) => /^\/?test\/?(tools\/?)?$/.test(l) || /^\/?test\/tools/.test(l) || /^\/?(src|dist)\/?$/.test(l)), '.gitignore 不得排除 test 夾整體、test/tools、src、dist(npm 包＝git 版控內容,下游取用 test/tools)')
            // 自有套件根目錄範本檔(編譯、文件、風格與安全政策)
            for (const f of ['.editorconfig', '.eslintignore', '.eslintrc.js', '.jsdoc', 'babel.config.js', 'SECURITY.md', 'g.mjs', 'README.md', 'LICENSE', 'script.txt', 'toolg/addVersion.mjs', 'toolg/modifyReadme.mjs', 'toolg/cleanFolder.mjs', 'toolg/gDocsExams.mjs', 'toolg/gDistRollup.mjs', 'toolg/genDocsDist.mjs', 'test/tools/relateTestKit.mjs']) {
                assert.ok(fs.existsSync(`${ROOT}/${f}`), `套件根須有 ${f}`)
            }
            const lic = readText('LICENSE') || ''
            assert.equal(pkg.license, 'MIT')
            assert.ok(lic.startsWith('MIT License') && lic.includes(`Copyright (c) 2026 ${pkg.author}`), 'LICENSE 須為 MIT 並署名作者')
        })

        it('打包清單(npm pack --dry-run):含 sgud/ 四份索引與 test/tools/ 全部檔、src 主入口、README、LICENSE、package.json;不含 CLAUDE*.md、暫存(tmp、test/_tmp)與 node_modules', () => {
            // 規則:npm 包＝git 版控內容(依 .gitignore);sgud/ 與 test/tools/ 隨包(下游之測試以「套件名/test/tools/…」取用),CLAUDE*.md 不入包
            const raw = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 120_000 })
            const parsed = JSON.parse(raw)
            const info = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
            const packed = info.files.map((x) => x.path.replace(/\\/g, '/'))
            assert.ok(packed.length >= 80, `打包清單過少:${packed.length}`)
            for (const f of ['sgud/exp/experience.md', 'sgud/proc/process.md', 'sgud/rule/rulebook.md', 'sgud/state/state.md', 'src/WKnowledgeRelate.mjs', 'README.md', 'LICENSE', 'package.json']) {
                assert.ok(packed.includes(f), `打包清單須含 ${f}`)
            }
            const tools = fs.readdirSync(`${ROOT}/test/tools`, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => `test/tools/${e.name}`)
            assert.ok(tools.length >= 5, `test/tools 檔數過少:${tools.length}`)
            for (const f of tools) assert.ok(packed.includes(f), `打包清單須含 ${f}`)
            assert.deepEqual(packed.filter((f) => /(^|\/)CLAUDE[^/]*\.md$/.test(f)), [], '打包清單不得含 CLAUDE*.md')
            assert.deepEqual(packed.filter((f) => /^(tmp|test\/_tmp|node_modules)\//.test(f)), [], '打包清單不得含 tmp、test/_tmp、node_modules')
        })

        it('範例 g.mjs 離線可直接執行(不連網、不呼叫真 AI、不留工作目錄),輸出與檔末 `// =>` 逐行相符;README 之 Example 含 g.mjs 全文', () => {
            // 規則:自有套件根目錄 g.mjs 為可直接執行之範例,README 之 Example 連該檔(改 g.mjs 須同步 README)
            const g = (readText('g.mjs') || '').replace(/\r\n/g, '\n')
            const rd = (readText('README.md') || '').replace(/\r\n/g, '\n')
            assert.ok(g.length > 1000 && rd.includes(g.trimEnd()), 'README 之 Example 須含 g.mjs 全文')
            const lines = g.split('\n')
            const at = lines.findIndex((l) => l.startsWith('// => '))
            assert.ok(at > 0, 'g.mjs 檔末須附 `// =>` 輸出')
            const want = lines.slice(at).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ => /, '').replace(/^\/\/ ?/, ''))
            const cwd = tmpRoot('pkg-g-mjs')
            fs.mkdirSync(cwd, { recursive: true })
            try {
                // 以 g.mjs 之位置載入 src,工作目錄(./_test_knowledge_relate)落在暫存夾,與套件根無關
                const out = execFileSync(process.execPath, [`${ROOT}/g.mjs`], { cwd, encoding: 'utf8', timeout: 120_000 })
                assert.deepEqual(out.replace(/\r\n/g, '\n').trimEnd().split('\n'), want)
                assert.equal(fs.existsSync(`${cwd}/_test_knowledge_relate`), false, '範例結束須清掉工作目錄')
            }
            finally {
                removeRoots([cwd])
            }
        })

        it('發布內容(README、*.csv、非測試 .mjs)不含宿主之痕跡:磁碟機絕對路徑(含字串字面中之跳脫形)、使用者目錄與宿主專屬功能字樣(Telegram);test/ 內不計', () => {
            // 判準自檢:被抓到與不誤判(盤符之相對寫法、網址、正斜線之範例路徑不算;宿主名不分大小寫、字首相近之他詞不算)
            for (const s of ['C:\\work\\x', "'d:\\\\kb'", '/Users/me/x', 'C:/Users/me']) assert.ok(HOST_PATH.test(s), s)
            for (const s of ['c:/kb/db', "workDir: 'd:/my-kb'", 'https://a.example/b', 'a:b', '相對\\路徑']) assert.ok(!HOST_PATH.test(s), s)
            for (const s of ['TELEGRAM_TEXT_MAX', 'telegram 通知']) assert.ok(HOST_NAME.test(s), s)
            for (const s of ['telegraph', '知識庫']) assert.ok(!HOST_NAME.test(s), s)
            const files = [...sourceFiles('.mjs').filter((f) => !f.startsWith('test/')), ...sourceFiles('.csv').filter((f) => !f.startsWith('test/')), 'README.md']
            assert.ok(files.length >= 40 && files.some((f) => f.endsWith('.csv')), `掃描量過少或漏 csv：${files.length}`)
            const bad = []
            for (const f of files) {
                (readText(f) || '').split('\n').forEach((l, i) => {
                    if (HOST_PATH.test(l) || HOST_NAME.test(l)) bad.push(`${f}:${i + 1} ${l.trim().slice(0, 80)}`)
                })
            }
            assert.deepEqual(bad, [])
        })
    })

    // ═══════════════════════ ③ 預設領域中立 ═══════════════════════
    describe('③ 預設領域中立', () => {
        /** 特定產業領域之詞彙(中英;預設內容不得含):詞表與命中函數取抓取套件之 test/tools/domainTerms(經 test/tools/captureForTest;四套件同一份) */
        const hits = domainTermsIn
        /** 值含函數與 RegExp 時之可掃描文字 */
        const textOf = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' || x instanceof RegExp ? String(x) : x))
        /**
         * 中立掃描之具名例外(只有一項):檔、行內之字樣、理由。例外之字樣自該行移除後再掃——同一行之其他詞照判
         *
         * @type {Array}
         */
        const NAMED_EXCEPTIONS = Object.freeze([
            { term: 'stock', token: "'stock'", files: ['src/stages/conflictCheckSegment.mjs', 'src/stages/edgeReviewSegment.mjs'], why: '核對帳／覆核帳之入口欄之持久化值(＝存量);改名即令既有帳列對不上' },
        ])
        /**
         * 一份文字之命中(套用具名例外)
         *
         * @param {String} file 輸入檔名(相對套件根)
         * @param {String} text 輸入文字
         * @returns {Array} 回傳命中之詞
         */
        const hitsOfFile = (file, text) => {
            let t = String(text || '')
            for (const x of NAMED_EXCEPTIONS) if (x.files.includes(file)) t = t.split(x.token).join('')
            return hits(t)
        }
        let root = ''
        before(() => {
            root = tmpRoot('relate-package')
        })
        after(() => {
            removeRoots([root])
        })

        it('詞表自檢:領域詞被抓到;中立題材、物理詞、識別字與模型條目 id 之片段不誤傷', () => {
            assert.deepEqual(hits('量化交易之股票回測與樣本外、市場報酬、倖存者與窺探'), ['量化', '交易', '股票', '回測', '樣本外', '報酬', '市場', '倖存者', '窺探'])
            assert.deepEqual(hits('Quant trading stock backtests sharpe alpha portfolio'), ['quant', 'trading', 'stock', 'backtest', 'portfolio', 'sharpe', 'alpha'])
            assert.deepEqual(hits('天文學知識庫：quantum tunneling、planEdgeStockFix、stock-fix.jsonl、oc:opencode/fledge-alpha-free、future work'), [])
        })

        it('具名例外只有一項(\'stock\')且仍有對象:所列之檔確含該字樣(例外過時即須移除);例外只免該字樣,同檔之其他詞照判', () => {
            assert.deepEqual(NAMED_EXCEPTIONS.map((x) => x.term), ['stock'])
            for (const x of NAMED_EXCEPTIONS) for (const f of x.files) assert.ok((readText(f) || '').includes(x.token), `${f} 已不含 ${x.token}:具名例外過時,請移除`)
            assert.deepEqual(hitsOfFile('src/stages/conflictCheckSegment.mjs', "entry: 'stock' 與 交易"), ['交易'])
            assert.deepEqual(hitsOfFile('src/stages/relateStage.mjs', "entry: 'stock'"), ['stock'], '未列之檔不免')
        })

        it('預設設定(resolveRelateSettings({}) 與預設常數)、預設詞彙(含預設 guide、角色候選名與解析後之詞彙)不含領域詞彙', () => {
            const all = {
                settingsResolved: resolveRelateSettings({}),
                settingsDefault: [RELATE_DEFAULT, RELATE_AI_DEFAULT],
                vocabDefault: RELATE_VOCAB_DEFAULT,
                vocabResolved: resolveRelateVocab({}),
                guide: relateGuideDefaultOf(),
                roles: RELATION_ROLE_NAMES,
            }
            for (const [k, v] of Object.entries(all)) assert.deepEqual(hits(textOf(v)), [], `預設「${k}」含領域詞彙`)
        })

        it('預設提示詞(四支之固定輸入;無詞彙與 { domain:"天文學" } 兩組)不含領域詞彙', () => {
            for (const vocab of Object.values(PROMPT_VARIANTS)) {
                const prompts = renderRelatePrompts(vocab)
                assert.ok(Object.keys(prompts).length >= 4)
                for (const [name, p] of Object.entries(prompts)) assert.deepEqual(hits(p), [], `${JSON.stringify(vocab)}:${name}`)
            }
        })

        it('零設定組裝之 info()(設定、詞彙、資料、生效之 domain 之型別定義)不含領域詞彙;提示詞首句之稱呼為通用「知識庫」', () => {
            const info = createKnowledgeRelate({ workDir: `${root}/zero`, aiAdapter: scriptedAi(), lock: false }).info()
            const d = info.domains.relate
            assert.deepEqual(hits(textOf({ settings: info.settings, vocab: info.vocab, data: info.data, types: [d.relationTypes, d.conflictType, d.fallbackType, d.relationTypeRoles, d.vagueReasons] })), [])
            assert.ok(d.buildPrompt([], new Map()).startsWith('你是知識庫的關聯建立器'))
        })

        it('README、package.json 與原始碼(src/ 非評分者,另含套件根之 g.mjs 與 toolg/;不含測試;含註解、日誌與待判字樣)不含領域詞彙(具名例外除外)', () => {
            const files = sourceFiles().filter((f) => !f.startsWith('test/') && !f.startsWith('src/bench/'))
            assert.ok(files.includes('g.mjs') && files.some((f) => f.startsWith('toolg/')), '掃描須含 g.mjs 與 toolg/')
            assert.ok(files.length >= 40, `掃描量過少：${files.length}`)
            const bad = []
            for (const f of [...files, 'package.json', 'README.md']) {
                const h = hitsOfFile(f, readText(f))
                if (h.length) bad.push(`${f}：${h.join('、')}`)
            }
            assert.deepEqual(bad, [])
        })
    })

    // ═══════════════════════ ④ 舊名、沿革與面向使用者之字樣 ═══════════════════════
    describe('④ 舊名、沿革與面向使用者之字樣(README、package.json 與原始碼〔含 bench/*.mjs;不含測試〕;判準取抓取套件之 test/tools/historyMarks)', () => {
        // 舊名:已不存在之套件名與以 extract 指稱之名(下游處理時刻之記錄欄 extractedAt 屬資料契約,不在此列)
        const OLD = /w-knowledge-extract|KnowledgeExtract|extractOpt|\bextract\b|srcPack/
        // 執行端之指令名(命令列工具、子命令、旗標)——字樣一律指本套件之 API 與選項(opt.apply、opt.reason…);宿主之共通名取 HOST_CLI
        const CLI = new RegExp(`${HOST_CLI.source}|restore-edge|reeval-baseline|project --all|--apply|--reason=|--by=|--ruling=`)
        // 他工作之名:下游一律稱下游
        const OTHER_JOBS = /提煉/
        // 本套件較嚴之加項:裸寫之審查代稱、他模組之路徑
        const LINE = { old: OLD, extra: [['審查代稱', /審查 [AB]-|終審|收尾 A/], ['他模組路徑', /extract\/|data\/bench/], ['他工作', OTHER_JOBS], ['執行端之指令', CLI]] }
        const USER = { cli: CLI, otherJobs: OTHER_JOBS }
        const files = () => [...sourceFiles().filter((x) => !x.startsWith('test/')), 'package.json', 'README.md']
        // 題組(bench/cases/*.json)之說明文字(頂層 note 與各案之 why)亦掃:說明屬原始碼之一部分,不得帶沿革;材料與應然為題材,不掃
        const caseDocs = () => sourceFiles('.json').filter((x) => x.startsWith('src/bench/cases/')).flatMap((f) => benchCaseNotesOf(f, readText(f) || ''))

        it('判準自檢:舊名、沿革、指令名、他工作名、帳本代號被抓到;本套件之 API 與選項、記錄欄不誤傷;掃描範圍含題組檔之說明(note 與各案之 why,不含材料)', () => {
            const docs = caseDocs()
            assert.ok(docs.filter((d) => /#note$/.test(d.file)).length >= 4 && docs.filter((d) => /\.why$/.test(d.file)).length >= 40, `題組之說明須在掃描範圍:${docs.length}`)
            assert.deepEqual(benchCaseNotesOf('x.json', '{"note":"說明","cases":[{"id":"a","why":"理由","input":{"text":"此前之審查"},"expect":{"to":"盤查-42d9c6e3"}}]}'), [{ file: 'x.json#note', text: '說明' }, { file: 'x.json#a.why', text: '理由' }], '只取說明,不取材料與應然')
            const line = (s) => historyHitsOf(s, LINE)
            const user = (s) => userTextHitsOf(s, USER)
            assert.ok(OLD.test('const extractOpt = 1') && OLD.test('w-knowledge-extract') && OLD.test('srcPack/relate') && !OLD.test('extractedAt、changedTouchExtracted'), '舊名')
            assert.deepEqual([user('以 notes 工具 prune-dangling 清理'), user('standards holds --std RS5'), user('restore-edge --apply')], [['執行端之指令'], ['執行端之指令'], ['執行端之指令']])
            assert.deepEqual([user('提煉段自行偵測'), user('見 STD-06'), user('規則帳本')], [['他工作'], ['規則帳本代號'], ['規則帳本代號']])
            for (const s of ['確認後以 pruneDangling（opt.apply）清理', '可 restoreEdge 以 opt.reason（新理由）還原', 'prune-dangling', '下游之非對立判斷屬其自身脈絡']) assert.deepEqual(user(s), [], s)
            assert.deepEqual([line('// 審查 A-3 之結論'), line('// 收尾 A 改'), line('// 見 data/bench/x'), line('// 見 extract/core'), line('// 此前之作法'), line('// 以 --apply 套用')],
                [['帳本／審查代號', '審查代稱'], ['審查代稱'], ['他模組路徑'], ['舊名', '他模組路徑'], ['此前敘事'], ['執行端之指令']])
            assert.deepEqual(line("const at = '2026-10-05T10:00:00+08:00'"), [])
        })

        it('不含舊名、沿革指標、他工作與執行端之指令(逐行,含註解;題組檔之說明同判)', () => {
            const docs = [...files().map((f) => ({ file: f, text: readText(f) || '' })), ...caseDocs()]
            assert.ok(docs.length >= 40, `掃描量過少：${docs.length}`)
            assert.deepEqual(historyScanOf(docs, LINE), [])
        })

        it('面向使用者之字樣(原始碼之字串字面——日誌、訊息、拋錯、待判之原因與下一步——與 README)不含執行端之指令名、他工作名與帳本代號', () => {
            const src = files().filter((f) => f.endsWith('.mjs')).map((f) => ({ file: f, strings: lexSource(readText(f) || '').strings }))
            assert.ok(src.reduce((n, d) => n + d.strings.length, 0) >= 2000, '字串字面過少(掃描空洞)')
            assert.deepEqual(userTextScanOf([...src, { file: 'README.md', strings: [readText('README.md') || ''] }], USER), [])
        })
    })
})
