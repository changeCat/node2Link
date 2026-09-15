export function applyFilter(value, filter) {
	const [operation, ...args] = filter.split(':');
	if (operation === 'slice') {
		const start = args[0] === '' || args[0] === undefined ? 0 : Number(args[0]);
		const end = args[1] === '' || args[1] === undefined ? undefined : Number(args[1]);
		if (!Number.isInteger(start) || (end !== undefined && !Number.isInteger(end))) throw new Error(`无效的 slice 截取操作：${filter}`);
		return String(value).slice(start, end);
	}
	if (operation === 'split') {
		const separator = args[0] ?? '';
		const index = Number(args[1] ?? 0);
		if (!separator || !Number.isInteger(index)) throw new Error(`无效的 split 分段操作：${filter}`);
		const parts = String(value).split(separator);
		return parts[index < 0 ? parts.length + index : index] || '';
	}
	throw new Error(`不支持的模板操作：${operation}`);
}

export function applyVariables(template, variables) {
	return String(template).replace(/\{\{(address|port|name|type)((?:\|[^{}|]+)*)\}\}/g, (_match, key, filters) => {
		let value = variables[key];
		for (const filter of String(filters || '').split('|').filter(Boolean)) value = applyFilter(value, filter);
		return value;
	});
}

export function hasVariable(template, names) {
	return new RegExp(`\\{\\{(?:${names.join('|')})(?:\\|[^{}|]+)*\\}\\}`).test(template);
}

