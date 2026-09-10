const pageData = JSON.parse(document.getElementById('page-data-share-confirm').textContent);
(function () {
			var promptDialog = document.createElement('dialog');
			promptDialog.className = 'share-prompt';
			promptDialog.innerHTML = '<div class="dialog-head"><strong id="sharePromptTitle">请确认操作</strong><button class="dialog-close" id="sharePromptClose" type="button" aria-label="关闭">×</button></div><div class="dialog-body"><p id="sharePromptText" style="margin:0;color:var(--muted);line-height:1.7"></p><div class="row" style="justify-content:flex-end;margin-top:18px"><button class="button" id="sharePromptCancel" type="button">取消</button><button class="button primary" id="sharePromptAccept" type="button">确认</button></div></div>';
			document.body.appendChild(promptDialog);
			window.askShareConfirm = function (message, title) { return new Promise(function (resolve) { document.getElementById('sharePromptTitle').textContent = title || '请确认操作'; document.getElementById('sharePromptText').textContent = message; document.getElementById('sharePromptCancel').hidden = false; document.getElementById('sharePromptAccept').textContent = '确认'; function finish(value) { promptDialog.close(); resolve(value); } document.getElementById('sharePromptAccept').onclick = function () { finish(true); }; document.getElementById('sharePromptCancel').onclick = function () { finish(false); }; document.getElementById('sharePromptClose').onclick = function () { finish(false); }; promptDialog.showModal(); }); };
			window.showShareNotice = function (message, title) { document.getElementById('sharePromptTitle').textContent = title || '操作提示'; document.getElementById('sharePromptText').textContent = message; document.getElementById('sharePromptCancel').hidden = true; document.getElementById('sharePromptAccept').textContent = '知道了'; document.getElementById('sharePromptAccept').onclick = function () { promptDialog.close(); }; document.getElementById('sharePromptClose').onclick = function () { promptDialog.close(); }; promptDialog.showModal(); };
			promptDialog.addEventListener('cancel', function (event) { event.preventDefault(); if (document.getElementById('sharePromptCancel').hidden) promptDialog.close(); else document.getElementById('sharePromptCancel').click(); });
			function addResetButtons() {
				document.querySelectorAll('[data-edit]').forEach(function (editButton) {
					var actions = editButton.parentElement;
					if (!actions || actions.querySelector('[data-reset="' + editButton.dataset.edit + '"]')) return;
					var button = document.createElement('button');
					button.className = 'share-action';
					button.type = 'button';
					button.dataset.reset = editButton.dataset.edit;
					button.textContent = '重置链接';
					actions.insertBefore(button, editButton.nextSibling);
				});
			}
			var originalRender = render;
			render = function () {
				originalRender();
				addResetButtons();
			};
			list.addEventListener('click', function (event) {
				var button = event.target.closest('[data-reset]');
				if (!button) return;
				var oldId = button.dataset.reset;
				askShareConfirm('重置后，当前订阅链接将失效，已使用旧链接的客户端需要更新。KV 同步可能有短暂延迟。','重置分享链接').then(function (accepted) {
					if (!accepted) return;
					button.disabled = true;
					return call('PATCH', { id: oldId }).then(function (data) {
					var index = shares.findIndex(function (item) { return item.id === oldId; });
					if (index >= 0) shares[index] = data.share;
					if (document.getElementById('shareId').value === oldId) document.getElementById('shareId').value = data.share.id;
					render();
					showShareNotice('订阅链接已重置，请复制新的链接。');
				}).catch(function (error) {
					button.disabled = false;
					showShareNotice(error.message, '重置失败');
				});
				});
			});
			addResetButtons();
		})();
