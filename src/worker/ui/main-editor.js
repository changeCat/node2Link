import { subscriptionCardStyles } from './subscription-cards.js';

export const mainEditorStyles = `
 .editor-overview{border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden;margin-bottom:18px}
 .main-workspace{border:1px solid var(--line);border-radius:10px;background:var(--surface);box-shadow:0 6px 24px rgba(26,46,35,.035);overflow:hidden}
 .main-workspace+.main-workspace{margin-top:20px}
 #originalSection.main-workspace{border:1px solid var(--line);padding:20px}
 .main-workspace-title{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
 .main-workspace-title h3,#originalSection h3{font-size:18px}
 .main-scope-badge{font-size:11px;font-weight:500;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:3px 7px;background:var(--surface-soft)}
 .preferred-toolbar{background:var(--surface);padding:20px;border-bottom:1px solid var(--line);align-items:center}
 .preferred-toolbar h3{margin:0;font-size:18px}.preferred-toolbar p{margin:7px 0 0;max-width:70ch}
 .preferred-save-actions{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:10px}
 .preferred-save-actions .save-state{font-size:12px}
 .preferred-sections{display:grid;gap:20px;padding:20px;background:#eef2ee}
 .preferred-sections>.main-section{border:1px solid #cbd8d0;border-radius:8px;background:var(--surface);padding:18px;overflow:hidden}
 .preferred-sections .main-section-head{flex-direction:row;align-items:center;gap:12px 20px;margin:-18px -18px 16px;padding:15px 18px;border-bottom:1px solid #d7e2da;background:#f0f6f2;border-left:3px solid var(--green)}
 .preview-heading-tools{display:flex;align-items:center;flex-wrap:wrap;gap:10px 18px;flex-basis:100%;min-width:0}
 .main-section-heading{flex:1 1 100%;min-width:0;display:grid;gap:6px}
 .preferred-sections .main-section-heading p{max-width:none;overflow-wrap:anywhere}
 .preferred-sections .main-section-head>.main-action-group{flex:1 1 100%;margin-left:auto;max-width:100%}
 .preferred-sections h4{display:flex;align-items:center;gap:8px;margin:0;font-size:15px}
 .preferred-sections h4 svg{width:16px;height:16px;color:var(--green);flex:none}
 @media(max-width:760px){#originalSection.main-workspace,.preferred-toolbar{padding:14px}.preferred-sections{padding:10px;gap:10px}.preferred-sections>.main-section{padding:14px}.preferred-sections .main-section-head{margin:-14px -14px 14px;padding:13px 14px}.preferred-save-actions{width:100%}}
 .main-section [hidden],.main-edit-dialog [hidden]{display:none!important}
 #content[hidden]{display:none!important}
 .main-scroll{max-height:480px;overflow:auto;overscroll-behavior:auto;scrollbar-gutter:stable;align-content:start}
 .main-section>.editor-actions{justify-content:flex-end;gap:10px 18px;margin:14px 0}
 .main-section>.editor-actions .primary-button{margin-left:0}
 .main-action-group,.main-selection{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:7px}
 .main-action-group+.main-action-group{border-left:1px solid var(--line);padding-left:18px}
 .main-section-head p{margin:0;max-width:90ch}
 .editor-toolbar>.primary-button{margin-left:auto;flex-shrink:0}
 .original-management-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:10px 18px;max-width:100%}
 .original-filter-controls{display:flex;align-items:center;gap:10px;flex:1 1 540px;min-width:0;margin-right:auto}
 .original-filter-controls>.main-toolbar-search{flex:1 1 200px;width:200px;max-width:260px}
 .original-filter-controls>.main-selection{flex:none;flex-wrap:nowrap;justify-content:flex-start}
 .main-section .main-toolbar-filters{flex:1 1 330px;justify-content:flex-start;margin:0 auto 0 0}
 .main-section .main-toolbar-filters>input{flex:0 1 240px;width:240px;max-width:100%}
 .main-section .main-filter{justify-content:flex-start;gap:10px}
 .endpoint-port-field{display:flex;flex-direction:column;gap:6px;min-width:0}
 .endpoint-port-field select,.endpoint-port-field input{width:100%}
 @media(max-width:760px){.original-filter-controls{flex-wrap:wrap;flex-basis:100%}.original-filter-controls>.main-toolbar-search{flex-basis:100%;width:100%;max-width:100%}.original-filter-controls>.main-selection{flex-wrap:wrap}.main-section .main-toolbar-filters>input{flex:1 1 160px}.main-toolbar-filters{max-width:100%}}
 @media(max-width:760px){.main-action-group{flex-basis:100%}.main-action-group+.main-action-group{border-left:0;padding-left:0}.main-selection{width:100%}}
 @media(max-width:760px){.main-scroll{max-height:360px}}
 .endpoint-input-row{display:grid;grid-template-columns:minmax(0,2fr) 105px minmax(0,1fr) auto;gap:8px;margin-bottom:10px;align-items:start}
 .endpoint-input-row>button{align-self:end}
 .endpoint-input-row label{display:flex;flex-direction:column;gap:6px;min-width:0}
 @media(max-width:600px){.endpoint-input-row{grid-template-columns:minmax(0,1fr) 105px}.endpoint-input-row label:nth-child(3){grid-column:1}.endpoint-input-row button{grid-column:2}}

 .main-section{padding:18px;border-top:1px solid var(--line)}
 .main-section h3{margin:0;font-size:15px}.main-section p,.main-help{color:var(--muted);font-size:12px;line-height:1.65}
 .main-section-head,.main-row-actions,.main-filter,.main-progress{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
 .main-section-head{flex-direction:column;align-items:flex-start;gap:6px;margin-bottom:10px}.main-filter{margin:10px 0}.main-progress{margin-top:10px;color:var(--muted);font-size:12px}
 .main-section .main-row-actions{justify-content:flex-end}
 .main-section .main-progress>button{margin-left:auto}
 .main-section .main-row-actions>.main-badge{margin-right:auto}
 .main-filter input{flex:1;min-width:120px}.main-filter select{width:auto;max-width:100%}
 .main-section input,.main-section select,.main-edit-dialog input:not([type=checkbox]),.main-edit-dialog select,.main-edit-dialog textarea{padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--text);font:inherit;min-width:0}
 .main-section input,.main-section select{font-size:12px}
 .main-empty{padding:12px 0}
 .main-badge{display:inline-block;padding:2px 6px;border-radius:4px;background:var(--green-soft);color:var(--green);font-size:10px;font-weight:500}
 .main-edit-dialog{width:min(720px,calc(100% - 28px));max-height:90vh}.main-edit-dialog .dialog-body{text-align:left;max-height:calc(90vh - 65px);overflow:auto}
 .main-edit-dialog label{font-size:13px}.main-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.main-field textarea{width:100%;min-height:100px;resize:vertical;font:12px/1.6 ui-monospace,monospace}
 .main-field-row{display:grid;grid-template-columns:120px 1fr;gap:12px}.main-targets{max-height:260px;overflow:auto;margin:10px 0;border:1px solid var(--line);border-radius:6px}
 .main-target{display:flex;gap:10px;padding:10px;border-bottom:1px solid var(--line-soft);cursor:pointer}.main-target input{flex-shrink:0}.main-target span{min-width:0}.main-target small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:10px}
 .main-error{color:var(--danger);font-size:12px;overflow-wrap:anywhere}.main-edit-dialog .dialog-actions{justify-content:flex-end;gap:8px}
 @media(max-width:760px){.main-section{padding:14px}.main-edit-dialog .dialog-body{padding:14px}.main-field-row{grid-template-columns:90px minmax(0,1fr)}.main-row-actions{width:100%}.main-node-row .tool-button{padding:0 8px}.workspace-main .editor{height:190px;min-height:150px}}
 .card-sort-handle{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:24px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--muted);cursor:grab;touch-action:none}
 .card-sort-handle svg{width:14px;height:18px;pointer-events:none}.card-sort-handle:hover,.card-sort-handle:focus-visible{background:var(--green-soft);color:var(--green)}
 .is-sorting{opacity:.5}.is-sorting .card-sort-handle{cursor:grabbing}.subscription-card.sort-before{box-shadow:inset 3px 0 var(--green)}.subscription-card.sort-after{box-shadow:inset -3px 0 var(--green)}
 ${subscriptionCardStyles}
`;

export function renderMainEditorSections() {
 return `<section class="main-section main-workspace" id="originalSection" aria-labelledby="originalSectionTitle">
  <div class="main-section-head"><div class="main-workspace-title"><h3 id="originalSectionTitle">原始节点</h3><span class="main-scope-badge">即时保存</span></div><p>追加、覆盖、编辑及删除后立即保存并生效。修改名称、参数或 UUID 请用“编辑”，已生效的关联扩展节点会同步更新。拖动左侧手柄调整展示顺序，仅在当前浏览器保留。</p></div>
  <div class="editor-actions">
   <div class="original-filter-controls"><input id="originalSearch" class="main-toolbar-search" type="search" aria-label="搜索原始节点" placeholder="搜索原始节点">
    <div class="main-selection"><button id="selectOriginals" class="tool-button" type="button" aria-pressed="false">全选筛选结果</button><span id="originalSelectionCount" class="main-help" role="status">已选 0 项</span><button id="deleteOriginals" class="tool-button" type="button" disabled>删除所选</button></div>
   </div>
   <div class="original-management-actions">
   <div class="main-action-group" role="group" aria-label="整理与恢复">
    <button class="tool-button" type="button" onclick="openDedupePreview()"><i data-lucide="list-checks"></i><span>去重</span></button>
    <button class="tool-button" type="button" onclick="openOriginalHistory()"><i data-lucide="history"></i><span>历史版本</span></button>
   </div>
   <div class="main-action-group" role="group" aria-label="导入与导出">
    <button class="tool-button" type="button" onclick="document.getElementById('restoreInput').click()"><i data-lucide="arrow-down-to-line"></i><span>导入 TXT</span></button>
    <button id="exportOriginals" class="tool-button" type="button"><i data-lucide="arrow-up-from-line" aria-hidden="true"></i><span>导出原始 TXT</span></button>
   </div>
   <div class="main-action-group" role="group" aria-label="添加节点">
    <button id="addOriginals" class="tool-button" type="button"><i data-lucide="plus"></i><span>批量添加</span></button>
   </div>
   </div>
   <input id="restoreInput" type="file" accept=".txt,text/plain" hidden>
  </div>
  <div id="originalList" class="node-grid main-scroll subscription-card-grid" tabindex="0" aria-label="原始节点列表"></div><div class="main-progress"><span id="originalProgress"></span><button id="moreOriginals" class="tool-button" type="button" hidden>显示更多</button></div>
 </section>
 <section class="main-workspace preferred-workspace" aria-labelledby="preferredSectionTitle">
  <div class="editor-toolbar preferred-toolbar"><div><div class="main-workspace-title"><h3 id="preferredSectionTitle">优选配置与生成结果</h3><span class="main-scope-badge">统一保存</span></div><p class="main-help">配置优选地址与原始节点的关联，预览后统一发布扩展节点。</p></div><div class="preferred-save-actions"><span id="saveStatus" class="save-state" role="status">已同步</span><button class="primary-button" id="saveButton" data-save-main type="button" onclick="saveContent()" title="保存全部优选地址与关联并更新扩展节点" disabled><i data-lucide="save"></i><span>保存全部并生效</span></button></div></div>
 <div class="preferred-sections">
 <section class="main-section" id="endpointSection" aria-labelledby="endpointSectionTitle">
  <div class="main-section-head"><div class="main-section-heading"><h4 id="endpointSectionTitle"><i data-lucide="settings" aria-hidden="true"></i>优选域名 / IP 与端口</h4><p>添加地址并勾选要扩展的原始节点，保存后生效。仅替换连接地址、端口和名称，保留 Host、SNI、路径等参数；协议适用性需自行确认。</p></div><div class="main-action-group"><button id="addEndpoint" class="tool-button" type="button"><i data-lucide="plus"></i><span>添加优选地址</span></button></div></div>
  <div id="endpointList" class="node-grid main-scroll subscription-card-grid" tabindex="0" aria-label="优选地址列表"></div><div class="main-progress"><span id="endpointProgress"></span><button id="moreEndpoints" class="tool-button" type="button" hidden>显示更多</button></div>
 </section>
 <section class="main-section" id="previewSection" aria-labelledby="previewSectionTitle">
  <div class="main-section-head"><div class="main-section-heading"><h4 id="previewSectionTitle"><i data-lucide="layers-3" aria-hidden="true"></i>生成结果预览</h4><p id="mainPreviewNote" role="status"></p></div><div class="preview-heading-tools"><div class="main-filter main-toolbar-filters"><input id="previewSearch" type="search" aria-label="搜索生成结果" placeholder="搜索节点名称或内容"><select id="previewKind" aria-label="结果类型"><option value="all">原始与扩展</option><option value="original">仅原始</option><option value="extension" selected>仅扩展</option></select></div><div class="main-action-group" role="group" aria-label="导出生成结果"><button id="exportExtensions" class="tool-button" type="button"><i data-lucide="arrow-up-from-line" aria-hidden="true"></i><span>导出扩展 TXT</span></button><button id="exportMain" class="tool-button" type="button"><i data-lucide="arrow-up-from-line" aria-hidden="true"></i><span>导出全部 TXT</span></button></div></div></div>

  <div id="mainPreview" class="node-grid main-scroll subscription-card-grid" tabindex="0" aria-label="生成节点列表"></div><div class="main-progress"><span id="previewProgress"></span><button id="morePreview" class="tool-button" type="button" hidden>显示更多</button></div>
 </section></div></section>`;
}

export function renderMainEditorDialogs() {
 return `<dialog id="batchDialog" class="main-edit-dialog" aria-labelledby="batchTitle"><div class="dialog-head"><strong id="batchTitle">批量添加原始节点</strong><button id="closeBatch" type="button" class="icon-button" aria-label="关闭">×</button></div><form id="batchForm" class="dialog-body"><div class="main-field"><label for="batchValue">节点 / 订阅源（每行一条）</label><textarea id="batchValue" spellcheck="false" placeholder="vless://...&#10;https://example.com/sub"></textarea></div><p class="main-help">追加和覆盖都必须填写节点。删除节点请使用列表中的删除操作。追加保留当前节点。覆盖仅保留完全相同链接的关联，移除其他旧节点及其关联；修改现有节点请使用列表中的“编辑”。追加或覆盖后立即保存并更新订阅，可在历史版本中查看和还原原始节点。</p><p id="batchError" class="main-error" role="alert"></p><div class="dialog-actions"><button type="submit" value="replace" class="tool-button">覆盖并生效</button><button type="submit" value="append" class="primary-button">追加并生效</button></div></form></dialog>
 <dialog id="nodeViewDialog" class="main-edit-dialog" aria-labelledby="nodeViewTitle"><div class="dialog-head"><strong id="nodeViewTitle">完整链接</strong><button id="closeNodeView" type="button" class="icon-button" aria-label="关闭">×</button></div><div class="dialog-body"><div class="main-field"><label for="nodeViewValue">完整链接</label><textarea id="nodeViewValue" readonly spellcheck="false"></textarea></div><div class="dialog-actions"><button id="copyNodeView" class="primary-button" type="button">复制链接</button></div></div></dialog>
 <dialog id="endpointDialog" class="main-edit-dialog" aria-labelledby="endpointTitle">
  <div class="dialog-head"><strong id="endpointTitle">添加优选地址</strong><button id="closeEndpoint" class="icon-button" type="button" aria-label="关闭">×</button></div>
  <form id="endpointForm" class="dialog-body">
   <div id="endpointRows"></div><button id="addEndpointRow" class="tool-button" type="button">再加一行</button>
   <p class="main-help">每个地址分别填写端口与备注，以下关联节点应用到本次所有地址。端口可从 Cloudflare 的 HTTP / HTTPS 列表选择，或填写自定义端口。备注不填则使用地址和端口。</p>
   <label><input id="endpointEnabled" type="checkbox" checked> 启用此优选地址</label>
   <p class="main-help">选择要应用的原始节点。这里只生成链接，不进行协议适用性判断或测速。</p>
   <div class="main-filter"><input id="targetSearch" type="search" aria-label="搜索关联节点" placeholder="搜索原始节点"><button id="selectTargets" type="button" class="tool-button">选择筛选结果</button><button id="clearTargets" type="button" class="tool-button">清空选择</button></div>
   <div id="endpointTargets" class="main-targets"></div><div class="main-progress"><span id="targetCount"></span><button id="moreTargets" type="button" class="tool-button" hidden>显示更多</button></div>
   <p id="endpointError" class="main-error" role="alert"></p><div class="dialog-actions"><button id="cancelEndpoint" class="tool-button" type="button">取消</button><button class="primary-button" type="submit">应用到编辑区</button></div><p class="main-help">应用仅更新优选编辑区；点击本区域顶部“保存全部并生效”后发布扩展节点。</p>
  </form>
 </dialog>
 <dialog id="originalHistoryDialog" class="main-edit-dialog" aria-labelledby="originalHistoryTitle"><div class="dialog-head"><strong id="originalHistoryTitle">原始节点历史版本</strong><button id="closeOriginalHistory" type="button" class="icon-button" aria-label="关闭">×</button></div><div class="dialog-body"><p id="originalHistoryHelp" class="main-help"></p><div class="main-field"><label for="originalHistorySelect">保存版本</label><select id="originalHistorySelect"></select></div><p id="originalHistoryMessage" class="main-help" role="status"></p><div class="main-field"><label for="originalHistoryContent">原始节点明细（每行一条完整链接）</label><textarea id="originalHistoryContent" readonly spellcheck="false" style="min-height:220px"></textarea></div><p class="main-help">还原后原始节点立即生效，保留当前优选配置并清理失效关联。已删除的关联不会随节点还原；还原操作也会记录为新版本。</p><div class="dialog-actions"><button id="downloadOriginalVersion" type="button" class="tool-button" disabled>下载 TXT</button><button id="restoreOriginalVersion" type="button" class="primary-button" disabled>还原此版本</button></div></div></dialog>
 <dialog id="originalDialog" class="main-edit-dialog" aria-labelledby="originalTitle"><div class="dialog-head"><strong id="originalTitle">编辑原始节点</strong><button id="closeOriginal" type="button" class="icon-button" aria-label="关闭">×</button></div><form id="originalForm" class="dialog-body"><div class="main-field"><label for="originalValue">完整链接</label><textarea id="originalValue" spellcheck="false" required></textarea><small class="main-help">应用修改后立即保存。原有优选关联保留，已生效的扩展节点同步更新。</small></div><p id="originalError" class="main-error" role="alert"></p><div class="dialog-actions"><button id="cancelOriginal" type="button" class="tool-button">取消</button><button type="submit" class="primary-button">应用修改</button></div></form></dialog>`;
}
