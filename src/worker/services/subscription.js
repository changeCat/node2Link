import { timed } from '../timing.js';
import { selectSubscriptionFormat } from '../domain/formats.js';
import { sanitizeSubscriptionName, SUBSCRIPTION_NO_STORE_HEADERS } from '../config.js';
import { ADD, encodeBase64, isV2rayNUserAgent, normalizeV2rayNSubscription, clashFix } from '../domain/nodes.js';
import { getSUB } from '../adapters/upstream.js';
import { normalizeSublinkConverter, fetchSublinkSubscription, fetchConvertedSubscription, supportsSublinkTarget } from '../adapters/converters.js';
import { queueTelegram, sendMessage, shouldSendSubscriptionNotification } from '../adapters/telegram.js';
import { detectSubscriptionClient, queueSubscriptionRequestLog } from '../storage/request-logs.js';
import { readGeneratedNodes } from '../storage/generated-nodes.js';
export async function serveSubscription(request, env, ctx, runtime, sourceData, access, includeWarp, subscriptionId = '', subscriptionName = '', options = {}) {
		const startedAt = Date.now();
		const userAgentHeader = request.headers.get('User-Agent');
		const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : 'null';
		const url = new URL(request.url);
		const effectiveSubscriptionName = access === 'share'
			? sanitizeSubscriptionName(subscriptionName)
			: runtime.FileName;
		const customSublinkConverter = runtime.converterMode === 'custom'
			? runtime.customConverterURL
			: (!env.KV ? normalizeSublinkConverter(url.searchParams.get('converter')) : '');

		let mainData = sourceData || '';
		let urls = [];
		if (access === 'main' && !env.KV && env.LINKSUB) urls = await ADD(env.LINKSUB);

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
		if (!isSubConverterRequest && request.method === 'GET' && shouldSendSubscriptionNotification(request)) {
			queueTelegram(ctx, sendMessage(runtime, effectiveSubscriptionName, request.headers.get('CF-Connecting-IP'), {
				userAgent: userAgentHeader || 'Unknown',
				hostname: url.hostname
			}));
		}

		const subscriptionFormat = selectSubscriptionFormat(url, userAgentHeader, isSubConverterRequest);

		const sourceBaseURL = access === 'main'
			? `${url.origin}/s/${encodeURIComponent(runtime.mainSubscriptionId)}`
			: url.origin + url.pathname;
		let converterSourceURL = sourceBaseURL + '?base64&source=direct';
		if (subscriptionFormat !== 'base64' && urls.filter(Boolean).length) converterSourceURL += '|' + urls.filter(Boolean).join('|');
		let requestData = mainData;
		let appendUA = 'v2rayn';
		let usedConverter = '';
		if (url.searchParams.has('clash')) appendUA = 'clash';
		else if (url.searchParams.has('singbox')) appendUA = 'singbox';
		else if (url.searchParams.has('surge')) appendUA = 'surge';
		else if (url.searchParams.has('quanx')) appendUA = 'Quantumult%20X';
		else if (url.searchParams.has('loon')) appendUA = 'Loon';

		let upstreamFailures = 0;
		const finish = (body, headers, status = 200) => {
			const durationMs = Date.now() - startedAt;
			headers['X-Node2Link-Format'] = subscriptionFormat;
			headers['Server-Timing'] = 'subscription;dur=' + durationMs;
			if (upstreamFailures) headers['X-Node2Link-Upstream-Failures'] = String(upstreamFailures);
			if (!isSubConverterRequest && runtime.requestLogEnabled) queueSubscriptionRequestLog(ctx, env, { client: detectSubscriptionClient(userAgentHeader), userAgent: userAgentHeader || 'Unknown', format: subscriptionFormat, access, subscriptionId, status, durationMs, upstreamFailures });
			console.log(JSON.stringify({ event: 'subscription.complete', format: subscriptionFormat, status, durationMs, upstreamFailures }));
			return new Response(body, { status, headers });
		};

		const uniqueSubscriptionLinks = [...new Set(urls)].filter(item => item?.trim?.());
		if (uniqueSubscriptionLinks.length > 0 && subscriptionFormat === 'base64' && !directSource) {
			const subscriptionResponses = await timed(options.timings, 'upstream', () => getSUB(uniqueSubscriptionLinks, request, appendUA, userAgentHeader, options));
			upstreamFailures = subscriptionResponses.failures || 0;
			requestData += subscriptionResponses[0].join('\n');
			if (subscriptionResponses[1]) converterSourceURL += '|' + subscriptionResponses[1];
			if (subscriptionFormat === 'base64' && !isSubConverterRequest && subscriptionResponses[1].includes('://')) {
				const mixedInit = { signal: request.signal, headers: { 'User-Agent': 'v2rayN/CF-Workers-SUB (https://github.com/cmliu/CF-Workers-SUB)' } };
				const mixedResult = await timed(options.timings, 'conversion', () => customSublinkConverter
					? fetchSublinkSubscription(customSublinkConverter, 'base64', subscriptionResponses[1], mixedInit, options)
					: fetchConvertedSubscription(runtime.subConverters, 'mixed', subscriptionResponses[1], runtime.subConfig, mixedInit, options));
				if (mixedResult) {
					try {
						requestData += '\n' + atob(await mixedResult.response.text());
						usedConverter = mixedResult.converter;
					} catch (error) {
						upstreamFailures += 1;
						console.log(JSON.stringify({ event: 'converter.invalid_base64' }));
					}
				} else upstreamFailures += 1;
			}
		}

		// API 订阅节点不写入主订阅编辑内容，只在读取主订阅时动态追加到所有主节点之后。
		if (access === 'main' && env.KV && runtime.apiSubscriptionEnabled) {
			const generatedNodes = await timed(options.timings, 'nodes_read', () => readGeneratedNodes(env.KV));
			if (generatedNodes.length) requestData += '\n' + generatedNodes.map(node => node.content).join('\n');
		}

		if (includeWarp && env.WARP) converterSourceURL += '|' + (await ADD(env.WARP)).join('|');
		const text = new TextDecoder().decode(new TextEncoder().encode(requestData));
		let result = [...new Set(text.split('\n'))].join('\n');
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
		if (usedConverter) responseHeaders['X-Subconverter-Used'] = usedConverter;
		if (subscriptionFormat === 'base64') return finish(base64Data, responseHeaders);

		const conversionInit = { signal: request.signal, headers: { 'User-Agent': userAgentHeader || 'CF-Workers-SUB' } };
		const conversionResult = await timed(options.timings, 'conversion', () => customSublinkConverter
			? supportsSublinkTarget(subscriptionFormat)
				? fetchSublinkSubscription(customSublinkConverter, subscriptionFormat, converterSourceURL, conversionInit, options)
				: null
			: fetchConvertedSubscription(runtime.subConverters, subscriptionFormat, converterSourceURL, runtime.subConfig, conversionInit, options));
		if (!conversionResult) return finish('订阅转换失败，请稍后重试或在管理页检查转换服务配置', responseHeaders, 502);

		responseHeaders['X-Subconverter-Used'] = conversionResult.converter;
		let convertedContent = await conversionResult.response.text();
		if (subscriptionFormat === 'clash') convertedContent = await clashFix(convertedContent);
		return finish(convertedContent, responseHeaders);
	}
