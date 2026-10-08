export const subscriptionCardStyles = `
.subscription-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:6px;align-content:start}
.subscription-card,.node-grid .subscription-card{display:block;min-width:0;max-width:300px;padding:9px;border:1px solid var(--line-soft);border-radius:6px;background:var(--surface,#fff)}
.subscription-card-heading{display:flex;align-items:center;gap:7px;min-width:0}
.subscription-card-controls{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex:0 1 auto;min-width:0;max-width:62%;margin-left:auto}
.subscription-card .subscription-card-controls .main-badge{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.node-enable-switch{position:relative;display:inline-block;flex:none;width:40px;height:22px;min-height:22px;margin:0;padding:0;border:2px solid #bb5555;border-radius:999px;background:#f49b9b;cursor:pointer;transition:background .15s,border-color .15s}
.node-enable-switch::after{content:'';position:absolute;top:-1px;left:-1px;width:20px;height:20px;box-sizing:border-box;border:2px solid #a74747;border-radius:50%;background:#fbc1c1;transition:transform .15s,background .15s,border-color .15s}
.node-enable-switch[aria-checked=true]{border-color:#81a943;background:#b5e563}
.node-enable-switch[aria-checked=true]::after{transform:translateX(18px);border-color:#6d9138;background:#b5e563}
.node-enable-switch:focus-visible{outline:2px solid var(--green);outline-offset:3px}
.node-enable-switch:disabled{opacity:.55;cursor:wait}
@media(prefers-reduced-motion:reduce){.node-enable-switch,.node-enable-switch::after{transition:none}}
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
