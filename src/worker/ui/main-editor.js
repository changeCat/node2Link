export const mainEditorStyles = `
 .main-section [hidden],.main-edit-dialog [hidden]{display:none!important}
 #content[hidden]{display:none!important}
 .main-scroll{max-height:480px;overflow:auto;overscroll-behavior:auto;scrollbar-gutter:stable;align-content:start}
 .node-heading{display:flex;align-items:flex-start;gap:8px}.node-heading>div{min-width:0;flex:1}.node-heading input{flex:none;margin:3px 0;accent-color:var(--green)}
 #originalSection>.editor-actions{justify-content:flex-start;margin:10px 0;gap:7px}
 #originalSection>.editor-actions .primary-button{margin-left:0}
 @media(max-width:760px){.main-scroll{max-height:360px}}
 .node-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:8px}
 .node-grid .main-node-row{display:block;border:1px solid var(--line-soft);border-radius:6px;padding:10px;min-width:0}
 .node-grid strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .node-grid .main-row-actions{margin-top:8px;gap:6px}.node-grid .tool-button{height:28px;padding:0 8px}
 .endpoint-input-row{display:grid;grid-template-columns:minmax(0,2fr) 90px minmax(0,1fr) auto;gap:8px;margin-bottom:10px;align-items:end}
 .endpoint-input-row label{display:flex;flex-direction:column;gap:6px;min-width:0}
 @media(max-width:600px){.endpoint-input-row{grid-template-columns:minmax(0,1fr) 85px}.endpoint-input-row label:nth-child(3){grid-column:1}.endpoint-input-row button{grid-column:2}}

 .main-section{padding:18px;border-top:1px solid var(--line)}
 .main-section h3{margin:0;font-size:15px}.main-section p,.main-help{color:var(--muted);font-size:12px;line-height:1.65}
 .main-section-head,.main-row-actions,.main-filter,.main-progress{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
 .main-section-head{justify-content:space-between;margin-bottom:10px}.main-filter{margin:10px 0}.main-progress{margin-top:10px;color:var(--muted);font-size:12px}
 .main-filter input{flex:1;min-width:120px}.main-filter select{max-width:100%}
 .main-section input,.main-section select,.main-edit-dialog input:not([type=checkbox]),.main-edit-dialog textarea{padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--text);font:inherit;min-width:0}
 .main-section input,.main-section select{font-size:12px}.main-node-row,.main-endpoint-row{display:flex;align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid var(--line-soft)}
 .main-node-row>div:first-child,.main-endpoint-row>div:first-child{flex:1;min-width:0}.main-node-row strong,.main-endpoint-row strong{font-size:12px;overflow-wrap:anywhere}
 .main-node-row small,.main-endpoint-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px/1.7 ui-monospace,monospace;color:var(--muted)}
 .main-endpoint-row{align-items:flex-start;flex-wrap:wrap}.main-endpoint-row p{margin:4px 0 0;overflow-wrap:anywhere}.main-empty{padding:12px 0}
 .main-badge{display:inline-block;padding:2px 6px;border-radius:4px;background:var(--green-soft);color:var(--green);font-size:10px;font-weight:500}
 .main-edit-dialog{width:min(720px,calc(100% - 28px));max-height:90vh}.main-edit-dialog .dialog-body{text-align:left;max-height:calc(90vh - 65px);overflow:auto}
 .main-edit-dialog label{font-size:13px}.main-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.main-field textarea{width:100%;min-height:100px;resize:vertical;font:12px/1.6 ui-monospace,monospace}
 .main-field-row{display:grid;grid-template-columns:120px 1fr;gap:12px}.main-targets{max-height:260px;overflow:auto;margin:10px 0;border:1px solid var(--line);border-radius:6px}
 .main-target{display:flex;gap:10px;padding:10px;border-bottom:1px solid var(--line-soft);cursor:pointer}.main-target input{flex-shrink:0}.main-target span{min-width:0}.main-target small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:10px}
 .main-error{color:var(--danger);font-size:12px;overflow-wrap:anywhere}.main-edit-dialog .dialog-actions{justify-content:flex-end;gap:8px}
 @media(max-width:760px){.main-section{padding:14px}.main-endpoint-row>div:first-child{flex-basis:100%}.main-edit-dialog .dialog-body{padding:14px}.main-field-row{grid-template-columns:90px minmax(0,1fr)}.main-row-actions{width:100%}.main-node-row .tool-button{padding:0 8px}.workspace-main .editor{height:190px;min-height:150px}}
`;

export function renderMainEditorSections() {
 return `<div class="main-section" id="originalSection">
  <div class="main-section-head"><h3>原始节点</h3></div>
<div class="editor-actions">
  <button id="addOriginals" class="primary-button" type="button">批量添加</button>
										<button class="tool-button" type="button" onclick="openDedupePreview()"><i data-lucide="list-checks"></i><span>去重</span></button>
										<button class="tool-button" id="undoButton" type="button" onclick="undoLastChange()" disabled><i data-lucide="undo-2"></i><span>撤销</span></button>
										<button class="tool-button" type="button" onclick="loadLastSavedVersion()"><i data-lucide="history"></i><span>上次版本</span></button>
										<button class="tool-button" type="button" onclick="downloadBackup()"><i data-lucide="download"></i><span>备份 JSON</span></button>
										<button class="tool-button" type="button" onclick="document.getElementById('restoreInput').click()"><i data-lucide="upload"></i><span>导入</span></button>
										<input id="restoreInput" type="file" accept=".json,.txt,.conf,.list,application/json,text/plain" hidden>
  <button id="exportOriginals" class="tool-button" type="button">导出原始 TXT</button>
										<button class="primary-button" id="saveButton" type="button" onclick="saveContent()" disabled><i data-lucide="save"></i><span>保存并生效</span></button>
									</div>
  <p>批量添加节点或订阅源；修改名称、参数或重置 UUID 请使用“编辑”，保留已有优选关联。</p>
  <div class="main-filter"><input id="originalSearch" type="search" aria-label="搜索原始节点" placeholder="搜索原始节点"></div>
  <div class="main-filter"><button id="selectOriginals" class="tool-button" type="button" aria-pressed="false">全选筛选结果</button><span id="originalSelectionCount" class="main-help" role="status">已选 0 项</span><button id="deleteOriginals" class="tool-button" type="button" disabled>删除所选</button></div>
  <div id="originalList" class="node-grid main-scroll" tabindex="0" aria-label="原始节点列表"></div><div class="main-progress"><span id="originalProgress"></span><button id="moreOriginals" class="tool-button" type="button" hidden>显示更多</button></div>
 </div>
 <div class="main-section">
  <div class="main-section-head"><h3>优选域名 / IP 与端口</h3><button id="addEndpoint" class="primary-button" type="button">添加优选地址</button></div>
  <p>填写优选地址，并勾选要扩展的原始节点。协议适用性由你确认；生成时仅替换连接地址、端口及名称，保留 Host、SNI、路径等其他参数。</p>
  <div id="endpointList" class="main-scroll" tabindex="0" aria-label="优选地址列表"></div><div class="main-progress"><span id="endpointProgress"></span><button id="moreEndpoints" class="tool-button" type="button" hidden>显示更多</button></div>
 </div>
 <div class="main-section">
  <div class="main-section-head"><h3>生成结果预览</h3><div class="main-row-actions"><button id="exportExtensions" class="tool-button" type="button">导出扩展 TXT</button><button id="exportMain" class="tool-button" type="button">导出全部 TXT</button><button class="primary-button" type="button" onclick="saveContent()">保存并生效</button></div></div>
  <p id="mainPreviewNote" role="status"></p>
  <div class="main-filter"><input id="previewSearch" type="search" aria-label="搜索生成结果" placeholder="搜索节点名称或内容"><select id="previewKind" aria-label="结果类型"><option value="all">原始与扩展</option><option value="original">仅原始</option><option value="extension" selected>仅扩展</option></select></div>
  <div id="mainPreview" class="node-grid main-scroll" tabindex="0" aria-label="生成节点列表"></div><div class="main-progress"><span id="previewProgress"></span><button id="morePreview" class="tool-button" type="button" hidden>显示更多</button></div>
 </div>`;
}

export function renderMainEditorDialogs() {
 return `<dialog id="batchDialog" class="main-edit-dialog" aria-labelledby="batchTitle"><div class="dialog-head"><strong id="batchTitle">批量添加原始节点</strong><button id="closeBatch" type="button" class="icon-button" aria-label="关闭">×</button></div><form id="batchForm" class="dialog-body"><div class="main-field"><label for="batchValue">节点 / 订阅源（每行一条）</label><textarea id="batchValue" spellcheck="false" placeholder="vless://...&#10;https://example.com/sub"></textarea></div><p class="main-help">追加和覆盖都必须填写节点。删除节点请使用列表中的删除操作。追加保留当前节点。覆盖仅保留完全相同链接的关联，移除其他旧节点及其关联；修改现有节点请使用列表中的“编辑”。应用后可撤销，保存并生效后发布。</p><p id="batchError" class="main-error" role="alert"></p><div class="dialog-actions"><button type="submit" value="replace" class="tool-button">覆盖列表</button><button type="submit" value="append" class="primary-button">追加到列表</button></div></form></dialog>
 <dialog id="nodeViewDialog" class="main-edit-dialog" aria-labelledby="nodeViewTitle"><div class="dialog-head"><strong id="nodeViewTitle">完整链接</strong><button id="closeNodeView" type="button" class="icon-button" aria-label="关闭">×</button></div><div class="dialog-body"><div class="main-field"><label for="nodeViewValue">完整链接</label><textarea id="nodeViewValue" readonly spellcheck="false"></textarea></div><div class="dialog-actions"><button id="copyNodeView" class="primary-button" type="button">复制链接</button></div></div></dialog>
 <dialog id="endpointDialog" class="main-edit-dialog" aria-labelledby="endpointTitle">
  <div class="dialog-head"><strong id="endpointTitle">添加优选地址</strong><button id="closeEndpoint" class="icon-button" type="button" aria-label="关闭">×</button></div>
  <form id="endpointForm" class="dialog-body">
   <div id="endpointRows"></div><button id="addEndpointRow" class="tool-button" type="button">再加一行</button><datalist id="endpointPorts"></datalist>
   <p class="main-help">每个地址分别填写端口与备注，以下关联节点应用到本次所有地址。备注不填则使用地址和端口。</p>
   <label><input id="endpointEnabled" type="checkbox" checked> 启用此优选地址</label>
   <p class="main-help">选择要应用的原始节点。这里只生成链接，不进行协议适用性判断或测速。</p>
   <div class="main-filter"><input id="targetSearch" type="search" aria-label="搜索关联节点" placeholder="搜索原始节点"><button id="selectTargets" type="button" class="tool-button">选择筛选结果</button><button id="clearTargets" type="button" class="tool-button">清空选择</button></div>
   <div id="endpointTargets" class="main-targets"></div><div class="main-progress"><span id="targetCount"></span><button id="moreTargets" type="button" class="tool-button" hidden>显示更多</button></div>
   <p id="endpointError" class="main-error" role="alert"></p><div class="dialog-actions"><button id="cancelEndpoint" class="tool-button" type="button">取消</button><button class="primary-button" type="submit">应用到编辑区</button></div><p class="main-help">应用后，点击主页面“保存并生效”发布全部更改。</p>
  </form>
 </dialog>
 <dialog id="originalDialog" class="main-edit-dialog" aria-labelledby="originalTitle"><div class="dialog-head"><strong id="originalTitle">编辑原始节点</strong><button id="closeOriginal" type="button" class="icon-button" aria-label="关闭">×</button></div><form id="originalForm" class="dialog-body"><div class="main-field"><label for="originalValue">完整链接</label><textarea id="originalValue" spellcheck="false" required></textarea><small class="main-help">修改连接信息、密码或名称后，原有优选地址关联仍然保留。</small></div><p id="originalError" class="main-error" role="alert"></p><div class="dialog-actions"><button id="cancelOriginal" type="button" class="tool-button">取消</button><button type="submit" class="primary-button">应用修改</button></div></form></dialog>`;
}
