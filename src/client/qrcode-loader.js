let qrcodePromise;
const assetVersion = globalThis.__NODE2LINK_ASSET_VERSION__ || 'dev';

window.loadQRCode = function loadQRCode() {
	if (window.QRCode) return Promise.resolve(window.QRCode);
	if (qrcodePromise) return qrcodePromise;

	qrcodePromise = new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = `/assets/qrcode.min.js?v=${encodeURIComponent(assetVersion)}`;
		script.async = true;
		script.onload = () => window.QRCode ? resolve(window.QRCode) : reject(new Error('二维码组件初始化失败'));
		script.onerror = () => reject(new Error('二维码组件加载失败'));
		document.head.appendChild(script);
	}).catch(error => {
		qrcodePromise = undefined;
		throw error;
	});

	return qrcodePromise;
};
