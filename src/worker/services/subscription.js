import { timed } from '../timing.js';
import { inspectLoonConversion } from '../domain/conversion-audit.js';
import { selectSubscriptionFormat } from '../domain/formats.js';
import { DEFAULT_FILE_NAME, BASE64_SUBSCRIPTION_USER_AGENT, CONVERTER_FETCH_TIMEOUT_MS, sanitizeSubscriptionName, SUBSCRIPTION_NO_STORE_HEADERS } from '../config.js';
import { splitSubscriptionLinks, encodeBase64, isV2rayNUserAgent, normalizeV2rayNSubscription, clashFix } from '../domain/nodes.js';
import { getSUB } from '../adapters/upstream.js';
import { fetchCustomSubscription, fetchConvertedSubscription, converterOrigin, converterTypeLabel } from '../adapters/converters.js';
import { queueTelegram, sendMessage, shouldSendSubscriptionNotification } from '../adapters/telegram.js';
import { detectSubscriptionClient, queueSubscriptionRequestLog } from '../storage/request-logs.js';
import { readGeneratedNodes } from '../storage/generated-nodes.js';
import { canProxySources, createSourceProxyURL } from '../source-proxy.js';

const MAX_PROXIED_SOURCES = 8;
const MAX_PROXY_SOURCE_LIST_LENGTH = 7 * 1024;

async function protectRemoteSources(env, origin, sources, sourcePrefix, options = {}) {
	const uniqueSources = [...new Set(sources || [])].filter(Boolean);
	if (!uniqueSources.length || uniqueSources.length > MAX_PROXIED_SOURCES || !canProxySources(env)) return '';
	try {
		const proxyURLs = await timed(options.timings, 'source_proxy', () => Promise.all(uniqueSources.map(source => createSourceProxyURL(env, origin, source))));
		const protectedSources = proxyURLs.join('|');
		if ((sourcePrefix + '|' + protectedSources).length > MAX_PROXY_SOURCE_LIST_LENGTH) return '';
		return protectedSources;
	} catch (error) {
		console.log(JSON.stringify({ event: 'source_proxy.skipped', reason: 'unavailable', type: error?.name || 'Error', sources: uniqueSources.length }));
		return '';
	}
}

async function fetchConfiguredConversion(runtime, target, sourceURL, init, options) {
 const budget = options.conversionTimeoutMs || options.timeoutMs || CONVERTER_FETCH_TIMEOUT_MS;
 const deadline = Date.now() + budget;
 let failure = null, customNotice = '';
 const onFailure = value => { failure = value; };
 if (runtime.converterMode === 'custom') {
  const customLabel = '自建 ' + converterTypeLabel(runtime.customConverterType) + '（' + (converterOrigin(runtime.customConverterURL) || '地址未配置或无效') + '）';
  const result = await timed(options.timings, 'conversion_custom', () => fetchCustomSubscription(runtime.customConverterURL, target, sourceURL, init, {
   ...options, converterType: runtime.customConverterType, configURL: runtime.subConfig, onFailure,
   conversionTimeoutMs: Math.min(options.customAttemptTimeoutMs || 8000, Math.max(1, Math.floor(budget * 0.4)))
  }));
  if (result) return { result, notice: '转换服务: ' + customLabel, route: 'custom' };
  customNotice = '自定义尝试: ' + customLabel + '\n回退原因: ' + (failure?.reason || '不可用');
 }
 if (init.signal?.aborted) return { result: null, notice: customNotice + '\n提示: 请求已取消，未继续回退', route: 'failed', audit: failure?.audit };
 const customFailure = failure;
 const remaining = deadline - Date.now();
 const result = remaining > 0 ? await timed(options.timings, runtime.converterMode === 'custom' ? 'conversion_fallback' : 'conversion_default', () => fetchConvertedSubscription(
  runtime.subConverters, target === 'base64' ? 'mixed' : target, sourceURL, runtime.subConfig, init,
  { ...options, conversionTimeoutMs: remaining, onFailure }
 )) : null;
 const service = result ? converterOrigin(result.converter) : runtime.subConverters.map(converterOrigin).join('、');
 return { result, route: result ? runtime.converterMode === 'custom' ? 'fallback' : 'default' : 'failed',
  audit: result?.audit || failure?.audit || customFailure?.audit,
  notice: (customNotice ? customNotice + '\n' : '') + '转换服务: 默认 Subconverter（' + service + '）'
   + (runtime.converterMode === 'custom' ? '\n回退结果: ' + (result ? '已使用默认服务' : '默认服务也不可用，已停止更新') : result ? '' : '\n提示: 默认转换服务不可用')
   + (!result && failure?.reason ? '\n失败原因: ' + failure.reason : '')
 };
}

export async function serveSubscription(request, env, ctx, runtime, sourceData, access, includeWarp, subscriptionId = '', subscriptionName = '', options = {}) {
		const startedAt = Date.now();
		const requestDeadline = startedAt + (options.subscriptionTimeoutMs || options.conversionTimeoutMs || options.timeoutMs || CONVERTER_FETCH_TIMEOUT_MS);
		const userAgentHeader = request.headers.get('User-Agent');
		const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : 'null';
		const url = new URL(request.url);
		const effectiveSubscriptionName = access === 'share'
			? sanitizeSubscriptionName(subscriptionName)
			: runtime.FileName;

		let mainData = sourceData || '';
		let urls = [];
		if (access === 'main' && env.LINKSUB) urls = splitSubscriptionLinks(env.LINKSUB);

		const allLinks = splitSubscriptionLinks(mainData + '\n' + urls.join('\n'));
		let selfBuiltNodes = '';
		let subscriptionLinks = '';
		for (const link of allLinks) {
			if (link.toLowerCase().startsWith('http')) subscriptionLinks += link + '\n';
			else selfBuiltNodes += link + '\n';
		}
		mainData = selfBuiltNodes;
		urls = splitSubscriptionLinks(subscriptionLinks);

		const directSource = url.searchParams.get('source') === 'direct';
		const isSubConverterRequest = directSource || url.searchParams.get('source') === 'normalized' || request.headers.get('subconverter-request')
			|| request.headers.get('subconverter-version')
			|| userAgent.includes('subconverter');
		const shouldNotifySubscription = !isSubConverterRequest && request.method === 'GET' && shouldSendSubscriptionNotification(request);

		const subscriptionFormat = selectSubscriptionFormat(url, userAgentHeader, isSubConverterRequest);

		const sourceBaseURL = access === 'main'
			? `${url.origin}/s/${encodeURIComponent(runtime.mainSubscriptionId)}`
			: url.origin + url.pathname;
		const warpSources = includeWarp && env.WARP ? splitSubscriptionLinks(env.WARP) : [];
		const warpLinks = warpSources.filter(item => /^https?:\/\//i.test(item));
		const warpNodes = warpSources.filter(item => !/^https?:\/\//i.test(item));
		// Let our callback normalize ordinary upstream subscriptions before the
		// converter sees them. Structured subscriptions remain direct converter inputs.
		let converterSourceURL = sourceBaseURL + '?base64&source=normalized' + (subscriptionFormat === 'loon' && warpNodes.length ? '&warp=1' : '');
		let requestData = mainData;
		let appendUA = 'v2rayn';
		let usedConverter = '';
		let converterRoute = '';
		let conversionFailed = false;
		let sourceCountComplete = true;
		let conversionAudit = null;
		let sourceMode = 'normalized';
		let sourceSafetyFailure = '';
		let protectedStructuredSources = '';
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
			if (sourceMode !== 'normalized') headers['X-Node2Link-Source-Mode'] = sourceMode;
			headers['Server-Timing'] = 'subscription;dur=' + durationMs;
			if (upstreamFailures) headers['X-Node2Link-Upstream-Failures'] = String(upstreamFailures);
			if (shouldNotifySubscription) {
				queueTelegram(ctx, sendMessage(runtime, effectiveSubscriptionName, request.headers.get('CF-Connecting-IP'), {
					userAgent: userAgentHeader || 'Unknown',
					hostname: url.hostname
				}, [
					'订阅结果: ' + (status >= 400 ? '失败（HTTP ' + status + '）' : upstreamFailures ? '部分来源获取失败' : '成功'),
					'目标格式: ' + ({ base64: 'Base64', loon: 'Loon', clash: 'Clash', singbox: 'Sing-box', surge: 'Surge', quanx: 'QuanX' }[subscriptionFormat] || subscriptionFormat),
					...(converterNotices.length ? [...new Set(converterNotices)] : [
						'处理方式: 本地合并与编码（目标格式无需外部转换）',
						'转换服务: 未调用（无需转换）',
						'转换配置: ' + (runtime.converterMode === 'custom' ? '自建 ' + converterTypeLabel(runtime.customConverterType) + '（' + (converterOrigin(runtime.customConverterURL) || '地址未配置或无效') + '）' : '默认 Subconverter')
					])
				]));
			}
			if (!isSubConverterRequest && env?.KV) queueSubscriptionRequestLog(ctx, env, { client: detectSubscriptionClient(userAgentHeader), userAgent: userAgentHeader || 'Unknown', format: subscriptionFormat, access, subscriptionId, status, durationMs, upstreamFailures });
			console.log(JSON.stringify({ event: 'subscription.complete', format: subscriptionFormat, status, durationMs, upstreamFailures, converterRoute, ...(conversionAudit ? { conversionCheck: conversionAudit.check, inputNodes: conversionAudit.inputCount, outputNodes: conversionAudit.outputCount, missingProtocols: conversionAudit.missing } : {}) }));
			return new Response(body, { status, headers });
		};

		const uniqueSubscriptionLinks = [...new Set(urls)].filter(item => item?.trim?.());
		const convertedRequest = subscriptionFormat !== 'base64' && !isSubConverterRequest;
		const proxyInputs = [...new Set([...uniqueSubscriptionLinks, ...warpLinks])];
		let useSourceProxy = false;
		const proxyCandidate = convertedRequest && subscriptionFormat !== 'loon'
			&& proxyInputs.length > 0 && proxyInputs.length <= MAX_PROXIED_SOURCES && canProxySources(env);
		if (proxyCandidate) {
			try {
				const proxyURLs = await timed(options.timings, 'source_proxy', () => Promise.all(proxyInputs.map(source => createSourceProxyURL(env, url.origin, source))));
				const proxiedSourceURL = sourceBaseURL + '?base64&source=direct|' + proxyURLs.join('|');
				if (proxiedSourceURL.length <= MAX_PROXY_SOURCE_LIST_LENGTH) {
					converterSourceURL = proxiedSourceURL;
					useSourceProxy = true;
					sourceCountComplete = false;
					sourceMode = 'proxied';
				} else console.log(JSON.stringify({ event: 'source_proxy.skipped', reason: 'source_list_too_long', sources: proxyInputs.length }));
			} catch (error) {
				console.log(JSON.stringify({ event: 'source_proxy.skipped', reason: 'unavailable', type: error?.name || 'Error', sources: proxyInputs.length }));
			}
		}
		if (uniqueSubscriptionLinks.length > 0 && !directSource && !useSourceProxy) {
			const subscriptionResponses = await timed(options.timings, 'upstream', () => getSUB(uniqueSubscriptionLinks, request, appendUA, userAgentHeader, options));
			upstreamFailures = subscriptionResponses.failures || 0;
			requestData += subscriptionResponses[0].join('\n');
			if (subscriptionResponses[1]) {
				protectedStructuredSources = await protectRemoteSources(env, url.origin, splitSubscriptionLinks(subscriptionResponses[1]), converterSourceURL, options);
				if (!protectedStructuredSources) sourceSafetyFailure = 'structured_source_unprotected';
				else { converterSourceURL += '|' + protectedStructuredSources; sourceCountComplete = false; }
			}
			if (subscriptionFormat === 'base64' && !isSubConverterRequest && !upstreamFailures && protectedStructuredSources) {
				const mixedInit = { signal: request.signal, headers: { 'User-Agent': BASE64_SUBSCRIPTION_USER_AGENT } };
				const mixedConversion = await timed(options.timings, 'conversion', () => fetchConfiguredConversion(
					runtime, 'base64', protectedStructuredSources, mixedInit, { ...options, conversionTimeoutMs: Math.max(1, requestDeadline - Date.now()) }
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

		if ((directSource || (convertedRequest && subscriptionFormat === 'loon') || (isSubConverterRequest && url.searchParams.get('source') === 'normalized' && url.searchParams.has('warp'))) && warpNodes.length) requestData += '\n' + warpNodes.join('\n');
		if (includeWarp && env.WARP && !useSourceProxy && !directSource) {
			let protectedWarpSources = '';
			if (warpLinks.length) {
				protectedWarpSources = await protectRemoteSources(env, url.origin, warpLinks, converterSourceURL, options);
				if (!protectedWarpSources) sourceSafetyFailure ||= 'remote_warp_unprotected';
			}
			const converterWarpSources = [...(subscriptionFormat === 'loon' ? [] : warpNodes), ...(protectedWarpSources ? protectedWarpSources.split('|') : [])];
			if (converterWarpSources.length) converterSourceURL += '|' + converterWarpSources.join('|');
			if (warpLinks.length || (subscriptionFormat !== 'loon' && warpNodes.length)) sourceCountComplete = false;
		}
		let result = [...new Set(requestData.split('\n'))].join('\n');
		let compatibility = null;
		if (subscriptionFormat === 'base64' && isV2rayNUserAgent(userAgentHeader)) {
			compatibility = normalizeV2rayNSubscription(result);
			result = compatibility.content;
		}
		const base64Data = encodeBase64(result);

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
		if (sourceSafetyFailure) {
			converterNotices.push('处理方式: 远程来源无法安全核验或隐藏，已停止更新', '转换服务: 未调用（避免泄露来源或返回缺失节点）');
			console.log(JSON.stringify({ event: 'subscription.source_rejected', format: subscriptionFormat, reason: sourceSafetyFailure }));
			return finish('订阅转换失败：远程来源无法安全核验或隐藏，为避免节点缺失或来源泄露，已停止更新', responseHeaders, 502);
		}
		if (upstreamFailures && !conversionFailed) {
   converterNotices.push('处理方式: 来源读取失败，已停止更新，未返回不完整节点', '转换服务: 未调用（来源读取失败）');
   return finish('订阅转换失败：部分来源读取失败，请稍后重试', responseHeaders, 502);
  }
		if (conversionFailed) return finish('订阅转换失败，请在管理页检查转换服务配置', responseHeaders, 502);
		if (subscriptionFormat === 'base64') return finish(base64Data, responseHeaders);

		const conversionInit = { signal: request.signal, headers: { 'User-Agent': userAgentHeader || DEFAULT_FILE_NAME } };
		const remainingConversionMs = requestDeadline - Date.now();
		if (remainingConversionMs <= 0) {
			converterRoute = 'failed';
			converterNotices.push('提示: 本次订阅处理已用完转换时间预算');
			return finish('订阅转换失败：处理超时，请稍后重试', responseHeaders, 502);
		}
		const conversion = await timed(options.timings, 'conversion', () => fetchConfiguredConversion(
			runtime, subscriptionFormat, converterSourceURL, conversionInit, { ...options,
			conversionTimeoutMs: remainingConversionMs,
    validateContent: subscriptionFormat === 'loon' ? content => inspectLoonConversion(requestData, content, { completeSource: sourceCountComplete && !upstreamFailures }) : undefined
   }
		));
		converterNotices.push(conversion.notice);
		converterRoute = conversion.route;
		if (!conversion.result) {
   conversionAudit = conversion.audit;
   if (conversionAudit) {
    responseHeaders['X-Node2Link-Conversion-Check'] = conversionAudit.check;
    responseHeaders['X-Node2Link-Input-Nodes'] = String(conversionAudit.inputCount);
    responseHeaders['X-Node2Link-Output-Nodes'] = String(conversionAudit.outputCount);
    converterNotices.push('节点数量: 已读取 ' + conversionAudit.inputCount + '，转换输出 ' + conversionAudit.outputCount);
   }
   const missing = conversionAudit?.missing.map(item => item.protocol.toUpperCase() + ' ' + item.count + ' 个').join('、');
   return finish('订阅转换失败：' + (missing ? '转换结果缺少 ' + missing : '转换服务不可用') + '，请检查转换配置', responseHeaders, 502);
  }

		responseHeaders['X-Subconverter-Used'] = converterOrigin(conversion.result.converter);
		let convertedContent = await conversion.result.response.text();
		if (subscriptionFormat === 'loon') {
			conversionAudit = conversion.result.audit;
			responseHeaders['X-Node2Link-Conversion-Check'] = conversionAudit.check;
			responseHeaders['X-Node2Link-Input-Nodes'] = String(conversionAudit.inputCount);
			responseHeaders['X-Node2Link-Output-Nodes'] = String(conversionAudit.outputCount);
			converterNotices.push('节点数量: 已读取 ' + conversionAudit.inputCount + '，转换输出 ' + conversionAudit.outputCount + (conversionAudit.hasRemoteNodes ? '（另含远程节点，无法核对总数）' : sourceCountComplete && !upstreamFailures ? '' : '（来源总数未完全确定）'));
			if (conversionAudit.check === 'unverified') converterNotices.push('提示: 节点数量未完全核验，请在客户端确认节点完整性');
		}

		if (subscriptionFormat === 'clash') convertedContent = await clashFix(convertedContent);
		return finish(convertedContent, responseHeaders);
	}
