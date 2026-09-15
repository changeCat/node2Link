export const subscriptionCardStyles = `
.subscription-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:6px;align-content:start}
.subscription-card,.node-grid .subscription-card{display:block;min-width:0;max-width:300px;padding:9px;border:1px solid var(--line-soft);border-radius:6px;background:var(--surface,#fff)}
.subscription-card-heading{display:flex;align-items:center;gap:7px;min-width:0}
.subscription-card .subscription-card-heading strong{flex:1;min-width:0;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:20px}
.subscription-card-heading>input[type=checkbox]{flex:none;margin:0;accent-color:var(--green)}
.subscription-card .main-badge{display:inline-block;flex:none;padding:2px 6px;border:0;border-radius:4px;background:var(--green-soft);color:var(--green);font-size:10px;font-weight:500;line-height:1.4;white-space:nowrap}
.subscription-card small.subscription-card-address{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px/1.5 ui-monospace,monospace;color:var(--muted);margin-top:3px}
.subscription-card-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-top:6px}
.subscription-card-port{display:flex;align-items:center;gap:4px;color:var(--muted);font-size:11px;white-space:nowrap}
.subscription-card .subscription-card-port strong{font-size:12px;color:var(--text)}
.subscription-card-actions{display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-left:auto}
.subscription-card .subscription-card-actions button{display:inline-flex;align-items:center;justify-content:center;height:28px;min-height:28px;padding:3px 7px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);font-size:11px;line-height:1;white-space:nowrap;cursor:pointer}
.subscription-card .subscription-card-actions .danger-button{border-color:#f2c6c2;color:var(--danger)}
.subscription-card .subscription-card-actions button:disabled{opacity:.55;cursor:wait}
.subscription-card .subscription-card-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:3px 0 0;font-size:11px;line-height:1.5;color:var(--muted)}
@media(max-width:700px){.subscription-card,.node-grid .subscription-card{max-width:none}}
.subscription-card .message{font-size:12px;margin:6px 0}
`;
