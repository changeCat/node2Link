import { mainNodeSummary } from '../shared/main-subscription.js';

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function subscriptionNodeDetails(content) {
 const info = mainNodeSummary(content);
 return { ...info, port: info.address.match(/:(\d+)$/)?.[1] || '—' };
}

// Only callers supply markup for controls; all node/configuration text is escaped here.
export function subscriptionCard({ name, protocol, address, port, checkbox = '', actions = '', detail = '', footerNote = '', addressTitle = address, portAttributes = '', showPort = false, dragHandle = '' }) {
 return '<div class="subscription-card-heading">' + dragHandle + checkbox + '<strong title="' + esc(name) + '">' + esc(name) + '</strong><span class="main-badge">' + esc(protocol) + '</span></div>'
  + '<small class="subscription-card-address" title="' + esc(addressTitle) + '">' + esc(address) + '</small>' + detail
  + '<div class="subscription-card-footer">' + (showPort ? '<div class="subscription-card-port">端口 <strong' + portAttributes + '>' + esc(port) + '</strong></div>' : '') + footerNote + '<div class="subscription-card-actions">' + actions + '</div></div>';
}
