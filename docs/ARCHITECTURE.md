# 電路模擬軟體 架構與模組

> 不清楚某檔案職責或要新增模組時讀本檔。

## 指令
| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器（http://localhost:5173） |
| `npm test` | 自動測試（Vitest，不到 1 秒） |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run build` | 型別檢查後打包成單一檔案 `dist/index.html` |

## 環境注意事項
- Node.js 裝在 `C:\Program Files\nodejs`。安裝前就開著的終端機可能找不到 `node`，重開終端機即可；Claude Code 的 PowerShell 要先重新載入 PATH：
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- 專案放在 SynologyDrive，`node_modules/` 約 1,200 個檔案、71 MB。如果同步變慢，可以到 Synology Drive Client 的同步設定排除；排除後換電腦要重跑 `npm install`。
- 版本控管：git，分支 `main`，遠端 `https://github.com/chihfuhsiao/circuit-lab`（公開）。這個 repo 的 `user.email` 設成 GitHub 隱藏信箱 `340008124+chihfuhsiao@users.noreply.github.com`（只設在 repo 內，不影響其他專案）。推送由使用者在 GitHub Desktop 按 `Push origin`；這個 git 沒有 GitHub 登入資訊，不要從命令列 `git push`。`git` 不在 PATH，用 GitHub Desktop 內附的 `%LOCALAPPDATA%\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe`（版本號會隨 GitHub Desktop 更新而變）；也可用 GitHub Desktop 開啟這個資料夾看歷史。GitHub Desktop 的 git 預設 `core.autocrlf=true`，這個 repo 設成 `false`，檔案一律維持 LF。
- Synology Drive 的同步設定排除了 `.` 開頭的檔案（`blacklist.filter` 的 `black_prefix = "."`），所以 `.git/`、`.gitignore`、`.claude/` **不會同步，也不會備份到 NAS**，只在電腦 PC-D018 上。好處是多台電腦不會同時改到 `.git` 造成損毀；版本歷史的備份靠 GitHub，所以要記得推送。換到另一台電腦時，SynologyDrive 裡的原始碼沒有 `.git/`，不要在那裡開 repo：用 GitHub Desktop 的 `Clone repository` 放到 SynologyDrive 以外的資料夾，clone 後設定 `core.autocrlf=false` 和上述 `user.email`，並重跑 `npm install`。
- 開發模式下瀏覽器主控台可用 `__app`、`__stage`、`__examples` 檢查狀態（正式版不含）。瀏覽器窗格隱藏時 `requestAnimationFrame` 不會跑，測試時用 `__app.tick(0.016)` 手動推進；截圖可能比實際狀態慢一拍，先等 1 秒再截。

## 資料流
使用者操作 → 修改 `CircuitDoc` → `App.commit()`（記入復原、自動存檔）→ `compile()` 產生新的 `Simulator`（保留電容電壓、正反器狀態）→ 每幀 `App.tick()` 步進 → 畫面讀取結果。

**沒有差異更新**：任何修改都重新編譯，由 `Device.saveState/loadState` 延續狀態。電路規模小，編譯只要幾毫秒。

## 模擬引擎 `src/engine/`（不依賴畫面）
| 檔案 | 職責 |
|---|---|
| `sim.ts` | `Simulator`：組裝矩陣、牛頓法、LU 分解（矩陣沒變就沿用）、時間步進。`Device` 基底類別 |
| `analog.ts` | 電阻、開關、可變電阻、電容、電感、電源、二極體／LED／齊納、BJT、MOSFET、運算放大器、三用電錶 |
| `digital.ts` | `Chip`（通用邏輯元件）、各種閘與正反器、74 系列、555、`Composite` |

- 積分：平常用梯形法，數位狀態或開關改變後的下一步用後向尤拉法（避免振鈴）。
- 電源內阻 1 mΩ：短路與電源並聯不會造成奇異矩陣，電流大到可以被偵測。
- 步長固定 = 模擬速度 ÷ 1000（`STEPS_PER_SEC`）。
- 數位輸出是「接到 VCC 或 GND 的電阻」，輸入在每步結束讀取、輸出 1～2 步後才翻轉，所以不會造成不收斂，也不會有永遠的競跑。

## 電路模型 `src/circuit/`（不依賴畫面）
| 檔案 | 職責 |
|---|---|
| `types.ts` | `CircuitDoc`：共用的元件清單＋兩個畫面各自的接線 |
| `catalog.ts` | **新增元件從這裡開始**：名稱、腳位、參數、麵包板外型、如何建立引擎元件 |
| `breadboard.ts` | 麵包板幾何與導通規則 |
| `topology.ts` | 把兩種畫面的接線轉成同一種結構，算出 net |
| `compile.ts` | 文件 → `Simulator`；導線電流的分配（生成樹） |
| `diagnostics.ts` | 把問題翻譯成學生聽得懂的話 |
| `compare.ts` | 麵包板對照電路圖 |
| `doc.ts` | 新增元件、編號、存檔格式 |
| `format.ts` | 工程記號解析與顯示、電阻色碼 |

## 畫面 `src/view/`（Canvas）
| 檔案 | 職責 |
|---|---|
| `common.ts` | 格點、攝影機、電壓配色、電流動畫、`EditorView` 介面 |
| `symbols.ts` | **新增元件的電路圖符號**；沒定義的元件自動用 IC 方塊 |
| `schematic.ts` | 電路圖編輯器 |
| `bbparts.ts` | **新增元件的麵包板外觀** |
| `breadboard.ts` | 麵包板編輯器 |

## 介面 `src/ui/`（不用框架）
| 檔案 | 職責 |
|---|---|
| `chrome.ts` | 視窗外框：標題列與功能表內容、工具列、畫面分頁、提醒、狀態列 |
| `menu.ts` | 功能表列的行為（點開、滑過切換、方向鍵、Esc） |
| `icons.ts` | **新增圖示**：16×16 的內嵌線條圖 |
| `theme.ts` | 深色／淺色主題，記在瀏覽器 |
| `tip.ts` | 工具提示：元素加 `data-tip`、`data-key` 就有 |
| `split.ts` | 可拖曳的面板分隔線，大小記在瀏覽器 |
| `dialogs.ts` | 對照電路圖、使用說明、關於 |
| `dom.ts` | DOM 工具、對話框、toast |
| `stage.ts` | 畫布與主迴圈 |
| `palette.ts` | 元件庫與搜尋 |
| `inspector.ts` | 屬性 |
| `scope.ts` | 示波器 |
| `side.ts` | 右側分頁、範例、實驗面板 |
| `file.ts` | 存檔、分享 |

組裝在 `src/main.ts`，全域狀態在 `src/app.ts`。

配色分兩處：介面用 `src/style.css` 開頭的 CSS 變數；畫布用 `src/view/common.ts` 的 `INK`、`PAPER`、`SELECT` 等（`export let`，切換主題後下一幀就讀到新值）。麵包板本身是白色的，上面的元件顏色固定，寫在 `src/view/bbparts.ts`。

## 教學內容 `src/content/`
| 檔案 | 職責 |
|---|---|
| `builder.ts` | 用程式描述電路的小工具 |
| `examples.ts` | 內建範例 |
| `experiments.ts` | 引導實驗：步驟、自動檢查、問答、參考電路 |

新增範例或實驗後 `tests/content.test.ts` 會自動涵蓋：接線完整、不出錯、解答通過檢查。實驗步驟標 `final: true` 表示解答電路要能通過。

## 測試 `tests/`
`engine.test.ts`（課本算得出答案的電路）、`circuit.test.ts`（接線、麵包板、對照、存檔）、`content.test.ts`（範例與實驗）。
