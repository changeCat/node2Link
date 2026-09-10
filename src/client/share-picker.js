const pageData = JSON.parse(document.getElementById('page-data-share-picker').textContent);
(function () {
			var availableNodes = pageData.availableNodes;
			var selectedIds = new Set();
			var candidatesLoaded = false;
			var dialog = document.getElementById('nodePickerDialog');
			var pickerList = document.getElementById('nodePickerList');
			var searchInput = document.getElementById('nodeSearch');
			var sourceSelect = document.getElementById('nodeSource');
			function pickerEscape(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
			function visibleNodes() {
				var query = searchInput.value.trim().toLowerCase();
				var source = sourceSelect.value;
				return availableNodes.filter(function (node) {
					return (source === 'all' || node.source === source) && (!query || (node.name + '\n' + node.content).toLowerCase().includes(query));
				});
			}
			function updateSelectedCount() {
				document.getElementById('selectedNodeCount').textContent = '已选择 ' + selectedIds.size + ' 个';
				document.getElementById('addSelectedNodes').disabled = !selectedIds.size;
			}
			function renderPicker() {
				var visible = visibleNodes();
				pickerList.innerHTML = visible.length ? visible.map(function (node) {
					return '<label class="picker-node"><input type="checkbox" data-node-id="' + pickerEscape(node.id) + '"' + (selectedIds.has(node.id) ? ' checked' : '') + '><span><strong>' + pickerEscape(node.name) + '<span class="source-tag">' + pickerEscape(node.sourceName) + '</span></strong><small title="' + pickerEscape(node.content) + '">' + pickerEscape(node.content) + '</small></span></label>';
				}).join('') : '<div class="picker-empty">没有符合条件的节点</div>';
				updateSelectedCount();
			}
			function closePicker() { dialog.close(); }
			function loadCandidates() {
				if (candidatesLoaded) { renderPicker(); return Promise.resolve(); }
				pickerList.innerHTML = '<div class="picker-empty">正在汇总' + pageData.sourceLabel + '节点…</div>';
				return fetch('/api/node-candidates', { cache: 'no-store' }).then(function (response) {
					return response.json().then(function (data) { if (!response.ok) throw new Error(data.message || '读取节点失败'); return data; });
				}).then(function (data) {
					availableNodes = data.nodes;
					candidatesLoaded = true;
					renderPicker();
				}).catch(function (error) {
					renderPicker();
					pickerList.insertAdjacentHTML('afterbegin', '<div class="message">' + pickerEscape(error.message) + '，已显示本地节点。</div>');
				});
			}
			document.getElementById('openNodePicker').addEventListener('click', function () {
				selectedIds.clear();
				searchInput.value = '';
				sourceSelect.value = 'all';
				dialog.showModal();
				searchInput.focus();
				loadCandidates();
			});
			searchInput.addEventListener('input', renderPicker);
			sourceSelect.addEventListener('change', renderPicker);
			pickerList.addEventListener('change', function (event) {
				var checkbox = event.target.closest('[data-node-id]');
				if (!checkbox) return;
				if (checkbox.checked) selectedIds.add(checkbox.dataset.nodeId); else selectedIds.delete(checkbox.dataset.nodeId);
				updateSelectedCount();
			});
			document.getElementById('selectVisibleNodes').addEventListener('click', function () {
				visibleNodes().forEach(function (node) { selectedIds.add(node.id); });
				renderPicker();
			});
			document.getElementById('addSelectedNodes').addEventListener('click', function () {
				var textarea = document.getElementById('shareContent');
				var current = textarea.value.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
				var seen = new Set(current);
				var added = 0;
				availableNodes.forEach(function (node) {
					if (selectedIds.has(node.id) && !seen.has(node.content)) { current.push(node.content); seen.add(node.content); added += 1; }
				});
				textarea.value = current.join('\n');
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
				closePicker();
				document.getElementById('formMessage').textContent = added ? '已加入 ' + added + ' 个节点，尚未保存' : '所选节点已在内容中';
				document.getElementById('formMessage').className = added ? 'success' : 'muted';
			});
			document.getElementById('closeNodePicker').addEventListener('click', closePicker);
			document.getElementById('cancelNodePicker').addEventListener('click', closePicker);
			dialog.addEventListener('click', function (event) { if (event.target === dialog) closePicker(); });
			updateSelectedCount();
		})();
