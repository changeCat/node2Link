import { timed } from '../timing.js';
import { selectSubscriptionFormat } from '../domain/formats.js';
import { CONVERTER_FETCH_TIMEOUT_MS, sanitizeSubscriptionName, SUBSCRIPTION_NO_STORE_HEADERS } from '../config.js';
import { ADD, encodeBase64, isV2rayNUserAgent, normalizeV2rayNSubscription, clashFix } from '../domain/nodes.js';
import { getSUB } from '../adapters/upstream.js';
import { fetchCustomSubscription, fetchConvertedSubscription, converterOrigin } from '../adapters/converters.js';
import { queueTelegram, sendMessage, shouldSendSubscriptionNotification } from '../adapters/telegram.js';
import { detectSubscriptionClient, queueSubscriptionRequestLog } from '../storage/request-logs.js';
import { readGeneratedNodes } from '../storage/generated-nodes.js';

async function fetchConfiguredConversion(runtime, target, sourceURL, init, options) {
	if (runtime.converterMode !== 'custom') {
		const result = await fetchConvertedSubscription(runtime.subConverters, target === 'base64' ? 'mixed' : target, sourceURL, runtime.subConfig, init, options);
		const service = result ? converterOrigin(result.converter) : runtime.subConverters.map(converterOrigin).join('、');
		return { result, notice: '转换服务: 默认 Subconverter（' + service + '）' + (result ? '' : '\n提示: 默认转换服务不可用'), route: result ? 'default' : 'failed' };
	}

	const converter = runtime.customConverterURL;
	const result = converter ? await timed(options.timings, 'conversion_custom', () => fetchCustomSubscription(converter, target, sourceURL, init, {
		...options,
		conversionTimeoutMs: options.conversionTimeoutMs || options.timeoutMs || CONVERTER_FETCH_TIMEOUT_MS,
		configURL: runtime.subConfig
	})) : null;
	return {
		result,
		notice: '转换服务: 自建 Subconverter（' + (converterOrigin(converter) || '地址未配置或无效') + '）'
			+ (result ? '' : '\n提示: 自建转换不可用，已停止更新，未使用默认服务；请检查服务状态、地址及访问密钥'),
		route: result ? 'custom' : 'failed'
	};
}

export async function serveSubscription(request, env, ctx, runtime, sourceData, access, includeWarp, subscriptionId = '', subscriptionName = '', options = {}) {
		const startedAt = Date.now();
		const userAgentHeader = request.headers.get('User-Agent');
		const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : 'null';
		const url = new URL(request.url);
		const effectiveSubscriptionName = access === 'share'
			? sanitizeSubscriptionName(subscriptionName)
			: runtime.FileName;

		let mainData = sourceData || '';
		let urls = [];
		if (access === 'main' && env.LINKSUB) urls = await ADD(env.LINKSUB);

		const allLinks = await ADD(mainData + '\n' + urls.join('\n'));
		let selfBuiltNodes = '';
		let subscriptionLinks = '';
		for (const link of allLinks) {
			if (link.toLowerCase().startsWith('http')) subscriptionLinks += link + '\n';
			else selfBuiltNodes += link + '\n';
		}
		mainData = selfBuiltNodes;
		urls = await ADD(subscriptionLinks);

		const directSource = url.searchParams.get('source') === 'direct';
		const isSubConverterRequest = directSource || request.headers.get('subconverter-request')
			|| request.headers.get('subconverter-version')
			|| userAgent.includes('subconverter');
		const shouldNotifySubscription = !isSubConverterRequest && request.method === 'GET' && shouldSendSubscriptionNotification(request);

		const subscriptionFormat = selectSubscriptionFormat(url, userAgentHeader, isSubConverterRequest);

		const sourceBaseURL = access === 'main'
			? `${url.origin}/s/${encodeURIComponent(runtime.mainSubscriptionId)}`
			: url.origin + url.pathname;
		// Let our callback normalize ordinary upstream subscriptions before the
		// converter sees them. Structured subscriptions remain direct converter inputs.
		let converterSourceURL = sourceBaseURL + '?base64';
		let requestData = mainData;
		let appendUA = 'v2rayn';
		let usedConverter = '';
		let converterRoute = '';
		let conversionFailed = false;
		const converterNotices = [];
		if (url.searchParams.has('clash')) appendUA = 'clash';
		else if (url.searchParams.has('singbox')) appendUA = 'singbox';
		else if (url.searchParams.has('surge')) appendUA = 'surge';
		else if (url.searchParams.has('quanx')) appendUA = 'Quantumult%20X';
		else if (url.searchParams.has('loon')) appendUA = 'Loon';

		let upstreamFailures = 0;
		const finish = (body, headers, status = 200) => {
			const durationMs = Date.now() - startedAt;
			headers['X-Node2Link-Format'] = subscriptionFormat;
			if (converterRoute) headers['X-Node2Link-Converter-Route'] = converterRoute;
			headers['Server-Timing'] = 'subscription;dur=' + durationMs;
			if (upstreamFailures) headers['X-Node2Link-Upstream-Failures'] = String(upstreamFailures);
			if (shouldNotifySubscription) {
				queueTelegram(ctx, sendMessage(runtime, effectiveSubscriptionName, request.headers.get('CF-Connecting-IP'), {
					userAgent: userAgentHeader || 'Unknown',
					hostname: url.hostname
				}, ['订阅结果: ' + (status >= 400 ? '失败（HTTP ' + status + '）' : upstreamFailures ? '部分来源获取失败' : '成功'), ...(converterNotices.length ? [...new Set(converterNotices)] : ['转换服务: 本地生成（未调用外部转换服务）'])]));
			}
			if (!isSubConverterRequest && env?.KV) queueSubscriptionRequestLog(ctx, env, { client: detectSubscriptionClient(userAgentHeader), userAgent: userAgentHeader || 'Unknown', format: subscriptionFormat, access, subscriptionId, status, durationMs, upstreamFailures });
			console.log(JSON.stringify({ event: 'subscription.complete', format: subscriptionFormat, status, durationMs, upstreamFailures, converterRoute }));
			return new Response(body, { status, headers });
		};

		const uniqueSubscriptionLinks = [...new Set(urls)].filter(item => item?.trim?.());
		if (uniqueSubscriptionLinks.length > 0 && !directSource) {
			const subscriptionResponses = await timed(options.timings, 'upstream', () => getSUB(uniqueSubscriptionLinks, request, appendUA, userAgentHeader, options));
			upstreamFailures = subscriptionResponses.failures || 0;
			requestData += subscriptionResponses[0].join('\n');
			if (subscriptionResponses[1]) converterSourceURL += '|' + subscriptionResponses[1];
			if (subscriptionFormat === 'base64' && !isSubConverterRequest && subscriptionResponses[1].includes('://')) {
				const mixedInit = { signal: request.signal, headers: { 'User-Agent': 'v2rayN/CF-Workers-SUB (https://github.com/cmliu/CF-Workers-SUB)' } };
				const mixedConversion = await timed(options.timings, 'conversion', () => fetchConfiguredConversion(
					runtime, 'base64', subscriptionResponses[1], mixedInit, options
				));
				converterNotices.push(mixedConversion.notice);
				converterRoute = mixedConversion.route;
				if (mixedConversion.result) {
					try {
						requestData += '\n' + atob(await mixedConversion.result.response.text());
						usedConverter = mixedConversion.result.converter;
					} catch (error) {
						upstreamFailures += 1;
						conversionFailed = true;
						converterRoute = 'failed';
						converterNotices.push('提示: 转换结果不是有效的 Base64 订阅，已停止更新');
						console.log(JSON.stringify({ event: 'converter.invalid_base64' }));
					}
				} else { upstreamFailures += 1; conversionFailed = true; }
			}
		}

		// API 订阅节点不写入主订阅编辑内容，只在读取主订阅时动态追加到所有主节点之后。
		if (access === 'main' && runtime.apiSubscriptionEnabled) {
			const generatedNodes = await timed(options.timings, 'nodes_read', () => readGeneratedNodes(env.KV));
			if (generatedNodes.length) requestData += '\n' + generatedNodes.map(node => node.content).join('\n');
		}

		if (includeWarp && env.WARP) converterSourceURL += '|' + (await ADD(env.WARP)).join('|');
		let result = [...new Set(requestData.split('\n'))].join('\n');
		let compatibility = null;
		if (subscriptionFormat === 'base64' && isV2rayNUserAgent(userAgentHeader)) {
			compatibility = normalizeV2rayNSubscription(result);
			result = compatibility.content;
		}
		let base64Data;
		try { base64Data = btoa(result); }
		catch (error) { base64Data = encodeBase64(result); }

		const responseHeaders = {
			'content-type': 'text/plain; charset=utf-8',
			'Profile-Update-Interval': `${runtime.SUBUpdateTime}`,
			'Profile-web-page-url': sourceBaseURL,
			'Profile-Title': `base64:${encodeBase64(effectiveSubscriptionName)}`,
			...SUBSCRIPTION_NO_STORE_HEADERS
		};
		if (!userAgent.includes('mozilla')) {
			responseHeaders['Content-Disposition'] = `attachment; filename*=utf-8''${encodeURIComponent(effectiveSubscriptionName)}`;
		}
		if (compatibility?.filteredSsObfsTls) responseHeaders['X-Node2Link-Filtered'] = `ss-obfs-tls=${compatibility.filteredSsObfsTls}`;
		if (compatibility?.normalizedAnytlsSni) responseHeaders['X-Node2Link-Normalized'] = `anytls-sni=${compatibility.normalizedAnytlsSni}`;
		if (usedConverter) responseHeaders['X-Subconverter-Used'] = converterOrigin(usedConverter);
		if (conversionFailed) return finish('订阅转换失败，请在管理页检查转换服务配置', responseHeaders, 502);
		if (subscriptionFormat === 'base64') return finish(base64Data, responseHeaders);

		const conversionInit = { signal: request.signal, headers: { 'User-Agent': userAgentHeader || 'CF-Workers-SUB' } };
		const conversion = await timed(options.timings, 'conversion', () => fetchConfiguredConversion(
			runtime, subscriptionFormat, converterSourceURL, conversionInit, options
		));
		converterNotices.push(conversion.notice);
		converterRoute = conversion.route;
		if (!conversion.result) return finish('订阅转换失败，请稍后重试或在管理页检查转换服务配置', responseHeaders, 502);

		responseHeaders['X-Subconverter-Used'] = converterOrigin(conversion.result.converter);
		let convertedContent = await conversion.result.response.text();
		if (subscriptionFormat === 'clash') convertedContent = await clashFix(convertedContent);
		return finish(convertedContent, responseHeaders);
	}
